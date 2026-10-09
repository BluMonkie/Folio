import logging
from typing import List, Optional
from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel

from backend.database import get_db
from backend.services import storage
from backend.services.renderer import render_page_content

logger = logging.getLogger("folio.public")

router = APIRouter(prefix="/public", tags=["Public"])

# -----------------------------------------------------------------------------
# Schemas
# -----------------------------------------------------------------------------
class PublicPageTreeNode(BaseModel):
    page_id: int
    parent_page_id: Optional[int] = None
    title: str
    slug: str
    position: int
    depth: int
    breadcrumb: str

class PublicBookViewResponse(BaseModel):
    book_id: int
    title: str
    slug: str
    owner_name: str
    access_mode: str  # "VIEWER" or "EDITOR"
    share_token: str
    tree: List[PublicPageTreeNode]

class PublicBacklinkItem(BaseModel):
    page_id: int
    title: str
    slug: str

class PublicTagItem(BaseModel):
    tag_id: int
    name: str

class PublicPageRenderResponse(BaseModel):
    page_id: int
    book_id: int
    title: str
    slug: str
    raw_content: str
    html_content: str
    tags: List[PublicTagItem] = []
    backlinks: List[PublicBacklinkItem] = []

# -----------------------------------------------------------------------------
# Public Viewing Endpoints (NO Authentication Required)
# -----------------------------------------------------------------------------
@router.get("/books/{share_token}", response_model=PublicBookViewResponse)
def get_public_book(share_token: str):
    """
    Retrieves public notebook metadata and full table of contents hierarchy.
    Accessible publicly without authentication.
    """
    with get_db() as cursor:
        # 1. Verify active share token
        cursor.execute("""
            SELECT bp.book_id, bp.access_mode, bp.is_active, b.title, b.slug, u.name AS owner_name
            FROM BookPublish bp
            JOIN Book b ON bp.book_id = b.book_id
            JOIN User u ON b.owner_id = u.user_id
            WHERE bp.share_token = %s AND bp.is_active = TRUE;
        """, (share_token,))
        pub_book = cursor.fetchone()

        if not pub_book:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Public notebook not found or share link has been revoked."
            )

        book_id = pub_book["book_id"]

        # 2. Fetch all pages to construct tree hierarchy
        cursor.execute("""
            SELECT page_id, parent_page_id, title, slug, position
            FROM Page
            WHERE book_id = %s
            ORDER BY position ASC, page_id ASC;
        """, (book_id,))
        pages = cursor.fetchall()

    # 3. Build hierarchical tree with depth and breadcrumbs
    children_map = {}
    for p in pages:
        parent_id = p["parent_page_id"]
        children_map.setdefault(parent_id, []).append(p)

    flat_tree = []

    def build_tree(parent_id, current_depth, current_breadcrumb):
        for child in children_map.get(parent_id, []):
            breadcrumb = f"{current_breadcrumb} / {child['title']}" if current_breadcrumb else child["title"]
            node = {
                "page_id": child["page_id"],
                "parent_page_id": child["parent_page_id"],
                "title": child["title"],
                "slug": child["slug"],
                "position": child["position"],
                "depth": current_depth,
                "breadcrumb": breadcrumb,
            }
            flat_tree.append(node)
            build_tree(child["page_id"], current_depth + 1, breadcrumb)

    build_tree(None, 0, "")

    return {
        "book_id": pub_book["book_id"],
        "title": pub_book["title"],
        "slug": pub_book["slug"],
        "owner_name": pub_book["owner_name"],
        "access_mode": pub_book["access_mode"],
        "share_token": share_token,
        "tree": flat_tree
    }

@router.get("/pages/{share_token}/{page_id}", response_model=PublicPageRenderResponse)
def get_public_page_render(share_token: str, page_id: int):
    """
    Renders a public page into HTML:
    - Parses and executes SQL query blocks against the book's database runner.
    - Resolves [[wikilinks]].
    - Fetches attached tags and backlinks.
    - Requires no authentication.
    """
    with get_db() as cursor:
        # 1. Verify share token
        cursor.execute("""
            SELECT bp.book_id, bp.access_mode, bp.is_active, b.slug AS book_slug
            FROM BookPublish bp
            JOIN Book b ON bp.book_id = b.book_id
            WHERE bp.share_token = %s AND bp.is_active = TRUE;
        """, (share_token,))
        pub = cursor.fetchone()

        if not pub:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Public notebook not found or share link has been revoked."
            )

        book_id = pub["book_id"]
        book_slug = pub["book_slug"]

        # 2. Verify page belongs to this published book
        cursor.execute("""
            SELECT page_id, book_id, title, slug
            FROM Page
            WHERE page_id = %s AND book_id = %s;
        """, (page_id, book_id))
        page = cursor.fetchone()

        if not page:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Page with ID {page_id} not found in this published book."
            )

        # 3. Fetch tags
        cursor.execute("""
            SELECT t.tag_id, t.name
            FROM PageTags pt
            JOIN Tag t ON pt.tag_id = t.tag_id
            WHERE pt.page_id = %s
            ORDER BY t.name ASC;
        """, (page_id,))
        tags = cursor.fetchall()

        # 4. Fetch backlinks
        cursor.execute("""
            SELECT p.page_id, p.title, p.slug
            FROM Backlinks b
            JOIN Page p ON b.page_id_from = p.page_id
            WHERE b.page_id_to = %s
            ORDER BY p.title ASC;
        """, (page_id,))
        backlinks = cursor.fetchall()

    # 5. Read Markdown & Render (executes SQL blocks via book's MySQL role)
    raw_content = storage.read_page_content(book_slug, page["slug"])
    html_content = render_page_content(
        page_id=page["page_id"],
        book_id=book_id,
        book_slug=book_slug,
        raw_markdown=raw_content
    )

    return {
        "page_id": page["page_id"],
        "book_id": book_id,
        "title": page["title"],
        "slug": page["slug"],
        "raw_content": raw_content,
        "html_content": html_content,
        "tags": tags,
        "backlinks": backlinks
    }
