"""/style-presets, /style-profiles — 추구미 (F04)."""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path

from fastapi import APIRouter, Depends, Response
from pydantic import BaseModel, Field, model_validator

from app.agent.llm_tasks import analyze_style, clean_attributes
from app.deps import Ctx, get_ctx
from app.errors import ApiError, not_found

router = APIRouter(tags=["style"])
PRESETS_PATH = Path(__file__).resolve().parents[1] / "domain" / "style_presets.json"


@lru_cache
def presets() -> list[dict]:
    return json.loads(PRESETS_PATH.read_text(encoding="utf-8"))["presets"]


def profile_view(r: dict) -> dict:
    return {k: r.get(k) for k in ("id", "style_name", "source_text", "preset_key", "attributes", "is_default",
                                  "created_at")}


class CreateReq(BaseModel):
    text: str | None = Field(None, max_length=300)
    preset: str | None = None

    @model_validator(mode="after")
    def _one(self):
        if not (self.text and self.text.strip()) and not self.preset:
            raise ValueError("text or preset is required")
        return self


class PatchReq(BaseModel):
    style_name: str | None = Field(None, max_length=30)
    attributes: dict | None = None
    is_default: bool | None = None


@router.get("/style-presets")
async def list_presets():
    return {"presets": presets()}


@router.post("/style-profiles")
async def create_profile(body: CreateReq, ctx: Ctx = Depends(get_ctx)):
    await ctx.store.ensure_user(ctx.user.nickname, ctx.user.avatar_url)
    if body.preset:
        p = next((p for p in presets() if p["key"] == body.preset), None)
        if not p:
            raise ApiError("INVALID_PRESET", "알 수 없는 추구미예요.", 400)
        name, attrs, source, key = p["style_name"], clean_attributes(p["attributes"]), None, p["key"]
    else:
        text = body.text.strip()
        # Same text as a preset name → use the preset, no LLM call (spec F04).
        p = next((p for p in presets() if p["style_name"].replace(" ", "") == text.replace(" ", "")), None)
        if p:
            name, attrs, key = p["style_name"], clean_attributes(p["attributes"]), p["key"]
        else:
            name, attrs = await analyze_style(ctx.llm, text)
            key = None
        source = text
    existing = await ctx.store.list_styles()
    row = await ctx.store.insert_style({"style_name": name, "source_text": source, "preset_key": key,
                                        "attributes": attrs, "is_default": not existing})
    return profile_view(row)


@router.get("/style-profiles")
async def list_profiles(ctx: Ctx = Depends(get_ctx)):
    return {"profiles": [profile_view(r) for r in await ctx.store.list_styles()]}


@router.patch("/style-profiles/{sid}")
async def patch_profile(sid: str, body: PatchReq, ctx: Ctx = Depends(get_ctx)):
    current = await ctx.store.get_style(sid)
    if not current:
        raise not_found("추구미")
    values: dict = {}
    if body.style_name is not None and body.style_name.strip():
        values["style_name"] = body.style_name.strip()
    if body.attributes is not None:
        values["attributes"] = clean_attributes({**current["attributes"], **body.attributes})
    if body.is_default:
        await ctx.store.clear_default_style()
        values["is_default"] = True
    row = await ctx.store.update_style(sid, values) if values else current
    return profile_view(row)


@router.delete("/style-profiles/{sid}", status_code=204)
async def delete_profile(sid: str, ctx: Ctx = Depends(get_ctx)):
    current = await ctx.store.get_style(sid)
    if not current:
        raise not_found("추구미")
    await ctx.store.delete_style(sid)
    if current.get("is_default"):
        rest = await ctx.store.list_styles()
        if rest:
            await ctx.store.update_style(rest[0]["id"], {"is_default": True})
    return Response(status_code=204)
