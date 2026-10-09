import asyncio
import io
import sys
import zipfile
from pathlib import Path
from starlette.datastructures import UploadFile

# Add project root to sys.path
PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

from backend.config import settings
from backend.database import get_db
from backend.routers.books import export_book_zip, import_book_zip
from backend.services.auth import CurrentUser

async def run_test():
    print("==================================================")
    print("Testing Folio Book ZIP Export & Import Pipeline")
    print("==================================================")

    with get_db() as cursor:
        # Check an existing book or use Book 1
        cursor.execute("SELECT book_id, owner_id, title, slug FROM Book LIMIT 1;")
        first_book = cursor.fetchone()
        if not first_book:
            print("No books exist in database to export. Please run seed script.")
            return

        test_book_id = first_book["book_id"]
        owner_id = first_book["owner_id"]

        cursor.execute("SELECT user_id, name, email FROM User WHERE user_id = %s;", (owner_id,))
        owner = cursor.fetchone()
        current_user = CurrentUser(user_id=owner["user_id"], name=owner["name"], email=owner["email"])

    # 1. Perform ZIP Export
    streaming_response = export_book_zip(test_book_id, current_user)
    # The StreamingResponse body is a BytesIO or body_iterator
    chunks = []
    async for chunk in streaming_response.body_iterator:
        chunks.append(chunk)
    zip_bytes = b"".join(chunks)

    print(f" -> Exported ZIP successfully ({len(zip_bytes)} bytes)")

    # Inspect ZIP structure
    with zipfile.ZipFile(io.BytesIO(zip_bytes), "r") as zf:
        file_list = zf.namelist()
        print(f" -> Archive contents: {len(file_list)} files: {file_list[:5]}...")
        assert "folio.json" in file_list, "ZIP must contain 'folio.json'"
        has_pages = any(f.startswith("pages/") and f.endswith(".md") for f in file_list)
        assert has_pages, "ZIP must contain markdown files inside 'pages/'"

    # 2. Test Import WITHOUT Grants (restore_grants = False)
    print("\n[2] Testing Import WITH restore_grants = False...")
    upload_file_no_grants = UploadFile(
        file=io.BytesIO(zip_bytes),
        filename=f"{first_book['slug']}.zip",
        headers={"content-type": "application/zip"}
    )
    res_no_grants = await import_book_zip(
        file=upload_file_no_grants,
        title="Imported Clone (No Grants)",
        slug=None,
        restore_grants=False,
        current_user=current_user
    )
    print(f" -> Import result: {res_no_grants['message']}")
    print(f"    New Book ID: {res_no_grants['book_id']}, Slug: {res_no_grants['slug']}")
    print(f"    Pages: {res_no_grants['pages_imported']}, Tags: {res_no_grants['tags_restored']}, Grants: {res_no_grants['grants_restored']}")
    assert res_no_grants['grants_restored'] == 0, "Grants should NOT be restored when restore_grants is False"
    assert res_no_grants['pages_imported'] > 0, "Pages should be imported"

    # 3. Test Import WITH Grants (restore_grants = True)
    print("\n[3] Testing Import WITH restore_grants = True...")
    upload_file_with_grants = UploadFile(
        file=io.BytesIO(zip_bytes),
        filename=f"{first_book['slug']}.zip",
        headers={"content-type": "application/zip"}
    )
    res_with_grants = await import_book_zip(
        file=upload_file_with_grants,
        title="Imported Clone (With Grants)",
        slug=None,
        restore_grants=True,
        current_user=current_user
    )
    print(f" -> Import result: {res_with_grants['message']}")
    print(f"    New Book ID: {res_with_grants['book_id']}, Slug: {res_with_grants['slug']}")
    print(f"    Pages: {res_with_grants['pages_imported']}, Tags: {res_with_grants['tags_restored']}, Grants: {res_with_grants['grants_restored']}")
    if res_with_grants['skipped_grants']:
        print(f"    Skipped grants notices: {res_with_grants['skipped_grants']}")

    # 4. Verify Backlinks and Structure in Database
    with get_db() as cursor:
        new_book_id = res_with_grants['book_id']
        cursor.execute("""
            SELECT b.link_id, pf.title AS from_title, pt.title AS to_title
            FROM Backlinks b
            JOIN Page pf ON b.page_id_from = pf.page_id
            JOIN Page pt ON b.page_id_to = pt.page_id
            WHERE pf.book_id = %s;
        """, (new_book_id,))
        backlinks = cursor.fetchall()
        print(f"\n[4] Verified Backlinks in imported book: {len(backlinks)} backlink relationship(s) created:")
        for bl in backlinks:
            print(f"    '{bl['from_title']}' -> '{bl['to_title']}'")

        # 5. Verify Tags
        cursor.execute("""
            SELECT DISTINCT t.name
            FROM PageTags pt
            JOIN Page p ON pt.page_id = p.page_id
            JOIN Tag t ON pt.tag_id = t.tag_id
            WHERE p.book_id = %s;
        """, (new_book_id,))
        restored_tags = [row["name"] for row in cursor.fetchall()]
        print(f"[5] Verified Tags attached to imported pages: {restored_tags}")

        # 6. Verify Parent-Child Hierarchy
        cursor.execute("""
            SELECT p.title, parent.title AS parent_title
            FROM Page p
            LEFT JOIN Page parent ON p.parent_page_id = parent.page_id
            WHERE p.book_id = %s AND p.parent_page_id IS NOT NULL;
        """, (new_book_id,))
        children = cursor.fetchall()
        print(f"[6] Verified Hierarchical Nested Pages:")
        for ch in children:
            print(f"    Child note: '{ch['title']}' nested under '{ch['parent_title']}'")

        # 7. Cleanup test clones
        from backend.services import storage
        for b_id, b_slug in [(res_no_grants['book_id'], res_no_grants['slug']), (res_with_grants['book_id'], res_with_grants['slug'])]:
            cursor.execute("DELETE FROM Book WHERE book_id = %s;", (b_id,))
            try:
                cursor.execute(f"DROP ROLE IF EXISTS 'role_book_{b_id}';")
            except Exception:
                pass
            storage.delete_book_dir(b_slug)
        print("\n[7] Cleaned up temporary test books from database and storage.")

    print("\n==================================================")
    print("ALL ZIP EXPORT & IMPORT TESTS COMPLETED SUCCESSFULLY!")
    print("==================================================")

if __name__ == "__main__":
    asyncio.run(run_test())
