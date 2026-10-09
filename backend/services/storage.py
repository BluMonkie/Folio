import os
import shutil
import logging
from abc import ABC, abstractmethod
from pathlib import Path
from typing import List, Optional

from backend.config import settings

logger = logging.getLogger("folio.storage")

# -----------------------------------------------------------------------------
# Abstract Storage Interface
# -----------------------------------------------------------------------------
class StorageBackend(ABC):
    """
    Abstract interface for book and page markdown storage.
    Enables pluggable backends: local filesystem or S3-compatible object storage.
    """

    @abstractmethod
    def ensure_book(self, book_slug: str) -> None:
        """Ensures the storage container or prefix for a book exists."""
        pass

    @abstractmethod
    def rename_book(self, old_slug: str, new_slug: str) -> bool:
        """Renames/moves a book namespace and its pages to a new slug."""
        pass

    @abstractmethod
    def delete_book(self, book_slug: str) -> bool:
        """Deletes a book namespace and all its stored pages."""
        pass

    @abstractmethod
    def read_page(self, book_slug: str, page_slug: str) -> str:
        """Reads markdown content for a page. Returns empty string if not found."""
        pass

    @abstractmethod
    def write_page(self, book_slug: str, page_slug: str, content: str) -> None:
        """Writes markdown content for a page."""
        pass

    @abstractmethod
    def rename_page(self, book_slug: str, old_page_slug: str, new_page_slug: str) -> bool:
        """Renames a page from old slug to new slug."""
        pass

    @abstractmethod
    def delete_page(self, book_slug: str, page_slug: str) -> bool:
        """Deletes a page's markdown file."""
        pass

    @abstractmethod
    def page_exists(self, book_slug: str, page_slug: str) -> bool:
        """Returns True if the page exists in storage, False otherwise."""
        pass

    @abstractmethod
    def list_pages(self, book_slug: str) -> List[str]:
        """Returns all page slugs belonging to a book."""
        pass


# -----------------------------------------------------------------------------
# Local FileSystem Storage Backend
# -----------------------------------------------------------------------------
class FileSystemStorage(StorageBackend):
    """
    Local filesystem storage provider.
    Stores files at: {FOLIO_STORAGE_ROOT}/{book_slug}/{page_slug}.md
    """

    def __init__(self, root_dir: Optional[Path] = None):
        self.root_dir = root_dir or settings.FOLIO_STORAGE_ROOT
        self.root_dir.mkdir(parents=True, exist_ok=True)

    def _get_book_dir(self, book_slug: str) -> Path:
        return self.root_dir / book_slug

    def _get_page_path(self, book_slug: str, page_slug: str) -> Path:
        return self._get_book_dir(book_slug) / f"{page_slug}.md"

    def ensure_book(self, book_slug: str) -> None:
        book_dir = self._get_book_dir(book_slug)
        book_dir.mkdir(parents=True, exist_ok=True)

    def rename_book(self, old_slug: str, new_slug: str) -> bool:
        old_dir = self._get_book_dir(old_slug)
        new_dir = self._get_book_dir(new_slug)

        if old_dir.exists():
            old_dir.rename(new_dir)
            return True
        else:
            new_dir.mkdir(parents=True, exist_ok=True)
            return False

    def delete_book(self, book_slug: str) -> bool:
        book_dir = self._get_book_dir(book_slug)
        if book_dir.exists() and book_dir.is_dir():
            shutil.rmtree(book_dir, ignore_errors=True)
            return True
        return False

    def read_page(self, book_slug: str, page_slug: str) -> str:
        path = self._get_page_path(book_slug, page_slug)
        if not path.exists():
            return ""
        return path.read_text(encoding="utf-8")

    def write_page(self, book_slug: str, page_slug: str, content: str) -> None:
        self.ensure_book(book_slug)
        path = self._get_page_path(book_slug, page_slug)
        path.write_text(content, encoding="utf-8")

    def rename_page(self, book_slug: str, old_page_slug: str, new_page_slug: str) -> bool:
        old_path = self._get_page_path(book_slug, old_page_slug)
        new_path = self._get_page_path(book_slug, new_page_slug)

        if not old_path.exists():
            return False

        old_path.rename(new_path)
        return True

    def delete_page(self, book_slug: str, page_slug: str) -> bool:
        path = self._get_page_path(book_slug, page_slug)
        if path.exists():
            path.unlink()
            return True
        return False

    def page_exists(self, book_slug: str, page_slug: str) -> bool:
        return self._get_page_path(book_slug, page_slug).exists()

    def list_pages(self, book_slug: str) -> List[str]:
        book_dir = self._get_book_dir(book_slug)
        if not book_dir.exists() or not book_dir.is_dir():
            return []
        return [f.stem for f in book_dir.glob("*.md")]


