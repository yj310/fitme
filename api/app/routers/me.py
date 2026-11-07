"""/me — profile, onboarding, exclusions, learning log, account deletion (F01, F07, F11)."""

from __future__ import annotations

import logging
from datetime import UTC, datetime
from typing import Literal

from fastapi import APIRouter, Depends, Response
from pydantic import BaseModel, Field, field_validator

from app.deps import Ctx, get_ctx
from app.domain import taxonomy as tx
from app.errors import ApiError, not_found
from app.services import regions

router = APIRouter(tags=["me"])
log = logging.getLogger("fitme.me")


class UsualSizes(BaseModel):
    top: Literal["S", "M", "L", "XL"] | None = None
    bottom_waist: int | None = Field(None, ge=20, le=50)


class Measurements(BaseModel):
    shoulder: float | None = Field(None, ge=20, le=80)
    chest: float | None = Field(None, ge=50, le=200)
    waist: float | None = Field(None, ge=40, le=200)
    hip: float | None = Field(None, ge=50, le=200)


class OnboardingStep(BaseModel):
    step: Literal["fit", "style", "body", "closet"]
    status: Literal["done", "skipped"]


class MePatch(BaseModel):
    nickname: str | None = Field(None, max_length=20)
    preferred_fit: str | None = None
    style_tags: list[str] | None = None
    avoid_colors: list[str] | None = None
    avoid_subcategories: list[str] | None = None
    personal_color: str | None = None
    region_code: str | None = None
    height_cm: int | None = Field(None, ge=100, le=230)
    usual_sizes: UsualSizes | None = None
    body_traits: list[str] | None = None
    body_measurements: Measurements | None = None
    onboarding_step: OnboardingStep | None = None
    complete_onboarding: bool | None = None

    @field_validator("preferred_fit")
    @classmethod
    def _fit(cls, v):
        if v is not None and v not in tx.FITS["top"]:
            raise ValueError("invalid fit")
        return v

    @field_validator("style_tags")
    @classmethod
    def _styles(cls, v):
        if v is not None and (len(v) > 3 or any(s not in tx.STYLE_TAGS for s in v)):
            raise ValueError("style_tags: up to 3 valid codes")
        return v

    @field_validator("avoid_colors")
    @classmethod
    def _colors(cls, v):
        if v is not None and any(c not in tx.COLOR_LABEL for c in v):
            raise ValueError("invalid color")
        return v

    @field_validator("avoid_subcategories")
    @classmethod
    def _subs(cls, v):
        if v is not None and any(s not in tx.SUBCATEGORY_TO_CATEGORY for s in v):
            raise ValueError("invalid subcategory")
        return v

    @field_validator("personal_color")
    @classmethod
    def _pc(cls, v):
        if v not in (None, "") and v not in tx.PERSONAL_COLORS:
            raise ValueError("invalid personal color")
        return v or None

    @field_validator("body_traits")
    @classmethod
    def _traits(cls, v):
        if v is not None and any(t not in tx.BODY_TRAITS for t in v):
            raise ValueError("invalid body trait")
        return v


def _exclusion_view(f: dict, items: dict[str, dict]) -> dict:
    t, target = f["feedback_type"], f.get("target")
    label = items[target]["name"] if t == "exclude_item" and target in items else tx.label(target)
    return {"id": f["id"], "type": t, "target": target, "target_label": label or "",
            "scope": f.get("scope"), "created_at": f["created_at"]}


async def user_view(ctx: Ctx, row: dict | None = None) -> dict:
    row = row or await ctx.store.ensure_user(ctx.user.nickname, ctx.user.avatar_url)
    styles = await ctx.store.list_styles()
    default = next((s for s in styles if s.get("is_default")), None)
    active = await ctx.store.list_items(active=True)
    persistent = await ctx.store.list_feedback(persistent=True)
    item_ids = [f["target"] for f in persistent if f["feedback_type"] == "exclude_item" and f.get("target")]
    items = {i["id"]: i for i in await ctx.store.get_items(item_ids)} if item_ids else {}
    keys = ("id", "nickname", "avatar_url", "preferred_fit", "style_tags", "avoid_colors", "avoid_subcategories",
            "personal_color", "home_region", "region_code", "grid_nx", "grid_ny", "height_cm", "usual_sizes",
            "body_traits", "body_measurements", "onboarding_state", "created_at")
    out = {k: row.get(k) for k in keys}
    out["usual_sizes"] = out["usual_sizes"] or {}
    out["onboarding_state"] = out["onboarding_state"] or {}
    out.update(persistent_exclusions=[_exclusion_view(f, items) for f in persistent],
               default_style={"id": default["id"], "style_name": default["style_name"]} if default else None,
               closet_count=len(active))
    return out


