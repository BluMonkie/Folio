from datetime import datetime
from typing import Optional, List
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from backend.database import get_db
from backend.routers.books import require_book_role
from backend.services import storage, markdown
from backend.services.renderer import render_page_content
from backend.services.auth import get_current_user, CurrentUser
from backend.utils import slugify

router = APIRouter(tags=["Pages"])

# -----------------------------------------------------------------------------
# Pydantic Schemas
# -----------------------------------------------------------------------------
class PageRenderResponse(BaseModel):
    page_id: int
    book_id: int
    title: str
    slug: str
    raw_content: str
    html_content: str
class PageCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=255)
    slug: Optional[str] = Field(None, max_length=255)
    parent_page_id: Optional[int] = None
    position: Optional[int] = None
    content: Optional[str] = ""

class PageUpdate(BaseModel):
    title: Optional[str] = None
    slug: Optional[str] = None
    parent_page_id: Optional[int] = None
    position: Optional[int] = None
    content: Optional[str] = None

class PageMove(BaseModel):
    target_page_id: Optional[int] = None
    drop_position: str = "inside"  # "before", "after", "inside"

class PageResponse(BaseModel):
    page_id: int
    book_id: int
    parent_page_id: Optional[int] = None
    title: str
    slug: str
    position: int
    content: Optional[str] = ""

class BacklinkItem(BaseModel):
    page_id: int
    title: str
    slug: str

class EditHistoryItem(BaseModel):
    edit_id: int
    user_id: Optional[int] = None
    user_name: Optional[str] = None
    edit_time: datetime
    action: str
    snapshot: str

# -----------------------------------------------------------------------------
# Endpoints
# -----------------------------------------------------------------------------
@router.post("/books/{book_id}/pages", response_model=PageResponse, status_code=status.HTTP_201_CREATED)
def create_page(book_id: int, payload: PageCreate, current_user: CurrentUser = Depends(get_current_user)):
    """
    Creates a new page within a book:
    - Verifies user has EDITOR, ADMIN, or OWNER access to the book.
    - Validates parent page.
    - Generates slug and verifies uniqueness within book.
    - Writes .md file to storage.
    - Inserts Page row and records initial CREATE snapshot under current_user.user_id.
    - Syncs outgoing backlinks.
    """
    with get_db() as cursor:
        # Verify user has write permissions for this book
        require_book_role(cursor, book_id, current_user.user_id, allowed_roles=("OWNER", "ADMIN", "EDITOR"))

        cursor.execute("SELECT slug FROM Book WHERE book_id = %s;", (book_id,))
        book_slug = cursor.fetchone()["slug"]

        # If parent_page_id is provided, verify it belongs to the same book
        if payload.parent_page_id is not None:
            cursor.execute(
                "SELECT page_id FROM Page WHERE page_id = %s AND book_id = %s;",
                (payload.parent_page_id, book_id)
            )
            if not cursor.fetchone():
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Parent page ID {payload.parent_page_id} does not exist in this book."
                )

        # Compute and validate slug
        slug = payload.slug.strip() if payload.slug else slugify(payload.title)
        if not slug:
            raise HTTPException(status_code=400, detail="Could not generate valid slug from title.")

        cursor.execute("SELECT page_id FROM Page WHERE book_id = %s AND slug = %s;", (book_id, slug))
        if cursor.fetchone():
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Page with slug '{slug}' already exists in this book."
            )

        # Auto-compute position if not provided
        position = payload.position
        if position is None:
            if payload.parent_page_id is None:
                cursor.execute(
                    "SELECT COALESCE(MAX(position), 0) + 1 AS next_pos FROM Page WHERE book_id = %s AND parent_page_id IS NULL;",
                    (book_id,)
                )
            else:
                cursor.execute(
                    "SELECT COALESCE(MAX(position), 0) + 1 AS next_pos FROM Page WHERE book_id = %s AND parent_page_id = %s;",
                    (book_id, payload.parent_page_id)
                )
            position = cursor.fetchone()["next_pos"]

        # Write file to disk before DB insertion
        content = payload.content or ""
        storage.write_page_content(book_slug, slug, content)

        # Insert Page row
        insert_page_sql = """
            INSERT INTO Page (book_id, parent_page_id, title, slug, position)
            VALUES (%s, %s, %s, %s, %s);
        """
        cursor.execute(insert_page_sql, (book_id, payload.parent_page_id, payload.title, slug, position))
        page_id = cursor.lastrowid

        # Insert EditHistory & Edits snapshot
        insert_history_sql = """
            INSERT INTO EditHistory (user_id, page_id, action)
            VALUES (%s, %s, 'CREATE');
        """
        cursor.execute(insert_history_sql, (current_user.user_id, page_id))
        edit_id = cursor.lastrowid

        cursor.execute("INSERT INTO Edits (edit_id, snapshot) VALUES (%s, %s);", (edit_id, content))

        # Synchronize backlinks
        markdown.sync_page_backlinks(cursor, page_id, book_id, content)

    return {
        "page_id": page_id,
        "book_id": book_id,
        "parent_page_id": payload.parent_page_id,
        "title": payload.title,
        "slug": slug,
        "position": position,
        "content": content
    }

