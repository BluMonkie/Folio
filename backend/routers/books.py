import contextvars
import io
import json
import logging
import secrets
import shutil
import zipfile
import uuid
import re
from datetime import datetime
from pathlib import Path
from typing import Optional, List
from fastapi import APIRouter, Depends, HTTPException, status, UploadFile, File, Form
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, EmailStr, Field

from backend.config import settings
from backend.database import get_db
from backend.services import storage
from backend.services.auth import get_current_user, CurrentUser
from backend.services.markdown import sync_page_backlinks
from backend.utils import slugify

logger = logging.getLogger("folio.books")

# Thread-local / Async ContextVar for tracking active public share token in request
current_share_token: contextvars.ContextVar[Optional[str]] = contextvars.ContextVar("current_share_token", default=None)

router = APIRouter(prefix="/books", tags=["Books"])

# -----------------------------------------------------------------------------
# Schemas
# -----------------------------------------------------------------------------
class BookCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=255, description="Title of the book")
    slug: Optional[str] = Field(None, max_length=255, description="Custom slug (optional)")

class BookUpdate(BaseModel):
    title: Optional[str] = Field(None, min_length=1, max_length=255, description="Updated title of the book")
    slug: Optional[str] = Field(None, max_length=255, description="Custom slug (optional)")

class BookResponse(BaseModel):
    book_id: int
    owner_id: int
    owner_name: Optional[str] = None
    title: str
    slug: str
    created_at: Optional[datetime] = None
    total_pages: Optional[int] = 0
    user_role: Optional[str] = "OWNER"

class PageTreeNode(BaseModel):
    page_id: int
    parent_page_id: Optional[int] = None
    title: str
    slug: str
    position: int
    depth: int
    breadcrumb: str

class CollaboratorAdd(BaseModel):
    email: EmailStr
    role: str = Field("EDITOR", pattern="^(VIEWER|EDITOR|ADMIN)$")

class CollaboratorResponse(BaseModel):
    user_id: int
    name: str
    email: str
    role: str

class BookImportResponse(BaseModel):
    book_id: int
    title: str
    slug: str
    pages_imported: int
    tags_restored: int
    grants_restored: int
    assets_restored: int = 0
    grants_requested: bool
    skipped_grants: List[str] = []
    message: str

class BookPublishResponse(BaseModel):
    book_id: int
    is_published: bool
    share_token: Optional[str] = None
    access_mode: str = "VIEWER"
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

class BookPublishUpdate(BaseModel):
    is_published: bool
    access_mode: str = "VIEWER"

# -----------------------------------------------------------------------------
# Authorization Helpers
# -----------------------------------------------------------------------------
def get_user_book_role(cursor, book_id: int, user_id: int, share_token: Optional[str] = None) -> Optional[str]:
    """
    Returns the user's role for a book ('OWNER', 'ADMIN', 'EDITOR', 'VIEWER'),
    or falls back to checking an active BookPublish share_token.
    """
    cursor.execute("SELECT owner_id FROM Book WHERE book_id = %s;", (book_id,))
    book = cursor.fetchone()
    if not book:
        return None

    if book["owner_id"] == user_id:
        return "OWNER"

    cursor.execute(
        "SELECT role FROM BookCollaborators WHERE book_id = %s AND user_id = %s;",
        (book_id, user_id)
    )
    collab = cursor.fetchone()
    if collab:
        return collab["role"]

    # Check active public share token if provided (or via request ContextVar)
    token = share_token or current_share_token.get()
    if token:
        cursor.execute(
            "SELECT access_mode FROM BookPublish WHERE book_id = %s AND share_token = %s AND is_active = TRUE;",
            (book_id, token)
        )
        pub = cursor.fetchone()
        if pub:
            return pub["access_mode"]

    return None

def require_book_role(
    cursor, 
    book_id: int, 
    user_id: int, 
    allowed_roles: tuple = ("OWNER", "ADMIN", "EDITOR", "VIEWER"),
    share_token: Optional[str] = None
) -> str:
    """Verifies the user has one of the allowed roles, raising 404 or 403 otherwise."""
    role = get_user_book_role(cursor, book_id, user_id, share_token=share_token)
    if role is None:
        # Check if book exists to decide between 404 and 403
        cursor.execute("SELECT book_id FROM Book WHERE book_id = %s;", (book_id,))
        if not cursor.fetchone():
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Book with ID {book_id} not found.")
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You do not have access to this book.")

    if role not in allowed_roles:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Action requires one of {allowed_roles} roles. Your role is '{role}'."
        )
    return role