# -----------------------------------------------------------------------------
# S3 / S3-Compatible Object Storage Backend
# -----------------------------------------------------------------------------
class S3Storage(StorageBackend):
    """
    S3-compatible object storage provider.
    Works seamlessly with AWS S3, MinIO, Cloudflare R2, Wasabi, Ceph, and LocalStack.
    Object Key format: {prefix}{book_slug}/{page_slug}.md
    """

    def __init__(
        self,
        bucket_name: Optional[str] = None,
        endpoint_url: Optional[str] = None,
        region_name: Optional[str] = None,
        access_key_id: Optional[str] = None,
        secret_access_key: Optional[str] = None,
        prefix: Optional[str] = None,
    ):
        import boto3
        from botocore.config import Config

        self.bucket_name = bucket_name or settings.FOLIO_S3_BUCKET
        self.endpoint_url = endpoint_url or settings.FOLIO_S3_ENDPOINT_URL
        self.region_name = region_name or settings.FOLIO_S3_REGION_NAME
        self.prefix = (prefix if prefix is not None else settings.FOLIO_S3_PREFIX).strip().strip("/")

        session_kwargs = {}
        if access_key_id or settings.FOLIO_S3_ACCESS_KEY_ID:
            session_kwargs["aws_access_key_id"] = access_key_id or settings.FOLIO_S3_ACCESS_KEY_ID
        if secret_access_key or settings.FOLIO_S3_SECRET_ACCESS_KEY:
            session_kwargs["aws_secret_access_key"] = secret_access_key or settings.FOLIO_S3_SECRET_ACCESS_KEY
        if self.region_name:
            session_kwargs["region_name"] = self.region_name

        client_kwargs = {**session_kwargs}
        if self.endpoint_url:
            client_kwargs["endpoint_url"] = self.endpoint_url

        # Signature version v4 is standard for modern S3 and MinIO
        client_kwargs["config"] = Config(signature_version="s3v4")

        self.client = boto3.client("s3", **client_kwargs)
        self._ensure_bucket_exists()

    def _ensure_bucket_exists(self) -> None:
        """Attempts to verify or create the target bucket if running against local/MinIO instances."""
        from botocore.exceptions import ClientError
        try:
            self.client.head_bucket(Bucket=self.bucket_name)
        except ClientError as e:
            error_code = e.response.get("Error", {}).get("Code", "")
            if error_code in ("404", "NoSuchBucket"):
                try:
                    create_kwargs = {"Bucket": self.bucket_name}
                    if self.region_name and self.region_name != "us-east-1":
                        create_kwargs["CreateBucketConfiguration"] = {"LocationConstraint": self.region_name}
                    self.client.create_bucket(**create_kwargs)
                    logger.info("Created S3 bucket: %s", self.bucket_name)
                except Exception as create_err:
                    logger.warning("Could not automatically create S3 bucket '%s': %s", self.bucket_name, create_err)
            else:
                logger.warning("S3 head_bucket check warning for '%s': %s", self.bucket_name, e)

    def _get_page_key(self, book_slug: str, page_slug: str) -> str:
        base = f"{self.prefix}/" if self.prefix else ""
        return f"{base}{book_slug}/{page_slug}.md"

    def _get_book_prefix(self, book_slug: str) -> str:
        base = f"{self.prefix}/" if self.prefix else ""
        return f"{base}{book_slug}/"

    def ensure_book(self, book_slug: str) -> None:
        # S3 has a flat namespace with key prefixes; creating a marker is optional,
        # but we can place an empty .keep marker to make the book folder explicit in UI tools.
        pass

    def rename_book(self, old_slug: str, new_slug: str) -> bool:
        from botocore.exceptions import ClientError
        old_prefix = self._get_book_prefix(old_slug)
        new_prefix = self._get_book_prefix(new_slug)

        try:
            paginator = self.client.get_paginator("list_objects_v2")
            renamed_any = False
            for page in paginator.paginate(Bucket=self.bucket_name, Prefix=old_prefix):
                for item in page.get("Contents", []):
                    old_key = item["Key"]
                    suffix = old_key[len(old_prefix):]
                    new_key = f"{new_prefix}{suffix}"

                    self.client.copy_object(
                        Bucket=self.bucket_name,
                        CopySource={"Bucket": self.bucket_name, "Key": old_key},
                        Key=new_key,
                    )
                    self.client.delete_object(Bucket=self.bucket_name, Key=old_key)
                    renamed_any = True
            return renamed_any
        except ClientError as e:
            logger.error("Error renaming book from '%s' to '%s' in S3: %s", old_slug, new_slug, e)
            return False

    def delete_book(self, book_slug: str) -> bool:
        from botocore.exceptions import ClientError
        prefix = self._get_book_prefix(book_slug)
        try:
            paginator = self.client.get_paginator("list_objects_v2")
            deleted_any = False
            for page in paginator.paginate(Bucket=self.bucket_name, Prefix=prefix):
                objects_to_delete = [{"Key": obj["Key"]} for obj in page.get("Contents", [])]
                if objects_to_delete:
                    self.client.delete_objects(
                        Bucket=self.bucket_name,
                        Delete={"Objects": objects_to_delete, "Quiet": True},
                    )
                    deleted_any = True
            return deleted_any
        except ClientError as e:
            logger.error("Error deleting book '%s' in S3: %s", book_slug, e)
            return False

    def read_page(self, book_slug: str, page_slug: str) -> str:
        from botocore.exceptions import ClientError
        key = self._get_page_key(book_slug, page_slug)
        try:
            response = self.client.get_object(Bucket=self.bucket_name, Key=key)
            return response["Body"].read().decode("utf-8")
        except ClientError as e:
            code = e.response.get("Error", {}).get("Code", "")
            if code in ("NoSuchKey", "404"):
                return ""
            logger.error("Failed to read page from S3 ('%s'): %s", key, e)
            return ""

    def write_page(self, book_slug: str, page_slug: str, content: str) -> None:
        key = self._get_page_key(book_slug, page_slug)
        self.client.put_object(
            Bucket=self.bucket_name,
            Key=key,
            Body=content.encode("utf-8"),
            ContentType="text/markdown; charset=utf-8",
        )

    def rename_page(self, book_slug: str, old_page_slug: str, new_page_slug: str) -> bool:
        from botocore.exceptions import ClientError
        old_key = self._get_page_key(book_slug, old_page_slug)
        new_key = self._get_page_key(book_slug, new_page_slug)

        try:
            # Copy to new key, then delete old
            self.client.copy_object(
                Bucket=self.bucket_name,
                CopySource={"Bucket": self.bucket_name, "Key": old_key},
                Key=new_key,
            )
            self.client.delete_object(Bucket=self.bucket_name, Key=old_key)
            return True
        except ClientError as e:
            code = e.response.get("Error", {}).get("Code", "")
            if code in ("NoSuchKey", "404"):
                return False
            logger.error("Failed to rename page in S3 from '%s' to '%s': %s", old_key, new_key, e)
            return False

    def delete_page(self, book_slug: str, page_slug: str) -> bool:
        from botocore.exceptions import ClientError
        key = self._get_page_key(book_slug, page_slug)
        try:
            # Check if exists first
            self.client.head_object(Bucket=self.bucket_name, Key=key)
            self.client.delete_object(Bucket=self.bucket_name, Key=key)
            return True
        except ClientError:
            return False

    def page_exists(self, book_slug: str, page_slug: str) -> bool:
        from botocore.exceptions import ClientError
        key = self._get_page_key(book_slug, page_slug)
        try:
            self.client.head_object(Bucket=self.bucket_name, Key=key)
            return True
        except ClientError:
            return False

    def list_pages(self, book_slug: str) -> List[str]:
        prefix = self._get_book_prefix(book_slug)
        pages = []
        paginator = self.client.get_paginator("list_objects_v2")
        for page in paginator.paginate(Bucket=self.bucket_name, Prefix=prefix):
            for item in page.get("Contents", []):
                key = item["Key"]
                if key.endswith(".md"):
                    pages.append(Path(key).stem)
        return pages


