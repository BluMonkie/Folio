import sys
import shutil
import tempfile
from pathlib import Path
from unittest.mock import MagicMock

# Add project root to sys.path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from backend.services.storage import (
    FileSystemStorage,
    S3Storage,
    get_storage,
    set_storage,
    read_page_content,
    write_page_content,
    rename_page_file,
    delete_page_file,
    page_exists,
    ensure_book_dir,
    rename_book_dir,
    delete_book_dir,
    list_book_pages,
)

def test_filesystem_storage():
    print("\n--- Testing FileSystemStorage ---")
    with tempfile.TemporaryDirectory() as tmpdir:
        temp_root = Path(tmpdir)
        fs = FileSystemStorage(root_dir=temp_root)
        set_storage(fs)

        book_slug = "demo-book"
        page_slug = "intro"
        content = "# Introduction\n\nWelcome to Folio."

        # 1. Write page
        write_page_content(book_slug, page_slug, content)
        assert page_exists(book_slug, page_slug), "Page should exist after write"

        # 2. Read page
        read_back = read_page_content(book_slug, page_slug)
        assert read_back == content, f"Expected '{content}', got '{read_back}'"
        print("[OK] Write and read page verified")

        # 3. List pages
        pages = list_book_pages(book_slug)
        assert "intro" in pages, f"Expected 'intro' in {pages}"
        print("[OK] List book pages verified")

        # 4. Rename page
        new_page_slug = "getting-started"
        renamed = rename_page_file(book_slug, page_slug, new_page_slug)
        assert renamed, "Rename should return True"
        assert not page_exists(book_slug, page_slug), "Old page should not exist"
        assert page_exists(book_slug, new_page_slug), "New page should exist"
        assert read_page_content(book_slug, new_page_slug) == content
        print("[OK] Rename page verified")

        # 5. Delete page
        deleted = delete_page_file(book_slug, new_page_slug)
        assert deleted, "Delete should return True"
        assert not page_exists(book_slug, new_page_slug)
        print("[OK] Delete page verified")

        # 6. Book operations
        write_page_content(book_slug, "chapter-1", "Chapter 1 text")
        rename_book_dir(book_slug, "renamed-book")
        assert not (temp_root / book_slug).exists()
        assert (temp_root / "renamed-book").exists()
        assert read_page_content("renamed-book", "chapter-1") == "Chapter 1 text"
        print("[OK] Rename book verified")

        delete_book_dir("renamed-book")
        assert not (temp_root / "renamed-book").exists()
        print("[OK] Delete book verified")

def test_s3_storage_mock():
    print("\n--- Testing S3Storage with mock S3 Client ---")
    mock_client = MagicMock()
    
    # Store objects in an in-memory dictionary to simulate S3
    s3_objects = {}

    def mock_put_object(Bucket, Key, Body, **kwargs):
        s3_objects[Key] = Body.decode("utf-8") if isinstance(Body, bytes) else Body
        return {"ETag": "12345"}

    def mock_get_object(Bucket, Key, **kwargs):
        from botocore.exceptions import ClientError
        if Key not in s3_objects:
            raise ClientError({"Error": {"Code": "NoSuchKey", "Message": "Key not found"}}, "GetObject")
        
        class MockBody:
            def read(self):
                return s3_objects[Key].encode("utf-8")
        return {"Body": MockBody()}

    def mock_head_object(Bucket, Key, **kwargs):
        from botocore.exceptions import ClientError
        if Key not in s3_objects:
            raise ClientError({"Error": {"Code": "404", "Message": "Not Found"}}, "HeadObject")
        return {}

    def mock_delete_object(Bucket, Key, **kwargs):
        s3_objects.pop(Key, None)
        return {}

    def mock_delete_objects(Bucket, Delete, **kwargs):
        for obj in Delete.get("Objects", []):
            s3_objects.pop(obj["Key"], None)
        return {"Deleted": Delete.get("Objects", [])}

    def mock_copy_object(Bucket, CopySource, Key, **kwargs):
        src_key = CopySource["Key"]
        if src_key in s3_objects:
            s3_objects[Key] = s3_objects[src_key]
        return {}

    def mock_get_paginator(operation_name):
        class MockPaginator:
            def paginate(self, Bucket, Prefix):
                items = [{"Key": k} for k in list(s3_objects.keys()) if k.startswith(Prefix)]
                return [{"Contents": items}]
        return MockPaginator()

    mock_client.put_object.side_effect = mock_put_object
    mock_client.get_object.side_effect = mock_get_object
    mock_client.head_object.side_effect = mock_head_object
    mock_client.delete_object.side_effect = mock_delete_object
    mock_client.delete_objects.side_effect = mock_delete_objects
    mock_client.copy_object.side_effect = mock_copy_object
    mock_client.get_paginator.side_effect = mock_get_paginator
    mock_client.head_bucket.return_value = {}

    # Initialize S3Storage instance and bypass boto3.client call
    s3_storage = S3Storage.__new__(S3Storage)
    s3_storage.bucket_name = "test-folio-bucket"
    s3_storage.endpoint_url = "http://localhost:9000"
    s3_storage.region_name = "us-east-1"
    s3_storage.prefix = "kb"
    s3_storage.client = mock_client

    set_storage(s3_storage)

    book_slug = "cloud-notes"
    page_slug = "architectures"
    content = "Distributed storage via S3 API."

    # 1. Write page
    write_page_content(book_slug, page_slug, content)
    assert f"kb/{book_slug}/{page_slug}.md" in s3_objects, "S3 key should exist in mock"
    print("[OK] S3 write_page creates correct object key:", f"kb/{book_slug}/{page_slug}.md")

    # 2. Read page
    read_back = read_page_content(book_slug, page_slug)
    assert read_back == content, f"Expected '{content}', got '{read_back}'"
    print("[OK] S3 read_page fetches object correctly")

    # 3. Page exists
    assert page_exists(book_slug, page_slug)
    assert not page_exists(book_slug, "nonexistent-page")
    print("[OK] S3 page_exists verified")

    # 4. List pages
    pages = list_book_pages(book_slug)
    assert page_slug in pages, f"Expected '{page_slug}' in {pages}"
    print("[OK] S3 list_book_pages verified:", pages)

    # 5. Rename page
    rename_page_file(book_slug, page_slug, "new-architectures")
    assert not page_exists(book_slug, page_slug)
    assert page_exists(book_slug, "new-architectures")
    assert read_page_content(book_slug, "new-architectures") == content
    print("[OK] S3 rename_page verified")

    # 6. Delete page
    delete_page_file(book_slug, "new-architectures")
    assert not page_exists(book_slug, "new-architectures")
    print("[OK] S3 delete_page verified")

    # 7. Rename book namespace in S3
    write_page_content(book_slug, "p1", "Page 1")
    write_page_content(book_slug, "p2", "Page 2")
    rename_book_dir(book_slug, "renamed-cloud-notes")
    assert not page_exists(book_slug, "p1")
    assert page_exists("renamed-cloud-notes", "p1")
    assert read_page_content("renamed-cloud-notes", "p1") == "Page 1"
    print("[OK] S3 rename_book across object prefixes verified")

    # 8. Delete book in S3
    delete_book_dir("renamed-cloud-notes")
    assert not page_exists("renamed-cloud-notes", "p1")
    assert not page_exists("renamed-cloud-notes", "p2")
    print("[OK] S3 delete_book batch deletion verified")

if __name__ == "__main__":
    test_filesystem_storage()
    test_s3_storage_mock()
    print("\n=========================================")
    print("ALL STORAGE BACKEND TESTS PASSED!")
    print("=========================================\n")