# -----------------------------------------------------------------------------
# Endpoints
# -----------------------------------------------------------------------------
@router.get("", response_model=List[BookResponse])
def list_books(current_user: CurrentUser = Depends(get_current_user)):
    """
    Lists only the books accessible to the currently authenticated user:
    - Books owned by the user (role: 'OWNER')
    - Books shared with the user (role: 'ADMIN', 'EDITOR', 'VIEWER')
    """
    query = """
        SELECT 
            b.book_id, 
            b.owner_id,
            u.name AS owner_name,
            b.title, 
            b.slug, 
            b.created_at,
            COUNT(DISTINCT p.page_id) AS total_pages,
            CASE 
                WHEN b.owner_id = %s THEN 'OWNER'
                ELSE bc.role 
            END AS user_role
        FROM Book b
        JOIN User u ON b.owner_id = u.user_id
        LEFT JOIN BookCollaborators bc ON b.book_id = bc.book_id AND bc.user_id = %s
        LEFT JOIN Page p ON b.book_id = p.book_id
        WHERE b.owner_id = %s OR bc.user_id = %s
        GROUP BY b.book_id, b.owner_id, u.name, b.title, b.slug, b.created_at, bc.role
        ORDER BY total_pages DESC, b.title ASC;
    """
    with get_db() as cursor:
        uid = current_user.user_id
        cursor.execute(query, (uid, uid, uid, uid))
        books = cursor.fetchall()
    return books

@router.post("", response_model=BookResponse, status_code=status.HTTP_201_CREATED)
def create_book(payload: BookCreate, current_user: CurrentUser = Depends(get_current_user)):
    """
    Creates a new book owned by the authenticated user:
    - Generates slug, checks uniqueness.
    - Creates storage directory.
    - Sets owner_id to current_user.user_id.
    """
    slug = payload.slug.strip() if payload.slug else slugify(payload.title)
    if not slug:
        raise HTTPException(status_code=400, detail="Could not generate valid slug from title.")

    with get_db() as cursor:
        cursor.execute("SELECT book_id FROM Book WHERE slug = %s;", (slug,))
        if cursor.fetchone():
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Book with slug '{slug}' already exists."
            )

        storage.ensure_book_dir(slug)

        insert_query = """
            INSERT INTO Book (owner_id, title, slug) 
            VALUES (%s, %s, %s);
        """
        cursor.execute(insert_query, (current_user.user_id, payload.title, slug))
        book_id = cursor.lastrowid

        # Provision sandboxed MySQL role for this book
        cursor.execute(f"CREATE ROLE IF NOT EXISTS 'role_book_{book_id}';")
        try:
            cursor.execute(f"GRANT 'role_book_{book_id}' TO '{settings.RUNNER_DB_USER}';")
        except Exception:
            try:
                cursor.execute(f"GRANT 'role_book_{book_id}' TO '{settings.RUNNER_DB_USER}'@'%';")
            except Exception:
                cursor.execute(f"GRANT 'role_book_{book_id}' TO '{settings.RUNNER_DB_USER}'@'localhost';")

        cursor.execute("""
            SELECT 
                b.book_id, b.owner_id, u.name AS owner_name, b.title, b.slug, b.created_at 
            FROM Book b
            JOIN User u ON b.owner_id = u.user_id
            WHERE b.book_id = %s;
        """, (book_id,))
        created_book = cursor.fetchone()
        created_book["total_pages"] = 0
        created_book["user_role"] = "OWNER"

    return created_book

@router.get("/{book_id}", response_model=BookResponse)
def get_book(book_id: int, current_user: CurrentUser = Depends(get_current_user)):
    """Retrieves metadata for a specific book (requires VIEWER, EDITOR, ADMIN, or OWNER)."""
    with get_db() as cursor:
        user_role = require_book_role(cursor, book_id, current_user.user_id)

        query = """
            SELECT 
                b.book_id, 
                b.owner_id,
                u.name AS owner_name,
                b.title, 
                b.slug, 
                b.created_at,
                COUNT(p.page_id) AS total_pages
            FROM Book b
            JOIN User u ON b.owner_id = u.user_id
            LEFT JOIN Page p ON b.book_id = p.book_id
            WHERE b.book_id = %s
            GROUP BY b.book_id, b.owner_id, u.name, b.title, b.slug, b.created_at;
        """
        cursor.execute(query, (book_id,))
        book = cursor.fetchone()
        book["user_role"] = user_role

    return book