# -----------------------------------------------------------------------------
# Factory & Singleton Accessor
# -----------------------------------------------------------------------------
_storage_instance: Optional[StorageBackend] = None

def get_storage() -> StorageBackend:
    """
    Returns the configured storage backend singleton based on FOLIO_STORAGE_BACKEND.
    Supported backends: 'filesystem' (default), 's3'.
    """
    global _storage_instance
    if _storage_instance is None:
        backend_type = settings.FOLIO_STORAGE_BACKEND
        if backend_type == "s3":
            logger.info("Initializing S3Storage backend (bucket=%s, endpoint=%s)", settings.FOLIO_S3_BUCKET, settings.FOLIO_S3_ENDPOINT_URL)
            _storage_instance = S3Storage()
        else:
            logger.info("Initializing FileSystemStorage backend (root=%s)", settings.FOLIO_STORAGE_ROOT)
            _storage_instance = FileSystemStorage()
    return _storage_instance

def set_storage(backend: StorageBackend) -> None:
    """Explicitly overrides or switches the active storage backend (useful for testing or runtime toggle)."""
    global _storage_instance
    _storage_instance = backend


# -----------------------------------------------------------------------------
# Convenience Functions (Backward-Compatible API)
# -----------------------------------------------------------------------------
def get_book_dir(book_slug: str) -> Path:
    """Returns local directory path for a book when using FileSystemStorage."""
    return settings.FOLIO_STORAGE_ROOT / book_slug