@router.get("/pages/{page_id}", response_model=PageResponse)
def get_page(page_id: int, current_user: CurrentUser = Depends(get_current_user)):
    """Retrieves page metadata and reads current markdown content from disk. Requires VIEWER access."""
    with get_db() as cursor:
        query = """
            SELECT 
                p.page_id, 
                p.book_id, 
                p.parent_page_id, 
                p.title, 
                p.slug, 
                p.position,
                b.slug AS book_slug
            FROM Page p
            JOIN Book b ON p.book_id = b.book_id
            WHERE p.page_id = %s;
        """
        cursor.execute(query, (page_id,))
        page = cursor.fetchone()

        if not page:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Page with ID {page_id} not found.")

        # Check authorization on the book
        require_book_role(cursor, page["book_id"], current_user.user_id)

    content = storage.read_page_content(page["book_slug"], page["slug"])

    return {
        "page_id": page["page_id"],
        "book_id": page["book_id"],
        "parent_page_id": page["parent_page_id"],
        "title": page["title"],
        "slug": page["slug"],
        "position": page["position"],
        "content": content
    }

@router.get("/pages/{page_id}/render", response_model=PageRenderResponse)
def render_page(page_id: int, current_user: CurrentUser = Depends(get_current_user)):
    """
    Renders page markdown into HTML:
    - Parses and dynamically executes :::query ... ::: SQL blocks with role isolation and grant enforcement.
    - Resolves [[wikilinks]] into navigational links or broken-link indicators.
    - Converts markdown formatting to HTML.
    - Requires at least VIEWER access to the containing book.
    """
    with get_db() as cursor:
        query = """
            SELECT 
                p.page_id, 
                p.book_id, 
                p.title, 
                p.slug, 
                b.slug AS book_slug
            FROM Page p
            JOIN Book b ON p.book_id = b.book_id
            WHERE p.page_id = %s;
        """
        cursor.execute(query, (page_id,))
        page = cursor.fetchone()

        if not page:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Page with ID {page_id} not found.")

        require_book_role(cursor, page["book_id"], current_user.user_id)

    raw_content = storage.read_page_content(page["book_slug"], page["slug"])
    html_content = render_page_content(
        page_id=page["page_id"],
        book_id=page["book_id"],
        book_slug=page["book_slug"],
        raw_markdown=raw_content
    )

    return {
        "page_id": page["page_id"],
        "book_id": page["book_id"],
        "title": page["title"],
        "slug": page["slug"],
        "raw_content": raw_content,
        "html_content": html_content
    }

