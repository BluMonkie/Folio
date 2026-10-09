import asyncio
import io
import sys
import zipfile
from pathlib import Path
from starlette.datastructures import UploadFile

PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

from backend.database import get_db
from backend.services.auth import CurrentUser, hash_password
from backend.services import storage
from backend.routers.books import import_book_zip

async def run_test():
    print("==================================================")
    print("Testing Asset Collision Prevention on Book Import")
    print("==================================================")

    # 1. Setup user
    with get_db() as cursor:
        cursor.execute("SELECT user_id, name, email FROM User WHERE email = %s;", ("collision_tester@example.com",))
        user = cursor.fetchone()
        if not user:
            cursor.execute(
                "INSERT INTO User (name, email, password_hash) VALUES (%s, %s, %s);",
                ("Collision Tester", "collision_tester@example.com", hash_password("pass123"))
            )
            user_id = cursor.lastrowid
            user = {"user_id": user_id, "name": "Collision Tester", "email": "collision_tester@example.com"}
        else:
            user_id = user["user_id"]

    current_user = CurrentUser(user_id=user["user_id"], name=user["name"], email=user["email"])

    # 2. Plant an existing asset in storage with original content
    colliding_filename = "shared_diagram.png"
    original_bytes = b"ORIGINAL_EXISTING_ASSET_CONTENT_AAAA_DO_NOT_OVERWRITE"
    storage.write_asset(colliding_filename, original_bytes, "image/png")
    assert storage.asset_exists(colliding_filename), "Original asset must exist in storage"
    print(f" -> Existing system asset '{colliding_filename}' created with original content.")

    # 3. Create a ZIP for an incoming book that has an asset with the SAME name but DIFFERENT content
    incoming_bytes = b"NEW_INCOMING_DIFFERENT_IMAGE_CONTENT_BBBB_NEW_BOOK"
    
    manifest = {
        "folio_version": "1.0",
        "book": {
            "title": "Book With Conflicting Asset",
            "slug": "book-with-conflicting-asset"
        },
        "pages": [
            {
                "title": "Conflicting Page",
                "slug": "conflicting-page",
                "position": 1,
                "file_path": "pages/conflicting-page.md"
            }
        ]
    }
    page_md = f"# Conflicting Asset Page\n\nHere is our diagram:\n\n![Diagram](/assets/{colliding_filename})\n\nEnd of note."

    zip_buffer = io.BytesIO()
    with zipfile.ZipFile(zip_buffer, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("folio.json", io.StringIO().getvalue() if False else str(manifest).replace("'", '"'))
        zf.writestr("pages/conflicting-page.md", page_md)
        zf.writestr(f"assets/{colliding_filename}", incoming_bytes)

    zip_buffer.seek(0)
    zip_bytes = zip_buffer.getvalue()

    # 4. Import the book
    upload_file = UploadFile(
        file=io.BytesIO(zip_bytes),
        filename="conflict_test.zip",
        headers={"content-type": "application/zip"}
    )
    import_result = await import_book_zip(
        file=upload_file,
        title="Book With Conflicting Asset",
        slug=None,
        restore_grants=False,
        current_user=current_user
    )
    print(f" -> Import result: {import_result['message']}")
    imported_book_slug = import_result['slug']

    # 5. VERIFY: The original system asset was NOT overwritten!
    existing_asset_data = storage.read_asset(colliding_filename)
    assert existing_asset_data is not None, "Original asset must still exist!"
    assert existing_asset_data[0] == original_bytes, "CRITICAL ERROR: Original asset content was overwritten!"
    print(f" -> SUCCESS: Existing asset '{colliding_filename}' was NOT overwritten and preserves original content!")

    # 6. VERIFY: The imported page was rewritten to point to the newly allocated non-colliding asset name
    imported_page_content = storage.read_page_content(imported_book_slug, "conflicting-page")
    print(f" -> Imported page markdown content:\n{imported_page_content}")
    assert f"/assets/{colliding_filename}" not in imported_page_content, (
        f"Page should NOT point to '{colliding_filename}', it should point to renamed asset!"
    )

    import re
    matched_new_assets = re.findall(r'/assets/([a-zA-Z0-9_\-\.]+)', imported_page_content)
    assert len(matched_new_assets) == 1, f"Expected 1 rewritten asset link, found: {matched_new_assets}"
    new_asset_name = matched_new_assets[0]
    assert new_asset_name != colliding_filename, f"Rewritten asset name should be different from {colliding_filename}"
    print(f" -> SUCCESS: Markdown link rewritten to new unique asset '{new_asset_name}'!")

    # 7. VERIFY: The newly allocated asset exists in storage and contains the incoming image bytes!
    new_asset_data = storage.read_asset(new_asset_name)
    assert new_asset_data is not None, "New asset must exist in storage!"
    assert new_asset_data[0] == incoming_bytes, "New asset content must match incoming image bytes!"
    print(f" -> SUCCESS: New asset '{new_asset_name}' contains incoming image bytes perfectly!")

    # Cleanup
    storage.delete_asset(colliding_filename)
    storage.delete_asset(new_asset_name)

    print("\nALL COLLISION PREVENTION AND REWRITING CHECKS PASSED WITH 100% SUCCESS!")

if __name__ == "__main__":
    asyncio.run(run_test())
