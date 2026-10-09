import os
import sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import urllib.request
import json
from backend.database import get_db
from backend.services.auth import create_access_token, hash_password

def run_test():
    # 1. Get or create test user
    with get_db() as cursor:
        cursor.execute("SELECT user_id, email FROM User WHERE email = %s;", ("image_tester@example.com",))
        user = cursor.fetchone()
        if not user:
            cursor.execute(
                "INSERT INTO User (name, email, password_hash) VALUES (%s, %s, %s);",
                ("Image Tester", "image_tester@example.com", hash_password("password123"))
            )
            user_id = cursor.lastrowid
        else:
            user_id = user["user_id"]

    token = create_access_token(user_id=user_id, email="image_tester@example.com")
    print(f"Generated JWT token for user_id={user_id}")

    # 2. Upload sample PNG image
    boundary = '----WebKitFormBoundaryFolioTestUpload123'
    png_bytes = b'\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15c4\x00\x00\x00\rIDATx\x9cc`\x00\x00\x00\x02\x00\x01H\xaf\xa4q\x00\x00\x00\x00IEND\xaeB`\x82'

    parts = [
        f'--{boundary}\r\n'.encode('utf-8'),
        b'Content-Disposition: form-data; name="file"; filename="test_diagram.png"\r\n',
        b'Content-Type: image/png\r\n\r\n',
        png_bytes,
        f'\r\n--{boundary}--\r\n'.encode('utf-8')
    ]
    body = b''.join(parts)

    upload_req = urllib.request.Request(
        'http://localhost:8000/api/assets/upload',
        data=body,
        headers={
            'Content-Type': f'multipart/form-data; boundary={boundary}',
            'Content-Length': str(len(body)),
            'Authorization': f'Bearer {token}'
        }
    )

    try:
        with urllib.request.urlopen(upload_req, timeout=10) as resp:
            res_data = json.loads(resp.read().decode('utf-8'))
            print('Upload response:', res_data)
            asset_url = res_data['url']
            assert asset_url.startswith('/assets/'), f"Invalid asset URL: {asset_url}"
    except urllib.error.HTTPError as e:
        print('HTTPError code:', e.code)
        print('HTTPError body:', e.read().decode('utf-8'))
        raise

    # 3. Static fetch
    fetch_req = urllib.request.Request(f'http://localhost:8000{asset_url}')
    with urllib.request.urlopen(fetch_req, timeout=10) as resp:
        content = resp.read()
        print(f'Static fetch HTTP {resp.status}, received {len(content)} bytes')
        assert content == png_bytes, "Fetched bytes do not match uploaded bytes!"

    print('ALL ASSET UPLOAD & RETRIEVAL TESTS PASSED SUCCESSFULLY!')

if __name__ == '__main__':
    run_test()
