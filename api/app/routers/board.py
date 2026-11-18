"""/board — 피드백 게시판 (decision 14).

Everyone: write a post with screenshots from any screen, see their own posts, the admin's replies and
status changes ('내 피드백'), and add to their own posts.
Admin (user ids in ADMIN_USER_IDS): see every post, change its status (접수 · 해결 중 · 해결됨 · 보류), reply.

Users read and write through their own JWT (RLS: own posts only). Admin reads and writes go through the
service role, only after require_admin. Image URLs are signed with the service role, but only for paths
taken from rows the caller was allowed to read.
"""

from __future__ import annotations

from collections import Counter
from datetime import UTC, datetime, timedelta
from typing import Literal

from fastapi import APIRouter, Depends, Response
from pydantic import BaseModel, Field, field_validator

from app.deps import Ctx, get_ctx
from app.errors import ApiError, not_found

router = APIRouter(tags=["board"])

BUCKET = "board"
MAX_IMAGES = 5
DAILY_POSTS = 30          # per user, to keep a runaway script from filling the board
Status = Literal["new", "doing", "done", "hold"]


# ── access ──

def is_admin(ctx: Ctx) -> bool:
    return ctx.user.id in ctx.settings.admin_ids


def require_admin(ctx: Ctx) -> None:
    if not is_admin(ctx):
        raise ApiError("FORBIDDEN", "관리자만 볼 수 있어요.", 403)


def _user_storage(ctx: Ctx):
    return ctx.storage.for_bucket(BUCKET)


def _signing_storage(ctx: Ctx):
    # Posts carry the author's and the admin's photos (different folders), so URLs are signed as the
    # service role. Only ever called with paths from rows the caller may read.
    return ctx.storage.for_bucket(BUCKET, service_key=ctx.settings.supabase_service_role_key or None)


def _check_paths(ctx: Ctx, paths: list[str]) -> list[str]:
    st = _user_storage(ctx)
    clean = list(dict.fromkeys(paths))
    if len(clean) > MAX_IMAGES:
        raise ApiError("TOO_MANY_IMAGES", f"사진은 {MAX_IMAGES}장까지 올릴 수 있어요.", 400)
    if not all(st.owns(p) and p.endswith((".webp", ".jpg")) for p in clean):
        raise ApiError("FORBIDDEN", "접근 권한이 없어요.", 403)
    return clean


# ── views ──

def _title(body: str) -> str:
    first = body.strip().splitlines()[0] if body.strip() else ""
    return first[:60] + ("…" if len(first) > 60 else "")


def _images(paths: list[str] | None, urls: dict[str, str]) -> list[dict]:
    return [{"path": p, "url": urls.get(p)} for p in paths or []]


def _comment_view(c: dict, urls: dict[str, str]) -> dict:
    return {"id": c["id"], "kind": c.get("kind") or "comment", "is_admin": bool(c.get("is_admin")),
            "body": c.get("body") or "", "status": c.get("status"), "images": _images(c.get("image_paths"), urls),
            "created_at": c["created_at"]}


def _unread(p: dict) -> bool:
    seen, upd = p.get("author_seen_at"), p.get("admin_updated_at")
    return bool(upd and (not seen or upd > seen))


def _post_view(p: dict, comments: list[dict], urls: dict[str, str], admin: bool) -> dict:
    out = {"id": p["id"], "kind": p["kind"], "title": _title(p["body"]), "body": p["body"], "status": p["status"],
           "page": p.get("page"), "device": p.get("device"), "images": _images(p.get("image_paths"), urls),
           "comments": [_comment_view(c, urls) for c in comments], "created_at": p["created_at"],
           "updated_at": p.get("updated_at"), "admin_updated_at": p.get("admin_updated_at")}
    if admin:
        out["author"] = ((p.get("users") or {}).get("nickname")) or "사용자"
    else:
        out["unread"] = _unread(p)
    return out


async def _views(ctx: Ctx, posts: list[dict], comments: list[dict], admin: bool) -> list[dict]:
    paths = [x for r in posts + comments for x in r.get("image_paths") or []]
    urls = await _signing_storage(ctx).signed_urls(paths) if paths else {}
    by_post: dict[int, list[dict]] = {}
    for c in comments:
        by_post.setdefault(c["post_id"], []).append(c)
    return [_post_view(p, by_post.get(p["id"], []), urls, admin) for p in posts]


# ── requests ──

class UploadReq(BaseModel):
    content_type: Literal["image/webp", "image/jpeg"]


