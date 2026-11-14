"""/health (no auth) and development-only /dev/session."""

from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Request
from pydantic import BaseModel

from app.deps import services
from app.errors import ApiError

router = APIRouter(tags=["system"])
dev_router = APIRouter(tags=["dev"])

DEV_ACCOUNTS = {"a": "fitme.dev.a@example.com", "b": "fitme.dev.b@example.com"}


@router.get("/health")
async def health(request: Request):
    app = services(request)
    models = None
    if app.settings.is_dev:
        models = {t: "/".join(app.cfg.default_for(t)) for t in ("chat", "tagging", "style")}
    return {"status": "ok", "app_env": app.settings.app_env, "models": models}


class DevSessionReq(BaseModel):
    account: Literal["a", "b"]


@dev_router.post("/dev/session")
async def dev_session(body: DevSessionReq, request: Request):
    """Sign in a seeded test account (decision #6). Router is only mounted in development."""
    app = services(request)
    s = app.settings
    if not s.is_dev:
        raise ApiError("NOT_FOUND", "없는 경로예요.", 404)
    if not s.dev_test_password:
        raise ApiError("DEV_NOT_CONFIGURED", "테스트 계정이 아직 준비되지 않았어요 (scripts/seed.py).", 503)
    r = await app.http.post(f"{s.supabase_url.rstrip('/')}/auth/v1/token", params={"grant_type": "password"},
                            json={"email": DEV_ACCOUNTS[body.account], "password": s.dev_test_password},
                            headers={"apikey": s.supabase_anon_key}, timeout=10.0)
    if r.status_code >= 400:
        raise ApiError("DEV_LOGIN_FAILED", "테스트 계정 로그인에 실패했어요. 시드를 먼저 실행해 주세요.", 400)
    data = r.json()
    return {"access_token": data["access_token"], "refresh_token": data["refresh_token"]}
