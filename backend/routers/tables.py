import csv
import io
import re
from datetime import datetime
from decimal import Decimal
from typing import Any, Dict, List, Optional
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from backend.config import settings
from backend.database import get_db
from backend.services.auth import get_current_user, CurrentUser

router = APIRouter(prefix="/tables", tags=["Tables & Data Studio"])

SYSTEM_TABLES = {
    "user", "book", "page", "bookcollaborators", "booktablegrants",
    "pagetablegrants", "pagepermission", "edits", "edithistory",
    "backlinks", "tag", "pagetags", "queryabletables", "queryabledatabases",
    "v_effectivepagegrants"
}

IDENTIFIER_REGEX = re.compile(r"^[a-zA-Z_][a-zA-Z0-9_]{0,63}$")

ALLOWED_DATA_TYPES = {
    "INT", "BIGINT", "TINYINT", "SMALLINT",
    "VARCHAR(50)", "VARCHAR(100)", "VARCHAR(255)", "VARCHAR(500)",
    "TEXT", "LONGTEXT",
    "DECIMAL(10,2)", "DECIMAL(12,4)", "FLOAT", "DOUBLE",
    "BOOLEAN", "DATE", "DATETIME", "TIMESTAMP"
}

def validate_identifier(name: str, kind: str = "Identifier") -> str:
    clean = name.strip()
    if not IDENTIFIER_REGEX.match(clean):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid {kind} name '{clean}'. Must be 1-64 characters, starting with a letter or underscore and containing only alphanumeric characters and underscores."
        )
    return clean

def is_system_table(name: str) -> bool:
    return name.lower() in SYSTEM_TABLES

# -----------------------------------------------------------------------------
# Schemas
# -----------------------------------------------------------------------------
class ColumnDefinition(BaseModel):
    name: str
    type: str = "VARCHAR(255)"
    primary_key: bool = False
    auto_increment: bool = False
    nullable: bool = True
    default: Optional[str] = None

class CreateTableRequest(BaseModel):
    table_name: str
    columns: List[ColumnDefinition]

class AddColumnRequest(BaseModel):
    name: str
    type: str = "VARCHAR(255)"
    nullable: bool = True
    default: Optional[str] = None

class RowInsertRequest(BaseModel):
    data: Dict[str, Any]

class RowUpdateRequest(BaseModel):
    primary_key: Dict[str, Any]
    data: Dict[str, Any]

class RowDeleteRequest(BaseModel):
    primary_key: Dict[str, Any]

class ImportCsvRequest(BaseModel):
    csv_text: str

class CreateFromCsvRequest(BaseModel):
    table_name: str
    csv_text: str

# -----------------------------------------------------------------------------
# Endpoints
# -----------------------------------------------------------------------------

@router.get("")
def list_tables(current_user: CurrentUser = Depends(get_current_user)):
    """
    Lists all accessible tables registered in QueryableTables along with their
    row counts, column counts, and whether they are system vs user-managed.
    """
    with get_db() as cursor:
        cursor.execute("SELECT table_id, table_name, db FROM QueryableTables ORDER BY table_name ASC;")
        registered = cursor.fetchall()

        results = []
        for reg in registered:
            t_name = reg["table_name"]
            db_name = reg["db"]
            is_sys = is_system_table(t_name)

            row_count = 0
            col_count = 0
            try:
                cursor.execute(f"SELECT COUNT(*) AS cnt FROM `{db_name}`.`{t_name}`;")
                row_res = cursor.fetchone()
                row_count = row_res["cnt"] if row_res else 0

                cursor.execute("""
                    SELECT COUNT(*) AS cnt 
                    FROM information_schema.columns 
                    WHERE table_schema = %s AND table_name = %s;
                """, (db_name, t_name))
                col_res = cursor.fetchone()
                col_count = col_res["cnt"] if col_res else 0
            except Exception:
                pass

            results.append({
                "table_id": reg["table_id"],
                "table_name": t_name,
                "db": db_name,
                "is_system": is_sys,
                "row_count": row_count,
                "column_count": col_count
            })

    return results

