"""Clothing tag taxonomy (spec ch.9). Loaded from taxonomy.json."""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Any

_PATH = Path(__file__).with_name("taxonomy.json")


@lru_cache
def raw() -> dict[str, Any]:
    return json.loads(_PATH.read_text(encoding="utf-8"))


CATEGORIES = [c["code"] for c in raw()["categories"]]
CATEGORY_LABEL = {c["code"]: c["label"] for c in raw()["categories"]}
SUBCATEGORIES: dict[str, list[str]] = {k: [s["code"] for s in v] for k, v in raw()["subcategories"].items()}
SUBCATEGORY_LABEL = {s["code"]: s["label"] for v in raw()["subcategories"].values() for s in v}
SUBCATEGORY_TO_CATEGORY = {s: cat for cat, subs in SUBCATEGORIES.items() for s in subs}
COLORS = [c["code"] for c in raw()["colors"]]
COLOR_LABEL = {c["code"]: c["label"] for c in raw()["colors"]}
NEUTRAL_COLORS = {c["code"] for c in raw()["colors"] if c["neutral"]}
COLOR_FAMILY = {c["code"]: c["family"] for c in raw()["colors"]}
PATTERNS = [p["code"] for p in raw()["patterns"]]
PATTERN_LABEL = {p["code"]: p["label"] for p in raw()["patterns"]}
SEASONS = [s["code"] for s in raw()["seasons"]]
SEASON_LABEL = {s["code"]: s["label"] for s in raw()["seasons"]}
FITS: dict[str, list[str]] = {k: [f["code"] for f in v] for k, v in raw()["fits"].items()}
FIT_LABEL = {f["code"]: f["label"] for v in raw()["fits"].values() for f in v}
STYLE_TAGS = [s["code"] for s in raw()["style_tags"]]
STYLE_LABEL = {s["code"]: s["label"] for s in raw()["style_tags"]}
MATERIALS = [m["code"] for m in raw()["materials"]]
MATERIAL_LABEL = {m["code"]: m["label"] for m in raw()["materials"]}
BODY_TRAITS = [b["code"] for b in raw()["body_traits"]]
BODY_TRAIT_LABEL = {b["code"]: b["label"] for b in raw()["body_traits"]}
PERSONAL_COLORS = [p["code"] for p in raw()["personal_colors"]]
TOP_SIZES = raw()["top_sizes"]
OCCASIONS: list[str] = raw()["occasions"]
TODAY_MOODS = {m["code"]: m["label"] for m in raw()["today_moods"]}
TEMP_BANDS = {t["code"]: t for t in raw()["temp_bands"]}

ROLE_ORDER = ["outer", "top", "bottom", "dress", "shoes"]

# Korean label → code, for LLM outputs that use labels instead of codes.
_LABEL_TO_CODE: dict[str, str] = {}
for _m in (SUBCATEGORY_LABEL, COLOR_LABEL, PATTERN_LABEL, STYLE_LABEL, MATERIAL_LABEL, CATEGORY_LABEL):
    for _code, _label in _m.items():
        _LABEL_TO_CODE.setdefault(_label.replace(" ", ""), _code)
# Common synonyms people type in chat.
_SYNONYMS = {
    "청바지": "denim", "진": "denim", "데님팬츠": "denim", "슬랙스": "slacks", "정장바지": "slacks",
    "치마": "midi_skirt", "스커트": "midi_skirt", "티": "tshirt_short", "티셔츠": "tshirt_short",
    "반팔": "tshirt_short", "긴팔": "tshirt_long", "후드티": "hoodie", "후디": "hoodie",
    "운동화": "sneakers", "구두": "flats", "플랫": "flats", "코트": "coat", "패딩": "padding",
    "트렌치": "trench_coat", "원피스": "midi_dress", "반바지": "shorts", "청": "denim_blue",
    "회색": "gray", "검정": "black", "검은색": "black", "흰색": "white", "하얀색": "white",
    "남색": "navy", "베이지색": "beige", "갈색": "brown", "빨간색": "red", "분홍": "pink",
    "초록": "green", "노란색": "yellow", "파란색": "blue", "하늘색": "sky_blue",
}


def to_code(value: str | None) -> str | None:
    """Return a taxonomy code for a code or Korean label/synonym, else None."""
    if not value:
        return None
    v = str(value).strip()
    if v in SUBCATEGORY_TO_CATEGORY or v in COLOR_LABEL or v in STYLE_LABEL or v in PATTERN_LABEL:
        return v
    if v in CATEGORY_LABEL or v in MATERIAL_LABEL:
        return v
    key = v.replace(" ", "")
    return _LABEL_TO_CODE.get(key) or _SYNONYMS.get(key)


