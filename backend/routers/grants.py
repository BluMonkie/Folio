from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from backend.config import settings
from backend.database import get_db
from backend.routers.books import require_book_role
from backend.services.auth import get_current_user, CurrentUser

router = APIRouter(tags=["Grants"])

# -----------------------------------------------------------------------------
# Schemas
# -----------------------------------------------------------------------------
class QueryableTableResponse(BaseModel):
    table_id: int
    table_name: str
    db: str

class GrantCreate(BaseModel):
    table_id: int
    can_read: bool = Field(True, description="Read permission (SELECT)")
    can_write: bool = Field(False, description="Write permission (Reserved for future)")

class BookGrantResponse(BaseModel):
    grant_id: int
    book_id: int
    table_id: int
    table_name: str
    db: str
    can_read: bool
    can_write: bool

class PageGrantResponse(BaseModel):
    table_id: int
    table_name: str
    db: str
    can_read: bool
    can_write: bool
    source_tier: str  # "PAGE" (override) or "BOOK" (inherited default)
    is_override: bool
    page_grant_id: Optional[int] = None
    book_grant_id: Optional[int] = None

# -----------------------------------------------------------------------------
# Helper: Fetch Page and Verify Book Role
# -----------------------------------------------------------------------------
def get_page_and_verify_access(cursor, page_id: int, user_id: int, allowed_roles=("OWNER", "ADMIN", "EDITOR", "VIEWER")):
    cursor.execute("SELECT page_id, book_id, title, slug FROM Page WHERE page_id = %s;", (page_id,))
    page = cursor.fetchone()
    if not page:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Page with ID {page_id} not found.")
    
    role = require_book_role(cursor, page["book_id"], user_id, allowed_roles=allowed_roles)
    return page, role

# -----------------------------------------------------------------------------
# Queryable Tables Catalog
# -----------------------------------------------------------------------------
@router.get("/queryable-tables", response_model=List[QueryableTableResponse])
def list_queryable_tables(current_user: CurrentUser = Depends(get_current_user)):
    """Lists all registered tables that are whitelisted for dynamic querying in Folio."""
    with get_db() as cursor:
        cursor.execute("SELECT table_id, table_name, db FROM QueryableTables ORDER BY db ASC, table_name ASC;")
        tables = cursor.fetchall()
    return tables

# -----------------------------------------------------------------------------
# Tier 1: Book-Level Default Grants
# -----------------------------------------------------------------------------
@router.get("/books/{book_id}/grants", response_model=List[BookGrantResponse])
def list_book_grants(book_id: int, current_user: CurrentUser = Depends(get_current_user)):
    """Lists all book-level default table grants. Requires at least VIEWER access to the book."""
    with get_db() as cursor:
        require_book_role(cursor, book_id, current_user.user_id)

        query = """
            SELECT 
                btg.grant_id,
                btg.book_id,
                btg.table_id,
                qt.table_name,
                qt.db,
                btg.can_read,
                btg.can_write
            FROM BookTableGrants btg
            JOIN QueryableTables qt ON btg.table_id = qt.table_id
            WHERE btg.book_id = %s
            ORDER BY qt.table_name ASC;
        """
        cursor.execute(query, (book_id,))
        grants = cursor.fetchall()

    return grants

@router.post("/books/{book_id}/grants", response_model=BookGrantResponse, status_code=status.HTTP_201_CREATED)
def grant_table_to_book(book_id: int, payload: GrantCreate, current_user: CurrentUser = Depends(get_current_user)):
    """
    Grants table access as a book-level default. All pages in this book inherit this grant
    unless explicitly overridden. Requires OWNER or ADMIN access to the book.
    """
    with get_db() as cursor:
        require_book_role(cursor, book_id, current_user.user_id, allowed_roles=("OWNER", "ADMIN"))

        # Verify target table exists
        cursor.execute("SELECT table_id, table_name, db FROM QueryableTables WHERE table_id = %s;", (payload.table_id,))
        target_table = cursor.fetchone()
        if not target_table:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Table ID {payload.table_id} is not registered in QueryableTables.")

        table_name = target_table["table_name"]
        db_name = target_table["db"]

        # Insert or update BookTableGrants
        cursor.execute("""
            INSERT INTO BookTableGrants (book_id, table_id, can_read, can_write)
            VALUES (%s, %s, %s, %s)
            ON DUPLICATE KEY UPDATE can_read = VALUES(can_read), can_write = VALUES(can_write);
        """, (book_id, payload.table_id, payload.can_read, payload.can_write))
        
        cursor.execute("SELECT grant_id FROM BookTableGrants WHERE book_id = %s AND table_id = %s;", (book_id, payload.table_id))
        grant_id = cursor.fetchone()["grant_id"]

        # Synchronize MySQL 8.0 role for this book if read is granted
        if payload.can_read:
            cursor.execute(f"CREATE ROLE IF NOT EXISTS 'role_book_{book_id}';")
            cursor.execute(f"GRANT 'role_book_{book_id}' TO '{settings.RUNNER_DB_USER}'@'localhost';")
            cursor.execute(f"GRANT SELECT ON `{db_name}`.`{table_name}` TO 'role_book_{book_id}';")

        return {
            "grant_id": grant_id,
            "book_id": book_id,
            "table_id": payload.table_id,
            "table_name": table_name,
            "db": db_name,
            "can_read": payload.can_read,
            "can_write": payload.can_write
        }