@router.get("/{table_name}/schema")
def get_table_schema(table_name: str, current_user: CurrentUser = Depends(get_current_user)):
    """
    Returns column schema details for a table: name, type, nullability, keys, default values.
    """
    t_clean = validate_identifier(table_name, "table")

    with get_db() as cursor:
        cursor.execute("SELECT table_id, table_name, db FROM QueryableTables WHERE table_name = %s;", (t_clean,))
        reg = cursor.fetchone()
        if not reg:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Table '{t_clean}' is not registered.")

        cursor.execute("""
            SELECT 
                COLUMN_NAME AS column_name,
                DATA_TYPE AS data_type,
                COLUMN_TYPE AS column_type,
                IS_NULLABLE AS is_nullable,
                COLUMN_KEY AS column_key,
                COLUMN_DEFAULT AS column_default,
                EXTRA AS extra
            FROM information_schema.columns
            WHERE table_schema = %s AND table_name = %s
            ORDER BY ordinal_position ASC;
        """, (reg["db"], t_clean))
        cols = cursor.fetchall()

        columns = []
        primary_keys = []
        for c in cols:
            col_key = c.get("column_key") or c.get("COLUMN_KEY") or ""
            is_pk = (col_key == "PRI")
            col_name = c.get("column_name") or c.get("COLUMN_NAME")
            if is_pk:
                primary_keys.append(col_name)

            columns.append({
                "name": col_name,
                "data_type": c.get("data_type") or c.get("DATA_TYPE"),
                "full_type": c.get("column_type") or c.get("COLUMN_TYPE"),
                "nullable": (c.get("is_nullable") or c.get("IS_NULLABLE")) == "YES",
                "is_primary_key": is_pk,
                "default": c.get("column_default") or c.get("COLUMN_DEFAULT"),
                "extra": c.get("extra") or c.get("EXTRA")
            })

    return {
        "table_name": t_clean,
        "db": reg["db"],
        "is_system": is_system_table(t_clean),
        "primary_keys": primary_keys,
        "columns": columns
    }

@router.get("/{table_name}/data")
def get_table_data(
    table_name: str,
    page: int = 1,
    limit: int = 25,
    sort_by: Optional[str] = None,
    sort_dir: str = "asc",
    search: Optional[str] = None,
    current_user: CurrentUser = Depends(get_current_user)
):
    """
    Returns paginated rows from the table with optional search filter and ordering.
    """
    t_clean = validate_identifier(table_name, "table")
    limit = max(1, min(limit, 100))
    page = max(1, page)
    offset = (page - 1) * limit
    sort_dir = "DESC" if sort_dir.lower() == "desc" else "ASC"

    with get_db() as cursor:
        cursor.execute("SELECT table_id, table_name, db FROM QueryableTables WHERE table_name = %s;", (t_clean,))
        reg = cursor.fetchone()
        if not reg:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Table '{t_clean}' is not registered.")

        # Get column names
        cursor.execute("""
            SELECT COLUMN_NAME AS column_name, DATA_TYPE AS data_type 
            FROM information_schema.columns 
            WHERE table_schema = %s AND table_name = %s 
            ORDER BY ordinal_position ASC;
        """, (reg["db"], t_clean))
        cols = cursor.fetchall()
        col_names = [c.get("column_name") or c.get("COLUMN_NAME") for c in cols]
        text_cols = [
            c.get("column_name") or c.get("COLUMN_NAME")
            for c in cols
            if (c.get("data_type") or c.get("DATA_TYPE", "")).lower() in ("varchar", "text", "char", "mediumtext", "longtext")
        ]

        where_clause = ""
        params: List[Any] = []
        if search and search.strip() and text_cols:
            search_pattern = f"%{search.strip()}%"
            conditions = [f"`{col}` LIKE %s" for col in text_cols]
            where_clause = "WHERE " + " OR ".join(conditions)
            params.extend([search_pattern] * len(text_cols))

        # Count total rows
        count_sql = f"SELECT COUNT(*) AS total FROM `{reg['db']}`.`{t_clean}` {where_clause};"
        cursor.execute(count_sql, tuple(params))
        total_rows = cursor.fetchone()["total"]

        # Order by
        order_clause = ""
        if sort_by and sort_by in col_names:
            order_clause = f"ORDER BY `{sort_by}` {sort_dir}"
        elif col_names:
            order_clause = f"ORDER BY `{col_names[0]}` ASC"

        # Fetch page data
        select_sql = f"SELECT * FROM `{reg['db']}`.`{t_clean}` {where_clause} {order_clause} LIMIT %s OFFSET %s;"
        query_params = list(params) + [limit, offset]
        cursor.execute(select_sql, tuple(query_params))
        raw_rows = cursor.fetchall()

        # Format rows for JSON serialization (convert Decimal, datetime, etc.)
        formatted_rows = []
        for r in raw_rows:
            formatted_r = {}
            for k, v in r.items():
                if isinstance(v, Decimal):
                    formatted_r[k] = float(v)
                elif isinstance(v, (datetime,)):
                    formatted_r[k] = v.isoformat()
                else:
                    formatted_r[k] = v
            formatted_rows.append(formatted_r)

    return {
        "table_name": t_clean,
        "total_rows": total_rows,
        "page": page,
        "limit": limit,
        "columns": col_names,
        "rows": formatted_rows
    }

