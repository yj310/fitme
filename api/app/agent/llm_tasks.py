"""LLM-backed tools: parse_request, generate_outfits, tag_clothing_image, analyze_style.

Every output is JSON-schema constrained and re-validated in code (spec 7.1, 7.5).
"""

from __future__ import annotations

import json
from datetime import date
from functools import lru_cache
from pathlib import Path
from typing import Any

from app.domain import taxonomy as tx
from app.llm.base import Image, LLMError
from app.llm.router import LLMService

PROMPTS = Path(__file__).with_name("prompts")
WEEKDAYS = ["월요일", "화요일", "수요일", "목요일", "금요일", "토요일", "일요일"]


@lru_cache
def _prompt(name: str) -> str:
    return (PROMPTS / f"{name}.md").read_text(encoding="utf-8")


def _codes(xs) -> str:
    return ", ".join(xs)


# ───────────────────────── parse_request ─────────────────────────

_REF = {"type": "object", "properties": {"type": {"type": "string", "enum": ["subcategory", "item", "color"]},
                                         "value": {"type": "string"}}, "required": ["type", "value"]}
PARSE_SCHEMA = {
    "type": "object",
    "properties": {
        "intent": {"type": "string", "enum": ["new_request", "feedback", "question", "other"]},
        "date": {"type": ["string", "null"]},
        "time_of_day": {"type": ["string", "null"], "enum": ["morning", "afternoon", "evening", "all", None]},
        "occasion": {"type": ["string", "null"]},
        "formality": {"type": ["integer", "null"]},
        "mood": {"type": "array", "items": {"type": "string"}},
        "style_tags": {"type": "array", "items": {"type": "string"}},
        "include": {"type": "array", "items": _REF},
        "exclude": {"type": "array", "items": _REF},
        "feedback": {
            "type": ["object", "null"],
            "properties": {"type": {"type": "string"}, "target": {"type": ["string", "null"]}},
            "required": ["type", "target"],
        },
    },
    "required": ["intent", "date", "time_of_day", "occasion", "formality", "mood", "style_tags",
                 "include", "exclude", "feedback"],
}

FEEDBACK_TYPES = {"exclude_item", "exclude_subcategory", "include_item", "change_style", "warmer", "cooler",
                  "more_formal", "more_casual", "other"}


def _clean_refs(refs: list, item_refs: set[str]) -> list[dict]:
    out = []
    for r in refs or []:
        if not isinstance(r, dict):
            continue
        t, v = r.get("type"), r.get("value")
        if t == "item" and v in item_refs:
            out.append({"type": "item", "value": v})
        elif t in ("subcategory", "color"):
            code = tx.to_code(v)
            if t == "subcategory" and code in tx.SUBCATEGORY_TO_CATEGORY or t == "color" and code in tx.COLOR_LABEL:
                out.append({"type": t, "value": code})
    return out


def normalize_parse(raw: dict, today: date, item_refs: set[str]) -> dict:
    p: dict[str, Any] = {"intent": raw.get("intent") if raw.get("intent") in
                         ("new_request", "feedback", "question", "other") else "new_request"}
    try:
        d = date.fromisoformat(raw["date"]) if raw.get("date") else None
        p["date"] = d.isoformat() if d and d >= today else None
    except (ValueError, TypeError):
        p["date"] = None
    p["time_of_day"] = raw.get("time_of_day") if raw.get("time_of_day") in ("morning", "afternoon", "evening",
                                                                              "all") else None
    occ = (raw.get("occasion") or "").strip()[:20] or None
    p["occasion"] = occ
    f = raw.get("formality")
    p["formality"] = f if isinstance(f, int) and 1 <= f <= 3 else None
    p["mood"] = [str(m)[:12] for m in (raw.get("mood") or [])][:3]
    p["style_tags"] = [c for c in (tx.to_code(s) if s not in tx.STYLE_TAGS else s
                                   for s in raw.get("style_tags") or []) if c in tx.STYLE_TAGS][:3]
    p["include"] = _clean_refs(raw.get("include"), item_refs)
    p["exclude"] = _clean_refs(raw.get("exclude"), item_refs)
    fb = raw.get("feedback")
    if isinstance(fb, dict) and fb.get("type") in FEEDBACK_TYPES:
        target = fb.get("target")
        if target and target not in item_refs:
            target = tx.to_code(target) or target
        p["feedback"] = {"type": fb["type"], "target": target}
    else:
        p["feedback"] = None
    if p["intent"] == "feedback" and not p["feedback"]:
        if p["exclude"]:
            e = p["exclude"][0]
            p["feedback"] = {"type": "exclude_item" if e["type"] == "item" else "exclude_subcategory",
                             "target": e["value"]}
        else:
            p["feedback"] = {"type": "other", "target": None}
    return p