@router.put("/pages/{page_id}", response_model=PageResponse)
def update_page(page_id: int, payload: PageUpdate, current_user: CurrentUser = Depends(get_current_user)):
    """
    Updates page metadata and/or markdown content.
    Requires EDITOR, ADMIN, or OWNER access to the book.
    Stamps current_user.user_id into EditHistory.
    """
    with get_db() as cursor:
        query = """
            SELECT 
                p.page_id, 
                p.book_id, 
                p.parent_page_id, 
                p.title, 
                p.slug, 
                p.position,
                b.slug AS book_slug
            FROM Page p
            JOIN Book b ON p.book_id = b.book_id
            WHERE p.page_id = %s;
        """
        cursor.execute(query, (page_id,))
        page = cursor.fetchone()
        if not page:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Page with ID {page_id} not found.")

        book_id = page["book_id"]
        book_slug = page["book_slug"]

        # Verify write permission
        require_book_role(cursor, book_id, current_user.user_id, allowed_roles=("OWNER", "ADMIN", "EDITOR"))

        old_slug = page["slug"]
        if "parent_page_id" in payload.model_fields_set:
            new_parent_id = payload.parent_page_id
            if new_parent_id is not None and new_parent_id == page_id:
                raise HTTPException(status_code=400, detail="A page cannot be its own parent.")
        else:
            new_parent_id = page["parent_page_id"]
        new_position = payload.position if payload.position is not None else page["position"]

        # Compute new title and slug
        new_title = payload.title.strip() if payload.title is not None else page["title"]
        if not new_title:
            raise HTTPException(status_code=400, detail="Page title cannot be empty.")

        new_slug = old_slug
        if payload.slug is not None:
            new_slug = slugify(payload.slug)
        elif payload.title is not None:
            new_slug = slugify(payload.title)

        if new_slug != old_slug:
            base_slug = new_slug
            counter = 1
            while True:
                cursor.execute(
                    "SELECT page_id FROM Page WHERE book_id = %s AND slug = %s AND page_id != %s;",
                    (book_id, new_slug, page_id)
                )
                if not cursor.fetchone():
                    break
                counter += 1
                new_slug = f"{base_slug}-{counter}"

            storage.rename_page_file(book_slug, old_slug, new_slug)

        # Update content if provided
        current_content = storage.read_page_content(book_slug, new_slug)
        if payload.content is not None and payload.content != current_content:
            current_content = payload.content
            storage.write_page_content(book_slug, new_slug, current_content)

            # Record EDIT snapshot under authenticated user
            cursor.execute(
                "INSERT INTO EditHistory (user_id, page_id, action) VALUES (%s, %s, 'EDIT');",
                (current_user.user_id, page_id)
            )
            edit_id = cursor.lastrowid
            cursor.execute("INSERT INTO Edits (edit_id, snapshot) VALUES (%s, %s);", (edit_id, current_content))

            # Resync backlinks
            markdown.sync_page_backlinks(cursor, page_id, book_id, current_content)

        # Update DB row
        update_sql = """
            UPDATE Page
            SET title = %s, slug = %s, parent_page_id = %s, position = %s
            WHERE page_id = %s;
        """
        cursor.execute(update_sql, (new_title, new_slug, new_parent_id, new_position, page_id))

    return {
        "page_id": page_id,
        "book_id": book_id,
        "parent_page_id": new_parent_id,
        "title": new_title,
        "slug": new_slug,
        "position": new_position,
        "content": current_content
    }

@router.delete("/pages/{page_id}", status_code=status.HTTP_200_OK)
def delete_page(page_id: int, current_user: CurrentUser = Depends(get_current_user)):
    """Deletes a page. Requires EDITOR, ADMIN, or OWNER access to the book."""
    with get_db() as cursor:
        query = """
            SELECT p.book_id, p.slug, b.slug AS book_slug
            FROM Page p
            JOIN Book b ON p.book_id = b.book_id
            WHERE p.page_id = %s;
        """
        cursor.execute(query, (page_id,))
        page = cursor.fetchone()
        if not page:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Page with ID {page_id} not found.")

        book_id = page["book_id"]
        book_slug = page["book_slug"]
        page_slug = page["slug"]

        require_book_role(cursor, book_id, current_user.user_id, allowed_roles=("OWNER", "ADMIN", "EDITOR"))

        # Delete from DB first
        cursor.execute("DELETE FROM Page WHERE page_id = %s;", (page_id,))

    storage.delete_page_file(book_slug, page_slug)

    return {"message": f"Page '{page_slug}' (ID {page_id}) deleted successfully."}