@router.post("", status_code=status.HTTP_201_CREATED)
def create_table(payload: CreateTableRequest, current_user: CurrentUser = Depends(get_current_user)):
    """
    Creates a new custom table in MySQL and registers it into QueryableTables.
    """
    t_clean = validate_identifier(payload.table_name, "table")
    if is_system_table(t_clean):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Cannot create table with reserved system name '{t_clean}'."
        )

    if not payload.columns:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="At least one column is required.")

    col_clauses = []
    pk_cols = []
    has_auto_increment = False

    for col in payload.columns:
        c_name = validate_identifier(col.name, "column")
        c_type = col.type.strip().upper()

        type_matched = any(
            c_type == allowed or c_type.startswith("VARCHAR(") or c_type.startswith("DECIMAL(")
            for allowed in ALLOWED_DATA_TYPES
        )
        if not type_matched:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Data type '{col.type}' is not supported. Use one of {sorted(list(ALLOWED_DATA_TYPES))}."
            )

        clause = f"`{c_name}` {c_type}"
        if not col.nullable:
            clause += " NOT NULL"

        if col.auto_increment:
            clause += " AUTO_INCREMENT"
            has_auto_increment = True
            pk_cols.append(c_name)
        elif col.primary_key:
            pk_cols.append(c_name)

        if col.default and not col.auto_increment:
            clause += f" DEFAULT {col.default}"

        col_clauses.append(clause)

    if pk_cols:
        col_clauses.append(f"PRIMARY KEY ({', '.join(f'`{pk}`' for pk in pk_cols)})")
    elif not has_auto_increment:
        # If no primary key provided, prepend an id column
        col_clauses.insert(0, "`id` INT AUTO_INCREMENT PRIMARY KEY")

    create_sql = f"CREATE TABLE IF NOT EXISTS `{settings.DB_NAME}`.`{t_clean}` (\n  " + ",\n  ".join(col_clauses) + "\n);"

    with get_db() as cursor:
        cursor.execute("SELECT table_id FROM QueryableTables WHERE table_name = %s;", (t_clean,))
        if cursor.fetchone():
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=f"Table '{t_clean}' already exists.")

        # Execute DDL
        cursor.execute(create_sql)

        # Register in QueryableTables
        cursor.execute("""
            INSERT INTO QueryableTables (table_name, db)
            VALUES (%s, %s);
        """, (t_clean, settings.DB_NAME))
        table_id = cursor.lastrowid

    return {
        "message": f"Table '{t_clean}' created successfully.",
        "table_id": table_id,
        "table_name": t_clean,
        "db": settings.DB_NAME
    }

