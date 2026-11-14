"""/weather, /regions (F06)."""

from __future__ import annotations

from datetime import date
from typing import Literal

from fastapi import APIRouter, Depends, Query

from app.agent.core import today_kst
from app.deps import Ctx, get_ctx
from app.errors import ApiError
from app.services import regions

router = APIRouter(tags=["weather"])


@router.get("/weather")
async def weather(ctx: Ctx = Depends(get_ctx), date_: str | None = Query(None, alias="date"),
                  time_of_day: Literal["morning", "afternoon", "evening", "all"] = "all",
                  nx: int | None = None, ny: int | None = None):
    try:
        d = date.fromisoformat(date_) if date_ else today_kst()
    except ValueError as e:
        raise ApiError("INVALID_DATE", "날짜 형식이 올바르지 않아요.", 400) from e
    if nx is None or ny is None:
        user = await ctx.store.get_user() or {}
        nx, ny = user.get("grid_nx"), user.get("grid_ny")
    return await ctx.app.weather.summary(nx, ny, d, time_of_day)


@router.get("/regions")
async def search_regions(q: str = "", ctx: Ctx = Depends(get_ctx)):
    return {"regions": regions.search(q[:30])}


@router.get("/regions/nearest")
async def nearest_region(lat: float = Query(..., ge=33, le=39), lon: float = Query(..., ge=124, le=132),
                         ctx: Ctx = Depends(get_ctx)):
    return {"region": regions.nearest(lat, lon)}