@router.delete("/books/{book_id}/grants/{grant_id}", status_code=status.HTTP_200_OK)
def revoke_book_grant(book_id: int, grant_id: int, current_user: CurrentUser = Depends(get_current_user)):
    """
    Revokes a book-level table grant. Requires OWNER or ADMIN access to the book.
    If no pages in this book have active page-level grants, revokes the table privilege from the MySQL role.
    """
    with get_db() as cursor:
        require_book_role(cursor, book_id, current_user.user_id, allowed_roles=("OWNER", "ADMIN"))

        cursor.execute("""
            SELECT btg.table_id, qt.table_name, qt.db 
            FROM BookTableGrants btg
            JOIN QueryableTables qt ON btg.table_id = qt.table_id
            WHERE btg.grant_id = %s AND btg.book_id = %s;
        """, (grant_id, book_id))
        grant_info = cursor.fetchone()

        if not grant_info:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Book grant ID {grant_id} not found.")

        table_id = grant_info["table_id"]
        table_name = grant_info["table_name"]
        db_name = grant_info["db"]

        # Delete book-level grant
        cursor.execute("DELETE FROM BookTableGrants WHERE grant_id = %s;", (grant_id,))

        # Check if any page in this book has an active page-level grant for this table
        cursor.execute("""
            SELECT COUNT(*) AS active_page_count
            FROM PageTableGrants ptg
            JOIN Page p ON ptg.page_id = p.page_id
            JOIN PagePermission pp ON ptg.grant_id = pp.grant_id
            WHERE p.book_id = %s AND ptg.table_id = %s AND pp.can_read = 1;
        """, (book_id, table_id))
        remaining = cursor.fetchone()["active_page_count"]

        if remaining == 0:
            try:
                cursor.execute(f"REVOKE SELECT ON `{db_name}`.`{table_name}` FROM 'role_book_{book_id}';")
            except Exception:
                pass

    return {"message": f"Book grant ID {grant_id} for table '{table_name}' revoked successfully."}

# -----------------------------------------------------------------------------
# Tier 2: Page-Level Grants & Two-Tier Resolution
# -----------------------------------------------------------------------------
@router.get("/pages/{page_id}/grants", response_model=List[PageGrantResponse])
def list_page_grants(page_id: int, current_user: CurrentUser = Depends(get_current_user)):
    """
    Lists resolved table grants for a page using two-tier inheritance:
    Page-level override takes precedence over Book-level default.
    Requires VIEWER access.
    """
    with get_db() as cursor:
        page, _ = get_page_and_verify_access(cursor, page_id, current_user.user_id)

        query = """
            SELECT 
                table_id,
                table_name,
                db,
                can_read,
                can_write,
                source_tier,
                is_override,
                page_grant_id,
                book_grant_id
            FROM v_EffectivePageGrants
            WHERE page_id = %s AND can_read = TRUE
            ORDER BY table_name ASC;
        """
        cursor.execute(query, (page_id,))
        grants = cursor.fetchall()

    return grants

