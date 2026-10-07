import os
from pathlib import Path
from dotenv import load_dotenv

# Load environment variables from .env file
BASE_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BASE_DIR / ".env")

class Settings:
    # Database settings
    DB_HOST: str = os.getenv("DB_HOST", "localhost")
    DB_PORT: int = int(os.getenv("DB_PORT", "3306"))
    DB_USER: str = os.getenv("DB_USER", "root")
    DB_PASSWORD: str = os.getenv("DB_PASSWORD", "")
    DB_NAME: str = os.getenv("DB_NAME", "folio_db")

    # Storage settings
    FOLIO_STORAGE_ROOT: Path = BASE_DIR / os.getenv("FOLIO_STORAGE_ROOT", "storage")

    # Authentication / Security settings
    JWT_SECRET_KEY: str = os.getenv("JWT_SECRET_KEY", "folio-insecure-secret-key-change-in-production-123456")
    JWT_ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "1440"))

    # Sandboxed Query Runner DB Settings (MySQL 8.0 Role Executor)
    RUNNER_DB_USER: str = os.getenv("RUNNER_DB_USER", "folio_runner")
    RUNNER_DB_PASSWORD: str = os.getenv("RUNNER_DB_PASSWORD", "folio_runner_pass")

settings = Settings()