def label(code: str | None) -> str:
    if not code:
        return ""
    for m in (SUBCATEGORY_LABEL, COLOR_LABEL, CATEGORY_LABEL, STYLE_LABEL, PATTERN_LABEL,
              MATERIAL_LABEL, FIT_LABEL, SEASON_LABEL, BODY_TRAIT_LABEL):
        if code in m:
            return m[code]
    return code


def item_name(color: str, subcategory: str) -> str:
    """Auto name: "색 + 세부 카테고리" (e.g. 차콜 가디건)."""
    return f"{COLOR_LABEL.get(color, color)} {SUBCATEGORY_LABEL.get(subcategory, subcategory)}".strip()


def _clamp_int(v: Any, lo: int, hi: int, default: int) -> int:
    try:
        return max(lo, min(hi, int(v)))
    except (TypeError, ValueError):
        return default


def normalize_tags(tags: dict[str, Any]) -> tuple[dict[str, Any], list[str]]:
    """Coerce a tag dict to taxonomy values. Returns (clean, invalid_fields)."""
    invalid: list[str] = []
    out: dict[str, Any] = {}

    sub = to_code(tags.get("subcategory"))
    cat = tags.get("category")
    cat = cat if cat in CATEGORIES else to_code(cat)
    if sub in SUBCATEGORY_TO_CATEGORY:
        cat = SUBCATEGORY_TO_CATEGORY[sub]  # subcategory decides category
    elif cat in CATEGORIES:
        invalid.append("subcategory")
        sub = SUBCATEGORIES[cat][0]
    else:
        invalid += ["category", "subcategory"]
        cat, sub = "top", "tshirt_short"
    out["category"], out["subcategory"] = cat, sub

    color = to_code(tags.get("color"))
    if color not in COLOR_LABEL:
        invalid.append("color")
        color = "black"
    out["color"] = color

    pattern = to_code(tags.get("pattern")) or tags.get("pattern")
    if pattern not in PATTERNS:
        if tags.get("pattern") is not None:
            invalid.append("pattern")
        pattern = "solid"
    out["pattern"] = pattern

    fit = tags.get("fit")
    allowed_fits = FITS[cat]
    if fit not in allowed_fits:
        if fit not in (None, "none"):
            invalid.append("fit")
        fit =allowed_fits[0] if cat in ("dress", "shoes") else ("regular" if cat in ("top", "outer") else "straight")
    out["fit"] = fit

    material = tags.get("material")
    material = to_code(material) if material else None
    out["material"] = material if material in MATERIALS else None

    seasons = [s for s in (tags.get("seasons") or []) if s in SEASONS]
    if not seasons:
        if tags.get("seasons"):
            invalid.append("seasons")
        seasons = list(SEASONS)
    out["seasons"] = sorted(set(seasons), key=SEASONS.index)

    styles = []
    for s in tags.get("style_tags") or []:
        c = s if s in STYLE_TAGS else to_code(s)
        if c in STYLE_TAGS and c not in styles:
            styles.append(c)
    out["style_tags"] = styles[:3]

    out["formality"] = _clamp_int(tags.get("formality"), 1, 3, 2)
    out["warmth"] = _clamp_int(tags.get("warmth"), 1, 3, 2)
    return out, invalid


def tagging_json_schema() -> dict[str, Any]:
    """JSON schema for tag_clothing_image output (values restricted to taxonomy)."""
    all_fits = sorted({f for v in FITS.values() for f in v})
    conf = {"type": "number", "minimum": 0, "maximum": 1}
    return {
        "type": "object",
        "properties": {
            "category": {"type": "string", "enum": CATEGORIES},
            "subcategory": {"type": "string", "enum": list(SUBCATEGORY_TO_CATEGORY)},
            "color": {"type": "string", "enum": COLORS},
            "pattern": {"type": "string", "enum": PATTERNS},
            "fit": {"type": "string", "enum": all_fits},
            "material": {"type": "string", "enum": MATERIALS},
            "seasons": {"type": "array", "items": {"type": "string", "enum": SEASONS}},
            "style_tags": {"type": "array", "items": {"type": "string", "enum": STYLE_TAGS}, "maxItems": 3},
            "formality": {"type": "integer", "minimum": 1, "maximum": 3},
            "warmth": {"type": "integer", "minimum": 1, "maximum": 3},
            "confidence": {
                "type": "object",
                "properties": {k: conf for k in (
                    "category", "subcategory", "color", "pattern", "fit", "material",
                    "seasons", "style_tags", "formality", "warmth")},
            },
        },
        "required": ["category", "subcategory", "color", "pattern", "fit", "seasons",
                     "style_tags", "formality", "warmth", "confidence"],
    }
