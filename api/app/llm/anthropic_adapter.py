"""Anthropic Claude adapter (official SDK, structured JSON output). Used only with a user's own key."""

from __future__ import annotations

import base64

import anthropic

from app.llm.base import LLMError, LLMResult, parse_json_text, strict_schema


class AnthropicAdapter:
    provider = "anthropic"

    def __init__(self, api_key: str, timeout: float = 40.0):
        # max_retries=0: the LLM service owns retry/fallback policy (spec 10.4).
        self.client = anthropic.AsyncAnthropic(api_key=api_key, timeout=timeout, max_retries=0)

    async def generate_json(self, *, model, system, user, schema, images=None, max_tokens=4000) -> LLMResult:
        content: list[dict] = []
        for img in images or []:
            content.append({"type": "image", "source": {"type": "base64", "media_type": img.mime,
                                                        "data": base64.standard_b64encode(img.data).decode()}})
        content.append({"type": "text", "text": user})
        kwargs = dict(
            model=model, max_tokens=max_tokens, system=system,
            messages=[{"role": "user", "content": content}],
            output_config={"effort": "low",
                           "format": {"type": "json_schema", "schema": strict_schema(schema)}},
        )
        try:
            if model.startswith("claude-sonnet-5-5"):
                # Server-side refusal fallback, enabled by default for Sonnet 5.5.
                resp = await self.client.beta.messages.create(
                    **kwargs, betas=["server-side-fallback-2026-07-01"], fallbacks="default")
            else:
                resp = await self.client.messages.create(**kwargs)
        except anthropic.AuthenticationError as e:
            raise LLMError("auth", "401") from e
        except anthropic.PermissionDeniedError as e:
            raise LLMError("auth", "403") from e
        except anthropic.RateLimitError as e:
            raise LLMError("rate_limit", "429") from e
        except anthropic.BadRequestError as e:
            # Out of credit is reported as a 400 billing error.
            msg = str(getattr(e, "message", "")).lower()
            raise LLMError("quota" if "credit" in msg or "billing" in msg else "bad_request", "400") from e
        except anthropic.APIStatusError as e:
            raise LLMError("unavailable", str(e.status_code)) from e
        except anthropic.APIConnectionError as e:
            raise LLMError("unavailable", "connection") from e

        if resp.stop_reason == "refusal":
            raise LLMError("bad_output", "refusal")
        text = next((b.text for b in resp.content if b.type == "text"), "")
        usage = resp.usage
        return LLMResult(parse_json_text(text), self.provider, model,
                         getattr(usage, "input_tokens", 0) or 0, getattr(usage, "output_tokens", 0) or 0)

    async def ping(self, model: str) -> None:
        await self.generate_json(model=model, system="Reply with JSON.", user='Return {"ok": true}.',
                                 schema={"type": "object", "properties": {"ok": {"type": "boolean"}},
                                         "required": ["ok"]}, max_tokens=64)

