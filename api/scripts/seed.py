"""Seed the DEVELOPMENT Supabase project: test accounts A/B + sample wardrobe for A.

    cd api && uv run python scripts/seed.py            # create/refresh
    cd api && uv run python scripts/seed.py --reset    # delete A's closet first

Reads api/.env (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, DEV_TEST_PASSWORD). Refuses to run when
APP_ENV=production. Account B gets an empty closet (used for the cross-account access test).
"""

from __future__ import annotations

import json
import sys
import uuid
from pathlib import Path

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.config import get_settings  # noqa: E402
from app.domain import taxonomy as tx  # noqa: E402
from app.routers.styles import presets  # noqa: E402
from app.routers.system import DEV_ACCOUNTS  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
SEED = ROOT / "supabase" / "seed"


def main() -> None:
    s = get_settings()
    if s.app_env != "development":
        sys.exit("seed.py only runs with APP_ENV=development")
    if not (s.supabase_url and s.supabase_service_role_key and s.dev_test_password):
        sys.exit("Set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and DEV_TEST_PASSWORD in api/.env")
    reset = "--reset" in sys.argv
    base = s.supabase_url.rstrip("/")
    h = {"apikey": s.supabase_service_role_key, "Authorization": f"Bearer {s.supabase_service_role_key}"}
    http = httpx.Client(timeout=30.0, headers=h)

    ids = {k: ensure_user(http, base, email, s.dev_test_password, f"테스트 {k.upper()}")
           for k, email in DEV_ACCOUNTS.items()}
    for k, uid in ids.items():
        rest(http, base, "PATCH", "users", {"id": f"eq.{uid}"}, {
            "nickname": f"테스트 {k.upper()}", "preferred_fit": "semi_over", "style_tags": ["minimal", "casual"],
            "home_region": "서울특별시 마포구", "region_code": "1144000000", "grid_nx": 59, "grid_ny": 127,
            "onboarding_state": {"completed_at": "2026-10-31T00:00:00+00:00", "seeded": True}})

    a = ids["a"]
    existing = rest(http, base, "GET", "clothing_items", {"user_id": f"eq.{a}", "select": "id,image_path"})
    if existing and not reset:
        print(f"account A already has {len(existing)} items (use --reset to reload)")
    else:
        if existing:
            paths = [r["image_path"] for r in existing if r.get("image_path")]
            if paths:
                http.request("DELETE", f"{base}/storage/v1/object/closet", json={"prefixes": paths})
            rest(http, base, "DELETE", "clothing_items", {"user_id": f"eq.{a}"})
        wardrobe = json.loads((SEED / "wardrobe.json").read_text(encoding="utf-8"))
        rows = []
        for w in wardrobe:
            path = f"{a}/{uuid.uuid4()}.webp"
            data = (SEED / "images" / w["file"]).read_bytes()
            r = http.post(f"{base}/storage/v1/object/closet/{path}", content=data,
                          headers={"content-type": "image/webp", "x-upsert": "true"})
            r.raise_for_status()
            clean, invalid = tx.normalize_tags(w)
            if invalid:
                print(f"  ! {w['file']}: fixed invalid {invalid}")
            rows.append({**clean, "user_id": a, "image_path": path, "name": w["name"], "tag_source": "manual",
                         "is_active": True})
        rest(http, base, "POST", "clothing_items", None, rows)
        print(f"account A: uploaded {len(rows)} items")

    styles = rest(http, base, "GET", "style_profiles", {"user_id": f"eq.{a}", "select": "id"})
    if not styles:
        p = next(p for p in presets() if p["key"] == "natural_minimal")
        rest(http, base, "POST", "style_profiles", None, {"user_id": a, "style_name": p["style_name"],
                                                          "preset_key": p["key"], "attributes": p["attributes"],
                                                          "is_default": True})
    print("done. Log in on /welcome with the dev buttons (테스트 계정 A/B).")


def ensure_user(http: httpx.Client, base: str, email: str, password: str, nickname: str) -> str:
    r = http.post(f"{base}/auth/v1/admin/users", json={
        "email": email, "password": password, "email_confirm": True, "user_metadata": {"nickname": nickname}})
    if r.status_code < 300:
        return r.json()["id"]
    # already exists → find it and reset the password to the current DEV_TEST_PASSWORD
    page = http.get(f"{base}/auth/v1/admin/users", params={"per_page": 200}).json()
    user = next(u for u in page.get("users", []) if u.get("email") == email)
    http.put(f"{base}/auth/v1/admin/users/{user['id']}", json={"password": password}).raise_for_status()
    return user["id"]


def rest(http: httpx.Client, base: str, method: str, table: str, params: dict | None, body=None):
    r = http.request(method, f"{base}/rest/v1/{table}", params=params, json=body,
                     headers={"Prefer": "return=representation"})
    if r.status_code >= 400:
        sys.exit(f"{method} {table} failed: HTTP {r.status_code}")
    return r.json() if r.content else None


if __name__ == "__main__":
    main()
