import shutil
from datetime import datetime
from pathlib import Path
from typing import Optional, List
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, EmailStr, Field

from backend.config import settings
from backend.database import get_db
from backend.services.auth import get_current_user, CurrentUser
from backend.utils import slugify

router = APIRouter(prefix="/books", tags=["Books"])

# -----------------------------------------------------------------------------
# Schemas
# -----------------------------------------------------------------------------
class BookCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=255, description="Title of the book")
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

# -----------------------------------------------------------------------------
# Authorization Helpers
# -----------------------------------------------------------------------------
def get_user_book_role(cursor, book_id: int, user_id: int) -> Optional[str]:
    """
    Returns the user's role for a book ('OWNER', 'ADMIN', 'EDITOR', 'VIEWER'),
    or None if the user has no access.
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
    return collab["role"] if collab else None

def require_book_role(cursor, book_id: int, user_id: int, allowed_roles: tuple = ("OWNER", "ADMIN", "EDITOR", "VIEWER")) -> str:
    """Verifies the user has one of the allowed roles, raising 404 or 403 otherwise."""
    role = get_user_book_role(cursor, book_id, user_id)
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

    book_dir = settings.FOLIO_STORAGE_ROOT / slug

    with get_db() as cursor:
        cursor.execute("SELECT book_id FROM Book WHERE slug = %s;", (slug,))
        if cursor.fetchone():
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Book with slug '{slug}' already exists."
            )

        book_dir.mkdir(parents=True, exist_ok=True)

        insert_query = """
            INSERT INTO Book (owner_id, title, slug) 
            VALUES (%s, %s, %s);
        """
        cursor.execute(insert_query, (current_user.user_id, payload.title, slug))
        book_id = cursor.lastrowid

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
                    CAST(title AS CHAR(1000)) AS breadcrumb
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
                    CONCAT(parent.breadcrumb, ' > ', child.title)
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
            ORDER BY depth, position;
        """
        cursor.execute(query, (book_id,))
        tree_nodes = cursor.fetchall()

    return tree_nodes

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

    book_dir = settings.FOLIO_STORAGE_ROOT / slug
    if book_dir.exists() and book_dir.is_dir():
        shutil.rmtree(book_dir, ignore_errors=True)

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