@router.get("/{book_id}/tree", response_model=List[PageTreeNode])
def get_book_tree(book_id: int, current_user: CurrentUser = Depends(get_current_user)):
    """
    Returns the hierarchical page tree for a book using a Recursive CTE.
    Requires at least VIEWER access to the book.
    """
    with get_db() as cursor:
        require_book_role(cursor, book_id, current_user.user_id)

        query = """
            WITH RECURSIVE page_tree AS (
                SELECT 
                    page_id, 
                    parent_page_id, 
                    book_id,
                    title, 
                    slug, 
                    position,
                    0 AS depth,
                    CAST(title AS CHAR(1000)) AS breadcrumb,
                    CAST(LPAD(position, 5, '0') AS CHAR(1000)) AS sort_path
                FROM Page
                WHERE book_id = %s AND parent_page_id IS NULL

                UNION ALL

                SELECT 
                    child.page_id, 
                    child.parent_page_id, 
                    child.book_id,
                    child.title, 
                    child.slug, 
                    child.position,
                    parent.depth + 1,
                    CONCAT(parent.breadcrumb, ' / ', child.title),
                    CONCAT(parent.sort_path, '.', LPAD(child.position, 5, '0'))
                FROM Page child
                JOIN page_tree parent ON child.parent_page_id = parent.page_id
            )
            SELECT 
                page_id, 
                parent_page_id, 
                title, 
                slug, 
                position,
                depth, 
                breadcrumb 
            FROM page_tree 
            ORDER BY sort_path;
        """
        cursor.execute(query, (book_id,))
        tree_nodes = cursor.fetchall()

    return tree_nodes

@router.put("/{book_id}", response_model=BookResponse)
def update_book(book_id: int, payload: BookUpdate, current_user: CurrentUser = Depends(get_current_user)):
    """
    Updates book title/slug. Requires OWNER or ADMIN role.
    """
    with get_db() as cursor:
        user_role = require_book_role(cursor, book_id, current_user.user_id, allowed_roles=("OWNER", "ADMIN"))
        cursor.execute("SELECT title, slug FROM Book WHERE book_id = %s;", (book_id,))
        book = cursor.fetchone()
        if not book:
            raise HTTPException(status_code=404, detail="Book not found.")
        
        new_title = payload.title.strip() if payload.title is not None else book["title"]
        if not new_title:
            raise HTTPException(status_code=400, detail="Book title cannot be empty.")
            
        old_slug = book["slug"]
        new_slug = old_slug
        if payload.slug is not None:
            new_slug = slugify(payload.slug)
        elif payload.title is not None and payload.title != book["title"]:
            new_slug = slugify(payload.title)
            
        if new_slug != old_slug:
            base_slug = new_slug
            counter = 1
            while True:
                cursor.execute("SELECT book_id FROM Book WHERE slug = %s AND book_id != %s;", (new_slug, book_id))
                if not cursor.fetchone():
                    break
                counter += 1
                new_slug = f"{base_slug}-{counter}"
                
            storage.rename_book_dir(old_slug, new_slug)
                
        cursor.execute("UPDATE Book SET title = %s, slug = %s WHERE book_id = %s;", (new_title, new_slug, book_id))
        
        cursor.execute("""
            SELECT 
                b.book_id, b.owner_id, u.name AS owner_name, b.title, b.slug, b.created_at,
                COUNT(p.page_id) AS total_pages
            FROM Book b
            JOIN User u ON b.owner_id = u.user_id
            LEFT JOIN Page p ON b.book_id = p.book_id
            WHERE b.book_id = %s
            GROUP BY b.book_id, b.owner_id, u.name, b.title, b.slug, b.created_at;
        """, (book_id,))
        updated = cursor.fetchone()
        updated["user_role"] = user_role
        return updated

@router.delete("/{book_id}", status_code=status.HTTP_200_OK)
def delete_book(book_id: int, current_user: CurrentUser = Depends(get_current_user)):
    """
    Deletes a book. Only the OWNER can delete a book.
    Cascades remove all pages, edits, backlinks, and storage folders.
    """
    with get_db() as cursor:
        require_book_role(cursor, book_id, current_user.user_id, allowed_roles=("OWNER",))

        cursor.execute("SELECT slug FROM Book WHERE book_id = %s;", (book_id,))
        slug = cursor.fetchone()["slug"]

        cursor.execute("DELETE FROM Book WHERE book_id = %s;", (book_id,))
        cursor.execute(f"DROP ROLE IF EXISTS 'role_book_{book_id}';")

    storage.delete_book_dir(slug)

    return {"message": f"Book '{slug}' (ID {book_id}) deleted successfully."}

# -----------------------------------------------------------------------------
# Collaboration Endpoints
# -----------------------------------------------------------------------------
@router.get("/{book_id}/collaborators", response_model=List[CollaboratorResponse])
def list_collaborators(book_id: int, current_user: CurrentUser = Depends(get_current_user)):
    """Lists all collaborators for a book. Requires at least VIEWER role."""
    with get_db() as cursor:
        require_book_role(cursor, book_id, current_user.user_id)

        query = """
            SELECT u.user_id, u.name, u.email, bc.role
            FROM BookCollaborators bc
            JOIN User u ON bc.user_id = u.user_id
            WHERE bc.book_id = %s
            ORDER BY u.name ASC;
        """
        cursor.execute(query, (book_id,))
        collaborators = cursor.fetchall()

    return collaborators

