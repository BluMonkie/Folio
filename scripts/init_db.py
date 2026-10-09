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
    print(f"Connecting to MySQL at {settings.DB_HOST}:{settings.DB_PORT} as {settings.DB_USER} (SSL={settings.DB_SSL})...")
    
    conn_kwargs = {
        "host": settings.DB_HOST,
        "port": settings.DB_PORT,
        "user": settings.DB_USER,
        "password": settings.DB_PASSWORD,
        "database": settings.DB_NAME,
        "client_flag": CLIENT.MULTI_STATEMENTS,
        "autocommit": True,
        "connect_timeout": 10,
    }
    if settings.DB_SSL:
        conn_kwargs["ssl"] = {"ssl": True}

    try:
        connection = pymysql.connect(**conn_kwargs)
    except Exception as e:
        # If connecting directly to database failed, try connecting without database to create it
        print(f"Direct connection to '{settings.DB_NAME}' failed ({e}). Attempting root connection...")
        try:
            root_kwargs = {**conn_kwargs}
            root_kwargs.pop("database", None)
            connection = pymysql.connect(**root_kwargs)
            with connection.cursor() as cur:
                cur.execute(f"CREATE DATABASE IF NOT EXISTS `{settings.DB_NAME}`;")
                cur.execute(f"USE `{settings.DB_NAME}`;")
        except Exception as root_err:
            print(f"Error connecting to MySQL: {root_err}")
            sys.exit(1)

    try:
        with connection.cursor() as cursor:
            # 1. Clear existing tables in this database
            print(f"Cleaning existing tables in database '{settings.DB_NAME}'...")
            cursor.execute("SET FOREIGN_KEY_CHECKS = 0;")
            cursor.execute("SHOW TABLES;")
            tables = [row[0] for row in cursor.fetchall()]
            for tbl in tables:
                cursor.execute(f"DROP TABLE IF EXISTS `{tbl}`;")
                print(f"  Dropped table `{tbl}`")
            cursor.execute("SET FOREIGN_KEY_CHECKS = 1;")

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

            # 4. Provision sandboxed runner user and book roles (if permitted)
            if settings.RUNNER_DB_USER != settings.DB_USER:
                try:
                    print(f"Provisioning sandboxed query runner '{settings.RUNNER_DB_USER}'...")
                    host_scope = "%" if settings.DB_HOST not in ("localhost", "127.0.0.1") else "localhost"
                    cursor.execute(f"CREATE USER IF NOT EXISTS '{settings.RUNNER_DB_USER}'@'{host_scope}' IDENTIFIED BY '{settings.RUNNER_DB_PASSWORD}';")
                    cursor.execute(f"ALTER USER '{settings.RUNNER_DB_USER}'@'{host_scope}' IDENTIFIED BY '{settings.RUNNER_DB_PASSWORD}';")
                    cursor.execute(f"REVOKE ALL PRIVILEGES, GRANT OPTION FROM '{settings.RUNNER_DB_USER}'@'{host_scope}';")
                except Exception as user_err:
                    print(f"Notice: Could not provision separate runner user ({user_err}). Primary user will be used.")

            if with_seed:
                try:
                    print("Configuring MySQL 8.0 Roles for seeded books...")
                    cursor.execute("CREATE ROLE IF NOT EXISTS 'role_book_1', 'role_book_2';")
                    cursor.execute(f"GRANT SELECT ON `{settings.DB_NAME}`.StudentGrades TO 'role_book_1';")
                except Exception as role_err:
                    print(f"Notice: Roles skipped ({role_err}).")

        print(f"\nDatabase '{settings.DB_NAME}' initialized successfully on {settings.DB_HOST}!")

    finally:
        connection.close()

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Initialize Folio MySQL Database")
    parser.add_argument("--seed", action="store_true", help="Also apply seed data from db/seed.sql")
    args = parser.parse_args()

    init_db(with_seed=args.seed)