def get_page_path(book_slug: str, page_slug: str) -> Path:
    """Returns local file path for a page when using FileSystemStorage."""
    return get_book_dir(book_slug) / f"{page_slug}.md"

def ensure_book_dir(book_slug: str) -> None:
    """Ensures the storage container/directory for a book exists."""
    get_storage().ensure_book(book_slug)

def rename_book_dir(old_slug: str, new_slug: str) -> bool:
    """Renames a book's container and pages to a new slug."""
    return get_storage().rename_book(old_slug, new_slug)

def delete_book_dir(book_slug: str) -> bool:
    """Deletes a book's container and all pages."""
    return get_storage().delete_book(book_slug)

def read_page_content(book_slug: str, page_slug: str) -> str:
    """Reads markdown content for a page from the active storage backend."""
    return get_storage().read_page(book_slug, page_slug)

def write_page_content(book_slug: str, page_slug: str, content: str) -> None:
    """Writes markdown content for a page to the active storage backend."""
    get_storage().write_page(book_slug, page_slug, content)

def rename_page_file(book_slug: str, old_page_slug: str, new_page_slug: str) -> bool:
    """Renames a page's content from old_page_slug to new_page_slug."""
    return get_storage().rename_page(book_slug, old_page_slug, new_page_slug)

def delete_page_file(book_slug: str, page_slug: str) -> bool:
    """Deletes the page's markdown content from the active storage backend."""
    return get_storage().delete_page(book_slug, page_slug)

def page_exists(book_slug: str, page_slug: str) -> bool:
    """Returns True if the page exists in storage."""
    return get_storage().page_exists(book_slug, page_slug)

def list_book_pages(book_slug: str) -> List[str]:
    """Lists all page slugs in a book."""
    return get_storage().list_pages(book_slug)
