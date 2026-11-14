"""Supabase JWT verification (spec 11.1). The user id comes only from the verified token."""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
from functools import lru_cache

import jwt
from fastapi import Request

from app.config import get_settings
from app.errors import ApiError


@dataclass
class AuthUser:
    id: str
    token: str
    nickname: str | None
    avatar_url: str | None


@lru_cache
def _jwks_client(url: str) -> jwt.PyJWKClient:
    return jwt.PyJWKClient(f"{url.rstrip('/')}/auth/v1/.well-known/jwks.json", cache_keys=True, lifespan=3600)


def _decode(token: str) -> dict:
    s = get_settings()
    issuer = f"{s.supabase_url.rstrip('/')}/auth/v1"
    header = jwt.get_unverified_header(token)
    alg = header.get("alg", "")
    opts = {"require": ["exp", "sub"]}
    if alg == "HS256":
        if not s.supabase_jwt_secret:
            raise jwt.InvalidTokenError("HS256 token but no secret configured")
        key = s.supabase_jwt_secret
    else:
        key = _jwks_client(s.supabase_url).get_signing_key_from_jwt(token).key
    return jwt.decode(token, key, algorithms=["HS256", "RS256", "ES256"], audience="authenticated",
                      issuer=issuer, options=opts)


async def verify_token(token: str) -> dict:
    try:
        return await asyncio.to_thread(_decode, token)
    except (jwt.PyJWTError, ValueError) as e:
        raise ApiError("UNAUTHORIZED", "다시 로그인해 주세요.", 401) from e


async def current_user(request: Request) -> AuthUser:
    h = request.headers.get("authorization", "")
    if not h.lower().startswith("bearer "):
        raise ApiError("UNAUTHORIZED", "로그인이 필요해요.", 401)
    token = h[7:].strip()
    claims = await verify_token(token)
    if claims.get("role") != "authenticated":
        raise ApiError("UNAUTHORIZED", "로그인이 필요해요.", 401)
    meta = claims.get("user_metadata") or {}
    return AuthUser(id=claims["sub"], token=token,
                    nickname=meta.get("nickname") or meta.get("name") or meta.get("full_name"),
                    avatar_url=meta.get("avatar_url") or meta.get("picture"))
