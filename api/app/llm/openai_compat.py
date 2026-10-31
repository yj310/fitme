"""OpenAI-format chat completions: OpenAI (BYOK) and NVIDIA free endpoints (development only)."""

from __future__ import annotations

import base64

import httpx

from app.llm.base import Image, LLMError, LLMResult, parse_json_text, schema_hint

OPENAI_BASE = "https://api.openai.com/v1"
NVIDIA_BASE = "https://integrate.api.nvidia.com/v1"


class OpenAICompatAdapter:
    def __init__(self, provider: str, http: httpx.AsyncClient, api_key: str, timeout: float = 40.0):
        if provider not in ("openai", "nvidia"):
            raise ValueError(provider)
        self.provider = provider
        self.base = OPENAI_BASE if provider == "openai" else NVIDIA_BASE
        self.http = http
        self.key = api_key
        self.timeout = timeout

    def _messages(self, system: str, user: str, images: list[Image] | None) -> list[dict]:
        if images:
            content: list[dict] | str = [{"type": "text", "text": user}] + [
                {"type": "image_url",
                 "image_url": {"url": f"data:{i.mime};base64,{base64.b64encode(i.data).decode()}"}}
                for i in images]
        else:
            content = user
        return [{"role": "system", "content": system}, {"role": "user", "content": content}]

    async def generate_json(self, *, model, system, user, schema, images=None, max_tokens=4000) -> LLMResult:
        body: dict = {"model": model, "messages": self._messages(system + "\n\n" + schema_hint(schema), user, images)}
        if self.provider == "openai":
            body["max_completion_tokens"] = max_tokens
            body["response_format"] = {"type": "json_schema",
                                       "json_schema": {"name": "output", "schema": schema, "strict": False}}
        else:
            body["max_tokens"] = max_tokens
            body["temperature"] = 0.3
            body["response_format"] = {"type": "json_object"}
        try:
            data = await self._post(body)
        except LLMError as e:
            if e.kind != "bad_request" or "response_format" not in body:
                raise
            body.pop("response_format")  # some NVIDIA models don't support it; rely on the prompt
            data = await self._post(body)
        try:
            text = data["choices"][0]["message"]["content"] or ""
        except (KeyError, IndexError, TypeError) as e:
            raise LLMError("bad_output", "no choices") from e
        usage = data.get("usage") or {}
        return LLMResult(parse_json_text(text), self.provider, model,
                         usage.get("prompt_tokens", 0), usage.get("completion_tokens", 0))

    async def ping(self, model: str) -> None:
        body = {"model": model, "messages": [{"role": "user", "content": "ping"}]}
        body["max_completion_tokens" if self.provider == "openai" else "max_tokens"] = 8
        await self._post(body)

    async def _post(self, body: dict) -> dict:
        try:
            r = await self.http.post(f"{self.base}/chat/completions", json=body,
                                     headers={"Authorization": f"Bearer {self.key}"}, timeout=self.timeout)
        except httpx.TimeoutException as e:
            raise LLMError("unavailable", "timeout") from e
        except httpx.HTTPError as e:
            raise LLMError("unavailable", type(e).__name__) from e
        if r.status_code == 429:
            kind = "quota" if "insufficient_quota" in r.text else "rate_limit"
            raise LLMError(kind, "429")
        if r.status_code in (401, 403):
            raise LLMError("auth", str(r.status_code))
        if r.status_code >= 500:
            raise LLMError("unavailable", str(r.status_code))
        if r.status_code >= 400:
            raise LLMError("bad_request", str(r.status_code))
        return r.json()
