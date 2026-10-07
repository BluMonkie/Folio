import json
import sys
import urllib.request
import urllib.error

BASE_URL = "http://127.0.0.1:8000"

def api_request(method: str, path: str, data: dict = None, token: str = None):
    url = f"{BASE_URL}{path}"
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    
    body = json.dumps(data).encode("utf-8") if data is not None else None
    req = urllib.request.Request(url, data=body, headers=headers, method=method)
    
    try:
        with urllib.request.urlopen(req) as resp:
            resp_body = resp.read().decode("utf-8")
            return resp.status, json.loads(resp_body) if resp_body else {}
    except urllib.error.HTTPError as e:
        resp_body = e.read().decode("utf-8")
        try:
            return e.code, json.loads(resp_body)
        except Exception:
            return e.code, resp_body

def run_tests():
    print("--- 1. Authenticating as Alice ---")
    status, res = api_request("POST", "/auth/login/json", {"email": "alice@example.com", "password": "password123"})
    if status != 200:
        print(f"FAILED login: {status} {res}")
        sys.exit(1)
    
    token = res["access_token"]
    print("Authenticated successfully!\n")

    print("--- 2. Checking Queryable Tables ---")
    status, tables = api_request("GET", "/queryable-tables", token=token)
    assert status == 200, f"Failed: {tables}"
    print(f"Found {len(tables)} queryable table(s): {[t['table_name'] for t in tables]}")
    assert any(t["table_name"] == "StudentGrades" for t in tables)

    print("\n--- 3. Checking Book-Level Grants for Book 1 ---")
    status, book_grants = api_request("GET", "/books/1/grants", token=token)
    assert status == 200, f"Failed: {book_grants}"
    print(f"Book 1 grants: {json.dumps(book_grants, indent=2)}")
    assert len(book_grants) > 0
    assert any(g["table_name"] == "StudentGrades" and g["can_read"] is True for g in book_grants)

    print("\n--- 4. Checking Two-Tier Resolution for Page 3 (Explicit Override) ---")
    status, p3_grants = api_request("GET", "/pages/3/grants", token=token)
    assert status == 200, f"Failed: {p3_grants}"
    print(f"Page 3 resolved grants: {json.dumps(p3_grants, indent=2)}")
    p3_grant = next(g for g in p3_grants if g["table_name"] == "StudentGrades")
    assert p3_grant["source_tier"] == "PAGE"
    assert p3_grant["is_override"] is True
    assert p3_grant["can_read"] is True

    print("\n--- 5. Checking Two-Tier Resolution for Page 4 (Inherited Default) ---")
    # Page 4 has no explicit page grant, so it inherits from Book 1
    status, p4_grants = api_request("GET", "/pages/4/grants", token=token)
    assert status == 200, f"Failed: {p4_grants}"
    print(f"Page 4 resolved grants: {json.dumps(p4_grants, indent=2)}")
    p4_grant = next(g for g in p4_grants if g["table_name"] == "StudentGrades")
    assert p4_grant["source_tier"] == "BOOK"
    assert p4_grant["is_override"] is False
    assert p4_grant["can_read"] is True

    print("\n--- 6. Testing Inherited Query Execution on Page 4 ---")
    api_request("PUT", "/pages/4", {"content": ":::query\nSELECT COUNT(*) AS total FROM StudentGrades;\n:::"}, token=token)
    _, p4_render_res = api_request("GET", "/pages/4/render", token=token)
    p4_html = p4_render_res["html_content"]
    assert "class=\"folio-data-table\"" in p4_html, "Page 4 failed to render inherited query"
    assert "total" in p4_html
    print("Page 4 successfully executed query inherited from Book 1 default!")

    print("\n--- 7. Testing Explicit Page-Level Override to DENY Access ---")
    # Override Page 4 to can_read = False
    status, deny_grant_res = api_request("POST", "/pages/4/grants", {"table_id": 1, "can_read": False}, token=token)
    assert status == 201
    page_grant_id = deny_grant_res["page_grant_id"]

    _, p4_deny_render = api_request("GET", "/pages/4/render", token=token)
    assert "Table Access Denied" in p4_deny_render["html_content"]
    print("Override verified: Explicit page deny overrides book-level default!")

    print("\n--- 8. Testing Revoking Page Override (Falls Back to Book Default) ---")
    status, del_res = api_request("DELETE", f"/pages/4/grants/{page_grant_id}", token=token)
    assert status == 200

    _, p4_restored_render = api_request("GET", "/pages/4/render", token=token)
    assert "class=\"folio-data-table\"" in p4_restored_render["html_content"]
    print("Fallback verified: Revoking page override restored book default access!")

    print("\n--- 9. Testing Book-Level Grant Lifecycle on Book 2 ---")
    # Book 2 currently has no table grants
    status, b2_grants_before = api_request("GET", "/books/2/grants", token=token)
    assert len(b2_grants_before) == 0

    # Add grant to Book 2
    status, b2_grant = api_request("POST", "/books/2/grants", {"table_id": 1, "can_read": True}, token=token)
    assert status == 201
    b2_grant_id = b2_grant["grant_id"]
    print(f"Granted StudentGrades to Book 2 with grant_id = {b2_grant_id}")

    # Page 6 belongs to Book 2 - test query inheritance
    api_request("PUT", "/pages/6", {"content": ":::query\nSELECT student_name, score FROM StudentGrades LIMIT 2;\n:::"}, token=token)
    _, p6_render = api_request("GET", "/pages/6/render", token=token)
    assert "class=\"folio-data-table\"" in p6_render["html_content"]
    assert "Alice Chen" in p6_render["html_content"]
    print("Page 6 (Book 2) successfully executed query via Book 2 default grant!")

    # Revoke grant from Book 2
    status, b2_del = api_request("DELETE", f"/books/2/grants/{b2_grant_id}", token=token)
    assert status == 200

    # Page 6 should now be denied
    _, p6_deny = api_request("GET", "/pages/6/render", token=token)
    assert "Table Access Denied" in p6_deny["html_content"]
    print("Book grant revocation verified: Page 6 denied access after Book 2 grant removed!")

    print("\n--- 10. Testing Security Enforcement: Prohibited Function & AST Whitelist ---")
    sleep_query = ":::query\nSELECT student_name FROM StudentGrades WHERE sleep(5) = 0;\n:::"
    api_request("PUT", "/pages/3", {"content": sleep_query}, token=token)
    _, p3_sleep = api_request("GET", "/pages/3/render", token=token)
    assert "Query Validation Failed" in p3_sleep["html_content"] or "Function 'sleep" in p3_sleep["html_content"]
    print("Security Pass: Prohibited function 'sleep()' blocked by AST whitelist!")

    # Restore page 3 original content
    orig_content = """# SQL Basics

Welcome to SQL Basics. Make sure you have read [[Relational Model]] first.
Also check our [[NonExistentPage|Missing Guide]].

## Current Student Performance

:::query
SELECT student_name, assignment, score 
FROM StudentGrades 
ORDER BY score DESC;
:::

## Average Grade by Assignment

:::query
SELECT assignment, ROUND(AVG(score), 2) AS average_score, COUNT(*) AS submissions
FROM StudentGrades
GROUP BY assignment;
:::
"""
    api_request("PUT", "/pages/3", {"content": orig_content}, token=token)
    print("Page 3 original content restored.")

    print("\n==============================================")
    print("ALL TWO-TIER GRANT & SECURITY TESTS PASSED (100%)!")
    print("==============================================")

if __name__ == "__main__":
    run_tests()
