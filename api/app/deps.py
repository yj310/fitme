"""Per-request context: verified user + user-scoped data access + services."""

from __future__ import annotations

import time
from collections import defaultdict, deque
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

import httpx
from fastapi import Depends, Request

from app.auth import AuthUser, current_user
from app.config import ModelConfig, Pricing, Settings
from app.db.postgrest import PostgREST
from app.db.store import SupabaseStore
from app.errors import ApiError, quota_exceeded
from app.llm.router import LLMService
from app.services.storage import Storage
from app.services.weather import KST, WeatherService


class RateLimiter:
    """Per-user sliding window (spec 14.2: 30 requests / minute)."""

    def __init__(self, per_minute: int):
        self.per_minute = per_minute
        self.hits: dict[str, deque] = defaultdict(deque)

    def check(self, key: str) -> None:
        now = time.monotonic()
        q = self.hits[key]
        while q and now - q[0] > 60:
            q.popleft()
        if len(q) >= self.per_minute:
            raise ApiError("RATE_LIMITED", "요청이 너무 잦아요. 잠시 후 다시 시도해 주세요.", 429)
        q.append(now)


@dataclass
class AppServices:
    settings: Settings
    cfg: ModelConfig
    pricing: Pricing
    http: httpx.AsyncClient
    weather: WeatherService
    limiter: RateLimiter
    admin: PostgREST


@dataclass
class Ctx:
    user: AuthUser
    store: Any            # SupabaseStore or MemoryStore
    storage: Any          # Storage or a fake
    llm: LLMService
    app: AppServices

    @property
    def settings(self) -> Settings:
        return self.app.settings


def services(request: Request) -> AppServices:
    return request.app.state.services


async def get_ctx(request: Request, user: AuthUser = Depends(current_user)) -> Ctx:
    app: AppServices = services(request)
    app.limiter.check(user.id)
    override = getattr(request.app.state, "ctx_factory", None)
    if override:  # tests
        return override(user, app)
    s = app.settings
    db = PostgREST(app.http, s.supabase_url, s.supabase_anon_key, user.token)
    store = SupabaseStore(user.id, db, app.admin)
    storage = Storage(app.http, s.supabase_url, s.supabase_anon_key, user.token, user.id)
    llm = LLMService(s, app.cfg, app.pricing, app.http, store)
    return Ctx(user, store, storage, llm, app)


def kst_day_start(now: datetime | None = None) -> datetime:
    now = (now or datetime.now(UTC)).astimezone(KST)
    return now.replace(hour=0, minute=0, second=0, microsecond=0)


async def check_agent_quota(ctx: Ctx, is_free: bool) -> None:
    if not is_free:
        return
    used = await ctx.store.count_runs_since(kst_day_start().astimezone(UTC), free_only=True)
    if used >= ctx.settings.free_daily_agent_runs:
        raise quota_exceeded()


async def check_tagging_quota(ctx: Ctx, is_free: bool) -> None:
    if not is_free:
        return
    used = await ctx.store.count_tagging_since(kst_day_start().astimezone(UTC))
    if used >= ctx.settings.free_daily_tagging:
        raise quota_exceeded()