@router.get("/pages/{page_id}/backlinks", response_model=List[BacklinkItem])
def get_page_backlinks(page_id: int, current_user: CurrentUser = Depends(get_current_user)):
    """Returns all pages linking to this page. Requires at least VIEWER access to the book."""
    with get_db() as cursor:
        cursor.execute("SELECT book_id FROM Page WHERE page_id = %s;", (page_id,))
        page = cursor.fetchone()
        if not page:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Page with ID {page_id} not found.")

        require_book_role(cursor, page["book_id"], current_user.user_id)

        query = """
            SELECT p.page_id, p.title, p.slug
            FROM Page p
            JOIN Backlinks b ON p.page_id = b.page_id_from
            WHERE b.page_id_to = %s;
        """
        cursor.execute(query, (page_id,))
        backlinks = cursor.fetchall()

    return backlinks

@router.get("/pages/{page_id}/history", response_model=List[EditHistoryItem])
def get_page_history(page_id: int, current_user: CurrentUser = Depends(get_current_user)):
    """Returns the full edit history and snapshots for a page. Requires at least VIEWER access to the book."""
    with get_db() as cursor:
        cursor.execute("SELECT book_id FROM Page WHERE page_id = %s;", (page_id,))
        page = cursor.fetchone()
        if not page:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Page with ID {page_id} not found.")

        require_book_role(cursor, page["book_id"], current_user.user_id)

        query = """
            SELECT 
                h.edit_id,
                h.user_id,
                u.name AS user_name,
                h.edit_time,
                h.action,
                e.snapshot
            FROM EditHistory h
            JOIN Edits e ON h.edit_id = e.edit_id
            LEFT JOIN User u ON h.user_id = u.user_id
            WHERE h.page_id = %s
            ORDER BY h.edit_time DESC, h.edit_id DESC;
        """
        cursor.execute(query, (page_id,))
        history = cursor.fetchall()

    return history

@router.post("/pages/{page_id}/restore/{edit_id}", response_model=PageResponse)
def restore_page_version(page_id: int, edit_id: int, current_user: CurrentUser = Depends(get_current_user)):
    """
    Restores the page content to the specified historical snapshot from Edits.
    Writes the snapshot to the .md file, creates a new EDIT snapshot row in EditHistory & Edits,
    and resynchronizes backlinks.
    """
    with get_db() as cursor:
        cursor.execute("SELECT book_id, slug FROM Page WHERE page_id = %s;", (page_id,))
        page = cursor.fetchone()
        if not page:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Page with ID {page_id} not found.")

        require_book_role(cursor, page["book_id"], current_user.user_id, allowed_roles=("OWNER", "ADMIN", "EDITOR"))

        cursor.execute("SELECT slug FROM Book WHERE book_id = %s;", (page["book_id"],))
        book = cursor.fetchone()
        if not book:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Book not found.")

        cursor.execute(
            """
            SELECT e.snapshot 
            FROM EditHistory h
            JOIN Edits e ON h.edit_id = e.edit_id
            WHERE h.edit_id = %s AND h.page_id = %s;
            """,
            (edit_id, page_id)
        )
        row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Revision snapshot not found for this page.")

        snapshot_content = row["snapshot"]
        book_slug = book["slug"]
        page_slug = page["slug"]

        storage.write_page_content(book_slug, page_slug, snapshot_content)

        # Record new history entry
        cursor.execute(
            "INSERT INTO EditHistory (user_id, page_id, action) VALUES (%s, %s, 'EDIT');",
            (current_user.user_id, page_id)
        )
        new_edit_id = cursor.lastrowid
        cursor.execute("INSERT INTO Edits (edit_id, snapshot) VALUES (%s, %s);", (new_edit_id, snapshot_content))

        # Resync backlinks
        markdown.sync_page_backlinks(cursor, page_id, page["book_id"], snapshot_content)

    return get_page(page_id, current_user)

