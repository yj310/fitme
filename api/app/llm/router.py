"""model_router + LLM call policy (spec 7.4, 10.2–10.5).

Every LLM call in the app goes through LLMService.call_json:
- picks provider/model/key: user's BYOK task setting if usable, else the free default
- JSON parse failure → retry once on the same model
- free tier 429 → exponential backoff, 2 retries, then "잠시 후 다시 시도"
- BYOK auth failure / monthly limit / provider quota → switch to the free default + notice
- development: a failing NVIDIA task falls back to Gemini (config `fallback`)
- logs usage (tokens, estimated cost) to ai_usage. Keys never leave memory or hit logs.
"""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

import httpx

from app.config import ModelConfig, Pricing, Settings
from app.errors import ApiError
from app.llm.base import Adapter, Image, LLMError, LLMResult
from app.services import crypto

log = logging.getLogger("fitme.llm")

TASK_LABEL = {"chat": "대화 · 코디 생성", "tagging": "옷 사진 태깅", "style": "추구미 분석"}
PROVIDER_LABEL = {"gemini": "Gemini", "anthropic": "Claude", "openai": "OpenAI", "nvidia": "NVIDIA"}
BYOK_PROVIDERS = ("gemini", "anthropic", "openai")


@dataclass
class Route:
    provider: str
    model: str
    key: str
    source: str  # free | byok

    @property
    def is_free(self) -> bool:
        return self.source == "free"

    def __repr__(self) -> str:  # never print the key
        return f"Route({self.provider}/{self.model}, {self.source})"


def make_adapter(route: Route, http: httpx.AsyncClient, timeout: float) -> Adapter:
    if route.provider == "gemini":
        from app.llm.gemini import GeminiAdapter
        return GeminiAdapter(http, route.key, timeout)
    if route.provider == "anthropic":
        from app.llm.anthropic_adapter import AnthropicAdapter
        return AnthropicAdapter(route.key, timeout)
    if route.provider == "openai":
        from app.llm.openai_compat import OpenAICompatAdapter
        return OpenAICompatAdapter("openai", http, route.key, timeout)
    if route.provider == "nvidia":
        from app.llm.openai_compat import OpenAICompatAdapter
        return OpenAICompatAdapter("nvidia", http, route.key, timeout)
    raise ValueError(route.provider)


def month_start(now: datetime | None = None) -> datetime:
    now = now or datetime.now(UTC)
    return now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)


