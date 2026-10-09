import os
from pathlib import Path
from dotenv import load_dotenv

# Load environment variables from .env file
BASE_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BASE_DIR / ".env")

class Settings:
    # Database settings
    DB_HOST: str = os.getenv("DB_HOST", "localhost").strip()
    DB_PORT: int = int(os.getenv("DB_PORT", "3306").strip())
    DB_USER: str = os.getenv("DB_USER", "root").strip()
    DB_PASSWORD: str = os.getenv("DB_PASSWORD", "").strip()
    DB_NAME: str = os.getenv("DB_NAME", "folio_db").strip()
    DB_SSL: bool = (
        os.getenv("DB_SSL", "auto").strip().lower() in ("true", "1", "yes")
        or (
            os.getenv("DB_SSL", "auto").strip().lower() == "auto"
            and os.getenv("DB_HOST", "localhost").strip() not in ("localhost", "127.0.0.1")
        )
    )

    # Storage settings
    FOLIO_STORAGE_BACKEND: str = os.getenv("FOLIO_STORAGE_BACKEND", "filesystem").strip().lower()
    FOLIO_STORAGE_ROOT: Path = BASE_DIR / os.getenv("FOLIO_STORAGE_ROOT", "storage")

    # S3 / Object Storage settings (AWS S3, MinIO, Cloudflare R2, LocalStack)
    FOLIO_S3_BUCKET: str = os.getenv("FOLIO_S3_BUCKET", "folio-storage").strip()
    _raw_s3_url: str = os.getenv("FOLIO_S3_ENDPOINT_URL", "").strip()
    FOLIO_S3_ENDPOINT_URL: str | None = (
        (f"https://{_raw_s3_url}" if _raw_s3_url and not (_raw_s3_url.startswith("http://") or _raw_s3_url.startswith("https://")) else _raw_s3_url)
        or None
    )
    FOLIO_S3_REGION_NAME: str = os.getenv("FOLIO_S3_REGION_NAME", "us-east-1")
    FOLIO_S3_ACCESS_KEY_ID: str | None = os.getenv("FOLIO_S3_ACCESS_KEY_ID") or None
    FOLIO_S3_SECRET_ACCESS_KEY: str | None = os.getenv("FOLIO_S3_SECRET_ACCESS_KEY") or None
    FOLIO_S3_PREFIX: str = os.getenv("FOLIO_S3_PREFIX", "").strip().strip("/")

    # Authentication / Security settings
    JWT_SECRET_KEY: str = os.getenv("JWT_SECRET_KEY", "folio-insecure-secret-key-change-in-production-123456")
    JWT_ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "1440"))

    # Sandboxed Query Runner DB Settings (MySQL 8.0 Role Executor)
    RUNNER_DB_USER: str = os.getenv("RUNNER_DB_USER", "folio_runner").strip()
    RUNNER_DB_PASSWORD: str = os.getenv("RUNNER_DB_PASSWORD", "folio_runner_pass").strip()

settings = Settings()
