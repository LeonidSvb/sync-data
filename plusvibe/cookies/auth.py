import json
from pathlib import Path
from curl_cffi import requests as cf

BASE = "https://api.pipl.ai/v1"
COOKIES_FILE = Path(__file__).parent.parent / "plusvibe_cookies.json"


def get_headers(cookies_file=None):
    path = cookies_file or COOKIES_FILE
    with open(path, encoding="utf-8") as f:
        cookies = json.load(f)
    token_map = {c["name"]: c["value"] for c in cookies}
    workspace_id = token_map["workspaceSelected"]
    refresh_token = token_map["refreshToken"]

    resp = cf.post(
        f"{BASE}/auth/refresh-token",
        json={"refresh_token": refresh_token},
        impersonate="chrome124",
    )
    resp.raise_for_status()
    data = resp.json()
    if data.get("code") != 1:
        raise RuntimeError(f"Token refresh failed: {data.get('message')}")

    access_token = data["data"]["access_token"]
    headers = {
        "Authorization": f"Bearer {access_token}",
        "workspace-id": workspace_id,
    }
    return headers, workspace_id
