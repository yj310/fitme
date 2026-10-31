"""/ai — BYOK connections, per-task models, usage (F10).

Key handling (spec 10.5): the key arrives once, is test-called, encrypted (AES-256-GCM) and stored.
Responses only ever contain the last 4 characters. The key is never logged.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Literal

from fastapi import APIRouter, Depends, Query, Response
from pydantic import BaseModel, Field, SecretStr

from app.deps import Ctx, get_ctx, kst_day_start
from app.errors import ApiError
from app.llm.router import BYOK_PROVIDERS, PROVIDER_LABEL, TASK_LABEL, month_start
from app.services import crypto

router = APIRouter(tags=["ai"])
Provider = Literal["gemini", "anthropic", "openai"]


class ConnectReq(BaseModel):
    api_key: SecretStr = Field(min_length=10, max_length=300)
    monthly_limit_usd: float | None = Field(None, ge=0, le=10000)


class LimitReq(BaseModel):
    monthly_limit_usd: float | None = Field(None, ge=0, le=10000)


class TaskSetting(BaseModel):
    task: Literal["chat", "tagging", "style"]
    provider: str
    model: str = ""


class TaskSettingsReq(BaseModel):
    tasks: list[TaskSetting]


def _conn_view(r: dict) -> dict:
    return {k: r.get(k) for k in ("provider", "key_last4", "status", "monthly_limit_usd", "verified_at")}


def _model_label(provider: str, model: str) -> str:
    return f"{PROVIDER_LABEL.get(provider, provider)} · {model}"


@router.get("/ai/connections")
async def connections(ctx: Ctx = Depends(get_ctx)):
    provider, model = ctx.app.cfg.default_for("chat")
    free_label = "Gemini Flash 계열 · 무료 티어" if provider == "gemini" else _model_label(provider, model)
    return {
        "free": {"provider": provider, "model_label": free_label,
                 "notice": "사용량 제한이 있고, 입력 내용이 Google 제품 개선에 쓰일 수 있어요."},
        "connections": [_conn_view(r) for r in await ctx.store.list_connections()],
        "providers": [p for p in BYOK_PROVIDERS if p in ctx.app.cfg.allowed_providers],
    }


@router.post("/ai/connections/{provider}")
async def connect(provider: Provider, body: ConnectReq, ctx: Ctx = Depends(get_ctx)):
    if provider not in ctx.app.cfg.allowed_providers:
        raise ApiError("PROVIDER_NOT_ALLOWED", "지금은 연결할 수 없는 제공사예요.", 400)
    key = body.api_key.get_secret_value().strip()
    await ctx.llm.verify_key(provider, key)
    blob = crypto.encrypt(key, ctx.settings.ai_key_encryption_key)
    row = await ctx.store.upsert_connection(provider, blob, key[-4:], body.monthly_limit_usd,
                                            datetime.now(UTC).isoformat())
    del key
    return _conn_view(row)


@router.patch("/ai/connections/{provider}")
async def set_limit(provider: Provider, body: LimitReq, ctx: Ctx = Depends(get_ctx)):
    row = await ctx.store.update_connection(provider, {"monthly_limit_usd": body.monthly_limit_usd})
    if not row:
        raise ApiError("NOT_CONNECTED", "연결된 키가 없어요.", 404)
    return _conn_view(row)


@router.delete("/ai/connections/{provider}", status_code=204)
async def disconnect(provider: Provider, ctx: Ctx = Depends(get_ctx)):
    await ctx.store.delete_connection(provider)
    for s in await ctx.store.get_task_settings():
        if s["provider"] == provider:
            await ctx.store.delete_task_setting(s["task"])
    return Response(status_code=204)


@router.get("/ai/task-settings")
async def get_task_settings(ctx: Ctx = Depends(get_ctx)):
    cfg = ctx.app.cfg
    rows = {r["task"]: r for r in await ctx.store.get_task_settings()}
    conns = {c["provider"]: c for c in await ctx.store.list_connections() if c["status"] == "active"}
    tasks = []
    for task in ("chat", "tagging", "style"):
        fp, fm = cfg.default_for(task)
        choices = [{"provider": "free", "model": fm, "label": f"기본 무료 ({_model_label(fp, fm)})"}]
        for p in conns:
            for m in (cfg.byok_choices.get(p) or {}).get(task, []):
                choices.append({"provider": p, "model": m, "label": _model_label(p, m)})
        r = rows.get(task)
        if r and r["provider"] in conns:
            tasks.append({"task": task, "label": TASK_LABEL[task], "provider": r["provider"], "model": r["model"],
                          "source": "byok", "choices": choices})
        else:
            tasks.append({"task": task, "label": TASK_LABEL[task], "provider": "free", "model": fm,
                          "source": "free", "choices": choices})
    return {"tasks": tasks}


@router.put("/ai/task-settings")
async def put_task_settings(body: TaskSettingsReq, ctx: Ctx = Depends(get_ctx)):
    cfg = ctx.app.cfg
    conns = {c["provider"] for c in await ctx.store.list_connections() if c["status"] == "active"}
    for t in body.tasks:
        if t.provider == "free":
            await ctx.store.delete_task_setting(t.task)
            continue
        allowed = (cfg.byok_choices.get(t.provider) or {}).get(t.task, [])
        if t.provider not in conns or t.model not in allowed:
            raise ApiError("INVALID_MODEL", "연결된 키로 쓸 수 있는 모델만 고를 수 있어요.", 400)
        await ctx.store.put_task_setting(t.task, t.provider, t.model)
    return await get_task_settings(ctx)


@router.get("/ai/usage")
async def usage(ctx: Ctx = Depends(get_ctx), month: str | None = Query(None, pattern=r"^\d{4}-\d{2}$")):
    if month:
        y, m = map(int, month.split("-"))
        start = datetime(y, m, 1, tzinfo=UTC)
    else:
        start = month_start()
        month = start.strftime("%Y-%m")
    end = datetime(start.year + (start.month == 12), start.month % 12 + 1, 1, tzinfo=UTC)
    rows = await ctx.store.usage_since(start, end)
    conns = {c["provider"]: c for c in await ctx.store.list_connections()}
    byok: dict[str, dict] = {}
    for r in rows:
        if r.get("is_free_tier"):
            continue
        b = byok.setdefault(r["provider"], {"provider": r["provider"], "requests": 0, "input_tokens": 0,
                                            "output_tokens": 0, "est_cost_usd": 0.0})
        b["requests"] += 1
        b["input_tokens"] += r.get("input_tokens") or 0
        b["output_tokens"] += r.get("output_tokens") or 0
        b["est_cost_usd"] += float(r.get("est_cost_usd") or 0)
    for p in conns:
        byok.setdefault(p, {"provider": p, "requests": 0, "input_tokens": 0, "output_tokens": 0, "est_cost_usd": 0.0})
    for b in byok.values():
        b["est_cost_usd"] = round(b["est_cost_usd"], 4)
        b["monthly_limit_usd"] = (conns.get(b["provider"]) or {}).get("monthly_limit_usd")
    day = kst_day_start().astimezone(UTC)
    notices = [{"code": "KEY_INVALID", "provider": p, "at": c.get("verified_at"),
                "message": f"연결한 {PROVIDER_LABEL[p]} 키가 실패해 기본 무료 AI로 동작 중이에요."}
               for p, c in conns.items() if c["status"] == "invalid"]
    return {"month": month, "byok": list(byok.values()),
            "free": {"agent_runs_today": await ctx.store.count_runs_since(day, free_only=True),
                     "agent_runs_limit": ctx.settings.free_daily_agent_runs,
                     "tagging_today": await ctx.store.count_tagging_since(day),
                     "tagging_limit": ctx.settings.free_daily_tagging},
            "notices": notices}
