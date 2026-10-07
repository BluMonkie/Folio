import re
from typing import List, Optional
from fastapi import APIRouter, Depends, Query, HTTPException, status
from pydantic import BaseModel

from backend.database import get_db
from backend.services.auth import get_current_user, CurrentUser

router = APIRouter(tags=["Search"])

# -----------------------------------------------------------------------------
# Schemas
# -----------------------------------------------------------------------------
class SearchResultItem(BaseModel):
    page_id: int
    book_id: int
    book_title: str
    book_slug: str
    page_title: str
    page_slug: str
    tags: List[str]
    relevance_score: int
    primary_match: str  # "TITLE", "TAG", "CONTENT"
    snippet: Optional[str] = None

class SearchResponse(BaseModel):
    query: str
    total_results: int
    book_filter_id: Optional[int] = None
    results: List[SearchResultItem]

# -----------------------------------------------------------------------------
# Snippet Helper
# -----------------------------------------------------------------------------
def extract_snippet(text: Optional[str], query: str, context_len: int = 60) -> Optional[str]:
    """Extracts a short snippet around the first occurrence of query term in text."""
    if not text or not query:
        return None
    
    match = re.search(re.escape(query), text, re.IGNORECASE)
    if not match:
        # Return start of text if no direct match in snapshot
        clean = " ".join(text.split())
        return clean[:120] + "..." if len(clean) > 120 else clean

    start, end = match.span()
    s_start = max(0, start - context_len)
    s_end = min(len(text), end + context_len)

    snippet = text[s_start:s_end].strip()
    clean_snippet = " ".join(snippet.split())

    prefix = "..." if s_start > 0 else ""
    suffix = "..." if s_end < len(text) else ""
    return f"{prefix}{clean_snippet}{suffix}"

# -----------------------------------------------------------------------------
# Search Core Function
# -----------------------------------------------------------------------------
def execute_search(current_user_id: int, q: str, book_id: Optional[int] = None) -> List[SearchResultItem]:
    term = q.strip()
    if not term:
        return []

    like_term = f"%{term}%"

    book_condition = "AND p.book_id = %s" if book_id is not None else ""

    query = f"""
    WITH latest_edits AS (
        SELECT 
            eh.page_id, 
            e.snapshot,
            ROW_NUMBER() OVER (PARTITION BY eh.page_id ORDER BY eh.edit_id DESC) AS rn
        FROM EditHistory eh
        JOIN Edits e ON eh.edit_id = e.edit_id
    ),
    page_tags_agg AS (
        SELECT 
            pt.page_id,
            GROUP_CONCAT(t.name SEPARATOR ', ') AS tag_names
        FROM PageTags pt
        JOIN Tag t ON pt.tag_id = t.tag_id
        GROUP BY pt.page_id
    )
    SELECT 
        p.page_id,
        p.book_id,
        b.title AS book_title,
        b.slug AS book_slug,
        p.title AS page_title,
        p.slug AS page_slug,
        COALESCE(pta.tag_names, '') AS tags_csv,
        (
            CASE WHEN LOWER(p.title) LIKE LOWER(%s) THEN 100 ELSE 0 END +
            CASE WHEN LOWER(pta.tag_names) LIKE LOWER(%s) THEN 50 ELSE 0 END +
            CASE WHEN LOWER(le.snapshot) LIKE LOWER(%s) THEN 20 ELSE 0 END
        ) AS relevance_score,
        CASE 
            WHEN LOWER(p.title) LIKE LOWER(%s) THEN 'TITLE'
            WHEN LOWER(pta.tag_names) LIKE LOWER(%s) THEN 'TAG'
            ELSE 'CONTENT'
        END AS primary_match,
        le.snapshot
    FROM Page p
    JOIN Book b ON p.book_id = b.book_id
    LEFT JOIN BookCollaborators bc ON b.book_id = bc.book_id AND bc.user_id = %s
    LEFT JOIN latest_edits le ON le.page_id = p.page_id AND le.rn = 1
    LEFT JOIN page_tags_agg pta ON pta.page_id = p.page_id
    WHERE (b.owner_id = %s OR bc.user_id = %s)
      {book_condition}
      AND (
          LOWER(p.title) LIKE LOWER(%s)
          OR LOWER(pta.tag_names) LIKE LOWER(%s)
          OR LOWER(le.snapshot) LIKE LOWER(%s)
      )
    ORDER BY relevance_score DESC, p.title ASC;
    """

    params = [
        like_term, like_term, like_term, # Relevance weights
        like_term, like_term,             # Match tier
        current_user_id,                  # Collaborator check
        current_user_id, current_user_id  # Where owner or collaborator
    ]

    if book_id is not None:
        params.append(book_id)

    params.extend([like_term, like_term, like_term]) # Where conditions

    with get_db() as cursor:
        cursor.execute(query, params)
        rows = cursor.fetchall()

    results: List[SearchResultItem] = []
    for r in rows:
        tag_list = [t.strip() for t in r["tags_csv"].split(",") if t.strip()] if r["tags_csv"] else []
        snippet = extract_snippet(r["snapshot"], term)
        results.append(
            SearchResultItem(
                page_id=r["page_id"],
                book_id=r["book_id"],
                book_title=r["book_title"],
                book_slug=r["book_slug"],
                page_title=r["page_title"],
                page_slug=r["page_slug"],
                tags=tag_list,
                relevance_score=r["relevance_score"],
                primary_match=r["primary_match"],
                snippet=snippet
            )
        )

    return results

# -----------------------------------------------------------------------------
# Endpoints
# -----------------------------------------------------------------------------
@router.get("/search", response_model=SearchResponse)
def search_all(
    q: str = Query(..., min_length=1, max_length=255, description="Search query term"),
    book_id: Optional[int] = Query(None, description="Optional book ID to constrain search"),
    current_user: CurrentUser = Depends(get_current_user)
):
    """
    Full knowledge-base search across page titles, tags, and document snapshots.
    Enforces RBAC: users only see search results from books they have access to.
    Ranks results by relevance: Title (100) > Tag (50) > Content (20).
    """
    results = execute_search(current_user.user_id, q, book_id=book_id)
    return SearchResponse(
        query=q,
        total_results=len(results),
        book_filter_id=book_id,
        results=results
    )

@router.get("/books/{book_id}/search", response_model=SearchResponse)
def search_in_book(
    book_id: int,
    q: str = Query(..., min_length=1, max_length=255, description="Search query term"),
    current_user: CurrentUser = Depends(get_current_user)
):
    """
    Scoped search within a specific book.
    Requires at least VIEWER access to the book.
    """
    results = execute_search(current_user.user_id, q, book_id=book_id)
    return SearchResponse(
        query=q,
        total_results=len(results),
        book_filter_id=book_id,
        results=results
    )
