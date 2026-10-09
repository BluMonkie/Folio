from contextlib import contextmanager
import pymysql
from pymysql.cursors import DictCursor
from backend.config import settings

def create_connection():
    """Creates a new PyMySQL connection using settings."""
    kwargs = {
        "host": settings.DB_HOST,
        "port": settings.DB_PORT,
        "user": settings.DB_USER,
        "password": settings.DB_PASSWORD,
        "database": settings.DB_NAME,
        "cursorclass": DictCursor,
        "autocommit": False,
        "connect_timeout": 10,
    }
    if settings.DB_SSL:
        kwargs["ssl"] = {"ssl": True}
    return pymysql.connect(**kwargs)

@contextmanager
def get_db():
    """
    Context manager for database transactions.
    Automatically commits on success and rolls back on exception.
    Yields a cursor.
    """
    conn = create_connection()
    try:
        with conn.cursor() as cursor:
            yield cursor
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()

@contextmanager
def get_runner_db(book_id: int):
    """
    Context manager for sandboxed query execution.
    Connects as folio_runner without default database, activates
    role_book_{book_id}, switches to database, sets execution timeout (3s),
    and opens a read-only transaction.
    """
    runner_kwargs = {
        "host": settings.DB_HOST,
        "port": settings.DB_PORT,
        "user": settings.RUNNER_DB_USER,
        "password": settings.RUNNER_DB_PASSWORD,
        "cursorclass": DictCursor,
        "autocommit": False,
        "connect_timeout": 10,
    }
    if settings.DB_SSL:
        runner_kwargs["ssl"] = {"ssl": True}
    conn = pymysql.connect(**runner_kwargs)
    try:
        with conn.cursor() as cursor:
            role_name = f"role_book_{int(book_id)}"
            cursor.execute(f"SET ROLE '{role_name}';")
            cursor.execute(f"USE `{settings.DB_NAME}`;")
            cursor.execute("SET SESSION max_execution_time = 3000;")
            cursor.execute("START TRANSACTION READ ONLY;")
            yield cursor
            cursor.execute("ROLLBACK;")
    except Exception:
        try:
            conn.rollback()
        except Exception:
            pass
        raise
    finally:
        conn.close()