@router.post("/{table_name}/columns", status_code=status.HTTP_201_CREATED)
def add_column(table_name: str, payload: AddColumnRequest, current_user: CurrentUser = Depends(get_current_user)):
    """
    Adds a new column to an existing user table via ALTER TABLE.
    """
    t_clean = validate_identifier(table_name, "table")
    c_clean = validate_identifier(payload.name, "column")

    if is_system_table(t_clean):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Cannot alter system table schema.")

    c_type = payload.type.strip().upper()
    clause = f"`{c_clean}` {c_type}"
    if not payload.nullable:
        clause += " NOT NULL"
    if payload.default:
        clause += f" DEFAULT {payload.default}"

    alter_sql = f"ALTER TABLE `{settings.DB_NAME}`.`{t_clean}` ADD COLUMN {clause};"

    with get_db() as cursor:
        cursor.execute("SELECT table_id FROM QueryableTables WHERE table_name = %s;", (t_clean,))
        if not cursor.fetchone():
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Table '{t_clean}' is not registered.")

        cursor.execute(alter_sql)

    return {"message": f"Column '{c_clean}' added to table '{t_clean}'."}

@router.delete("/{table_name}/columns/{column_name}", status_code=status.HTTP_200_OK)
def drop_column(table_name: str, column_name: str, current_user: CurrentUser = Depends(get_current_user)):
    """
    Drops a column from a user table via ALTER TABLE.
    """
    t_clean = validate_identifier(table_name, "table")
    c_clean = validate_identifier(column_name, "column")

    if is_system_table(t_clean):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Cannot alter system table schema.")

    alter_sql = f"ALTER TABLE `{settings.DB_NAME}`.`{t_clean}` DROP COLUMN `{c_clean}`;"

    with get_db() as cursor:
        cursor.execute("SELECT table_id FROM QueryableTables WHERE table_name = %s;", (t_clean,))
        if not cursor.fetchone():
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Table '{t_clean}' is not registered.")

        cursor.execute(alter_sql)

    return {"message": f"Column '{c_clean}' dropped from table '{t_clean}'."}

@router.post("/{table_name}/rows", status_code=status.HTTP_201_CREATED)
def insert_row(table_name: str, payload: RowInsertRequest, current_user: CurrentUser = Depends(get_current_user)):
    """
    Inserts a row into the target table.
    """
    t_clean = validate_identifier(table_name, "table")
    if is_system_table(t_clean):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Cannot directly insert into system tables via Data Studio.")

    if not payload.data:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No data provided to insert.")

    cols = []
    vals = []
    for k, v in payload.data.items():
        k_clean = validate_identifier(k, "column")
        cols.append(f"`{k_clean}`")
        vals.append(v)

    col_names_str = ", ".join(cols)
    placeholders = ", ".join(["%s"] * len(vals))
    insert_sql = f"INSERT INTO `{settings.DB_NAME}`.`{t_clean}` ({col_names_str}) VALUES ({placeholders});"

    with get_db() as cursor:
        cursor.execute(insert_sql, tuple(vals))
        last_id = cursor.lastrowid

    return {"message": "Row inserted successfully.", "inserted_id": last_id}

@router.put("/{table_name}/rows", status_code=status.HTTP_200_OK)
def update_row(table_name: str, payload: RowUpdateRequest, current_user: CurrentUser = Depends(get_current_user)):
    """
    Updates an existing row in the table matching the primary key criteria.
    """
    t_clean = validate_identifier(table_name, "table")
    if is_system_table(t_clean):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Cannot directly modify system tables via Data Studio.")

    if not payload.primary_key:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Primary key specification is required to update a row.")

    if not payload.data:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No updated fields provided.")

    set_clauses = []
    set_vals = []
    for k, v in payload.data.items():
        k_clean = validate_identifier(k, "column")
        set_clauses.append(f"`{k_clean}` = %s")
        set_vals.append(v)

    where_clauses = []
    where_vals = []
    for k, v in payload.primary_key.items():
        k_clean = validate_identifier(k, "column")
        where_clauses.append(f"`{k_clean}` = %s")
        where_vals.append(v)

    update_sql = f"UPDATE `{settings.DB_NAME}`.`{t_clean}` SET {', '.join(set_clauses)} WHERE {' AND '.join(where_clauses)};"

    with get_db() as cursor:
        cursor.execute(update_sql, tuple(set_vals + where_vals))
        affected = cursor.rowcount

    return {"message": "Row updated successfully.", "rows_affected": affected}