async def parse_request(llm: LLMService, message: str, recent: list[str], current_items: list[dict],
                        today: date) -> dict:
    system = _prompt("parse_request").format(
        today=today.isoformat(), weekday=WEEKDAYS[today.weekday()], occasions=_codes(tx.OCCASIONS),
        style_tags=_codes(tx.STYLE_TAGS), subcategories=_codes(tx.SUBCATEGORY_TO_CATEGORY),
        colors=_codes(tx.COLORS))
    refs = "\n".join(f"{c['ref']}: {c['name']} ({c['subcategory']}, {c['color']})" for c in current_items)
    user = (f"<recent>\n{chr(10).join(recent[-6:])}\n</recent>\n"
            f"<current_outfits>\n{refs}\n</current_outfits>\n"
            f"<user_message>\n{message}\n</user_message>")
    res = await llm.call_json("chat", system=system, user=user, schema=PARSE_SCHEMA, max_tokens=800)
    return normalize_parse(res.data, today, {c["ref"] for c in current_items})


# ───────────────────────── generate_outfits ─────────────────────────

GEN_SCHEMA = {
    "type": "object",
    "properties": {
        "outfits": {"type": "array", "items": {
            "type": "object",
            "properties": {"items": {"type": "array", "items": {"type": "string"}},
                           "title": {"type": "string"},
                           "reason": {"type": "array", "items": {"type": "string"}}},
            "required": ["items", "title", "reason"]}},
        "summary": {"type": ["string", "null"]},
        "ask": {"type": ["object", "null"],
                "properties": {"question": {"type": "string"},
                               "options": {"type": "array", "items": {"type": "string"}}},
                "required": ["question", "options"]},
    },
    "required": ["outfits", "summary", "ask"],
}


def _validate_gen(data: dict) -> None:
    if not isinstance(data.get("outfits"), list):
        raise LLMError("bad_output", "outfits missing")
    for o in data["outfits"]:
        if not isinstance(o, dict) or not isinstance(o.get("items"), list):
            raise LLMError("bad_output", "bad outfit")


async def generate_outfits(llm: LLMService, payload: dict, count: int = 6) -> dict:
    system = _prompt("generate_outfits").format(count=count)
    user = json.dumps(payload, ensure_ascii=False)
    res = await llm.call_json("chat", system=system, user=user, schema=GEN_SCHEMA, max_tokens=3000,
                              validate=_validate_gen)
    data = res.data
    outfits = []
    for o in data.get("outfits", [])[:count]:
        outfits.append({"items": [str(i) for i in o.get("items", [])][:5],
                        "title": str(o.get("title") or "")[:40],
                        "reasons": [str(r)[:80] for r in (o.get("reason") or [])][:3]})
    ask = data.get("ask")
    if ask and isinstance(ask, dict) and ask.get("question"):
        ask = {"question": str(ask["question"])[:200],
               "options": [str(x)[:40] for x in (ask.get("options") or [])][:3]}
    else:
        ask = None
    return {"outfits": outfits, "summary": (data.get("summary") or None), "ask": ask,
            "provider": res.provider, "model": res.model}


# ───────────────────────── tag_clothing_image ─────────────────────────