@router.post("/{book_id}/collaborators", response_model=CollaboratorResponse, status_code=status.HTTP_201_CREATED)
def add_or_update_collaborator(book_id: int, payload: CollaboratorAdd, current_user: CurrentUser = Depends(get_current_user)):
    """
    Shares a book with another user by email (or updates their role).
    Requires OWNER or ADMIN role.
    """
    with get_db() as cursor:
        require_book_role(cursor, book_id, current_user.user_id, allowed_roles=("OWNER", "ADMIN"))

        # Find target user by email
        cursor.execute("SELECT user_id, name, email FROM User WHERE email = %s;", (payload.email.lower().strip(),))
        target_user = cursor.fetchone()
        if not target_user:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"No user found with email '{payload.email}'.")

        target_id = target_user["user_id"]

        # Prevent adding the owner as collaborator
        cursor.execute("SELECT owner_id FROM Book WHERE book_id = %s;", (book_id,))
        if cursor.fetchone()["owner_id"] == target_id:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cannot add the book owner as a collaborator.")

        # Upsert collaborator
        upsert_query = """
            INSERT INTO BookCollaborators (book_id, user_id, role)
            VALUES (%s, %s, %s)
            ON DUPLICATE KEY UPDATE role = VALUES(role);
        """
        cursor.execute(upsert_query, (book_id, target_id, payload.role))

    return {
        "user_id": target_id,
        "name": target_user["name"],
        "email": target_user["email"],
        "role": payload.role
    }

@router.delete("/{book_id}/collaborators/{user_id}", status_code=status.HTTP_200_OK)
def remove_collaborator(book_id: int, user_id: int, current_user: CurrentUser = Depends(get_current_user)):
    """Removes a collaborator from a book. Requires OWNER or ADMIN role."""
    with get_db() as cursor:
        require_book_role(cursor, book_id, current_user.user_id, allowed_roles=("OWNER", "ADMIN"))

        cursor.execute(
            "DELETE FROM BookCollaborators WHERE book_id = %s AND user_id = %s;",
            (book_id, user_id)
        )
        if cursor.rowcount == 0:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Collaborator not found on this book.")

    return {"message": f"User ID {user_id} removed from book collaborators."}

# -----------------------------------------------------------------------------
# Book Publishing (Public Web Sharing with Viewer / Editor access)
# -----------------------------------------------------------------------------
@router.get("/{book_id}/publish", response_model=BookPublishResponse)
def get_book_publish(book_id: int, current_user: CurrentUser = Depends(get_current_user)):
    """Retrieves publishing configuration for a book (requires OWNER or ADMIN)."""
    with get_db() as cursor:
        require_book_role(cursor, book_id, current_user.user_id, allowed_roles=("OWNER", "ADMIN"))
        cursor.execute("""
            SELECT book_id, share_token, access_mode, is_active, created_at, updated_at
            FROM BookPublish
            WHERE book_id = %s;
        """, (book_id,))
        row = cursor.fetchone()
        if not row:
            return {
                "book_id": book_id,
                "is_published": False,
                "share_token": None,
                "access_mode": "VIEWER",
                "created_at": None,
                "updated_at": None
            }
        return {
            "book_id": row["book_id"],
            "is_published": bool(row["is_active"]),
            "share_token": row["share_token"],
            "access_mode": row["access_mode"],
            "created_at": row["created_at"],
            "updated_at": row["updated_at"]
        }

@router.post("/{book_id}/publish", response_model=BookPublishResponse)
def update_book_publish(book_id: int, payload: BookPublishUpdate, current_user: CurrentUser = Depends(get_current_user)):
    """Enables, disables, or configures access mode for public web sharing (requires OWNER or ADMIN)."""
    if payload.access_mode not in ("VIEWER", "EDITOR"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="access_mode must be either 'VIEWER' or 'EDITOR'."
        )

    with get_db() as cursor:
        require_book_role(cursor, book_id, current_user.user_id, allowed_roles=("OWNER", "ADMIN"))
        cursor.execute("SELECT book_id, share_token FROM BookPublish WHERE book_id = %s;", (book_id,))
        existing = cursor.fetchone()

        if existing:
            token = existing["share_token"]
            cursor.execute("""
                UPDATE BookPublish 
                SET is_active = %s, access_mode = %s
                WHERE book_id = %s;
            """, (payload.is_published, payload.access_mode, book_id))
        else:
            token = secrets.token_urlsafe(16)
            cursor.execute("""
                INSERT INTO BookPublish (book_id, share_token, access_mode, is_active)
                VALUES (%s, %s, %s, %s);
            """, (book_id, token, payload.access_mode, payload.is_published))

        cursor.execute("""
            SELECT book_id, share_token, access_mode, is_active, created_at, updated_at
            FROM BookPublish
            WHERE book_id = %s;
        """, (book_id,))
        updated = cursor.fetchone()

        return {
            "book_id": updated["book_id"],
            "is_published": bool(updated["is_active"]),
            "share_token": updated["share_token"],
            "access_mode": updated["access_mode"],
            "created_at": updated["created_at"],
            "updated_at": updated["updated_at"]
        }

