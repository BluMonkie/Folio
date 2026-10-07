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

class PageGrantResponse(BaseModel):
    grant_id: int
    page_id: int
    table_id: int
    table_name: str
    db: str
    can_read: bool
    can_write: bool

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
# Endpoints
# -----------------------------------------------------------------------------
@router.get("/queryable-tables", response_model=List[QueryableTableResponse])
def list_queryable_tables(current_user: CurrentUser = Depends(get_current_user)):
    """Lists all registered tables that are whitelisted for dynamic querying in Folio."""
    with get_db() as cursor:
        cursor.execute("SELECT table_id, table_name, db FROM QueryableTables ORDER BY db ASC, table_name ASC;")
        tables = cursor.fetchall()
    return tables

@router.get("/pages/{page_id}/grants", response_model=List[PageGrantResponse])
def list_page_grants(page_id: int, current_user: CurrentUser = Depends(get_current_user)):
    """Lists all active table grants and permissions assigned to a page. Requires VIEWER access."""
    with get_db() as cursor:
        page, _ = get_page_and_verify_access(cursor, page_id, current_user.user_id)

        query = """
            SELECT 
                ptg.grant_id,
                ptg.page_id,
                ptg.table_id,
                qt.table_name,
                qt.db,
                COALESCE(pp.can_read, 0) AS can_read,
                COALESCE(pp.can_write, 0) AS can_write
            FROM PageTableGrants ptg
            JOIN QueryableTables qt ON ptg.table_id = qt.table_id
            LEFT JOIN PagePermission pp ON ptg.grant_id = pp.grant_id
            WHERE ptg.page_id = %s
            ORDER BY qt.table_name ASC;
        """
        cursor.execute(query, (page_id,))
        grants = cursor.fetchall()

    return grants

@router.post("/pages/{page_id}/grants", response_model=PageGrantResponse, status_code=status.HTTP_201_CREATED)
def grant_table_to_page(page_id: int, payload: GrantCreate, current_user: CurrentUser = Depends(get_current_user)):
    """
    Grants access for a specific table to a page.
    Requires OWNER or ADMIN access to the containing book.
    Also synchronizes the MySQL 8.0 Role for the book.
    """
    with get_db() as cursor:
        page, _ = get_page_and_verify_access(cursor, page_id, current_user.user_id, allowed_roles=("OWNER", "ADMIN"))
        book_id = page["book_id"]

        # 1. Verify target table exists
        cursor.execute("SELECT table_id, table_name, db FROM QueryableTables WHERE table_id = %s;", (payload.table_id,))
        target_table = cursor.fetchone()
        if not target_table:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Table ID {payload.table_id} is not registered in QueryableTables.")

        table_name = target_table["table_name"]
        db_name = target_table["db"]

        # 2. Check if grant already exists
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

        # 3. Synchronize MySQL role for this book if can_read is True
        if payload.can_read:
            cursor.execute(f"CREATE ROLE IF NOT EXISTS 'role_book_{book_id}';")
            cursor.execute(f"GRANT 'role_book_{book_id}' TO '{settings.RUNNER_DB_USER}'@'localhost';")
            cursor.execute(f"GRANT SELECT ON `{db_name}`.`{table_name}` TO 'role_book_{book_id}';")

        return {
            "grant_id": grant_id,
            "page_id": page_id,
            "table_id": payload.table_id,
            "table_name": table_name,
            "db": db_name,
            "can_read": payload.can_read,
            "can_write": payload.can_write
        }

@router.delete("/pages/{page_id}/grants/{grant_id}", status_code=status.HTTP_200_OK)
def revoke_table_grant(page_id: int, grant_id: int, current_user: CurrentUser = Depends(get_current_user)):
    """
    Revokes a table grant from a page.
    Requires OWNER or ADMIN access to the containing book.
    If no other pages in the book use this table, revokes role privileges.
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

        # Delete the grant (cascade deletes PagePermission)
        cursor.execute("DELETE FROM PageTableGrants WHERE grant_id = %s;", (grant_id,))

        # Check if any other page in this book still has a grant to this table
        cursor.execute("""
            SELECT COUNT(*) AS active_count
            FROM PageTableGrants ptg
            JOIN Page p ON ptg.page_id = p.page_id
            WHERE p.book_id = %s AND ptg.table_id = %s;
        """, (book_id, table_id))
        remaining = cursor.fetchone()["active_count"]

        if remaining == 0:
            try:
                cursor.execute(f"REVOKE SELECT ON `{db_name}`.`{table_name}` FROM 'role_book_{book_id}';")
            except Exception:
                pass  # Gracefully ignore if role or privilege was already dropped

    return {"message": f"Grant ID {grant_id} revoked successfully for table '{table_name}'."}
