import argparse
import sys
from pathlib import Path
import pymysql
from pymysql.constants import CLIENT

# Add project root to sys.path
PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

from backend.config import settings

def execute_sql_file(cursor, filepath: Path):
    """Reads and executes all SQL statements from a file."""
    print(f"Executing: {filepath.name}...")
    sql_content = filepath.read_text(encoding="utf-8")
    cursor.execute(sql_content)
    print(f"Successfully applied {filepath.name}")

def init_db(with_seed: bool = False):
    print(f"Connecting to MySQL at {settings.DB_HOST}:{settings.DB_PORT} as {settings.DB_USER}...")
    try:
        # Connect initially without specifying db to ensure it exists
        connection = pymysql.connect(
            host=settings.DB_HOST,
            port=settings.DB_PORT,
            user=settings.DB_USER,
            password=settings.DB_PASSWORD,
            client_flag=CLIENT.MULTI_STATEMENTS,
            autocommit=True
        )
    except Exception as e:
        print(f"Error connecting to MySQL: {e}")
        sys.exit(1)

    try:
        with connection.cursor() as cursor:
            # 1. Ensure database exists
            print(f"Ensuring database '{settings.DB_NAME}' exists...")
            cursor.execute(f"CREATE DATABASE IF NOT EXISTS `{settings.DB_NAME}`;")
            cursor.execute(f"USE `{settings.DB_NAME}`;")

            # 2. Execute schema.sql
            schema_path = PROJECT_ROOT / "db" / "schema.sql"
            if not schema_path.exists():
                print(f"Error: Schema file not found at {schema_path}")
                sys.exit(1)
            execute_sql_file(cursor, schema_path)

            # 3. Optionally execute seed.sql
            if with_seed:
                seed_path = PROJECT_ROOT / "db" / "seed.sql"
                if seed_path.exists():
                    execute_sql_file(cursor, seed_path)
                else:
                    print(f"Warning: Seed file not found at {seed_path}")

        print(f"\nDatabase '{settings.DB_NAME}' initialized successfully!")

    finally:
        connection.close()

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Initialize Folio MySQL Database")
    parser.add_argument("--seed", action="store_true", help="Also apply seed data from db/seed.sql")
    args = parser.parse_args()

    init_db(with_seed=args.seed)