# -----------------------------------------------------------------------------
# Book Export & Import (ZIP Archive Package: folio.json + pages/*.md)
# -----------------------------------------------------------------------------
@router.get("/{book_id}/export")
def export_book_zip(book_id: int, current_user: CurrentUser = Depends(get_current_user)):
    """
    Exports a notebook as a portable ZIP archive:
    - folio.json: complete metadata, page hierarchy, tags, and table grant configs.
    - pages/{slug}.md: raw, clean Markdown documents for each page.
    Requires at least VIEWER access to the book.
    """
    with get_db() as cursor:
        require_book_role(cursor, book_id, current_user.user_id)

        # 1. Fetch Book details
        cursor.execute("""
            SELECT b.book_id, b.title, b.slug, b.created_at, u.name AS owner_name, u.email AS owner_email
            FROM Book b
            JOIN User u ON b.owner_id = u.user_id
            WHERE b.book_id = %s;
        """, (book_id,))
        book_row = cursor.fetchone()
        if not book_row:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Book not found.")

        # 2. Fetch Book-level table grants
        cursor.execute("""
            SELECT qt.table_name, qt.db, btg.can_read, btg.can_write
            FROM BookTableGrants btg
            JOIN QueryableTables qt ON btg.table_id = qt.table_id
            WHERE btg.book_id = %s
            ORDER BY qt.table_name ASC;
        """, (book_id,))
        book_grants = [
            {
                "table_name": g["table_name"],
                "db": g["db"],
                "can_read": bool(g["can_read"]),
                "can_write": bool(g["can_write"]),
            }
            for g in cursor.fetchall()
        ]

        # 3. Fetch Collaborators (metadata context)
        cursor.execute("""
            SELECT u.email, bc.role
            FROM BookCollaborators bc
            JOIN User u ON bc.user_id = u.user_id
            WHERE bc.book_id = %s;
        """, (book_id,))
        collaborators = [{"email": c["email"], "role": c["role"]} for c in cursor.fetchall()]

        # 4. Fetch all pages
        cursor.execute("""
            SELECT 
                p.page_id, 
                p.parent_page_id, 
                parent.slug AS parent_slug, 
                p.title, 
                p.slug, 
                p.position
            FROM Page p
            LEFT JOIN Page parent ON p.parent_page_id = parent.page_id
            WHERE p.book_id = %s
            ORDER BY p.position ASC, p.page_id ASC;
        """, (book_id,))
        page_rows = cursor.fetchall()

        metadata_pages = []
        page_markdown_files = {}

        for p in page_rows:
            p_id = p["page_id"]
            p_slug = p["slug"]

            # Read content from active storage backend
            content = storage.read_page_content(book_row["slug"], p_slug)
            file_rel_path = f"pages/{p_slug}.md"
            page_markdown_files[file_rel_path] = content

            # Attached tags
            cursor.execute("""
                SELECT t.name
                FROM PageTags pt
                JOIN Tag t ON pt.tag_id = t.tag_id
                WHERE pt.page_id = %s
                ORDER BY t.name ASC;
            """, (p_id,))
            tags = [t_row["name"] for t_row in cursor.fetchall()]

            # Page-level table grants
            cursor.execute("""
                SELECT qt.table_name, qt.db, pp.can_read, pp.can_write
                FROM PageTableGrants ptg
                JOIN QueryableTables qt ON ptg.table_id = qt.table_id
                JOIN PagePermission pp ON ptg.grant_id = pp.grant_id
                WHERE ptg.page_id = %s
                ORDER BY qt.table_name ASC;
            """, (p_id,))
            page_grants = [
                {
                    "table_name": pg["table_name"],
                    "db": pg["db"],
                    "can_read": bool(pg["can_read"]),
                    "can_write": bool(pg["can_write"]),
                }
                for pg in cursor.fetchall()
            ]

            metadata_pages.append({
                "title": p["title"],
                "slug": p_slug,
                "position": p["position"],
                "parent_slug": p["parent_slug"],
                "file_path": file_rel_path,
                "tags": tags,
                "grants": page_grants,
            })

    # 5. Discover referenced image assets across all page markdown contents
    import re
    referenced_asset_names = set()
    for md_text in page_markdown_files.values():
        for match in re.findall(r'(?:/api)?/assets/([a-zA-Z0-9_\-\.]+)', md_text):
            clean_name = Path(match).name
            if clean_name:
                referenced_asset_names.add(clean_name)

    bundled_assets = []
    asset_data_map = {}
    for asset_name in sorted(referenced_asset_names):
        asset_res = storage.read_asset(asset_name)
        if asset_res:
            asset_bytes, _ = asset_res
            bundled_assets.append(asset_name)
            asset_data_map[f"assets/{asset_name}"] = asset_bytes

    # 6. Build ZIP archive in-memory
    manifest = {
        "folio_version": "1.0",
        "exported_at": datetime.utcnow().isoformat() + "Z",
        "book": {
            "title": book_row["title"],
            "slug": book_row["slug"],
            "created_at": book_row["created_at"].isoformat() if book_row["created_at"] else None,
        },
        "book_grants": book_grants,
        "pages": metadata_pages,
        "assets": bundled_assets,
        "collaborators": collaborators,
    }

    zip_buffer = io.BytesIO()
    with zipfile.ZipFile(zip_buffer, "w", zipfile.ZIP_DEFLATED) as zf:
        # Write folio.json manifest
        zf.writestr("folio.json", json.dumps(manifest, indent=2))
        # Write individual markdown files in pages/
        for rel_path, md_text in page_markdown_files.items():
            zf.writestr(rel_path, md_text.encode("utf-8"))
        # Write bundled image assets in assets/
        for asset_rel_path, asset_bytes in asset_data_map.items():
            zf.writestr(asset_rel_path, asset_bytes)

    zip_buffer.seek(0)
    filename = f"{book_row['slug']}.zip"

    return StreamingResponse(
        zip_buffer,
        media_type="application/zip",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Access-Control-Expose-Headers": "Content-Disposition",
        }
    )