@router.delete("/{table_name}/rows", status_code=status.HTTP_200_OK)
def delete_row(table_name: str, payload: RowDeleteRequest, current_user: CurrentUser = Depends(get_current_user)):
    """
    Deletes a row from the table matching primary key criteria.
    """
    t_clean = validate_identifier(table_name, "table")
    if is_system_table(t_clean):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Cannot delete from system tables via Data Studio.")

    if not payload.primary_key:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Primary key is required to delete a row.")

    where_clauses = []
    where_vals = []
    for k, v in payload.primary_key.items():
        k_clean = validate_identifier(k, "column")
        where_clauses.append(f"`{k_clean}` = %s")
        where_vals.append(v)

    delete_sql = f"DELETE FROM `{settings.DB_NAME}`.`{t_clean}` WHERE {' AND '.join(where_clauses)};"

    with get_db() as cursor:
        cursor.execute(delete_sql, tuple(where_vals))
        affected = cursor.rowcount

    return {"message": "Row deleted successfully.", "rows_affected": affected}

@router.post("/{table_name}/import-csv", status_code=status.HTTP_200_OK)
def import_csv_into_table(table_name: str, payload: ImportCsvRequest, current_user: CurrentUser = Depends(get_current_user)):
    """
    Imports rows from CSV text into an existing table.
    """
    t_clean = validate_identifier(table_name, "table")
    if is_system_table(t_clean):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Cannot import CSV into system tables.")

    if not payload.csv_text.strip():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="CSV content is empty.")

    f = io.StringIO(payload.csv_text.strip())
    reader = csv.reader(f)
    header_row = next(reader, None)
    if not header_row:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Could not detect CSV header row.")

    # Deduplicate and normalize headers
    seen_names: Dict[str, int] = {}
    clean_headers: List[str] = []
    for idx, col in enumerate(header_row):
        raw_col = col.strip()
        clean = re.sub(r"[^a-zA-Z0-9_]", "_", raw_col.lower())
        clean = re.sub(r"_+", "_", clean).strip("_")
        if not clean:
            clean = f"col_{idx + 1}"
        elif clean[0].isdigit():
            clean = f"col_{clean}"
        clean = clean[:55]

        if clean in seen_names:
            seen_names[clean] += 1
            final_name = f"{clean}_{seen_names[clean]}"
        else:
            seen_names[clean] = 1
            final_name = clean
        clean_headers.append(final_name)

    rows = [r for r in reader if any(cell.strip() for cell in r)]
    if not rows:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="CSV does not contain any data rows.")

    with get_db() as cursor:
        cursor.execute("""
            SELECT COLUMN_NAME AS column_name, DATA_TYPE AS data_type 
            FROM information_schema.columns 
            WHERE table_schema = %s AND table_name = %s;
        """, (settings.DB_NAME, t_clean))
        raw_cols = cursor.fetchall()
        db_cols = {
            (c.get("column_name") or c.get("COLUMN_NAME", "")).lower(): (
                c.get("column_name") or c.get("COLUMN_NAME", ""),
                (c.get("data_type") or c.get("DATA_TYPE", "")).lower()
            )
            for c in raw_cols
        }

        matched_mappings = []
        for idx, (orig, clean) in enumerate(zip(header_row, clean_headers)):
            clean_key = clean.lower()
            orig_key = orig.strip().lower()
            if clean_key in db_cols:
                db_col, dt = db_cols[clean_key]
                matched_mappings.append((idx, db_col, dt))
            elif orig_key in db_cols:
                db_col, dt = db_cols[orig_key]
                matched_mappings.append((idx, db_col, dt))

        if not matched_mappings:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"None of the CSV columns match the columns of table '{t_clean}'."
            )

        target_col_names = [m[1] for m in matched_mappings]
        col_sql = ", ".join(f"`{c}`" for c in target_col_names)
        placeholders = ", ".join(["%s"] * len(target_col_names))
        insert_sql = f"INSERT INTO `{settings.DB_NAME}`.`{t_clean}` ({col_sql}) VALUES ({placeholders});"

        batch_vals = []
        for row in rows:
            row_vals = []
            for csv_idx, _, dt in matched_mappings:
                raw_val = row[csv_idx].strip() if csv_idx < len(row) and row[csv_idx] is not None else ""
                if raw_val == "":
                    row_vals.append(None)
                else:
                    if dt in ("int", "tinyint", "smallint", "mediumint", "bigint"):
                        try:
                            row_vals.append(int(raw_val))
                        except ValueError:
                            row_vals.append(None)
                    elif dt in ("decimal", "numeric", "float", "double"):
                        try:
                            row_vals.append(float(raw_val))
                        except ValueError:
                            row_vals.append(None)
                    else:
                        row_vals.append(raw_val)
            batch_vals.append(tuple(row_vals))

        if batch_vals:
            cursor.executemany(insert_sql, batch_vals)

    return {
        "message": f"Successfully imported {len(batch_vals)} rows into '{t_clean}'.",
        "rows_imported": len(batch_vals),
        "columns_matched": target_col_names
    }

