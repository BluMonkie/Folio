import json
import urllib.request
import sys

BASE_URL = "http://127.0.0.1:8000"

def run_tests():
    # 1. Login as Alice
    data = json.dumps({"email": "alice@example.com", "password": "password123"}).encode()
    req = urllib.request.Request(f"{BASE_URL}/auth/login/json", data=data, headers={"Content-Type": "application/json"})
    alice_token = json.loads(urllib.request.urlopen(req).read().decode())["access_token"]
    headers = {"Authorization": f"Bearer {alice_token}"}

    print("--- 1. Testing Global Search (/search?q=sql) ---")
    req = urllib.request.Request(f"{BASE_URL}/search?q=sql", headers=headers)
    res = json.loads(urllib.request.urlopen(req).read().decode())
    print(f"Total results: {res['total_results']}")
    for item in res["results"]:
        print(f"  • [{item['primary_match']} | score {item['relevance_score']}] {item['page_title']} ({item['book_title']})")
        print(f"    Tags: {item['tags']} | Snippet: {item['snippet']}")
    assert res["total_results"] >= 2
    # Verify ranking: Title match (SQL Basics) should come first
    assert res["results"][0]["page_title"] == "SQL Basics"

    print("\n--- 2. Testing Content Search (/search?q=BCNF) ---")
    req = urllib.request.Request(f"{BASE_URL}/search?q=BCNF", headers=headers)
    res = json.loads(urllib.request.urlopen(req).read().decode())
    print(f"Total results: {res['total_results']}")
    for item in res["results"]:
        print(f"  • [{item['primary_match']} | score {item['relevance_score']}] {item['page_title']} - Snippet: {item['snippet']}")
    assert res["total_results"] >= 1
    assert any(item["page_title"] == "Normalization" for item in res["results"])

    print("\n--- 3. Testing Tag Search (/search?q=theory) ---")
    req = urllib.request.Request(f"{BASE_URL}/search?q=theory", headers=headers)
    res = json.loads(urllib.request.urlopen(req).read().decode())
    print(f"Total results: {res['total_results']}")
    for item in res["results"]:
        print(f"  • [{item['primary_match']}] {item['page_title']} - Tags: {item['tags']}")
    assert res["total_results"] >= 2

    print("\n--- 4. Testing Book-Scoped Search (/books/1/search?q=sql) ---")
    req = urllib.request.Request(f"{BASE_URL}/books/1/search?q=sql", headers=headers)
    res = json.loads(urllib.request.urlopen(req).read().decode())
    assert all(item["book_id"] == 1 for item in res["results"])
    print(f"Book 1 scoped search verified ({res['total_results']} results found)")

    print("\n==============================================")
    print("ALL SEARCH TESTS PASSED (100%)!")
    print("==============================================")

if __name__ == "__main__":
    run_tests()
