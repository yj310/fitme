"""Google Gemini adapter (REST generateContent, JSON schema output)."""

from __future__ import annotations

import base64

import httpx

from app.llm.base import LLMError, LLMResult, parse_json_text

BASE = "https://generativelanguage.googleapis.com/v1beta"


class GeminiAdapter:
    provider = "gemini"

    def __init__(self, http: httpx.AsyncClient, api_key: str, timeout: float = 40.0):
        self.http = http
        self.key = api_key
        self.timeout = timeout

    async def generate_json(self, *, model, system, user, schema, images=None, max_tokens=4000) -> LLMResult:
        parts: list[dict] = [{"text": user}]
        for img in images or []:
            parts.append({"inline_data": {"mime_type": img.mime, "data": base64.b64encode(img.data).decode()}})
        gen: dict = {"responseMimeType": "application/json", "responseJsonSchema": schema,
                     "maxOutputTokens": max_tokens}
        if model.startswith("gemini-3"):
            gen["thinkingConfig"] = {"thinkingLevel": "low"}  # keep latency low (spec 14.1)
        body = {"systemInstruction": {"parts": [{"text": system}]},
                "contents": [{"role": "user", "parts": parts}], "generationConfig": gen}
        data = await self._post(model, body)
        try:
            cand = data["candidates"][0]
            text = "".join(p.get("text", "") for p in cand["content"]["parts"] if not p.get("thought"))
        except (KeyError, IndexError, TypeError) as e:
            raise LLMError("bad_output", "empty candidate") from e
        usage = data.get("usageMetadata", {})
        return LLMResult(parse_json_text(text), self.provider, model,
                         usage.get("promptTokenCount", 0),
                         usage.get("candidatesTokenCount", 0) + usage.get("thoughtsTokenCount", 0))

    async def ping(self, model: str) -> None:
        body = {"contents": [{"role": "user", "parts": [{"text": "ping"}]}],
                "generationConfig": {"maxOutputTokens": 8}}
        await self._post(model, body)

    async def _post(self, model: str, body: dict) -> dict:
        try:
            r = await self.http.post(f"{BASE}/models/{model}:generateContent", json=body,
                                     headers={"x-goog-api-key": self.key}, timeout=self.timeout)
        except httpx.TimeoutException as e:
            raise LLMError("unavailable", "timeout") from e
        except httpx.HTTPError as e:
            raise LLMError("unavailable", type(e).__name__) from e
        if r.status_code == 429:
            raise LLMError("rate_limit", "429")
        if r.status_code in (401, 403) or (r.status_code == 400 and "API_KEY" in r.text):
            raise LLMError("auth", str(r.status_code))
        if r.status_code >= 500:
            raise LLMError("unavailable", str(r.status_code))
        if r.status_code >= 400:
            raise LLMError("bad_request", str(r.status_code))
        return r.json()
