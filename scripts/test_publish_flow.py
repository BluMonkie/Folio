import json
import sys
import urllib.error
import urllib.request
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

from backend.database import get_db
from backend.services.auth import create_access_token, hash_password

BASE_URL = "http://localhost:8000"

def request(method, path, body=None, headers=None):
    url = f"{BASE_URL}{path}"
    req_headers = {"Content-Type": "application/json"}
    if headers:
        req_headers.update(headers)

    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib.request.Request(url, data=data, headers=req_headers, method=method)

    try:
        with urllib.request.urlopen(req) as response:
            status_code = response.status
            content = response.read().decode("utf-8")
            return status_code, json.loads(content) if content else {}
    except urllib.error.HTTPError as e:
        content = e.read().decode("utf-8")
        try:
            parsed = json.loads(content)
        except Exception:
            parsed = {"detail": content}
        return e.code, parsed

def test_publishing_pipeline():
    print("==================================================")
    print("Testing Book Publishing & Shared Access Pipeline")
    print("==================================================")

    # 1. Setup two test users in database
    with get_db() as cursor:
        cursor.execute("INSERT IGNORE INTO User (name, email, password_hash) VALUES (%s, %s, %s);",
                       ("Alice Owner", "alice_owner@test.com", hash_password("pass123")))
        cursor.execute("SELECT user_id FROM User WHERE email = 'alice_owner@test.com';")
        alice_id = cursor.fetchone()["user_id"]

        cursor.execute("INSERT IGNORE INTO User (name, email, password_hash) VALUES (%s, %s, %s);",
                       ("Bob Editor", "bob_editor@test.com", hash_password("pass123")))
        cursor.execute("SELECT user_id FROM User WHERE email = 'bob_editor@test.com';")
        bob_id = cursor.fetchone()["user_id"]

    alice_token = create_access_token(alice_id, "alice_owner@test.com")
    bob_token = create_access_token(bob_id, "bob_editor@test.com")
    alice_headers = {"Authorization": f"Bearer {alice_token}"}
    bob_headers = {"Authorization": f"Bearer {bob_token}"}

    # Clean up any previous test book
    with get_db() as cursor:
        cursor.execute("SELECT book_id, slug FROM Book WHERE slug LIKE 'data-engineering-published%';")
        for old_b in cursor.fetchall():
            cursor.execute("DELETE FROM Book WHERE book_id = %s;", (old_b["book_id"],))
            try:
                cursor.execute(f"DROP ROLE IF EXISTS 'role_book_{old_b['book_id']}';")
            except Exception:
                pass
            from backend.services import storage
            storage.delete_book_dir(old_b["slug"])

    # 2. Alice creates a book and a page with SQL block
    code, book = request("POST", "/books", {"title": "Data Engineering Published"}, alice_headers)
    assert code == 201, f"Create book failed: {book}"
    book_id = book["book_id"]
    print(f" -> Alice created book ID {book_id}: '{book['title']}'")

    # Alice grants StudentGrades table to the book
    with get_db() as cursor:
        cursor.execute("SELECT table_id, db FROM QueryableTables WHERE table_name = 'StudentGrades';")
        t_row = cursor.fetchone()
        t_id = t_row["table_id"]
        db_name = t_row["db"]
        cursor.execute("INSERT INTO BookTableGrants (book_id, table_id, can_read, can_write) VALUES (%s, %s, TRUE, FALSE);", (book_id, t_id))
        cursor.execute(f"GRANT SELECT ON `{db_name}`.`StudentGrades` TO 'role_book_{book_id}';")

    code, page = request("POST", f"/books/{book_id}/pages", {
        "title": "Welcome Chapter",
        "content": "# Welcome to Folio\n\nThis note is shared with the world.\n\n```query\nSELECT * FROM StudentGrades LIMIT 2;\n```"
    }, alice_headers)
    assert code == 201, f"Create page failed: {page}"
    page_id = page["page_id"]
    print(f" -> Created page ID {page_id} with SQL query block")

    # 3. Check initial publish state
    code, pub_info = request("GET", f"/books/{book_id}/publish", headers=alice_headers)
    assert code == 200, f"Get publish status failed: {pub_info}"
    assert pub_info["is_published"] is False
    print(" -> Verified initial status: is_published = False")

    # 4. Publish book as VIEWER
    code, pub_data = request("POST", f"/books/{book_id}/publish", {
        "is_published": True,
        "access_mode": "VIEWER"
    }, alice_headers)
    assert code == 200, f"Publish book failed: {pub_data}"
    assert pub_data["is_published"] is True
    assert pub_data["access_mode"] == "VIEWER"
    share_token = pub_data["share_token"]
    assert share_token is not None
    print(f" -> Published as VIEWER. Share token: {share_token}")

    # 5. Test Public Unauthenticated Access
    code, public_book_data = request("GET", f"/public/books/{share_token}")
    assert code == 200, f"Public book fetch failed: {public_book_data}"
    assert public_book_data["title"] == "Data Engineering Published"
    assert public_book_data["access_mode"] == "VIEWER"
    assert len(public_book_data["tree"]) >= 1
    print(f" -> Public book view verified: title='{public_book_data['title']}', tree nodes={len(public_book_data['tree'])}")

    # 6. Test Public Page Render with SQL Execution (No Auth)
    code, public_page_data = request("GET", f"/public/pages/{share_token}/{page_id}")
    assert code == 200, f"Public page render failed: {public_page_data}"
    assert "Welcome to Folio" in public_page_data["html_content"]
    assert "folio-data-table" in public_page_data["html_content"]
    print(" -> Public page rendered HTML verified with sandboxed SQL output included!")

    # 7. Bob tries to edit page while in VIEWER mode (should be 403 Forbidden)
    code, res_bob_fail = request("PUT", f"/pages/{page_id}", {"content": "Hacked content"}, bob_headers)
    assert code == 403
    print(" -> Bob (not collaborator) correctly forbidden from editing.")

    code, res_bob_token_fail = request("PUT", f"/pages/{page_id}", {"content": "Hacked"}, {**bob_headers, "X-Share-Token": share_token})
    assert code == 403, "Viewer share token should not allow editing"
    print(" -> Bob correctly rejected when share_token access_mode is VIEWER.")

    # 8. Alice changes access_mode to EDITOR
    code, res_pub_editor = request("POST", f"/books/{book_id}/publish", {
        "is_published": True,
        "access_mode": "EDITOR"
    }, alice_headers)
    assert code == 200
    assert res_pub_editor["access_mode"] == "EDITOR"
    print(" -> Updated publish access_mode to EDITOR.")

    # 9. Bob edits the page using X-Share-Token
    new_content = "# Welcome to Folio (Edited by Bob)\n\nCollaborative note."
    code, res_bob_edit = request("PUT", f"/pages/{page_id}", {
        "content": new_content
    }, {**bob_headers, "X-Share-Token": share_token})
    assert code == 200, f"Bob edit failed ({code}): {res_bob_edit}"
    print(" -> Bob successfully edited page using X-Share-Token!")

    # 10. Verify EditHistory records Bob's user_id
    with get_db() as cursor:
        cursor.execute("SELECT user_id, action FROM EditHistory WHERE page_id = %s ORDER BY edit_id DESC LIMIT 1;", (page_id,))
        last_edit = cursor.fetchone()
        assert last_edit["user_id"] == bob_id, f"Expected editor to be Bob (ID {bob_id}), got {last_edit['user_id']}"
        assert last_edit["action"] == "EDIT"
        print(f" -> Verified EditHistory correctly recorded editor user_id={bob_id} ({last_edit['action']})")

    # 11. Verify the book does NOT appear in Bob's personal books list
    code, res_bob_books = request("GET", "/books", headers=bob_headers)
    assert code == 200
    bob_book_ids = [b["book_id"] for b in res_bob_books]
    assert book_id not in bob_book_ids, "Shared book must NOT be added to Bob's personal books list!"
    print(f" -> Verified shared book is NOT in Bob's personal books list: {bob_book_ids}")

    # 12. Cleanup test data
    with get_db() as cursor:
        cursor.execute("DELETE FROM Book WHERE book_id = %s;", (book_id,))
        try:
            cursor.execute(f"DROP ROLE IF EXISTS 'role_book_{book_id}';")
        except Exception:
            pass
        from backend.services import storage
        storage.delete_book_dir(book["slug"])
    print(" -> Cleaned up test book.")

    print("\n==================================================")
    print("ALL PUBLISHING & SHARED ACCESS TESTS PASSED!")
    print("==================================================")

if __name__ == "__main__":
    test_publishing_pipeline()