async def tag_clothing_image(llm: LLMService, image: bytes, mime: str) -> tuple[dict, dict]:
    system = _prompt("tag_clothing").format(
        categories=_codes(tx.CATEGORIES),
        subcategories="; ".join(f"{c}: {_codes(s)}" for c, s in tx.SUBCATEGORIES.items()),
        colors=_codes(tx.COLORS), patterns=_codes(tx.PATTERNS), fit_top=_codes(tx.FITS["top"]),
        fit_bottom=_codes(tx.FITS["bottom"]), materials=_codes(tx.MATERIALS), style_tags=_codes(tx.STYLE_TAGS))
    res = await llm.call_json("tagging", system=system, user="이 옷 사진의 태그를 JSON으로 알려주세요.",
                              schema=tx.tagging_json_schema(), images=[Image(image, mime)], max_tokens=800)
    clean, invalid = tx.normalize_tags(res.data)
    raw_conf = res.data.get("confidence") or {}
    conf = {}
    for k in ("category", "subcategory", "color", "pattern", "fit", "material", "seasons", "style_tags",
              "formality", "warmth"):
        try:
            v = float(raw_conf.get(k, 0.5))
        except (TypeError, ValueError):
            v = 0.5
        conf[k] = 0.3 if k in invalid else max(0.0, min(1.0, round(v, 2)))
    return clean, conf


# ───────────────────────── analyze_style (F04) ─────────────────────────

STYLE_SCHEMA = {
    "type": "object",
    "properties": {
        "style_name": {"type": "string"},
        "style_tags": {"type": "array", "items": {"type": "string", "enum": tx.STYLE_TAGS}},
        "preferred_colors": {"type": "array", "items": {"type": "string", "enum": tx.COLORS}},
        "silhouette": {"type": "object", "properties": {
            "top": {"type": "array", "items": {"type": "string", "enum": tx.FITS["top"]}},
            "bottom": {"type": "array", "items": {"type": "string", "enum": tx.FITS["bottom"]}}},
            "required": ["top", "bottom"]},
        "mood": {"type": "array", "items": {"type": "string"}},
        "avoid": {"type": "object", "properties": {
            "subcategories": {"type": "array", "items": {"type": "string",
                                                          "enum": list(tx.SUBCATEGORY_TO_CATEGORY)}},
            "colors": {"type": "array", "items": {"type": "string", "enum": tx.COLORS}}},
            "required": ["subcategories", "colors"]},
    },
    "required": ["style_name", "style_tags", "preferred_colors", "silhouette", "mood", "avoid"],
}


def clean_attributes(a: dict) -> dict:
    sil = a.get("silhouette") or {}
    avoid = a.get("avoid") or {}
    return {
        "style_tags": [t for t in a.get("style_tags", []) if t in tx.STYLE_TAGS][:3],
        "preferred_colors": [c for c in a.get("preferred_colors", []) if c in tx.COLOR_LABEL][:6],
        "silhouette": {"top": [f for f in sil.get("top", []) if f in tx.FITS["top"]],
                       "bottom": [f for f in sil.get("bottom", []) if f in tx.FITS["bottom"]]},
        "mood": [str(m)[:12] for m in a.get("mood", [])][:3],
        "avoid": {"subcategories": [s for s in avoid.get("subcategories", []) if s in tx.SUBCATEGORY_TO_CATEGORY],
                  "colors": [c for c in avoid.get("colors", []) if c in tx.COLOR_LABEL]},
    }


async def analyze_style(llm: LLMService, text: str) -> tuple[str, dict]:
    system = _prompt("style_profile").format(
        style_tags=_codes(tx.STYLE_TAGS), colors=_codes(tx.COLORS), fit_top=_codes(tx.FITS["top"]),
        fit_bottom=_codes(tx.FITS["bottom"]), subcategories=_codes(tx.SUBCATEGORY_TO_CATEGORY))
    res = await llm.call_json("style", system=system, user=f"<style_text>\n{text}\n</style_text>",
                              schema=STYLE_SCHEMA, max_tokens=800)
    name = str(res.data.get("style_name") or text)[:30]
    return name, clean_attributes(res.data)
