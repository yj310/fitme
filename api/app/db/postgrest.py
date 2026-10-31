"""Minimal async PostgREST client over httpx.

User-scoped clients send the caller's JWT, so Postgres RLS decides what is visible.
The service client (service role key) is used only where the spec allows it.
"""

from __future__ import annotations

import logging
from typing import Any

import httpx

from app.errors import ApiError

log = logging.getLogger("fitme.db")


class PostgREST:
    def __init__(self, http: httpx.AsyncClient, base_url: str, apikey: str, bearer: str):
        self.http = http
        self.base = base_url.rstrip("/") + "/rest/v1"
        self.headers = {"apikey": apikey, "Authorization": f"Bearer {bearer}"}

    async def _req(self, method: str, table: str, *, params: dict | None = None, json: Any = None,
                   prefer: str | None = None) -> Any:
        headers = dict(self.headers)
        if prefer:
            headers["Prefer"] = prefer
        try:
            r = await self.http.request(method, f"{self.base}/{table}", params=params, json=json,
                                        headers=headers, timeout=10.0)
        except httpx.HTTPError as e:
            log.warning("db request failed: %s %s (%s)", method, table, type(e).__name__)
            raise ApiError("DB_UNAVAILABLE", "데이터를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.", 503) from e
        if r.status_code >= 400:
            # Never log the response body: it may echo user data.
            log.warning("db error %s on %s %s", r.status_code, method, table)
            if r.status_code in (401, 403):
                raise ApiError("FORBIDDEN", "접근 권한이 없어요.", 403)
            raise ApiError("DB_ERROR", "데이터 처리 중 문제가 생겼어요.", 502)
        if r.status_code == 204 or not r.content:
            return None
        return r.json()

    async def select(self, table: str, params: dict[str, str] | None = None) -> list[dict]:
        return await self._req("GET", table, params=params or {}) or []

    async def select_one(self, table: str, params: dict[str, str]) -> dict | None:
        rows = await self.select(table, {**params, "limit": "1"})
        return rows[0] if rows else None

    async def insert(self, table: str, rows: dict | list[dict]) -> list[dict]:
        return await self._req("POST", table, json=rows, prefer="return=representation") or []

    async def upsert(self, table: str, rows: dict | list[dict], on_conflict: str) -> list[dict]:
        return await self._req("POST", table, params={"on_conflict": on_conflict}, json=rows,
                               prefer="return=representation,resolution=merge-duplicates") or []

    async def update(self, table: str, filters: dict[str, str], values: dict) -> list[dict]:
        return await self._req("PATCH", table, params=filters, json=values,
                               prefer="return=representation") or []

    async def delete(self, table: str, filters: dict[str, str]) -> None:
        await self._req("DELETE", table, params=filters)

    async def count(self, table: str, filters: dict[str, str]) -> int:
        headers = dict(self.headers)
        headers["Prefer"] = "count=exact"
        try:
            r = await self.http.request("HEAD", f"{self.base}/{table}", params=filters, headers=headers,
                                        timeout=10.0)
        except httpx.HTTPError as e:
            raise ApiError("DB_UNAVAILABLE", "데이터를 불러오지 못했어요.", 503) from e
        rng = r.headers.get("content-range", "*/0")
        try:
            return int(rng.split("/")[-1])
        except ValueError:
            return 0


def eq(v: Any) -> str:
    return f"eq.{v}"


def in_(values: list[str]) -> str:
    return "in.(" + ",".join(f'"{v}"' for v in values) + ")"
