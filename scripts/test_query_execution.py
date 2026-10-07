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

    print("\n--- 3. Checking Grants for Page 3 (SQL Basics) ---")
    status, grants = api_request("GET", "/pages/3/grants", token=token)
    assert status == 200, f"Failed: {grants}"
    print(f"Page 3 grants: {json.dumps(grants, indent=2)}")
    assert len(grants) > 0
    assert grants[0]["table_name"] == "StudentGrades"
    assert grants[0]["can_read"] is True

    print("\n--- 4. Testing Page 3 Render (/pages/3/render) ---")
    status, render_data = api_request("GET", "/pages/3/render", token=token)
    assert status == 200, f"Failed: {render_data}"
    html_out = render_data["html_content"]
    
    # Verify wikilinks
    assert "class=\"folio-wikilink\"" in html_out, "Wikilink not found in HTML"
    assert "relational-model" in html_out, "Relational Model link not resolved"
    assert "broken-link" in html_out, "Broken wikilink indicator not found"
    print("Wikilink resolution verified!")

    # Verify query table output
    assert "class=\"folio-data-table\"" in html_out, "Data table not rendered"
    assert "Alice Chen" in html_out, "Student data not found in table"
    assert "average_score" in html_out, "Aggregate column average_score not found in table"
    print("Embedded SQL table rendering verified!")

    print("\n--- 5. Testing Security Enforcement: Non-whitelisted Table ---")
    unauth_query = ":::query\nSELECT * FROM User;\n:::"
    status, _ = api_request("PUT", "/pages/3", {"content": unauth_query}, token=token)
    assert status == 200

    _, p3_unauth = api_request("GET", "/pages/3/render", token=token)
    render_unauth = p3_unauth["html_content"]
    assert "Table Access Denied" in render_unauth, "Security failure: ungranted table did not trigger access denied!"
    print("Security Pass: Access denied to ungranted table 'User'!")

    print("\n--- 6. Testing Security Enforcement: Prohibited Function (sleep) ---")
    sleep_query = ":::query\nSELECT student_name FROM StudentGrades WHERE sleep(5) = 0;\n:::"
    api_request("PUT", "/pages/3", {"content": sleep_query}, token=token)
    _, p3_sleep = api_request("GET", "/pages/3/render", token=token)
    render_sleep = p3_sleep["html_content"]
    assert "Query Validation Failed" in render_sleep or "Function 'sleep" in render_sleep
    print("Security Pass: Prohibited function 'sleep()' blocked by AST whitelist!")

    print("\n--- 7. Testing Security Enforcement: Mutation Attack (DROP / INSERT) ---")
    drop_query = ":::query\nDROP TABLE StudentGrades;\n:::"
    api_request("PUT", "/pages/3", {"content": drop_query}, token=token)
    _, p3_drop = api_request("GET", "/pages/3/render", token=token)
    render_drop = p3_drop["html_content"]
    assert "Only SELECT statements are permitted" in render_drop or "Query Validation Failed" in render_drop
    print("Security Pass: DDL/DML mutation blocked!")

    print("\n--- 8. Testing Security Enforcement: Multi-Statement Injection ---")
    multi_query = ":::query\nSELECT * FROM StudentGrades; DROP TABLE StudentGrades;\n:::"
    api_request("PUT", "/pages/3", {"content": multi_query}, token=token)
    _, p3_multi = api_request("GET", "/pages/3/render", token=token)
    render_multi = p3_multi["html_content"]
    assert "single SQL statement" in render_multi or "Query Validation Failed" in render_multi
    print("Security Pass: Multi-statement query injection blocked!")

    print("\n--- 9. Testing Dynamic Grant Management (POST & DELETE /grants) ---")
    # Check page 4 (Normalization) - currently has no grants
    _, p4_grants_before = api_request("GET", "/pages/4/grants", token=token)
    assert len(p4_grants_before) == 0

    # Add grant to page 4
    status, add_grant_res = api_request("POST", "/pages/4/grants", {"table_id": 1, "can_read": True}, token=token)
    assert status == 201
    grant_id = add_grant_res["grant_id"]
    print(f"Granted table 1 to page 4 with grant_id = {grant_id}")

    # Set query on page 4 and render
    api_request("PUT", "/pages/4", {"content": ":::query\nSELECT COUNT(*) AS total FROM StudentGrades;\n:::"}, token=token)
    _, p4_render_res = api_request("GET", "/pages/4/render", token=token)
    p4_render = p4_render_res["html_content"]
    assert "class=\"folio-data-table\"" in p4_render, "Page 4 failed to render table after grant was added"
    assert "total" in p4_render
    print("Page 4 successfully rendered query after grant!")

    # Revoke grant
    status, del_res = api_request("DELETE", f"/pages/4/grants/{grant_id}", token=token)
    assert status == 200
    print(f"Revoked grant_id {grant_id}")

    # Now render again - should be access denied
    _, p4_render_after_res = api_request("GET", "/pages/4/render", token=token)
    p4_render_after = p4_render_after_res["html_content"]
    assert "Table Access Denied" in p4_render_after
    print("Page 4 properly denied access after grant revocation!")

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
    print("\nPage 3 original notes restored!")

    print("\n==============================================")
    print("ALL TESTS PASSED WITH 100% SUCCESS!")
    print("==============================================")

if __name__ == "__main__":
    run_tests()
