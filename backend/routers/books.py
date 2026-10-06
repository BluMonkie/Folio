import shutil
from datetime import datetime
from pathlib import Path
from typing import Optional, List
from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field

from backend.config import settings
from backend.database import get_db
from backend.utils import slugify

router = APIRouter(prefix="/books", tags=["Books"])

class BookCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=255, description="Title of the book")
    slug: Optional[str] = Field(None, max_length=255, description="Custom slug (optional)")

class BookResponse(BaseModel):
    book_id: int
    title: str
    slug: str
    created_at: Optional[datetime] = None
    total_pages: Optional[int] = 0

class PageTreeNode(BaseModel):
    page_id: int
    parent_page_id: Optional[int] = None
    title: str
    slug: str
    position: int
    depth: int
    breadcrumb: str

@router.get("", response_model=List[BookResponse])
def list_books():
    """Lists all books with total page counts."""
    query = """
        SELECT 
            b.book_id, 
            b.title, 
            b.slug, 
            b.created_at,
            COUNT(p.page_id) AS total_pages
        FROM Book b
        LEFT JOIN Page p ON b.book_id = p.book_id
        GROUP BY b.book_id, b.title, b.slug, b.created_at
        ORDER BY total_pages DESC, b.title ASC;
    """
    with get_db() as cursor:
        cursor.execute(query)
        books = cursor.fetchall()
    return books

@router.post("", response_model=BookResponse, status_code=status.HTTP_201_CREATED)
def create_book(payload: BookCreate):
    """
    Creates a new book.
    Generates a slug, creates the storage directory, and inserts the book into the database.
    """
    slug = payload.slug.strip() if payload.slug else slugify(payload.title)
    if not slug:
        raise HTTPException(status_code=400, detail="Could not generate valid slug from title.")

    book_dir = settings.FOLIO_STORAGE_ROOT / slug

    with get_db() as cursor:
        # Check if slug is unique
        cursor.execute("SELECT book_id FROM Book WHERE slug = %s;", (slug,))
        if cursor.fetchone():
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Book with slug '{slug}' already exists."
            )

        # Create directory on disk
        book_dir.mkdir(parents=True, exist_ok=True)

        # Insert book row
        insert_query = """
            INSERT INTO Book (title, slug) 
            VALUES (%s, %s);
        """
        cursor.execute(insert_query, (payload.title, slug))
        book_id = cursor.lastrowid

        # Fetch created book
        cursor.execute(
            "SELECT book_id, title, slug, created_at FROM Book WHERE book_id = %s;",
            (book_id,)
        )
        created_book = cursor.fetchone()
        created_book["total_pages"] = 0

    return created_book

@router.get("/{book_id}", response_model=BookResponse)
def get_book(book_id: int):
    """Retrieves metadata for a specific book."""
    query = """
        SELECT 
            b.book_id, 
            b.title, 
            b.slug, 
            b.created_at,
            COUNT(p.page_id) AS total_pages
        FROM Book b
        LEFT JOIN Page p ON b.book_id = p.book_id
        WHERE b.book_id = %s
        GROUP BY b.book_id, b.title, b.slug, b.created_at;
    """
    with get_db() as cursor:
        cursor.execute(query, (book_id,))
        book = cursor.fetchone()

    if not book:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Book with ID {book_id} not found.")

    return book

@router.get("/{book_id}/tree", response_model=List[PageTreeNode])
def get_book_tree(book_id: int):
    """
    Returns the hierarchical page tree for a book using a Recursive CTE.
    Traverses root pages down through nested sub-pages, computing depth and breadcrumb paths.
    """
    # Verify book exists
    with get_db() as cursor:
        cursor.execute("SELECT book_id FROM Book WHERE book_id = %s;", (book_id,))
        if not cursor.fetchone():
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Book with ID {book_id} not found.")

        query = """
            WITH RECURSIVE page_tree AS (
                -- 1. Anchor: Root pages (parent_page_id IS NULL)
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

                -- 2. Recursive: Child pages
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
def delete_book(book_id: int):
    """
    Deletes a book.
    DB CASCADE removes all associated pages, edits, backlinks, and grants.
    Removes the book's folder on disk.
    """
    with get_db() as cursor:
        cursor.execute("SELECT slug FROM Book WHERE book_id = %s;", (book_id,))
        book = cursor.fetchone()

        if not book:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Book with ID {book_id} not found.")

        slug = book["slug"]

        # Delete from DB first (triggers foreign key cascades)
        cursor.execute("DELETE FROM Book WHERE book_id = %s;", (book_id,))

    # Remove storage directory if it exists
    book_dir = settings.FOLIO_STORAGE_ROOT / slug
    if book_dir.exists() and book_dir.is_dir():
        shutil.rmtree(book_dir, ignore_errors=True)

    return {"message": f"Book '{slug}' (ID {book_id}) deleted successfully."}
