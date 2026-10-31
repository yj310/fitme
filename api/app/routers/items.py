"""/items — upload URL, AI tagging, closet CRUD (F02, F03)."""

from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends, Query, Response
from pydantic import BaseModel, Field

from app.agent.llm_tasks import tag_clothing_image
from app.deps import Ctx, check_tagging_quota, get_ctx
from app.domain import taxonomy as tx
from app.errors import ApiError, not_found

router = APIRouter(tags=["items"])

ITEM_KEYS = ("id", "image_path", "name", "category", "subcategory", "color", "pattern", "fit", "material",
             "seasons", "style_tags", "formality", "warmth", "brand", "size_label", "memo", "tag_confidence",
             "tag_source", "is_active", "created_at")


def item_view(row: dict, urls: dict[str, str]) -> dict:
    out = {k: row.get(k) for k in ITEM_KEYS}
    out["image_url"] = urls.get(row.get("image_path") or "")
    out["tag_confidence"] = out["tag_confidence"] or {}
    return out


class UploadReq(BaseModel):
    content_type: Literal["image/webp", "image/jpeg"]


class TagReq(BaseModel):
    image_path: str


class ItemBody(BaseModel):
    image_path: str | None = None
    name: str | None = Field(None, max_length=40)
    category: str | None = None
    subcategory: str | None = None
    color: str | None = None
    pattern: str | None = None
    fit: str | None = None
    material: str | None = None
    seasons: list[str] | None = None
    style_tags: list[str] | None = None
    formality: int | None = Field(None, ge=1, le=3)
    warmth: int | None = Field(None, ge=1, le=3)
    brand: str | None = Field(None, max_length=40)
    size_label: str | None = Field(None, max_length=20)
    memo: str | None = Field(None, max_length=200)
    tag_confidence: dict[str, float] | None = None
    tag_source: Literal["ai", "user_edited", "manual"] | None = None
    is_active: bool | None = None


TAG_FIELDS = ("category", "subcategory", "color", "pattern", "fit", "material", "seasons", "style_tags",
              "formality", "warmth")


def _clean_tags(data: dict, base: dict | None = None) -> dict:
    merged = {**(base or {}), **{k: v for k, v in data.items() if k in TAG_FIELDS and v is not None}}
    clean, invalid = tx.normalize_tags(merged)
    # A user-submitted value that isn't in the taxonomy is a client bug — reject instead of guessing.
    submitted_bad = [f for f in invalid if data.get(f) is not None]
    if submitted_bad:
        raise ApiError("INVALID_TAGS", "태그 값이 올바르지 않아요: " + ", ".join(submitted_bad), 400)
    if data.get("material") is None and "material" in data:
        clean["material"] = None
    return clean


@router.post("/items/upload-url")
async def upload_url(body: UploadReq, ctx: Ctx = Depends(get_ctx)):
    path = ctx.storage.new_path(body.content_type)
    return {"path": path, "upload_url": await ctx.storage.signed_upload_url(path)}


@router.post("/items/tag")
async def tag(body: TagReq, ctx: Ctx = Depends(get_ctx)):
    if not ctx.storage.owns(body.image_path):
        raise ApiError("FORBIDDEN", "접근 권한이 없어요.", 403)
    route = await ctx.llm.route("tagging")
    await check_tagging_quota(ctx, route.is_free)
    data, mime = await ctx.storage.download(body.image_path)
    try:
        tags, conf = await tag_clothing_image(ctx.llm, data, mime)
    except ApiError as e:
        if e.code == "FREE_QUOTA_EXCEEDED":
            raise
        raise ApiError("TAGGING_FAILED", "AI가 태그를 제안하지 못했어요. 직접 입력해 주세요.", 502) from e
    return {"tags": tags, "confidence": conf, "name": tx.item_name(tags["color"], tags["subcategory"]),
            "notices": ctx.llm.notices}


@router.post("/items")
async def create_item(body: ItemBody, ctx: Ctx = Depends(get_ctx)):
    data = body.model_dump(exclude_unset=True)
    if not data.get("subcategory") or not data.get("color"):
        raise ApiError("INVALID_TAGS", "세부 카테고리와 색은 꼭 골라 주세요.", 400)
    if data.get("image_path") and not ctx.storage.owns(data["image_path"]):
        raise ApiError("FORBIDDEN", "접근 권한이 없어요.", 403)
    await ctx.store.ensure_user(ctx.user.nickname, ctx.user.avatar_url)
    clean = _clean_tags(data)
    row = {**clean, "image_path": data.get("image_path"),
           "name": (data.get("name") or "").strip() or tx.item_name(clean["color"], clean["subcategory"]),
           "brand": data.get("brand"), "size_label": data.get("size_label"), "memo": data.get("memo"),
           "tag_confidence": data.get("tag_confidence") or {}, "tag_source": data.get("tag_source") or "manual",
           "is_active": True}
    saved = await ctx.store.insert_item(row)
    urls = await ctx.storage.signed_urls([saved["image_path"]]) if saved.get("image_path") else {}
    return item_view(saved, urls)


@router.get("/items")
async def list_items(ctx: Ctx = Depends(get_ctx), category: str | None = None, color: str | None = None,
                     season: str | None = None, active: Literal["true", "false", "all"] = Query("true")):
    rows = await ctx.store.list_items(active=None)
    counts = {"all": 0, **{c: 0 for c in tx.CATEGORIES}, "archived": 0}
    for r in rows:
        if r["is_active"]:
            counts["all"] += 1
            counts[r["category"]] += 1
        else:
            counts["archived"] += 1
    cats = set(category.split(",")) if category else None
    colors = set(color.split(",")) if color else None
    seasons = set(season.split(",")) if season else None
    want_active = None if active == "all" else active == "true"
    out = [r for r in rows
           if (want_active is None or r["is_active"] == want_active)
           and (not cats or r["category"] in cats) and (not colors or r["color"] in colors)
           and (not seasons or not r.get("seasons") or set(r["seasons"]) & seasons)]
    urls = await ctx.storage.signed_urls([r["image_path"] for r in out if r.get("image_path")])
    return {"items": [item_view(r, urls) for r in out], "counts": counts}


@router.patch("/items/{item_id}")
async def update_item(item_id: str, body: ItemBody, ctx: Ctx = Depends(get_ctx)):
    current = await ctx.store.get_item(item_id)
    if not current:
        raise not_found("옷")
    data = body.model_dump(exclude_unset=True)
    data.pop("image_path", None)
    values: dict = {}
    if any(k in data for k in TAG_FIELDS):
        values.update(_clean_tags(data, {k: current.get(k) for k in TAG_FIELDS}))
        if current.get("tag_source") == "ai":
            values["tag_source"] = "user_edited"
    for k in ("name", "brand", "size_label", "memo", "is_active"):
        if k in data:
            values[k] = data[k]
    if "name" in values and not (values["name"] or "").strip():
        values["name"] = tx.item_name(values.get("color", current["color"]),
                                      values.get("subcategory", current["subcategory"]))
    row = await ctx.store.update_item(item_id, values) if values else current
    urls = await ctx.storage.signed_urls([row["image_path"]]) if row.get("image_path") else {}
    return item_view(row, urls)


@router.delete("/items/{item_id}", status_code=204)
async def delete_item(item_id: str, ctx: Ctx = Depends(get_ctx)):
    current = await ctx.store.get_item(item_id)
    if not current:
        raise not_found("옷")
    await ctx.store.delete_item(item_id)
    if current.get("image_path"):
        await ctx.storage.remove([current["image_path"]])
    return Response(status_code=204)
