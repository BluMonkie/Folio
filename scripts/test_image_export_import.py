import asyncio
import io
import os
import sys
import zipfile
from pathlib import Path
from starlette.datastructures import UploadFile

PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

from backend.database import get_db
from backend.services.auth import CurrentUser, create_access_token, hash_password
from backend.services import storage
from backend.routers.books import export_book_zip, import_book_zip

async def run_test():
    print("==================================================")
    print("Testing Image Preservation in Export/Import Pipeline")
    print("==================================================")

    # 1. Create or get test user
    with get_db() as cursor:
        cursor.execute("SELECT user_id, name, email FROM User WHERE email = %s;", ("img_export_tester@example.com",))
        user = cursor.fetchone()
        if not user:
            cursor.execute(
                "INSERT INTO User (name, email, password_hash) VALUES (%s, %s, %s);",
                ("Image Export Tester", "img_export_tester@example.com", hash_password("pass123"))
            )
            user_id = cursor.lastrowid
            user = {"user_id": user_id, "name": "Image Export Tester", "email": "img_export_tester@example.com"}
        else:
            user_id = user["user_id"]

    current_user = CurrentUser(user_id=user["user_id"], name=user["name"], email=user["email"])

    # 2. Create test asset in storage
    test_asset_name = "test_export_banner.png"
    sample_img_bytes = b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR" + b"TEST_IMAGE_CONTENT_BYTES_12345"
    storage.write_asset(test_asset_name, sample_img_bytes, "image/png")
    assert storage.asset_exists(test_asset_name), "Test asset must exist in storage"
    print(f" -> Created test asset '{test_asset_name}' in storage")

    # 3. Create test book and page containing image reference
    book_slug = "img-export-test-book"
    with get_db() as cursor:
        cursor.execute("SELECT book_id FROM Book WHERE slug = %s;", (book_slug,))
        existing = cursor.fetchone()
        if existing:
            test_book_id = existing["book_id"]
        else:
            cursor.execute(
                "INSERT INTO Book (owner_id, title, slug) VALUES (%s, %s, %s);",
                (user_id, "Image Export Test Book", book_slug)
            )
            test_book_id = cursor.lastrowid

        storage.ensure_book_dir(book_slug)

        # Create page with markdown image link
        page_slug = "page-with-image"
        page_content = f"# Welcome to Image Testing\n\nHere is an important embedded chart:\n\n![Chart](/assets/{test_asset_name})\n\nSome text below."
        storage.write_page_content(book_slug, page_slug, page_content)

        cursor.execute("SELECT page_id FROM Page WHERE book_id = %s AND slug = %s;", (test_book_id, page_slug))
        p_row = cursor.fetchone()
        if not p_row:
            cursor.execute(
                "INSERT INTO Page (book_id, parent_page_id, title, slug, position) VALUES (%s, NULL, %s, %s, %s);",
                (test_book_id, "Page with Image", page_slug, 1)
            )

    print(f" -> Created book {test_book_id} with page referencing /assets/{test_asset_name}")

    # 4. Export Book to ZIP
    streaming_response = export_book_zip(test_book_id, current_user)
    chunks = []
    async for chunk in streaming_response.body_iterator:
        chunks.append(chunk)
    zip_bytes = b"".join(chunks)

    print(f" -> Exported ZIP successfully ({len(zip_bytes)} bytes)")

    # 5. Inspect ZIP structure for bundled asset
    with zipfile.ZipFile(io.BytesIO(zip_bytes), "r") as zf:
        namelist = zf.namelist()
        print(f" -> Archive contents: {namelist}")
        assert f"assets/{test_asset_name}" in namelist, f"ZIP must bundle 'assets/{test_asset_name}'"
        bundled_bytes = zf.read(f"assets/{test_asset_name}")
        assert bundled_bytes == sample_img_bytes, "Bundled asset bytes must match original!"
        print(f" -> Verified 'assets/{test_asset_name}' is bundled with identical bytes!")

    # 6. Delete asset from active storage to simulate new environment/server
    storage.delete_asset(test_asset_name)
    assert not storage.asset_exists(test_asset_name), "Asset should be deleted from storage for restore test"
    print(f" -> Deleted '{test_asset_name}' from storage to verify import restoration")

    # 7. Import Book from ZIP
    upload_file = UploadFile(
        file=io.BytesIO(zip_bytes),
        filename="exported_book.zip",
        headers={"content-type": "application/zip"}
    )
    import_result = await import_book_zip(
        file=upload_file,
        title="Restored Book with Images",
        slug=None,
        restore_grants=False,
        current_user=current_user
    )
    print(f" -> Import result: {import_result['message']}")
    print(f"    Assets restored: {import_result['assets_restored']}")
    assert import_result['assets_restored'] >= 1, "Expected at least 1 asset to be restored"

    # 8. Verify asset is restored in storage and identical
    assert storage.asset_exists(test_asset_name), f"Asset '{test_asset_name}' must be restored in storage!"
    restored_bytes, ctype = storage.read_asset(test_asset_name)
    assert restored_bytes == sample_img_bytes, "Restored asset bytes must match original!"
    print(f" -> Verified asset '{test_asset_name}' successfully restored in storage!")

    print("\nALL IMAGE EXPORT/IMPORT PRESERVATION TESTS PASSED SUCCESSFULLY!")

if __name__ == "__main__":
    asyncio.run(run_test())