@router.get("/me")
async def get_me(ctx: Ctx = Depends(get_ctx)):
    return await user_view(ctx)


@router.patch("/me")
async def patch_me(body: MePatch, ctx: Ctx = Depends(get_ctx)):
    row = await ctx.store.ensure_user(ctx.user.nickname, ctx.user.avatar_url)
    data = body.model_dump(exclude_unset=True)
    step = data.pop("onboarding_step", None)
    complete = data.pop("complete_onboarding", None)
    code = data.pop("region_code", None) if "region_code" in data else None
    if "region_code" in body.model_fields_set:
        if code:
            r = regions.by_code(code)
            if not r:
                raise ApiError("INVALID_REGION", "지역을 찾을 수 없어요.", 400)
            data.update(region_code=r["code"], home_region=r["name"], grid_nx=r["nx"], grid_ny=r["ny"])
        else:
            data.update(region_code=None, home_region=None, grid_nx=None, grid_ny=None)
    if "body_measurements" in data and data["body_measurements"] is not None:
        data["body_measurements"] = {k: v for k, v in data["body_measurements"].items()}
    if step or complete:
        state = dict(row.get("onboarding_state") or {})
        now = datetime.now(UTC).isoformat()
        if step:
            state.setdefault("steps", {})[step["step"]] = {"status": step["status"], "at": now}
        if complete:
            state["completed_at"] = now
        data["onboarding_state"] = state
    if data:
        row = await ctx.store.update_user(data)
    return await user_view(ctx, row)


@router.delete("/me/exclusions/{feedback_id}", status_code=204)
async def remove_exclusion(feedback_id: str, ctx: Ctx = Depends(get_ctx)):
    f = await ctx.store.get_feedback(feedback_id)
    if not f or not f.get("is_persistent"):
        raise not_found("제외 조건")
    await ctx.store.update_feedback(feedback_id, {"is_persistent": False})
    return Response(status_code=204)


@router.get("/me/learning-log")
async def learning_log(ctx: Ctx = Depends(get_ctx)):
    events: list[dict] = []
    persistent = await ctx.store.list_feedback(persistent=True)
    item_ids = [f["target"] for f in persistent if f["feedback_type"] == "exclude_item" and f.get("target")]
    items = {i["id"]: i for i in await ctx.store.get_items(item_ids)} if item_ids else {}
    for f in persistent:
        v = _exclusion_view(f, items)
        where = f"{'·'.join(f['scope'])} 코디에서 " if f.get("scope") else ""
        events.append({"type": "exclusion", "date": f["created_at"],
                       "text": f"{where}{v['target_label']} 제외 (대화 · 동의함)"})
    rerolls = await ctx.store.list_feedback(types=["reroll"])
    by_day: dict[str, int] = {}
    for f in rerolls:
        by_day[f["created_at"][:10]] = by_day.get(f["created_at"][:10], 0) + 1
    for day, n in by_day.items():
        events.append({"type": "dislike", "date": day + "T00:00:00+00:00",
                       "text": f"추천 코디 다시 짜기 {n}회 (비슷한 조합은 덜 추천)"})
    for o in await ctx.store.list_outfits(favorite=True, limit=50):
        events.append({"type": "favorite", "date": o.get("favorited_at") or o["created_at"],
                       "text": f"'{o['title']}' 코디 저장 (♥)"})
    for s in await ctx.store.list_styles():
        events.append({"type": "style_added", "date": s["created_at"], "text": f"추구미 '{s['style_name']}' 추가"})
    events.sort(key=lambda e: e["date"], reverse=True)
    return {"events": events[:50], "total": len(events), "last_updated": events[0]["date"] if events else None}


@router.delete("/me", status_code=204)
async def delete_me(ctx: Ctx = Depends(get_ctx)):
    """F11: delete every row, every photo, every AI key, then the auth user."""
    paths = await ctx.store.all_image_paths()
    await ctx.storage.remove(paths)
    await ctx.store.delete_user_rows()
    await _delete_auth_user(ctx)
    log.info("account deleted")
    return Response(status_code=204)


async def _delete_auth_user(ctx: Ctx) -> None:
    s = ctx.settings
    if not s.supabase_url or not s.supabase_service_role_key:
        return
    r = await ctx.app.http.delete(f"{s.supabase_url.rstrip('/')}/auth/v1/admin/users/{ctx.user.id}",
                                  headers={"apikey": s.supabase_service_role_key,
                                           "Authorization": f"Bearer {s.supabase_service_role_key}"},
                                  timeout=10.0)
    if r.status_code >= 400 and r.status_code != 404:
        raise ApiError("DELETE_FAILED", "계정 삭제 중 문제가 생겼어요. 다시 시도해 주세요.", 502)

