import os
from pathlib import Path
from backend.config import settings

def get_book_dir(book_slug: str) -> Path:
    """Returns the directory path for a book."""
    return settings.FOLIO_STORAGE_ROOT / book_slug

def get_page_path(book_slug: str, page_slug: str) -> Path:
    """Returns the .md file path for a page."""
    return get_book_dir(book_slug) / f"{page_slug}.md"

def ensure_book_dir(book_slug: str) -> Path:
    """Ensures the directory for a book exists on disk."""
    book_dir = get_book_dir(book_slug)
    book_dir.mkdir(parents=True, exist_ok=True)
    return book_dir

def read_page_content(book_slug: str, page_slug: str) -> str:
    """
    Reads markdown content for a page from disk.
    Returns empty string if file does not exist yet.
    """
    path = get_page_path(book_slug, page_slug)
    if not path.exists():
        return ""
    return path.read_text(encoding="utf-8")

def write_page_content(book_slug: str, page_slug: str, content: str) -> Path:
    """
    Writes markdown content for a page to disk.
    Creates parent directories if necessary.
    """
    ensure_book_dir(book_slug)
    path = get_page_path(book_slug, page_slug)
    path.write_text(content, encoding="utf-8")
    return path

def rename_page_file(book_slug: str, old_page_slug: str, new_page_slug: str) -> bool:
    """
    Renames a page's .md file from old_page_slug to new_page_slug.
    Returns True if renamed, False if old file didn't exist.
    """
    old_path = get_page_path(book_slug, old_page_slug)
    new_path = get_page_path(book_slug, new_page_slug)

    if not old_path.exists():
        return False

    old_path.rename(new_path)
    return True

def delete_page_file(book_slug: str, page_slug: str) -> bool:
    """
    Deletes the page's .md file from disk.
    Returns True if deleted, False if file did not exist.
    """
    path = get_page_path(book_slug, page_slug)
    if path.exists():
        path.unlink()
        return True
    return False