@router.post("/pages/{page_id}/grants", response_model=PageGrantResponse, status_code=status.HTTP_201_CREATED)
def grant_table_to_page(page_id: int, payload: GrantCreate, current_user: CurrentUser = Depends(get_current_user)):
    """
    Configures an explicit page-level override for a table.
    Can be used to grant access or explicitly block/override a book-level default (can_read=False).
    Requires OWNER or ADMIN access to the containing book.
    """
    with get_db() as cursor:
        page, _ = get_page_and_verify_access(cursor, page_id, current_user.user_id, allowed_roles=("OWNER", "ADMIN"))
        book_id = page["book_id"]

        # Verify target table exists
        cursor.execute("SELECT table_id, table_name, db FROM QueryableTables WHERE table_id = %s;", (payload.table_id,))
        target_table = cursor.fetchone()
        if not target_table:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Table ID {payload.table_id} is not registered in QueryableTables.")

        table_name = target_table["table_name"]
        db_name = target_table["db"]

        # Check existing page grant
        cursor.execute("SELECT grant_id FROM PageTableGrants WHERE page_id = %s AND table_id = %s;", (page_id, payload.table_id))
        existing_grant = cursor.fetchone()

        if existing_grant:
            grant_id = existing_grant["grant_id"]
            cursor.execute("""
                INSERT INTO PagePermission (grant_id, can_read, can_write)
                VALUES (%s, %s, %s)
                ON DUPLICATE KEY UPDATE can_read = VALUES(can_read), can_write = VALUES(can_write);
            """, (grant_id, payload.can_read, payload.can_write))
        else:
            cursor.execute("INSERT INTO PageTableGrants (page_id, table_id) VALUES (%s, %s);", (page_id, payload.table_id))
            grant_id = cursor.lastrowid
            cursor.execute("""
                INSERT INTO PagePermission (grant_id, can_read, can_write)
                VALUES (%s, %s, %s);
            """, (grant_id, payload.can_read, payload.can_write))

        # Synchronize MySQL role if read is allowed
        if payload.can_read:
            cursor.execute(f"CREATE ROLE IF NOT EXISTS 'role_book_{book_id}';")
            cursor.execute(f"GRANT 'role_book_{book_id}' TO '{settings.RUNNER_DB_USER}'@'localhost';")
            cursor.execute(f"GRANT SELECT ON `{db_name}`.`{table_name}` TO 'role_book_{book_id}';")

        return {
            "table_id": payload.table_id,
            "table_name": table_name,
            "db": db_name,
            "can_read": payload.can_read,
            "can_write": payload.can_write,
            "source_tier": "PAGE",
            "is_override": True,
            "page_grant_id": grant_id,
            "book_grant_id": None
        }

@router.delete("/pages/{page_id}/grants/{grant_id}", status_code=status.HTTP_200_OK)
def revoke_table_grant(page_id: int, grant_id: int, current_user: CurrentUser = Depends(get_current_user)):
    """
    Revokes an explicit page-level override. The page will now fall back to the book-level default (if any).
    Requires OWNER or ADMIN access to the containing book.
    """
    with get_db() as cursor:
        page, _ = get_page_and_verify_access(cursor, page_id, current_user.user_id, allowed_roles=("OWNER", "ADMIN"))
        book_id = page["book_id"]

        cursor.execute("""
            SELECT ptg.table_id, qt.table_name, qt.db 
            FROM PageTableGrants ptg
            JOIN QueryableTables qt ON ptg.table_id = qt.table_id
            WHERE ptg.grant_id = %s AND ptg.page_id = %s;
        """, (grant_id, page_id))
        grant_info = cursor.fetchone()

        if not grant_info:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Grant ID {grant_id} not found on this page.")

        table_id = grant_info["table_id"]
        table_name = grant_info["table_name"]
        db_name = grant_info["db"]

        # Delete page override (cascades to PagePermission)
        cursor.execute("DELETE FROM PageTableGrants WHERE grant_id = %s;", (grant_id,))

        # Check if the book has a book-level grant for this table
        cursor.execute("""
            SELECT COUNT(*) AS book_grant_count
            FROM BookTableGrants
            WHERE book_id = %s AND table_id = %s AND can_read = 1;
        """, (book_id, table_id))
        has_book_grant = cursor.fetchone()["book_grant_count"] > 0

        if not has_book_grant:
            # Check if any other page in this book still has a grant
            cursor.execute("""
                SELECT COUNT(*) AS active_count
                FROM PageTableGrants ptg
                JOIN Page p ON ptg.page_id = p.page_id
                JOIN PagePermission pp ON ptg.grant_id = pp.grant_id
                WHERE p.book_id = %s AND ptg.table_id = %s AND pp.can_read = 1;
            """, (book_id, table_id))
            remaining = cursor.fetchone()["active_count"]

            if remaining == 0:
                try:
                    cursor.execute(f"REVOKE SELECT ON `{db_name}`.`{table_name}` FROM 'role_book_{book_id}';")
                except Exception:
                    pass

    return {"message": f"Page grant ID {grant_id} revoked successfully for table '{table_name}'."}
