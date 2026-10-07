from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from backend.database import get_db
from backend.routers.books import require_book_role
from backend.services.auth import get_current_user, CurrentUser

router = APIRouter(tags=["Tags"])

# -----------------------------------------------------------------------------
# Pydantic Schemas
# -----------------------------------------------------------------------------
class TagCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=50, description="Tag name (e.g. 'exam-prep' or 'sql')")

class TagResponse(BaseModel):
    tag_id: int
    name: str
    page_count: Optional[int] = 0

class PageTagAdd(BaseModel):
    name: str = Field(..., min_length=1, max_length=50, description="Tag name to attach (creates if nonexistent)")

class TaggedPageItem(BaseModel):
    page_id: int
    book_id: int
    book_title: str
    title: str
    slug: str

def clean_tag_name(raw_name: str) -> str:
    """Normalizes tag name: strips leading '#' and whitespace, converts to lowercase."""
    name = raw_name.strip().lstrip("#").strip().lower()
    if not name:
        raise HTTPException(status_code=400, detail="Tag name cannot be empty.")
    return name

# -----------------------------------------------------------------------------
# Tag Endpoints
# -----------------------------------------------------------------------------
@router.get("/tags", response_model=List[TagResponse])
def list_tags(current_user: CurrentUser = Depends(get_current_user)):
    """
    Lists all available tags along with the total count of pages using each tag.
    Sorted by popularity (page_count DESC) and name.
    """
    query = """
        SELECT 
            t.tag_id, 
            t.name, 
            COUNT(pt.page_id) AS page_count
        FROM Tag t
        LEFT JOIN PageTags pt ON t.tag_id = pt.tag_id
        GROUP BY t.tag_id, t.name
        ORDER BY page_count DESC, t.name ASC;
    """
    with get_db() as cursor:
        cursor.execute(query)
        tags = cursor.fetchall()
    return tags

@router.post("/tags", response_model=TagResponse, status_code=status.HTTP_201_CREATED)
def create_tag(payload: TagCreate, current_user: CurrentUser = Depends(get_current_user)):
    """Creates a new tag directly."""
    name = clean_tag_name(payload.name)
    with get_db() as cursor:
        cursor.execute("SELECT tag_id, name FROM Tag WHERE name = %s;", (name,))
        existing = cursor.fetchone()
        if existing:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Tag '{name}' already exists."
            )

        cursor.execute("INSERT INTO Tag (name) VALUES (%s);", (name,))
        tag_id = cursor.lastrowid

    return {"tag_id": tag_id, "name": name, "page_count": 0}

@router.get("/tags/{tag_id}/pages", response_model=List[TaggedPageItem])
def get_pages_by_tag(tag_id: int, current_user: CurrentUser = Depends(get_current_user)):
    """
    Returns all pages tagged with this tag.
    Respects authorization: only returns pages from books the user has access to!
    """
    with get_db() as cursor:
        cursor.execute("SELECT tag_id FROM Tag WHERE tag_id = %s;", (tag_id,))
        if not cursor.fetchone():
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Tag with ID {tag_id} not found.")

        query = """
            SELECT 
                p.page_id,
                p.book_id,
                b.title AS book_title,
                p.title,
                p.slug
            FROM PageTags pt
            JOIN Page p ON pt.page_id = p.page_id
            JOIN Book b ON p.book_id = b.book_id
            LEFT JOIN BookCollaborators bc ON b.book_id = bc.book_id AND bc.user_id = %s
            WHERE pt.tag_id = %s 
              AND (b.owner_id = %s OR bc.user_id = %s)
            ORDER BY b.title ASC, p.position ASC;
        """
        uid = current_user.user_id
        cursor.execute(query, (uid, tag_id, uid, uid))
        pages = cursor.fetchall()

    return pages

# -----------------------------------------------------------------------------
# Page-Specific Tag Endpoints
# -----------------------------------------------------------------------------
@router.get("/pages/{page_id}/tags", response_model=List[TagResponse])
def get_page_tags(page_id: int, current_user: CurrentUser = Depends(get_current_user)):
    """
    Returns all tags attached to a specific page.
    Requires at least VIEWER access to the page's book.
    """
    with get_db() as cursor:
        cursor.execute("SELECT book_id FROM Page WHERE page_id = %s;", (page_id,))
        page = cursor.fetchone()
        if not page:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Page with ID {page_id} not found.")

        require_book_role(cursor, page["book_id"], current_user.user_id)

        query = """
            SELECT t.tag_id, t.name, 0 AS page_count
            FROM Tag t
            JOIN PageTags pt ON t.tag_id = pt.tag_id
            WHERE pt.page_id = %s
            ORDER BY t.name ASC;
        """
        cursor.execute(query, (page_id,))
        tags = cursor.fetchall()

    return tags

@router.post("/pages/{page_id}/tags", response_model=TagResponse, status_code=status.HTTP_201_CREATED)
def add_tag_to_page(page_id: int, payload: PageTagAdd, current_user: CurrentUser = Depends(get_current_user)):
    """
    Attaches a tag to a page:
    - Normalizes tag name (e.g. '#SQL' -> 'sql').
    - Automatically creates the tag in Tag table if it doesn't exist yet.
    - Links the tag to the page in PageTags.
    - Requires EDITOR, ADMIN, or OWNER access to the book.
    """
    tag_name = clean_tag_name(payload.name)

    with get_db() as cursor:
        cursor.execute("SELECT book_id FROM Page WHERE page_id = %s;", (page_id,))
        page = cursor.fetchone()
        if not page:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Page with ID {page_id} not found.")

        # Require write access
        require_book_role(cursor, page["book_id"], current_user.user_id, allowed_roles=("OWNER", "ADMIN", "EDITOR"))

        # 1. Find or create the tag
        cursor.execute("SELECT tag_id, name FROM Tag WHERE name = %s;", (tag_name,))
        tag_row = cursor.fetchone()
        if not tag_row:
            cursor.execute("INSERT INTO Tag (name) VALUES (%s);", (tag_name,))
            tag_id = cursor.lastrowid
        else:
            tag_id = tag_row["tag_id"]

        # 2. Link tag to page (ignore if already linked)
        cursor.execute(
            "INSERT IGNORE INTO PageTags (page_id, tag_id) VALUES (%s, %s);",
            (page_id, tag_id)
        )

    return {"tag_id": tag_id, "name": tag_name, "page_count": 0}

@router.delete("/pages/{page_id}/tags/{tag_id}", status_code=status.HTTP_200_OK)
def remove_tag_from_page(page_id: int, tag_id: int, current_user: CurrentUser = Depends(get_current_user)):
    """
    Removes a tag from a page.
    Requires EDITOR, ADMIN, or OWNER access to the book.
    """
    with get_db() as cursor:
        cursor.execute("SELECT book_id FROM Page WHERE page_id = %s;", (page_id,))
        page = cursor.fetchone()
        if not page:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Page with ID {page_id} not found.")

        require_book_role(cursor, page["book_id"], current_user.user_id, allowed_roles=("OWNER", "ADMIN", "EDITOR"))

        cursor.execute("DELETE FROM PageTags WHERE page_id = %s AND tag_id = %s;", (page_id, tag_id))
        if cursor.rowcount == 0:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tag is not attached to this page.")

    return {"message": f"Tag ID {tag_id} removed from Page ID {page_id}."}