class LLMService:
    def __init__(self, settings: Settings, cfg: ModelConfig, pricing: Pricing, http: httpx.AsyncClient,
                 store: Any, adapter_factory: Callable[[Route], Adapter] | None = None,
                 sleep: Callable[[float], Any] = asyncio.sleep):
        self.s = settings
        self.cfg = cfg
        self.pricing = pricing
        self.http = http
        self.store = store
        self.factory = adapter_factory or (lambda r: make_adapter(r, http, settings.llm_timeout_s))
        self.sleep = sleep
        self.notices: list[dict] = []

    # ── routing ──
    def _env_key(self, provider: str) -> str:
        if provider == "nvidia":
            if not self.s.is_dev:
                raise ApiError("SERVER_MISCONFIGURED", "운영 모드에서는 NVIDIA를 쓸 수 없어요.", 500)
            return self.s.nvidia_api_key
        if provider == "gemini":
            return self.s.gemini_api_key
        return ""

    def free_route(self, task: str) -> Route:
        provider, model = self.cfg.default_for(task)
        key = self._env_key(provider)
        if not key and self.cfg.fallback_for(task):
            provider, model = self.cfg.fallback_for(task)
            key = self._env_key(provider)
        if not key:
            raise ApiError("AI_NOT_CONFIGURED", "기본 AI가 아직 설정되지 않았어요. 관리자에게 알려주세요.", 503)
        return Route(provider, model, key, "free")

    async def route(self, task: str) -> Route:
        """model_router: execution mode, key status, per-task setting, monthly limit."""
        settings = {r["task"]: r for r in await self.store.get_task_settings()}
        chosen = settings.get(task)
        if chosen and chosen["provider"] in BYOK_PROVIDERS and chosen["provider"] in self.cfg.allowed_providers:
            provider = chosen["provider"]
            got = await self.store.get_connection_secret(provider)
            if got:
                row, blob = got
                if row["status"] != "active":
                    self._notice("KEY_INVALID", provider,
                                 f"연결한 {PROVIDER_LABEL[provider]} 키를 쓸 수 없어 기본 무료 AI로 동작해요.")
                elif await self._over_limit(provider, row.get("monthly_limit_usd")):
                    self._notice("LIMIT_REACHED", provider,
                                 f"{PROVIDER_LABEL[provider]} 월 한도에 도달해 기본 무료 AI로 바꿨어요.")
                else:
                    return Route(provider, chosen["model"], crypto.decrypt(blob, self.s.ai_key_encryption_key),
                                 "byok")
        return self.free_route(task)

    async def _over_limit(self, provider: str, limit: Any) -> bool:
        if limit in (None, ""):
            return False
        rows = await self.store.usage_since(month_start())
        spent = sum(float(r.get("est_cost_usd") or 0) for r in rows if r["provider"] == provider
                    and not r.get("is_free_tier"))
        return spent >= float(limit)

    def _notice(self, code: str, provider: str, message: str) -> None:
        if not any(n["code"] == code and n["provider"] == provider for n in self.notices):
            self.notices.append({"code": code, "provider": provider, "message": message,
                                 "at": datetime.now(UTC).isoformat()})

    # ── calls ──
    async def call_json(self, task: str, *, system: str, user: str, schema: dict,
                        images: list[Image] | None = None, max_tokens: int = 4000,
                        validate: Callable[[dict], None] | None = None) -> LLMResult:
        route = await self.route(task)
        parse_retried = False
        backoffs = [1.0, 2.0]
        tried_fallback = False
        while True:
            adapter = self.factory(route)
            try:
                res = await adapter.generate_json(model=route.model, system=system, user=user, schema=schema,
                                                  images=images, max_tokens=max_tokens)
                if validate:
                    validate(res.data)
                await self._record(task, route, res)
                res.notices = list(self.notices)
                return res
            except LLMError as e:
                log.info("llm %s failed on %r: %s", task, route, e.kind)
                if e.kind == "bad_output" and not parse_retried:
                    parse_retried = True
                    continue
                if route.source == "byok" and e.kind in ("auth", "quota", "rate_limit"):
                    if e.kind == "auth":
                        await self.store.update_connection(route.provider, {"status": "invalid"})
                    msg = {"auth": "인증에 실패해", "quota": "한도를 넘어", "rate_limit": "요청이 많아"}[e.kind]
                    self._notice("BYOK_FALLBACK", route.provider,
                                 f"연결한 {PROVIDER_LABEL[route.provider]} 키가 {msg} 기본 무료 AI로 바꿨어요.")
                    route = self.free_route(task)
                    parse_retried = False
                    continue
                if route.is_free and e.kind == "rate_limit" and backoffs:
                    await self.sleep(backoffs.pop(0))
                    continue
                fb = self.cfg.fallback_for(task)
                if (self.s.is_dev and route.provider == "nvidia" and fb and not tried_fallback
                        and self.s.gemini_api_key):
                    tried_fallback = True
                    route = Route(fb[0], fb[1], self.s.gemini_api_key, "free")
                    parse_retried = False
                    continue
                raise self._api_error(e) from e

    @staticmethod
    def _api_error(e: LLMError) -> ApiError:
        if e.kind in ("rate_limit", "quota"):
            return ApiError("AI_RATE_LIMITED", "AI 요청이 몰려 있어요. 잠시 후 다시 시도해 주세요.", 429)
        if e.kind == "bad_output":
            return ApiError("AI_BAD_OUTPUT", "AI 응답을 이해하지 못했어요. 다시 시도해 주세요.", 502)
        return ApiError("AI_UNAVAILABLE", "AI에 연결하지 못했어요. 잠시 후 다시 시도해 주세요.", 503)

    async def _record(self, task: str, route: Route, res: LLMResult) -> None:
        cost = 0.0 if route.is_free else self.pricing.cost(route.provider, route.model, res.input_tokens,
                                                           res.output_tokens)
        try:
            await self.store.insert_usage({"provider": route.provider, "model": route.model, "task": task,
                                           "input_tokens": res.input_tokens, "output_tokens": res.output_tokens,
                                           "est_cost_usd": round(cost, 6), "is_free_tier": route.is_free})
        except Exception:
            log.warning("usage record failed")

    async def verify_key(self, provider: str, api_key: str) -> None:
        """Test call before saving a BYOK key (F10-b)."""
        choices = self.cfg.byok_choices.get(provider, {})
        model = (choices.get("tagging") or choices.get("chat") or [""])[0]
        adapter = self.factory(Route(provider, model, api_key, "byok"))
        try:
            await adapter.ping(model)
        except LLMError as e:
            if e.kind == "auth":
                raise ApiError("INVALID_KEY", "키를 확인하지 못했어요. 키가 맞는지 다시 확인해 주세요.", 400) from e
            if e.kind in ("quota", "rate_limit"):
                raise ApiError("KEY_QUOTA", "이 키는 지금 사용 한도에 걸려 있어요.", 400) from e
            raise ApiError("KEY_CHECK_FAILED", "제공사에 연결하지 못했어요. 잠시 후 다시 시도해 주세요.", 503) from e