class PostReq(BaseModel):
    kind: Literal["bug", "idea", "etc"]
    body: str = Field(min_length=1, max_length=2000)
    page: str | None = Field(None, max_length=120)
    device: str | None = Field(None, max_length=80)
    image_paths: list[str] = Field(default_factory=list, max_length=MAX_IMAGES)

    @field_validator("body")
    @classmethod
    def _body(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("body is empty")
        return v.strip()


class CommentReq(BaseModel):
    body: str = Field("", max_length=2000)
    image_paths: list[str] = Field(default_factory=list, max_length=MAX_IMAGES)


class StatusReq(BaseModel):
    status: Status


# ── everyone ──

@router.post("/board/upload-url")
async def upload_url(body: UploadReq, ctx: Ctx = Depends(get_ctx)):
    st = _user_storage(ctx)
    path = st.new_path(body.content_type)
    return {"path": path, "upload_url": await st.signed_upload_url(path)}


@router.post("/board/posts")
async def create_post(body: PostReq, ctx: Ctx = Depends(get_ctx)):
    await ctx.store.ensure_user(ctx.user.nickname, ctx.user.avatar_url)
    since = (datetime.now(UTC) - timedelta(days=1)).isoformat()
    if sum(1 for p in await ctx.store.list_my_board_posts() if p["created_at"] >= since) >= DAILY_POSTS:
        raise ApiError("RATE_LIMITED", "오늘은 피드백을 충분히 남겼어요. 내일 다시 남겨 주세요.", 429)
    row = await ctx.store.insert_board_post({"kind": body.kind, "body": body.body, "page": body.page,
                                             "device": body.device,
                                             "image_paths": _check_paths(ctx, body.image_paths)})
    return (await _views(ctx, [row], [], admin=False))[0]


@router.get("/board/mine")
async def my_posts(ctx: Ctx = Depends(get_ctx)):
    posts = await ctx.store.list_my_board_posts()
    comments = await ctx.store.list_board_comments([p["id"] for p in posts])
    views = await _views(ctx, posts, comments, admin=False)
    return {"posts": views, "unread": sum(1 for v in views if v["unread"])}


@router.post("/board/mine/seen", status_code=204)
async def mark_seen(ctx: Ctx = Depends(get_ctx)):
    await ctx.store.mark_board_seen(datetime.now(UTC).isoformat())
    return Response(status_code=204)


@router.post("/board/posts/{pid}/comments")
async def add_my_comment(pid: int, body: CommentReq, ctx: Ctx = Depends(get_ctx)):
    if not await ctx.store.get_my_board_post(pid):
        raise not_found("피드백")
    paths = _check_paths(ctx, body.image_paths)
    if not body.body.strip() and not paths:
        raise ApiError("EMPTY", "내용이나 사진을 넣어 주세요.", 400)
    c = await ctx.store.insert_board_comment({"post_id": pid, "body": body.body.strip(), "image_paths": paths})
    urls = await _signing_storage(ctx).signed_urls(paths) if paths else {}
    return _comment_view(c, urls)


# ── admin ──

@router.get("/admin/board")
async def admin_list(ctx: Ctx = Depends(get_ctx)):
    require_admin(ctx)
    posts = await ctx.store.admin_list_board_posts()
    comments = await ctx.store.admin_list_board_comments([p["id"] for p in posts])
    counts = Counter(p["status"] for p in posts)
    return {"posts": await _views(ctx, posts, comments, admin=True),
            "counts": {s: counts.get(s, 0) for s in ("new", "doing", "done", "hold")}}


@router.patch("/admin/board/{pid}")
async def admin_set_status(pid: int, body: StatusReq, ctx: Ctx = Depends(get_ctx)):
    require_admin(ctx)
    post = await ctx.store.admin_get_board_post(pid)
    if not post:
        raise not_found("피드백")
    if post["status"] != body.status:
        now = datetime.now(UTC).isoformat()
        await ctx.store.admin_update_board_post(pid, {"status": body.status, "admin_updated_at": now,
                                                      "updated_at": now})
        await ctx.store.admin_insert_board_comment({"post_id": pid, "kind": "status", "status": body.status})
    return await _admin_one(ctx, pid)


@router.post("/admin/board/{pid}/comments")
async def admin_reply(pid: int, body: CommentReq, ctx: Ctx = Depends(get_ctx)):
    require_admin(ctx)
    if not await ctx.store.admin_get_board_post(pid):
        raise not_found("피드백")
    paths = _check_paths(ctx, body.image_paths)
    if not body.body.strip() and not paths:
        raise ApiError("EMPTY", "내용이나 사진을 넣어 주세요.", 400)
    now = datetime.now(UTC).isoformat()
    await ctx.store.admin_insert_board_comment({"post_id": pid, "body": body.body.strip(), "image_paths": paths})
    await ctx.store.admin_update_board_post(pid, {"admin_updated_at": now, "updated_at": now})
    return await _admin_one(ctx, pid)


async def _admin_one(ctx: Ctx, pid: int) -> dict:
    post = await ctx.store.admin_get_board_post(pid)
    comments = await ctx.store.admin_list_board_comments([pid])
    return (await _views(ctx, [post], comments, admin=True))[0]
