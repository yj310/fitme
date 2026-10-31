"""In-memory store with the same interface as SupabaseStore (tests, eval/run.py)."""

from __future__ import annotations

import copy
import uuid
from datetime import UTC, datetime


def _now() -> str:
    return datetime.now(UTC).isoformat()


def _id() -> str:
    return str(uuid.uuid4())


class MemoryDB:
    """Shared tables for several MemoryStores (one per user), so cross-user tests are possible."""

    def __init__(self):
        self.t: dict[str, list[dict]] = {k: [] for k in (
            "users", "clothing_items", "style_profiles", "conversations", "chat_messages", "agent_runs",
            "outfits", "outfit_items", "feedback", "ai_connections", "ai_task_settings", "ai_usage")}
        self.secrets: dict[tuple[str, str], bytes] = {}


class MemoryStore:
    def __init__(self, user_id: str, mdb: MemoryDB | None = None):
        self.user_id = user_id
        self.m = mdb or MemoryDB()

    def _mine(self, table: str) -> list[dict]:
        key = "id" if table == "users" else "user_id"
        return [r for r in self.m.t[table] if r.get(key) == self.user_id]

    def _find(self, table: str, rid: str) -> dict | None:
        return next((r for r in self._mine(table) if r["id"] == rid), None)

    def _ins(self, table: str, row: dict) -> dict:
        r = {"id": _id(), "created_at": _now(), **row}
        if table != "users":
            r["user_id"] = self.user_id
        self.m.t[table].append(r)
        return copy.deepcopy(r)

    # users
    async def get_user(self):
        r = self._find("users", self.user_id)
        return copy.deepcopy(r) if r else None

    async def ensure_user(self, nickname, avatar_url):
        r = await self.get_user()
        if r:
            return r
        row = {"id": self.user_id, "nickname": nickname or "사용자", "avatar_url": avatar_url,
               "login_provider": "kakao", "preferred_fit": None, "style_tags": [], "avoid_colors": [],
               "avoid_subcategories": [], "personal_color": None, "home_region": None, "region_code": None,
               "grid_nx": None, "grid_ny": None, "height_cm": None, "usual_sizes": {}, "body_traits": [],
               "body_measurements": None, "onboarding_state": {}, "created_at": _now()}
        self.m.t["users"].append(row)
        return copy.deepcopy(row)

    async def update_user(self, values):
        r = self._find("users", self.user_id)
        r.update(copy.deepcopy(values))
        return copy.deepcopy(r)

    # items
    async def list_items(self, active=True):
        rows = [r for r in self._mine("clothing_items") if active is None or r["is_active"] == active]
        return copy.deepcopy(sorted(rows, key=lambda r: r["created_at"], reverse=True))

    async def get_items(self, ids):
        return copy.deepcopy([r for r in self._mine("clothing_items") if r["id"] in ids])

    async def get_item(self, item_id):
        r = self._find("clothing_items", item_id)
        return copy.deepcopy(r) if r else None

    async def insert_item(self, row):
        base = {"pattern": "solid", "fit": "none", "material": None, "seasons": [], "style_tags": [],
                "formality": 2, "warmth": 2, "brand": None, "size_label": None, "memo": None,
                "tag_confidence": {}, "tag_source": "manual", "is_active": True, "image_path": None}
        return self._ins("clothing_items", {**base, **row, "updated_at": _now()})

    async def update_item(self, item_id, values):
        r = self._find("clothing_items", item_id)
        if not r:
            return None
        r.update(copy.deepcopy(values))
        return copy.deepcopy(r)

    async def delete_item(self, item_id):
        self.m.t["clothing_items"] = [r for r in self.m.t["clothing_items"]
                                      if not (r["id"] == item_id and r["user_id"] == self.user_id)]

    # styles
    async def list_styles(self):
        return copy.deepcopy(self._mine("style_profiles"))

    async def get_style(self, sid):
        r = self._find("style_profiles", sid)
        return copy.deepcopy(r) if r else None

    async def insert_style(self, row):
        return self._ins("style_profiles", row)

    async def update_style(self, sid, values):
        r = self._find("style_profiles", sid)
        if not r:
            return None
        r.update(copy.deepcopy(values))
        return copy.deepcopy(r)

    async def clear_default_style(self):
        for r in self._mine("style_profiles"):
            r["is_default"] = False

    async def delete_style(self, sid):
        self.m.t["style_profiles"] = [r for r in self.m.t["style_profiles"]
                                      if not (r["id"] == sid and r["user_id"] == self.user_id)]

    # conversations
    async def create_conversation(self, title, kind="chat"):
        return self._ins("conversations", {"title": title, "state": {"kind": kind}, "updated_at": _now()})

    async def get_conversation(self, cid):
        r = self._find("conversations", cid)
        return copy.deepcopy(r) if r else None

    async def latest_conversation(self, kind="chat"):
        rows = sorted((r for r in self._mine("conversations") if (r.get("state") or {}).get("kind") == kind),
                      key=lambda r: r["updated_at"], reverse=True)
        return copy.deepcopy(rows[0]) if rows else None

    async def update_conversation(self, cid, values):
        r = self._find("conversations", cid)
        if r:
            r.update(copy.deepcopy(values))
            r["updated_at"] = _now()

    async def add_message(self, cid, role, content, payload):
        return self._ins("chat_messages", {"conversation_id": cid, "role": role, "content": content,
                                           "payload": copy.deepcopy(payload)})

    async def update_message(self, mid, values):
        r = self._find("chat_messages", mid)
        if r:
            r.update(copy.deepcopy(values))

    async def list_messages(self, cid, limit=100):
        return copy.deepcopy([r for r in self._mine("chat_messages") if r["conversation_id"] == cid][:limit])

    # runs
    async def insert_run(self, row):
        return self._ins("agent_runs", row)

    async def update_run(self, rid, values):
        r = self._find("agent_runs", rid)
        if r:
            r.update(copy.deepcopy(values))

    async def count_runs_since(self, since, free_only=True):
        return sum(1 for r in self._mine("agent_runs") if r["created_at"] >= since.isoformat()
                   and (not free_only or r.get("is_free_tier", True)))

    # outfits
    def _hydrate(self, o: dict) -> dict:
        o = copy.deepcopy(o)
        items = [oi for oi in self.m.t["outfit_items"] if oi["outfit_id"] == o["id"]]
        o["outfit_items"] = [{"role": oi["role"], "clothing_item_id": oi["clothing_item_id"],
                              "clothing_items": copy.deepcopy(self._find("clothing_items", oi["clothing_item_id"]))}
                             for oi in items]
        return o

    async def insert_outfit(self, row, items):
        base = {"is_favorite": False, "favorited_at": None, "version": 1, "rank": 1, "label": None,
                "score_detail": {}, "reasons": [], "weather_snapshot": None}
        o = self._ins("outfits", {**base, **row})
        for iid, role in items:
            if not self._find("clothing_items", iid):
                raise PermissionError("outfit item not owned")  # mirrors the RLS insert policy
            self.m.t["outfit_items"].append({"outfit_id": o["id"], "clothing_item_id": iid, "role": role,
                                             "user_id": self.user_id})
        return o

    async def get_outfit(self, oid):
        r = self._find("outfits", oid)
        return self._hydrate(r) if r else None

    async def list_outfits(self, *, favorite=None, occasion=None, conversation_id=None, limit=60, since=None):
        rows = self._mine("outfits")
        if favorite is not None:
            rows = [r for r in rows if r["is_favorite"] == favorite]
        if occasion:
            rows = [r for r in rows if r.get("occasion") == occasion]
        if conversation_id:
            rows = [r for r in rows if r.get("conversation_id") == conversation_id]
        if since:
            rows = [r for r in rows if r["created_at"] >= since.isoformat()]
        rows = sorted(rows, key=lambda r: r["created_at"], reverse=True)[:limit]
        return [self._hydrate(r) for r in rows]

    async def favorite_occasions(self):
        return sorted({r["occasion"] for r in self._mine("outfits") if r["is_favorite"] and r.get("occasion")})

    async def set_favorite(self, oid, fav, at):
        r = self._find("outfits", oid)
        if not r:
            return None
        r["is_favorite"], r["favorited_at"] = fav, at
        return copy.deepcopy(r)

    # feedback
    async def insert_feedback(self, row):
        return self._ins("feedback", row)

    async def update_feedback(self, fid, values):
        r = self._find("feedback", fid)
        if not r:
            return None
        r.update(copy.deepcopy(values))
        return copy.deepcopy(r)

    async def get_feedback(self, fid):
        r = self._find("feedback", fid)
        return copy.deepcopy(r) if r else None

    async def list_feedback(self, *, persistent=None, types=None, since=None, limit=200):
        rows = self._mine("feedback")
        if persistent is not None:
            rows = [r for r in rows if r.get("is_persistent") == persistent]
        if types:
            rows = [r for r in rows if r["feedback_type"] in types]
        if since:
            rows = [r for r in rows if r["created_at"] >= since.isoformat()]
        return copy.deepcopy(sorted(rows, key=lambda r: r["created_at"], reverse=True)[:limit])

    async def delete_feedback(self, fid):
        self.m.t["feedback"] = [r for r in self.m.t["feedback"]
                                if not (r["id"] == fid and r["user_id"] == self.user_id)]

    # AI
    async def list_connections(self):
        return copy.deepcopy(self._mine("ai_connections"))

    async def get_connection_secret(self, provider):
        row = next((r for r in self._mine("ai_connections") if r["provider"] == provider), None)
        if not row:
            return None
        return copy.deepcopy(row), self.m.secrets[(self.user_id, provider)]

    async def upsert_connection(self, provider, encrypted, last4, monthly_limit, verified_at):
        self.m.t["ai_connections"] = [r for r in self.m.t["ai_connections"]
                                      if not (r["user_id"] == self.user_id and r["provider"] == provider)]
        self.m.secrets[(self.user_id, provider)] = encrypted
        return self._ins("ai_connections", {"provider": provider, "key_last4": last4, "status": "active",
                                            "monthly_limit_usd": monthly_limit, "verified_at": verified_at})

    async def update_connection(self, provider, values):
        row = next((r for r in self._mine("ai_connections") if r["provider"] == provider), None)
        if not row:
            return None
        row.update(values)
        return copy.deepcopy(row)

    async def delete_connection(self, provider):
        self.m.t["ai_connections"] = [r for r in self.m.t["ai_connections"]
                                      if not (r["user_id"] == self.user_id and r["provider"] == provider)]
        self.m.secrets.pop((self.user_id, provider), None)

    async def get_task_settings(self):
        return copy.deepcopy(self._mine("ai_task_settings"))

    async def put_task_setting(self, task, provider, model):
        await self.delete_task_setting(task)
        self.m.t["ai_task_settings"].append({"user_id": self.user_id, "task": task, "provider": provider,
                                             "model": model})

    async def delete_task_setting(self, task):
        self.m.t["ai_task_settings"] = [r for r in self.m.t["ai_task_settings"]
                                        if not (r["user_id"] == self.user_id and r["task"] == task)]

    async def insert_usage(self, row):
        self._ins("ai_usage", row)

    async def usage_since(self, since, until=None):
        return copy.deepcopy([r for r in self._mine("ai_usage") if r["created_at"] >= since.isoformat()
                              and (until is None or r["created_at"] < until.isoformat())])

    async def count_tagging_since(self, since):
        return sum(1 for r in self._mine("ai_usage") if r["task"] == "tagging" and r.get("is_free_tier")
                   and r["created_at"] >= since.isoformat())

    async def all_image_paths(self):
        return [r["image_path"] for r in self._mine("clothing_items") if r.get("image_path")]

    async def delete_user_rows(self):
        for table in self.m.t:
            key = "id" if table == "users" else "user_id"
            self.m.t[table] = [r for r in self.m.t[table] if r.get(key) != self.user_id]
        self.m.secrets = {k: v for k, v in self.m.secrets.items() if k[0] != self.user_id}
