from contextlib import contextmanager
import pymysql
from pymysql.cursors import DictCursor
from backend.config import settings

def create_connection():
    """Creates a new PyMySQL connection using settings."""
    return pymysql.connect(
        host=settings.DB_HOST,
        port=settings.DB_PORT,
        user=settings.DB_USER,
        password=settings.DB_PASSWORD,
        database=settings.DB_NAME,
        cursorclass=DictCursor,
        autocommit=False
    )

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
