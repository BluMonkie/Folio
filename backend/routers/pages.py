from datetime import datetime
from typing import Optional, List
from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field

from backend.database import get_db
from backend.services import storage, markdown
from backend.utils import slugify

router = APIRouter(tags=["Pages"])

# -----------------------------------------------------------------------------
# Pydantic Schemas
# -----------------------------------------------------------------------------
class PageCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=255)
    slug: Optional[str] = Field(None, max_length=255)
    parent_page_id: Optional[int] = None
    position: Optional[int] = None
    content: Optional[str] = ""
    user_id: Optional[int] = 1

class PageUpdate(BaseModel):
    title: Optional[str] = None
    slug: Optional[str] = None
    parent_page_id: Optional[int] = None
    position: Optional[int] = None
    content: Optional[str] = None
    user_id: Optional[int] = 1

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
def create_page(book_id: int, payload: PageCreate):
    """
    Creates a new page within a book:
    1. Validates book and parent page.
    2. Generates slug and verifies uniqueness.
    3. Writes .md file to storage/{book_slug}/{page_slug}.md.
    4. Inserts row into Page table.
    5. Records initial snapshot in EditHistory & Edits with action='CREATE'.
    6. Extracts and syncs outgoing backlinks.
    """
    with get_db() as cursor:
        # 1. Verify book exists
        cursor.execute("SELECT slug FROM Book WHERE book_id = %s;", (book_id,))
        book = cursor.fetchone()
        if not book:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Book with ID {book_id} not found.")
        book_slug = book["slug"]

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

        # 2. Compute and validate slug
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

        # 3. Write file to disk before DB insertion
        content = payload.content or ""
        storage.write_page_content(book_slug, slug, content)

        # 4. Insert Page row
        insert_page_sql = """
            INSERT INTO Page (book_id, parent_page_id, title, slug, position)
            VALUES (%s, %s, %s, %s, %s);
        """
        cursor.execute(insert_page_sql, (book_id, payload.parent_page_id, payload.title, slug, position))
        page_id = cursor.lastrowid

        # 5. Insert EditHistory & Edits snapshot
        insert_history_sql = """
            INSERT INTO EditHistory (user_id, page_id, action)
            VALUES (%s, %s, 'CREATE');
        """
        cursor.execute(insert_history_sql, (payload.user_id, page_id))
        edit_id = cursor.lastrowid

        cursor.execute("INSERT INTO Edits (edit_id, snapshot) VALUES (%s, %s);", (edit_id, content))

        # 6. Synchronize backlinks
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
def get_page(page_id: int):
    """Retrieves page metadata and reads current markdown content from disk."""
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

    # Read content from file
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

@router.put("/pages/{page_id}", response_model=PageResponse)
def update_page(page_id: int, payload: PageUpdate):
    """
    Updates page metadata and/or markdown content:
    - Renames .md file on disk if slug changes.
    - Updates file content on disk.
    - Records an 'EDIT' snapshot in EditHistory & Edits.
    - Re-synchronizes backlinks.
    """
    with get_db() as cursor:
        # Fetch current page details
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
        old_slug = page["slug"]
        new_title = payload.title if payload.title is not None else page["title"]
        new_parent_id = payload.parent_page_id if payload.parent_page_id is not None else page["parent_page_id"]
        new_position = payload.position if payload.position is not None else page["position"]

        # Compute new slug if title or slug provided
        new_slug = old_slug
        if payload.slug is not None:
            new_slug = slugify(payload.slug)
        elif payload.title is not None:
            new_slug = slugify(payload.title)

        # If slug changed, verify uniqueness and rename file
        if new_slug != old_slug:
            cursor.execute(
                "SELECT page_id FROM Page WHERE book_id = %s AND slug = %s AND page_id != %s;",
                (book_id, new_slug, page_id)
            )
            if cursor.fetchone():
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail=f"Page with slug '{new_slug}' already exists in this book."
                )
            storage.rename_page_file(book_slug, old_slug, new_slug)

        # Update content if provided
        current_content = storage.read_page_content(book_slug, new_slug)
        if payload.content is not None and payload.content != current_content:
            current_content = payload.content
            storage.write_page_content(book_slug, new_slug, current_content)

            # Record EDIT snapshot
            cursor.execute(
                "INSERT INTO EditHistory (user_id, page_id, action) VALUES (%s, %s, 'EDIT');",
                (payload.user_id, page_id)
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
def delete_page(page_id: int):
    """
    Deletes a page:
    1. Removes row from DB first (triggers cascades on Backlinks, Edits, and sets child parents to NULL).
    2. Deletes the .md file from disk.
    """
    with get_db() as cursor:
        query = """
            SELECT p.slug, b.slug AS book_slug
            FROM Page p
            JOIN Book b ON p.book_id = b.book_id
            WHERE p.page_id = %s;
        """
        cursor.execute(query, (page_id,))
        page = cursor.fetchone()
        if not page:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Page with ID {page_id} not found.")

        book_slug = page["book_slug"]
        page_slug = page["slug"]

        # Delete from DB first
        cursor.execute("DELETE FROM Page WHERE page_id = %s;", (page_id,))

    # Delete file from disk
    storage.delete_page_file(book_slug, page_slug)

    return {"message": f"Page '{page_slug}' (ID {page_id}) deleted successfully."}

@router.get("/pages/{page_id}/backlinks", response_model=List[BacklinkItem])
def get_page_backlinks(page_id: int):
    """Returns all pages that contain a wikilink pointing to this page."""
    with get_db() as cursor:
        cursor.execute("SELECT page_id FROM Page WHERE page_id = %s;", (page_id,))
        if not cursor.fetchone():
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Page with ID {page_id} not found.")

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
def get_page_history(page_id: int):
    """Returns the full edit history and snapshots for a page."""
    with get_db() as cursor:
        cursor.execute("SELECT page_id FROM Page WHERE page_id = %s;", (page_id,))
        if not cursor.fetchone():
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Page with ID {page_id} not found.")

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
