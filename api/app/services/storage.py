"""Supabase Storage: signed upload/download URLs for the private buckets (spec 11.3).

'closet' holds clothing photos, 'board' the pictures attached to 피드백 게시판 posts.
Calls are made with the user's JWT, so storage RLS (own folder only) applies; only the admin
board view signs with the service role (see routers/board.py). Signed URLs are never logged.
"""

from __future__ import annotations

import logging
import uuid

import httpx

from app.errors import ApiError

log = logging.getLogger("fitme.storage")
BUCKET = "closet"


class Storage:
    def __init__(self, http: httpx.AsyncClient, supabase_url: str, apikey: str, bearer: str, user_id: str,
                 bucket: str = BUCKET):
        self.http = http
        self.supabase_url = supabase_url
        self.base = supabase_url.rstrip("/") + "/storage/v1"
        self.apikey, self.bearer = apikey, bearer
        self.headers = {"apikey": apikey, "Authorization": f"Bearer {bearer}"}
        self.user_id = user_id
        self.bucket = bucket

    def for_bucket(self, bucket: str, service_key: str | None = None) -> Storage:
        """Same user, another bucket. `service_key` signs as the service role (admin board view only)."""
        key = service_key or self.bearer
        return Storage(self.http, self.supabase_url, service_key or self.apikey, key, self.user_id, bucket)

    def owns(self, path: str) -> bool:
        parts = path.split("/")
        return len(parts) == 2 and parts[0] == self.user_id and ".." not in path

    def new_path(self, content_type: str) -> str:
        ext = "webp" if content_type == "image/webp" else "jpg"
        return f"{self.user_id}/{uuid.uuid4()}.{ext}"

    async def signed_upload_url(self, path: str) -> str:
        r = await self._post(f"/object/upload/sign/{self.bucket}/{path}", {})
        url = r.get("url") or r.get("signedURL") or ""
        return self.base + url if url.startswith("/") else url

    async def signed_urls(self, paths: list[str], expires_in: int = 3600) -> dict[str, str]:
        paths = [p for p in paths if p]
        if not paths:
            return {}
        rows = await self._post(f"/object/sign/{self.bucket}", {"paths": paths, "expiresIn": expires_in})
        out = {}
        for row in rows or []:
            signed = row.get("signedURL") or row.get("signedUrl")
            if signed and row.get("path"):
                out[row["path"]] = self.base + signed if signed.startswith("/") else signed
        return out

    async def download(self, path: str) -> tuple[bytes, str]:
        try:
            r = await self.http.get(f"{self.base}/object/authenticated/{self.bucket}/{path}", headers=self.headers,
                                    timeout=15.0)
        except httpx.HTTPError as e:
            raise ApiError("STORAGE_UNAVAILABLE", "사진을 불러오지 못했어요.", 503) from e
        if r.status_code >= 400:
            raise ApiError("IMAGE_NOT_FOUND", "사진을 찾을 수 없어요. 다시 올려 주세요.", 404)
        return r.content, r.headers.get("content-type", "image/webp")

    async def remove(self, paths: list[str]) -> None:
        paths = [p for p in paths if p]
        if not paths:
            return
        try:
            await self.http.request("DELETE", f"{self.base}/object/{self.bucket}", json={"prefixes": paths},
                                    headers=self.headers, timeout=15.0)
        except httpx.HTTPError:
            log.warning("storage delete failed for %d paths", len(paths))

    async def _post(self, path: str, body: dict):
        try:
            r = await self.http.post(self.base + path, json=body, headers=self.headers, timeout=10.0)
        except httpx.HTTPError as e:
            raise ApiError("STORAGE_UNAVAILABLE", "사진 저장소에 연결하지 못했어요.", 503) from e
        if r.status_code >= 400:
            log.warning("storage error %s on %s", r.status_code, path.split("/")[1])
            raise ApiError("STORAGE_ERROR", "사진 저장소 요청이 실패했어요.", 502)
        return r.json()