@router.post("/create-from-csv", status_code=status.HTTP_201_CREATED)
def create_table_from_csv(payload: CreateFromCsvRequest, current_user: CurrentUser = Depends(get_current_user)):
    """
    Infers column types from a CSV string, creates a new MySQL table,
    registers it into QueryableTables, and imports all records.
    """
    t_clean = validate_identifier(payload.table_name, "table")
    if is_system_table(t_clean):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Cannot create table with reserved system name '{t_clean}'.")

    if not payload.csv_text.strip():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="CSV content is empty.")

    f = io.StringIO(payload.csv_text.strip())
    reader = csv.reader(f)
    header_row = next(reader, None)
    if not header_row:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Could not parse CSV header.")

    # Deduplicate and normalize headers
    seen_names: Dict[str, int] = {}
    clean_headers: List[str] = []
    for idx, col in enumerate(header_row):
        raw_col = col.strip()
        clean = re.sub(r"[^a-zA-Z0-9_]", "_", raw_col.lower())
        clean = re.sub(r"_+", "_", clean).strip("_")
        if not clean:
            clean = f"col_{idx + 1}"
        elif clean[0].isdigit():
            clean = f"col_{clean}"
        clean = clean[:55]

        if clean in seen_names:
            seen_names[clean] += 1
            final_name = f"{clean}_{seen_names[clean]}"
        else:
            seen_names[clean] = 1
            final_name = clean
        clean_headers.append(final_name)

    rows = [r for r in reader if any(cell.strip() for cell in r)]
    if not rows:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="CSV does not contain any data rows.")

    # Infer types per column
    inferred_types: List[str] = []
    for i in range(len(clean_headers)):
        non_empty = [r[i].strip() for r in rows if i < len(r) and r[i] is not None and r[i].strip() != ""]
        if not non_empty:
            inferred_types.append("VARCHAR(255)")
            continue

        is_int = True
        max_len = 0
        for val in non_empty:
            max_len = max(max_len, len(val))
            try:
                int(val)
            except ValueError:
                is_int = False
                break

        if is_int:
            inferred_types.append("INT" if max_len < 10 else "BIGINT")
        else:
            is_float = True
            for val in non_empty:
                try:
                    float(val)
                except ValueError:
                    is_float = False
                    break
            if is_float:
                inferred_types.append("DECIMAL(12, 2)")
            elif max_len > 255:
                inferred_types.append("TEXT")
            else:
                inferred_types.append("VARCHAR(255)")

    col_defs = []
    has_pk = False

    if "id" in clean_headers:
        id_idx = clean_headers.index("id")
        id_vals = [r[id_idx].strip() for r in rows if id_idx < len(r) and r[id_idx] is not None and r[id_idx].strip() != ""]
        if len(id_vals) == len(rows) and inferred_types[id_idx] in ("INT", "BIGINT") and len(set(id_vals)) == len(id_vals):
            has_pk = True

    if not has_pk:
        col_defs.append("`id` INT AUTO_INCREMENT PRIMARY KEY")

    for c_name, sql_type in zip(clean_headers, inferred_types):
        if has_pk and c_name == "id":
            col_defs.append(f"`{c_name}` {sql_type} PRIMARY KEY")
        else:
            col_defs.append(f"`{c_name}` {sql_type} NULL")

    create_sql = f"CREATE TABLE IF NOT EXISTS `{settings.DB_NAME}`.`{t_clean}` (\n  " + ",\n  ".join(col_defs) + "\n);"

    with get_db() as cursor:
        cursor.execute("SELECT table_id FROM QueryableTables WHERE table_name = %s;", (t_clean,))
        if cursor.fetchone():
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=f"Table '{t_clean}' already exists.")

        try:
            cursor.execute(create_sql)

            # Register in QueryableTables
            cursor.execute("""
                INSERT INTO QueryableTables (table_name, db)
                VALUES (%s, %s);
            """, (t_clean, settings.DB_NAME))
            table_id = cursor.lastrowid

            # Insert rows
            col_sql = ", ".join(f"`{c}`" for c in clean_headers)
            placeholders = ", ".join(["%s"] * len(clean_headers))
            insert_sql = f"INSERT INTO `{settings.DB_NAME}`.`{t_clean}` ({col_sql}) VALUES ({placeholders});"

            batch_vals = []
            for r in rows:
                row_vals = []
                for i, sql_type in enumerate(inferred_types):
                    raw_val = r[i].strip() if i < len(r) and r[i] is not None else ""
                    if raw_val == "":
                        row_vals.append(None)
                    else:
                        if sql_type in ("INT", "BIGINT"):
                            try:
                                row_vals.append(int(raw_val))
                            except ValueError:
                                row_vals.append(None)
                        elif sql_type.startswith("DECIMAL"):
                            try:
                                row_vals.append(float(raw_val))
                            except ValueError:
                                row_vals.append(None)
                        else:
                            row_vals.append(raw_val)
                batch_vals.append(tuple(row_vals))

            if batch_vals:
                cursor.executemany(insert_sql, batch_vals)

        except Exception as e:
            try:
                cursor.execute(f"DROP TABLE IF EXISTS `{settings.DB_NAME}`.`{t_clean}`;")
                cursor.execute("DELETE FROM QueryableTables WHERE table_name = %s;", (t_clean,))
            except Exception:
                pass
            raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"Failed to create table from CSV: {str(e)}")

    return {
        "message": f"Table '{t_clean}' created from CSV with {len(batch_vals)} rows.",
        "table_id": table_id,
        "table_name": t_clean,
        "rows_inserted": len(batch_vals)
    }

@router.delete("/{table_name}", status_code=status.HTTP_200_OK)
def drop_table(table_name: str, current_user: CurrentUser = Depends(get_current_user)):
    """
    Drops a user-created table and removes it from QueryableTables and active grants.
    """
    t_clean = validate_identifier(table_name, "table")
    if is_system_table(t_clean):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Cannot drop system tables.")

    with get_db() as cursor:
        cursor.execute("SELECT table_id FROM QueryableTables WHERE table_name = %s;", (t_clean,))
        reg = cursor.fetchone()
        if not reg:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Table '{t_clean}' is not registered.")

        table_id = reg["table_id"]

        # Remove associated grants
        cursor.execute("DELETE FROM BookTableGrants WHERE table_id = %s;", (table_id,))
        cursor.execute("DELETE FROM PageTableGrants WHERE table_id = %s;", (table_id,))
        cursor.execute("DELETE FROM QueryableTables WHERE table_id = %s;", (table_id,))

        # Drop physical table
        cursor.execute(f"DROP TABLE IF EXISTS `{settings.DB_NAME}`.`{t_clean}`;")

    return {"message": f"Table '{t_clean}' dropped successfully."}