@router.post("/import", response_model=BookImportResponse, status_code=status.HTTP_201_CREATED)
async def import_book_zip(
    file: UploadFile = File(..., description="ZIP archive containing folio.json and pages/ folder"),
    title: Optional[str] = Form(None),
    slug: Optional[str] = Form(None),
    restore_grants: bool = Form(False),
    current_user: CurrentUser = Depends(get_current_user)
):
    """
    Imports a notebook from an uploaded ZIP archive:
    - Unpacks folio.json (or metadata.json) and individual markdown files from pages/.
    - Reconstructs book entity with authenticated user as OWNER.
    - Two-pass page hierarchy reconstruction (parent_slug -> new parent_page_id).
    - Preserves and restores all tags attached to pages.
    - Accurately re-indexes all page backlinks.
    - Explicitly asks/handles restoring table permissions and grants if restore_grants=True.
    - Sets baseline edit history and snapshot tracking.
    """
    # 1. Read uploaded archive
    content_bytes = await file.read()
    if not content_bytes:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Uploaded file is empty."
        )

    try:
        archive = zipfile.ZipFile(io.BytesIO(content_bytes), "r")
    except zipfile.BadZipFile:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="The uploaded file is not a valid ZIP archive."
        )

    # 2. Locate folio.json manifest
    manifest_name = None
    for candidate in ["folio.json", "metadata.json"]:
        if candidate in archive.namelist():
            manifest_name = candidate
            break

    if not manifest_name:
        # Check subfolder like my-notebook/folio.json
        for name in archive.namelist():
            if name.endswith("folio.json") or name.endswith("metadata.json"):
                manifest_name = name
                break

    if not manifest_name:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Archive missing 'folio.json' manifest file."
        )

    try:
        manifest_raw = archive.read(manifest_name).decode("utf-8")
        manifest = json.loads(manifest_raw)
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Failed to parse 'folio.json' manifest: {e}"
        )

    book_meta = manifest.get("book", {})
    raw_title = (title or book_meta.get("title") or "Imported Notebook").strip()
    raw_slug = (slug or book_meta.get("slug") or slugify(raw_title)).strip()
    base_slug = slugify(raw_slug) or "imported-notebook"

    with get_db() as cursor:
        # 3. Guarantee unique book slug
        new_slug = base_slug
        counter = 1
        while True:
            cursor.execute("SELECT book_id FROM Book WHERE slug = %s;", (new_slug,))
            if not cursor.fetchone():
                break
            new_slug = f"{base_slug}-{counter}"
            counter += 1

        # 4. Insert Book
        cursor.execute(
            "INSERT INTO Book (owner_id, title, slug) VALUES (%s, %s, %s);",
            (current_user.user_id, raw_title, new_slug)
        )
        new_book_id = cursor.lastrowid

        # 5. Ensure container in storage backend
        storage.ensure_book_dir(new_slug)

        # 6. Provision sandboxed MySQL role for this book
        cursor.execute(f"CREATE ROLE IF NOT EXISTS 'role_book_{new_book_id}';")
        try:
            cursor.execute(f"GRANT 'role_book_{new_book_id}' TO '{settings.RUNNER_DB_USER}';")
        except Exception:
            try:
                cursor.execute(f"GRANT 'role_book_{new_book_id}' TO '{settings.RUNNER_DB_USER}'@'%';")
            except Exception:
                cursor.execute(f"GRANT 'role_book_{new_book_id}' TO '{settings.RUNNER_DB_USER}'@'localhost';")

        # 6.5. Restore any bundled image assets into active storage backend with collision protection
        assets_restored = 0
        asset_rename_map = {}  # orig_name -> final_name
        import mimetypes
        for entry in archive.infolist():
            if entry.is_dir():
                continue
            norm_name = entry.filename.replace("\\", "/")
            if "assets/" in norm_name:
                orig_asset_name = Path(norm_name).name
                if not orig_asset_name:
                    continue
                asset_bytes = archive.read(entry)
                ctype, _ = mimetypes.guess_type(orig_asset_name)
                content_type = ctype or "application/octet-stream"

                final_asset_name = orig_asset_name
                # Check for existing asset to prevent overwriting different files
                if storage.asset_exists(orig_asset_name):
                    existing = storage.read_asset(orig_asset_name)
                    if existing and existing[0] == asset_bytes:
                        # Identical file already exists in storage; keep existing name
                        final_asset_name = orig_asset_name
                    else:
                        # Existing asset has different content! Generate brand new unique filename to prevent collision
                        ext = Path(orig_asset_name).suffix.lower()
                        while True:
                            candidate_name = f"{uuid.uuid4().hex}{ext}"
                            if not storage.asset_exists(candidate_name):
                                break
                        final_asset_name = candidate_name
                        storage.write_asset(final_asset_name, asset_bytes, content_type)
                        assets_restored += 1
                else:
                    # New asset name; persist directly
                    storage.write_asset(final_asset_name, asset_bytes, content_type)
                    assets_restored += 1

                asset_rename_map[orig_asset_name] = final_asset_name

        # 7. Pass 1: Insert all Pages & extract content from ZIP
        manifest_pages = manifest.get("pages", [])
        slug_to_new_page_id = {}
        created_records = []
        used_page_slugs = set()

        # Build index of files in zip
        namelist_set = set(archive.namelist())

        for idx, p in enumerate(manifest_pages):
            p_title = (p.get("title") or f"Untitled {idx+1}").strip()
            raw_p_slug = p.get("slug") or slugify(p_title)
            p_base_slug = slugify(raw_p_slug) or f"note-{idx+1}"

            p_slug = p_base_slug
            p_cnt = 1
            while p_slug in used_page_slugs:
                p_slug = f"{p_base_slug}-{p_cnt}"
                p_cnt += 1
            used_page_slugs.add(p_slug)

            position = p.get("position", idx + 1)
            cursor.execute(
                "INSERT INTO Page (book_id, parent_page_id, title, slug, position) VALUES (%s, NULL, %s, %s, %s);",
                (new_book_id, p_title, p_slug, position)
            )
            new_page_id = cursor.lastrowid

            if p.get("slug"):
                slug_to_new_page_id[p["slug"]] = new_page_id
            slug_to_new_page_id[p_slug] = new_page_id

            # Extract markdown content from zip
            md_content = ""
            file_candidates = [
                p.get("file_path"),
                f"pages/{p.get('slug')}.md",
                f"pages/{p_slug}.md",
                f"{p.get('slug')}.md",
            ]
            for fc in file_candidates:
                if fc and fc in namelist_set:
                    try:
                        md_content = archive.read(fc).decode("utf-8")
                        break
                    except Exception:
                        pass
                # Check with prefix if zip was created with parent folder
                if fc:
                    for name in namelist_set:
                        if name.endswith(fc):
                            try:
                                md_content = archive.read(name).decode("utf-8")
                                break
                            except Exception:
                                pass
                    if md_content:
                        break

            # If not in file, fallback to embedded content if present
            if not md_content and "content" in p:
                md_content = p["content"]

            # Rewrite markdown image links for any renamed or normalized assets
            if md_content and asset_rename_map:
                for orig_name, final_name in asset_rename_map.items():
                    # Normalize /assets/<orig_name>, /api/assets/<orig_name>, assets/<orig_name>, ./assets/<orig_name>
                    pattern = re.compile(rf'(?:\./|/api/|/)?assets/{re.escape(orig_name)}')
                    md_content = pattern.sub(f"/assets/{final_name}", md_content)
                    if orig_name != final_name:
                        # Also replace direct filename links like (orig_name) or src="orig_name"
                        md_content = re.sub(
                            rf'\({re.escape(orig_name)}\)',
                            f"(/assets/{final_name})",
                            md_content
                        )
                        md_content = re.sub(
                            rf'src=["\']{re.escape(orig_name)}["\']',
                            f'src="/assets/{final_name}"',
                            md_content
                        )

            storage.write_page_content(new_slug, p_slug, md_content)

            # Baseline edit history & snapshot
            cursor.execute(
                "INSERT INTO EditHistory (user_id, page_id, action) VALUES (%s, %s, 'CREATE');",
                (current_user.user_id, new_page_id)
            )
            edit_id = cursor.lastrowid
            cursor.execute(
                "INSERT INTO Edits (edit_id, snapshot) VALUES (%s, %s);",
                (edit_id, md_content)
            )

            created_records.append({
                "page_id": new_page_id,
                "title": p_title,
                "slug": p_slug,
                "parent_slug": p.get("parent_slug"),
                "content": md_content,
                "tags": p.get("tags", []),
                "grants": p.get("grants", []),
            })

        # 8. Pass 2: Reconstruct Parent-Child Hierarchy
        for rec in created_records:
            parent_slug = rec["parent_slug"]
            if parent_slug and parent_slug in slug_to_new_page_id:
                parent_id = slug_to_new_page_id[parent_slug]
                cursor.execute(
                    "UPDATE Page SET parent_page_id = %s WHERE page_id = %s;",
                    (parent_id, rec["page_id"])
                )

        # 9. Pass 3: Restore Tags
        total_tags_restored = 0
        for rec in created_records:
            for raw_tag in rec["tags"]:
                if not raw_tag or not isinstance(raw_tag, str):
                    continue
                tag_name = raw_tag.strip().lstrip("#").strip().lower()
                if not tag_name:
                    continue
                cursor.execute("INSERT IGNORE INTO Tag (name) VALUES (%s);", (tag_name,))
                cursor.execute("SELECT tag_id FROM Tag WHERE name = %s;", (tag_name,))
                t_row = cursor.fetchone()
                if t_row:
                    cursor.execute(
                        "INSERT IGNORE INTO PageTags (page_id, tag_id) VALUES (%s, %s);",
                        (rec["page_id"], t_row["tag_id"])
                    )
                    total_tags_restored += 1

        # 10. Pass 4: Re-process Backlinks
        for rec in created_records:
            sync_page_backlinks(cursor, rec["page_id"], new_book_id, rec["content"])

        # 11. Pass 5: Explicit Table Grants Restoration
        restored_grants_count = 0
        skipped_grants = []

        if restore_grants:
            # Book-level grants
            for bg in manifest.get("book_grants", []):
                t_name = bg.get("table_name")
                if not t_name:
                    continue
                cursor.execute("SELECT table_id, db FROM QueryableTables WHERE table_name = %s;", (t_name,))
                matched = cursor.fetchone()
                if matched:
                    tbl_id = matched["table_id"]
                    db_name = matched["db"]
                    can_read = bool(bg.get("can_read", True))
                    can_write = bool(bg.get("can_write", False))
                    cursor.execute("""
                        INSERT INTO BookTableGrants (book_id, table_id, can_read, can_write)
                        VALUES (%s, %s, %s, %s)
                        ON DUPLICATE KEY UPDATE can_read = VALUES(can_read), can_write = VALUES(can_write);
                    """, (new_book_id, tbl_id, can_read, can_write))
                    if can_read:
                        cursor.execute(f"GRANT SELECT ON `{db_name}`.`{t_name}` TO 'role_book_{new_book_id}';")
                    restored_grants_count += 1
                else:
                    skipped_grants.append(f"Book Grant: Table '{t_name}' not found in QueryableTables.")

            # Page-level grants
            for rec in created_records:
                for pg in rec["grants"]:
                    t_name = pg.get("table_name")
                    if not t_name:
                        continue
                    cursor.execute("SELECT table_id, db FROM QueryableTables WHERE table_name = %s;", (t_name,))
                    matched = cursor.fetchone()
                    if matched:
                        tbl_id = matched["table_id"]
                        db_name = matched["db"]
                        can_read = bool(pg.get("can_read", True))
                        can_write = bool(pg.get("can_write", False))
                        cursor.execute("""
                            INSERT INTO PageTableGrants (page_id, table_id)
                            VALUES (%s, %s)
                            ON DUPLICATE KEY UPDATE grant_id = LAST_INSERT_ID(grant_id);
                        """, (rec["page_id"], tbl_id))
                        grant_id = cursor.lastrowid
                        cursor.execute("""
                            INSERT INTO PagePermission (grant_id, can_read, can_write)
                            VALUES (%s, %s, %s)
                            ON DUPLICATE KEY UPDATE can_read = VALUES(can_read), can_write = VALUES(can_write);
                        """, (grant_id, can_read, can_write))
                        if can_read:
                            cursor.execute(f"GRANT SELECT ON `{db_name}`.`{t_name}` TO 'role_book_{new_book_id}';")
                        restored_grants_count += 1
                    else:
                        skipped_grants.append(f"Page '{rec['title']}': Table '{t_name}' not found in QueryableTables.")

    return {
        "book_id": new_book_id,
        "title": raw_title,
        "slug": new_slug,
        "pages_imported": len(created_records),
        "tags_restored": total_tags_restored,
        "grants_restored": restored_grants_count,
        "assets_restored": assets_restored,
        "grants_requested": restore_grants,
        "skipped_grants": skipped_grants,
        "message": f"Successfully imported '{raw_title}' with {len(created_records)} pages and {assets_restored} image assets."
    }