@router.post("/pages/{page_id}/move", response_model=PageResponse)
def move_page(page_id: int, payload: PageMove, current_user: CurrentUser = Depends(get_current_user)):
    """
    Moves/reorders a page within a book's hierarchy:
    - drop_position == 'inside': page becomes a child of target_page_id (or root if None).
    - drop_position == 'before': page becomes sibling of target_page_id, placed immediately before it.
    - drop_position == 'after': page becomes sibling of target_page_id, placed immediately after it.
    Prevents cycles and maintains sequential positions.
    """
    with get_db() as cursor:
        cursor.execute("SELECT book_id, parent_page_id, position, title, slug FROM Page WHERE page_id = %s;", (page_id,))
        page = cursor.fetchone()
        if not page:
            raise HTTPException(status_code=404, detail="Page not found.")
        
        book_id = page["book_id"]
        require_book_role(cursor, book_id, current_user.user_id, allowed_roles=("OWNER", "ADMIN", "EDITOR"))

        # Cycle prevention: target parent cannot be page_id itself or any of its descendants
        cursor.execute("""
            WITH RECURSIVE subpages AS (
                SELECT page_id FROM Page WHERE page_id = %s
                UNION ALL
                SELECT p.page_id FROM Page p JOIN subpages s ON p.parent_page_id = s.page_id
            )
            SELECT page_id FROM subpages;
        """, (page_id,))
        descendants = {r["page_id"] for r in cursor.fetchall()}

        target_page = None
        if payload.target_page_id is not None:
            cursor.execute("SELECT page_id, parent_page_id, position, book_id FROM Page WHERE page_id = %s;", (payload.target_page_id,))
            target_page = cursor.fetchone()
            if not target_page or target_page["book_id"] != book_id:
                raise HTTPException(status_code=400, detail="Target page does not exist in this book.")

        new_parent_id = None
        if payload.drop_position == "inside":
            if payload.target_page_id is not None and payload.target_page_id in descendants:
                raise HTTPException(status_code=400, detail="Cannot move a page inside itself or its own descendants.")
            new_parent_id = payload.target_page_id
            if new_parent_id is None:
                cursor.execute("SELECT COALESCE(MAX(position), 0) + 1 AS next_pos FROM Page WHERE book_id = %s AND parent_page_id IS NULL AND page_id != %s;", (book_id, page_id))
            else:
                cursor.execute("SELECT COALESCE(MAX(position), 0) + 1 AS next_pos FROM Page WHERE book_id = %s AND parent_page_id = %s AND page_id != %s;", (book_id, new_parent_id, page_id))
            new_pos = cursor.fetchone()["next_pos"]
            cursor.execute("UPDATE Page SET parent_page_id = %s, position = %s WHERE page_id = %s;", (new_parent_id, new_pos, page_id))
        elif payload.drop_position in ("before", "after") and target_page:
            new_parent_id = target_page["parent_page_id"]
            if new_parent_id is not None and new_parent_id in descendants:
                raise HTTPException(status_code=400, detail="Cannot move page into descendant branch.")
            
            # Fetch existing siblings excluding page_id
            if new_parent_id is None:
                cursor.execute("SELECT page_id FROM Page WHERE book_id = %s AND parent_page_id IS NULL AND page_id != %s ORDER BY position, page_id;", (book_id, page_id))
            else:
                cursor.execute("SELECT page_id FROM Page WHERE book_id = %s AND parent_page_id = %s AND page_id != %s ORDER BY position, page_id;", (book_id, new_parent_id, page_id))
            siblings = [r["page_id"] for r in cursor.fetchall()]

            try:
                target_idx = siblings.index(payload.target_page_id)
            except ValueError:
                target_idx = len(siblings)
            
            insert_idx = target_idx if payload.drop_position == "before" else target_idx + 1
            siblings.insert(insert_idx, page_id)

            for idx, pid in enumerate(siblings, start=1):
                if pid == page_id:
                    cursor.execute("UPDATE Page SET parent_page_id = %s, position = %s WHERE page_id = %s;", (new_parent_id, idx, pid))
                else:
                    cursor.execute("UPDATE Page SET position = %s WHERE page_id = %s;", (idx, pid))
        else:
            # Fallback to root end
            cursor.execute("SELECT COALESCE(MAX(position), 0) + 1 AS next_pos FROM Page WHERE book_id = %s AND parent_page_id IS NULL AND page_id != %s;", (book_id, page_id))
            new_pos = cursor.fetchone()["next_pos"]
            cursor.execute("UPDATE Page SET parent_page_id = NULL, position = %s WHERE page_id = %s;", (new_pos, page_id))
            new_parent_id = None

        cursor.execute("SELECT page_id, book_id, parent_page_id, title, slug, position FROM Page WHERE page_id = %s;", (page_id,))
        updated = cursor.fetchone()
        updated["content"] = ""
        return updated
