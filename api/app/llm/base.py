"""Common adapter interface for every LLM provider (spec 10.1).

Adapters expose one operation the app needs: JSON output constrained by a schema,
with optional image input. Prompts are shared across providers.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from typing import Any, Protocol


class LLMError(Exception):
    """kind: auth | rate_limit | quota | bad_output | unavailable | bad_request"""

    def __init__(self, kind: str, detail: str = ""):
        super().__init__(f"{kind}: {detail}")
        self.kind = kind
        self.detail = detail


@dataclass
class Image:
    data: bytes
    mime: str


@dataclass
class LLMResult:
    data: dict[str, Any]
    provider: str
    model: str
    input_tokens: int = 0
    output_tokens: int = 0
    notices: list[dict] = field(default_factory=list)


class Adapter(Protocol):
    provider: str

    async def generate_json(self, *, model: str, system: str, user: str, schema: dict,
                            images: list[Image] | None = None, max_tokens: int = 4000) -> LLMResult: ...

    async def ping(self, model: str) -> None: ...


_FENCE = re.compile(r"^```(?:json)?\s*|\s*```$", re.MULTILINE)


def parse_json_text(text: str) -> dict[str, Any]:
    """Parse model text as a JSON object, tolerating code fences and leading prose."""
    t = _FENCE.sub("", (text or "").strip())
    try:
        v = json.loads(t)
    except json.JSONDecodeError:
        start, end = t.find("{"), t.rfind("}")
        if start < 0 or end <= start:
            raise LLMError("bad_output", "no JSON object in response") from None
        try:
            v = json.loads(t[start:end + 1])
        except json.JSONDecodeError as e:
            raise LLMError("bad_output", "invalid JSON") from e
    if not isinstance(v, dict):
        raise LLMError("bad_output", "JSON is not an object")
    return v


def strict_schema(schema: dict) -> dict:
    """Copy of a JSON schema with additionalProperties:false on objects and numeric/array
    bounds removed (some providers reject them). Bounds are re-checked in code."""
    drop = {"minimum", "maximum", "maxItems", "minItems", "maxLength", "minLength"}

    def walk(node: Any) -> Any:
        if isinstance(node, dict):
            out = {k: walk(v) for k, v in node.items() if k not in drop}
            if out.get("type") == "object":
                out["additionalProperties"] = False
                props = out.get("properties", {})
                out["required"] = list(props)  # strict modes need every property listed
                for k, v in props.items():
                    if k not in (node.get("required") or []):
                        # optional field → allow null so "required" stays honest
                        t = v.get("type")
                        if isinstance(t, str):
                            v["type"] = [t, "null"]
            return out
        if isinstance(node, list):
            return [walk(v) for v in node]
        return node

    return walk(schema)


def schema_hint(schema: dict) -> str:
    return "Return ONLY a JSON object matching this JSON Schema, no prose:\n" + json.dumps(
        schema, ensure_ascii=False)
