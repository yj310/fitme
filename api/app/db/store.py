"""Data access for one signed-in user.

SupabaseStore talks to PostgREST with the user's JWT (RLS enforced) for everything
except the few operations that need the service role (AI key secrets, account deletion).
MemoryStore (app/db/memory.py) implements the same methods for tests and the eval script.
"""

from __future__ import annotations

from datetime import datetime

from app.db.postgrest import PostgREST, eq, in_

OUTFIT_SELECT = "*,outfit_items(role,clothing_item_id,clothing_items(*))"


def _hex(b: bytes) -> str:
    return "\\x" + b.hex()


def _unhex(s: str) -> bytes:
    return bytes.fromhex(s.removeprefix("\\x"))


class SupabaseStore:
    def __init__(self, user_id: str, db: PostgREST, admin: PostgREST):
        self.user_id = user_id
        self.db = db          # user JWT → RLS
        self.admin = admin    # service role; always filter by user_id explicitly

    # ── users ──
    async def get_user(self) -> dict | None:
        return await self.db.select_one("users", {"id": eq(self.user_id)})

    async def ensure_user(self, nickname: str | None, avatar_url: str | None) -> dict:
        row = await self.get_user()
        if row:
            return row
        rows = await self.db.insert("users", {"id": self.user_id, "nickname": nickname or "사용자",
                                              "avatar_url": avatar_url, "login_provider": "kakao"})
        return rows[0]

    async def update_user(self, values: dict) -> dict:
        rows = await self.db.update("users", {"id": eq(self.user_id)}, values)
        return rows[0] if rows else {}

    # ── clothing items ──
    async def list_items(self, active: bool | None = True) -> list[dict]:
        params = {"user_id": eq(self.user_id), "order": "created_at.desc"}
        if active is not None:
            params["is_active"] = eq(str(active).lower())
        return await self.db.select("clothing_items", params)

    async def get_items(self, ids: list[str]) -> list[dict]:
        if not ids:
            return []
        return await self.db.select("clothing_items", {"user_id": eq(self.user_id), "id": in_(ids)})

    async def get_item(self, item_id: str) -> dict | None:
        return await self.db.select_one("clothing_items", {"user_id": eq(self.user_id), "id": eq(item_id)})

    async def insert_item(self, row: dict) -> dict:
        return (await self.db.insert("clothing_items", {**row, "user_id": self.user_id}))[0]

    async def update_item(self, item_id: str, values: dict) -> dict | None:
        rows = await self.db.update("clothing_items", {"user_id": eq(self.user_id), "id": eq(item_id)}, values)
        return rows[0] if rows else None

    async def delete_item(self, item_id: str) -> None:
        await self.db.delete("clothing_items", {"user_id": eq(self.user_id), "id": eq(item_id)})

    # ── style profiles ──
    async def list_styles(self) -> list[dict]:
        return await self.db.select("style_profiles", {"user_id": eq(self.user_id), "order": "created_at.asc"})

    async def get_style(self, sid: str) -> dict | None:
        return await self.db.select_one("style_profiles", {"user_id": eq(self.user_id), "id": eq(sid)})

    async def insert_style(self, row: dict) -> dict:
        return (await self.db.insert("style_profiles", {**row, "user_id": self.user_id}))[0]

    async def update_style(self, sid: str, values: dict) -> dict | None:
        rows = await self.db.update("style_profiles", {"user_id": eq(self.user_id), "id": eq(sid)}, values)
        return rows[0] if rows else None

    async def clear_default_style(self) -> None:
        await self.db.update("style_profiles", {"user_id": eq(self.user_id), "is_default": "eq.true"},
                             {"is_default": False})

    async def delete_style(self, sid: str) -> None:
        await self.db.delete("style_profiles", {"user_id": eq(self.user_id), "id": eq(sid)})

    # ── conversations / messages ──
    async def create_conversation(self, title: str | None, kind: str = "chat") -> dict:
        return (await self.db.insert("conversations", {"user_id": self.user_id, "title": title,
                                                       "state": {"kind": kind}}))[0]

    async def get_conversation(self, cid: str) -> dict | None:
        return await self.db.select_one("conversations", {"user_id": eq(self.user_id), "id": eq(cid)})

    async def latest_conversation(self, kind: str = "chat") -> dict | None:
        return await self.db.select_one("conversations", {"user_id": eq(self.user_id), "state->>kind": eq(kind),
                                                          "order": "updated_at.desc"})

    async def update_conversation(self, cid: str, values: dict) -> None:
        await self.db.update("conversations", {"user_id": eq(self.user_id), "id": eq(cid)}, values)

    async def add_message(self, cid: str, role: str, content: str, payload: dict | None) -> dict:
        return (await self.db.insert("chat_messages", {"user_id": self.user_id, "conversation_id": cid,
                                                       "role": role, "content": content,
                                                       "payload": payload}))[0]

    async def update_message(self, mid: str, values: dict) -> None:
        await self.db.update("chat_messages", {"user_id": eq(self.user_id), "id": eq(mid)}, values)

    async def list_messages(self, cid: str, limit: int = 100) -> list[dict]:
        return await self.db.select("chat_messages", {"user_id": eq(self.user_id), "conversation_id": eq(cid),
                                                      "order": "created_at.asc", "limit": str(limit)})

    # ── agent runs ──
    async def insert_run(self, row: dict) -> dict:
        return (await self.db.insert("agent_runs", {**row, "user_id": self.user_id}))[0]

    async def update_run(self, rid: str, values: dict) -> None:
        await self.db.update("agent_runs", {"user_id": eq(self.user_id), "id": eq(rid)}, values)

    async def count_runs_since(self, since: datetime, free_only: bool = True) -> int:
        f = {"user_id": eq(self.user_id), "created_at": f"gte.{since.isoformat()}"}
        if free_only:
            f["is_free_tier"] = "eq.true"
        return await self.db.count("agent_runs", f)

    # ── outfits ──
    async def insert_outfit(self, row: dict, items: list[tuple[str, str]]) -> dict:
        outfit = (await self.db.insert("outfits", {**row, "user_id": self.user_id}))[0]
        await self.db.insert("outfit_items", [
            {"outfit_id": outfit["id"], "clothing_item_id": iid, "role": role, "user_id": self.user_id}
            for iid, role in items
        ])
        return outfit

    async def get_outfit(self, oid: str) -> dict | None:
        return await self.db.select_one("outfits", {"user_id": eq(self.user_id), "id": eq(oid),
                                                    "select": OUTFIT_SELECT})

    async def list_outfits(self, *, favorite: bool | None = None, occasion: str | None = None,
                           conversation_id: str | None = None, limit: int = 60,
                           since: datetime | None = None) -> list[dict]:
        p = {"user_id": eq(self.user_id), "select": OUTFIT_SELECT, "order": "created_at.desc",
             "limit": str(limit)}
        if favorite is not None:
            p["is_favorite"] = eq(str(favorite).lower())
            if favorite:
                p["order"] = "favorited_at.desc.nullslast,created_at.desc"
        if occasion:
            p["occasion"] = eq(occasion)
        if conversation_id:
            p["conversation_id"] = eq(conversation_id)
        if since:
            p["created_at"] = f"gte.{since.isoformat()}"
        return await self.db.select("outfits", p)

    async def favorite_occasions(self) -> list[str]:
        rows = await self.db.select("outfits", {"user_id": eq(self.user_id), "is_favorite": "eq.true",
                                                "select": "occasion"})
        return sorted({r["occasion"] for r in rows if r.get("occasion")})

    async def set_favorite(self, oid: str, fav: bool, at: str | None) -> dict | None:
        rows = await self.db.update("outfits", {"user_id": eq(self.user_id), "id": eq(oid)},
                                    {"is_favorite": fav, "favorited_at": at})
        return rows[0] if rows else None

    # ── feedback ──
    async def insert_feedback(self, row: dict) -> dict:
        return (await self.db.insert("feedback", {**row, "user_id": self.user_id}))[0]

    async def update_feedback(self, fid: str, values: dict) -> dict | None:
        rows = await self.db.update("feedback", {"user_id": eq(self.user_id), "id": eq(fid)}, values)
        return rows[0] if rows else None

    async def get_feedback(self, fid: str) -> dict | None:
        return await self.db.select_one("feedback", {"user_id": eq(self.user_id), "id": eq(fid)})

    async def list_feedback(self, *, persistent: bool | None = None, types: list[str] | None = None,
                            since: datetime | None = None, limit: int = 200) -> list[dict]:
        p = {"user_id": eq(self.user_id), "order": "created_at.desc", "limit": str(limit)}
        if persistent is not None:
            p["is_persistent"] = eq(str(persistent).lower())
        if types:
            p["feedback_type"] = in_(types)
        if since:
            p["created_at"] = f"gte.{since.isoformat()}"
        return await self.db.select("feedback", p)

    async def delete_feedback(self, fid: str) -> None:
        await self.db.delete("feedback", {"user_id": eq(self.user_id), "id": eq(fid)})

    # ── AI connections / settings / usage ──
    async def list_connections(self) -> list[dict]:
        return await self.db.select("ai_connections", {
            "user_id": eq(self.user_id),
            "select": "id,provider,key_last4,status,monthly_limit_usd,verified_at,created_at"})

    async def get_connection_secret(self, provider: str) -> tuple[dict, bytes] | None:
        row = await self.admin.select_one("ai_connections", {"user_id": eq(self.user_id),
                                                             "provider": eq(provider)})
        if not row:
            return None
        return row, _unhex(row["encrypted_key"])

    async def upsert_connection(self, provider: str, encrypted: bytes, last4: str,
                                monthly_limit: float | None, verified_at: str) -> dict:
        rows = await self.admin.upsert("ai_connections", {
            "user_id": self.user_id, "provider": provider, "encrypted_key": _hex(encrypted),
            "key_last4": last4, "status": "active", "monthly_limit_usd": monthly_limit,
            "verified_at": verified_at}, on_conflict="user_id,provider")
        row = rows[0]
        row.pop("encrypted_key", None)
        return row

    async def update_connection(self, provider: str, values: dict) -> dict | None:
        rows = await self.admin.update("ai_connections", {"user_id": eq(self.user_id),
                                                          "provider": eq(provider)}, values)
        if not rows:
            return None
        rows[0].pop("encrypted_key", None)
        return rows[0]

    async def delete_connection(self, provider: str) -> None:
        await self.admin.delete("ai_connections", {"user_id": eq(self.user_id), "provider": eq(provider)})

    async def get_task_settings(self) -> list[dict]:
        return await self.db.select("ai_task_settings", {"user_id": eq(self.user_id)})

    async def put_task_setting(self, task: str, provider: str, model: str) -> None:
        await self.db.upsert("ai_task_settings", {"user_id": self.user_id, "task": task,
                                                  "provider": provider, "model": model},
                             on_conflict="user_id,task")

    async def delete_task_setting(self, task: str) -> None:
        await self.db.delete("ai_task_settings", {"user_id": eq(self.user_id), "task": eq(task)})

    async def insert_usage(self, row: dict) -> None:
        await self.db.insert("ai_usage", {**row, "user_id": self.user_id})

    async def usage_since(self, since: datetime, until: datetime | None = None) -> list[dict]:
        p = {"user_id": eq(self.user_id), "created_at": f"gte.{since.isoformat()}"}
        rows = await self.db.select("ai_usage", p)
        if until:
            rows = [r for r in rows if r["created_at"] < until.isoformat()]
        return rows

    async def count_tagging_since(self, since: datetime) -> int:
        return await self.db.count("ai_usage", {"user_id": eq(self.user_id), "task": "eq.tagging",
                                                "is_free_tier": "eq.true",
                                                "created_at": f"gte.{since.isoformat()}"})

    # ── account deletion (service role) ──
    async def all_image_paths(self) -> list[str]:
        rows = await self.admin.select("clothing_items", {"user_id": eq(self.user_id), "select": "image_path"})
        return [r["image_path"] for r in rows if r.get("image_path")]

    async def delete_user_rows(self) -> None:
        # users → everything else cascades (ON DELETE CASCADE).
        await self.admin.delete("users", {"id": eq(self.user_id)})


def outfit_item_rows(outfit: dict) -> list[tuple[str, dict]]:
    """[(role, clothing_item_row)] from an outfit selected with OUTFIT_SELECT."""
    out = []
    for oi in outfit.get("outfit_items") or []:
        if oi.get("clothing_items"):
            out.append((oi["role"], oi["clothing_items"]))
    return out

