"""/outfits — today generation, chip feedback, favorites, saved list (F05–F08)."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Literal

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field

from app.agent import core, service
from app.deps import Ctx, get_ctx
from app.errors import not_found

router = APIRouter(tags=["outfits"])


class GenerateReq(BaseModel):
    date: str | None = None
    time_of_day: Literal["morning", "afternoon", "evening", "all"] | None = None
    nx: int | None = None
    ny: int | None = None
    region_code: str | None = None
    schedule: str | None = Field(None, max_length=100)
    moods: list[Literal["neat", "comfy", "dressy", "warm"]] = []
    temp_band: str | None = None


class FeedbackReq(BaseModel):
    chip: Literal["change_top", "too_plain", "warmer", "reroll"] | None = None
    message: str | None = Field(None, max_length=500)


@router.post("/outfits/generate")
async def generate(body: GenerateReq, ctx: Ctx = Depends(get_ctx)):
    return await service.run_today(ctx, body.model_dump())


@router.post("/outfits/{outfit_id}/feedback")
async def feedback(outfit_id: str, body: FeedbackReq, ctx: Ctx = Depends(get_ctx)):
    return await service.outfit_feedback(ctx, outfit_id, body.chip, body.message)


@router.post("/outfits/{outfit_id}/favorite")
async def favorite(outfit_id: str, ctx: Ctx = Depends(get_ctx)):
    row = await ctx.store.set_favorite(outfit_id, True, datetime.now(UTC).isoformat())
    if not row:
        raise not_found("코디")
    return {"id": row["id"], "is_favorite": True}


@router.delete("/outfits/{outfit_id}/favorite")
async def unfavorite(outfit_id: str, ctx: Ctx = Depends(get_ctx)):
    row = await ctx.store.set_favorite(outfit_id, False, None)
    if not row:
        raise not_found("코디")
    return {"id": row["id"], "is_favorite": False}


@router.get("/outfits")
async def list_outfits(ctx: Ctx = Depends(get_ctx), favorite: bool | None = None, occasion: str | None = None,
                       limit: int = Query(60, ge=1, le=100)):
    rows = await ctx.store.list_outfits(favorite=favorite, occasion=occasion or None, limit=limit)
    return {"outfits": await core.outfit_cards(rows, ctx.storage),
            "occasions": await ctx.store.favorite_occasions()}
