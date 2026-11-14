"""/style-profiles — 추구미 (F04).

A 추구미 holds everything about the look the user wants: fit (silhouette), style tags, liked and avoided
colors, avoided items and mood. Onboarding makes the first one (the default); more can be added in 내 프로필.
Free text is analysed by the LLM into the same attributes, which the user reviews before saving.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Response
from pydantic import BaseModel, Field

from app.agent.llm_tasks import analyze_style, clean_attributes
from app.deps import Ctx, get_ctx
from app.domain import taxonomy as tx
from app.errors import not_found

router = APIRouter(tags=["style"])


def profile_view(r: dict) -> dict:
    return {k: r.get(k) for k in ("id", "style_name", "source_text", "attributes", "is_default", "created_at")}


def auto_name(attrs: dict) -> str:
    """'미니멀 · 캐주얼' from the style tags when the user gave no name."""
    return " · ".join(tx.STYLE_LABEL.get(t, t) for t in attrs.get("style_tags", [])) or "내 추구미"


class CreateReq(BaseModel):
    style_name: str | None = Field(None, max_length=30)
    attributes: dict
    source_text: str | None = Field(None, max_length=300)
    is_default: bool | None = None


class AnalyzeReq(BaseModel):
    text: str = Field(min_length=1, max_length=300)


class PatchReq(BaseModel):
    style_name: str | None = Field(None, max_length=30)
    attributes: dict | None = None
    is_default: bool | None = None


@router.post("/style-profiles/analyze")
async def analyze_profile(body: AnalyzeReq, ctx: Ctx = Depends(get_ctx)):
    """Free text → attributes, not saved: the user checks them in the steps and saves with POST."""
    name, attrs = await analyze_style(ctx.llm, body.text.strip())
    return {"style_name": name, "attributes": attrs}


@router.post("/style-profiles")
async def create_profile(body: CreateReq, ctx: Ctx = Depends(get_ctx)):
    await ctx.store.ensure_user(ctx.user.nickname, ctx.user.avatar_url)
    attrs = clean_attributes(body.attributes)
    existing = await ctx.store.list_styles()
    default = not existing or bool(body.is_default)
    if default and existing:
        await ctx.store.clear_default_style()
    row = await ctx.store.insert_style({"style_name": (body.style_name or "").strip() or auto_name(attrs),
                                        "source_text": (body.source_text or "").strip() or None,
                                        "attributes": attrs, "is_default": default})
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
