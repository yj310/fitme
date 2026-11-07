"""Recommendation rules, all in code (spec ch.8).

- validate_outfit: 8.1 hard rules → list of failure codes (empty = pass)
- score_outfit:    8.2 weighted score with per-item breakdown
- color_harmony:   8.3
- temp_band:       8.4
"""

from __future__ import annotations

from collections import Counter
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import date
from typing import Any

from app.domain import taxonomy as tx

Item = dict[str, Any]

# ───────────────────────── seasons ─────────────────────────


def season_for(d: date) -> str:
    m = d.month
    if m in (3, 4, 5):
        return "spring"
    if m in (6, 7, 8):
        return "summer"
    if m in (9, 10, 11):
        return "fall"
    return "winter"


def season_ok(item: Item, season: str, temp: float | None) -> bool:
    seasons = item.get("seasons") or []
    if not seasons or season in seasons or len(seasons) == 4:
        return True
    # Shoulder weeks: a cold fall day may use winter items, a hot spring day summer items.
    if temp is not None:
        if temp <= 8 and "winter" in seasons:
            return True
        if temp >= 23 and "summer" in seasons:
            return True
        if 12 <= temp <= 22 and ({"spring", "fall"} & set(seasons)):
            return True
    return False


# ───────────────────────── temperature bands (8.4) ─────────────────────────


@dataclass(frozen=True)
class TempBand:
    code: str
    label: str
    top: tuple[int, int]              # allowed top warmth range
    outer: str                        # none | light | optional | required
    outer_warmth: tuple[int, int]     # allowed outer warmth when worn


_BANDS: list[tuple[float, TempBand]] = [
    (28, TempBand("t28", "28° 이상", (1, 1), "none", (1, 1))),
    (23, TempBand("t23", "23–27°", (1, 1), "none", (1, 1))),
    (20, TempBand("t20", "20–22°", (1, 2), "light", (1, 1))),
    (17, TempBand("t17", "17–19°", (2, 2), "optional", (1, 2))),
    (12, TempBand("t12", "12–16°", (2, 2), "required", (1, 2))),
    (9, TempBand("t9", "9–11°", (2, 3), "required", (2, 2))),
    (5, TempBand("t5", "5–8°", (3, 3), "required", (2, 3))),
    (-99, TempBand("t4", "4° 이하", (3, 3), "required", (3, 3))),
]


def temp_band(temp: float, wind: float | None = None) -> TempBand:
    idx = next(i for i, (lo, _) in enumerate(_BANDS) if temp >= lo)
    if wind is not None and wind >= 4:
        idx = min(idx + 1, len(_BANDS) - 1)  # windy: treat as one band colder
    return _BANDS[idx][1]


# ───────────────────────── color harmony (8.3) ─────────────────────────


def color_harmony(items: list[Item]) -> float:
    colors = [i["color"] for i in items]
    non_neutral = {c for c in colors if c not in tx.NEUTRAL_COLORS}
    patterned = sum(1 for i in items if i.get("pattern", "solid") != "solid")
    score = 100.0
    if len(non_neutral) >= 3:
        score -= 40
    if patterned >= 2:
        score -= 30
    if len(non_neutral) == 2:
        fams = {tx.COLOR_FAMILY[c] for c in non_neutral}
        if len(fams) > 1:
            score -= 15
    if len({tx.COLOR_FAMILY[c] for c in colors}) == 1:
        score += 10  # tone-on-tone
    return max(0.0, min(100.0, score))


# ───────────────────────── validation (8.1) ─────────────────────────


@dataclass
class ValidationContext:
    owned: dict[str, Item]                    # active items owned by the user, by id
    season: str
    temp: float | None = None
    wind: float | None = None
    exclude_item_ids: set[str] = field(default_factory=set)
    exclude_subcategories: set[str] = field(default_factory=set)
    exclude_colors: set[str] = field(default_factory=set)
    alias: Callable[[str], str] = lambda x: x  # real id → short id for messages

    @property
    def owns_shoes(self) -> bool:
        return any(i["category"] == "shoes" for i in self.owned.values())

    def owns_outer_in(self, lo: int, hi: int) -> bool:
        return any(i["category"] == "outer" and lo <= i["warmth"] <= hi for i in self.owned.values()
                   if i["id"] not in self.exclude_item_ids and i["subcategory"] not in self.exclude_subcategories)


def validate_outfit(item_ids: list[str], ctx: ValidationContext) -> list[str]:
    fails: list[str] = []
    a = ctx.alias
    items: list[Item] = []
    for iid in item_ids:
        it = ctx.owned.get(iid)
        if it is None:
            fails.append(f"UNKNOWN_ITEM:{a(iid)}")  # not owned, archived, or made up
        else:
            items.append(it)
    if len(set(item_ids)) != len(item_ids):
        fails.append("DUPLICATE_ITEM")
    if fails:
        return fails

    cats = Counter(i["category"] for i in items)
    for c, n in cats.items():
        if n > 1:
            fails.append(f"DUPLICATE_CATEGORY:{c}")
    has_top_bottom = cats["top"] == 1 and cats["bottom"] == 1 and cats["dress"] == 0
    has_dress = cats["dress"] == 1 and cats["top"] == 0 and cats["bottom"] == 0
    if not (has_top_bottom or has_dress):
        fails.append("BAD_COMPOSITION")
    if ctx.owns_shoes and cats["shoes"] == 0:
        fails.append("MISSING_SHOES")

    for it in items:
        if it["id"] in ctx.exclude_item_ids:
            fails.append(f"EXCLUDED_ITEM:{a(it['id'])}")
        if it["subcategory"] in ctx.exclude_subcategories:
            fails.append(f"EXCLUDED_SUBCATEGORY:{a(it['id'])}")
        if it["color"] in ctx.exclude_colors:
            fails.append(f"EXCLUDED_COLOR:{a(it['id'])}")
        if not season_ok(it, ctx.season, ctx.temp):
            fails.append(f"SEASON_MISMATCH:{a(it['id'])}")

    if ctx.temp is not None:
        fails += _warmth_fails(items, ctx)
    return fails


def _warmth_fails(items: list[Item], ctx: ValidationContext) -> list[str]:
    band = temp_band(ctx.temp, ctx.wind)
    a = ctx.alias
    fails: list[str] = []
    by = {i["category"]: i for i in items}
    outer = by.get("outer")
    main = by.get("top") or by.get("dress")
    lo, hi = band.top

    if band.outer == "required" and outer is None:
        if ctx.owns_outer_in(*band.outer_warmth) or ctx.owns_outer_in(1, 3):
            fails.append("MISSING_OUTER")
    if band.outer == "none" and outer is not None:
        fails.append(f"OUTER_NOT_NEEDED:{a(outer['id'])}")
    if outer is not None and band.outer != "none":
        olo, ohi = band.outer_warmth
        if outer["warmth"] < olo - 1 or outer["warmth"] > ohi + 1:
            fails.append(f"OUTER_WARMTH:{a(outer['id'])}")
    if main is not None:
        if main["warmth"] < lo - 1 and outer is None:
            fails.append(f"TOO_LIGHT:{a(main['id'])}")       # e.g. short sleeves alone at 5°
        if main["warmth"] > hi + 1:
            fails.append(f"TOO_WARM:{a(main['id'])}")
    bottom = by.get("bottom")
    if bottom is not None and bottom["subcategory"] == "shorts" and ctx.temp < 17:
        fails.append(f"TOO_LIGHT:{a(bottom['id'])}")
    shoes = by.get("shoes")
    if shoes is not None:
        if shoes["subcategory"] in ("sandals", "slippers") and ctx.temp < 17:
            fails.append(f"TOO_LIGHT:{a(shoes['id'])}")
        if shoes["subcategory"] == "boots" and shoes["warmth"] >= 3 and ctx.temp >= 23:
            fails.append(f"TOO_WARM:{a(shoes['id'])}")
    return fails


FAIL_HINTS = {
    "UNKNOWN_ITEM": "후보 목록에 없는 ID를 썼음. 반드시 후보 ID만 사용",
    "DUPLICATE_ITEM": "같은 아이템을 두 번 넣음",
    "DUPLICATE_CATEGORY": "같은 카테고리를 두 개 넣음",
    "BAD_COMPOSITION": "구성은 (상의 1 + 하의 1) 또는 원피스 1",
    "MISSING_SHOES": "신발을 꼭 포함",
    "EXCLUDED_ITEM": "제외된 아이템을 넣음",
    "EXCLUDED_SUBCATEGORY": "제외된 세부 카테고리를 넣음",
    "EXCLUDED_COLOR": "제외된 색을 넣음",
    "SEASON_MISMATCH": "계절에 맞지 않는 아이템",
    "MISSING_OUTER": "기온상 아우터가 필요함",
    "OUTER_NOT_NEEDED": "더운 날씨라 아우터를 빼야 함",
    "OUTER_WARMTH": "아우터 두께가 기온에 맞지 않음",
    "TOO_LIGHT": "기온에 비해 너무 얇음",
    "TOO_WARM": "기온에 비해 너무 두꺼움",
}


def describe_fails(fails: list[str]) -> str:
    parts = []
    for f in fails:
        code, _, arg = f.partition(":")
        parts.append(f"{f} ({FAIL_HINTS.get(code, '')})" if arg else f"{code} ({FAIL_HINTS.get(code, '')})")
    return "; ".join(parts)


# ───────────────────────── scoring (8.2) ─────────────────────────


@dataclass
class ScoreContext:
    style_tags: set[str]
    preferred_colors: set[str]
    request_formality: int | None
    temp: float | None
    wind: float | None
    rainy: bool
    preferred_fit: str | None
    silhouette_top: set[str]
    silhouette_bottom: set[str]
    favorite_item_ids: Counter = field(default_factory=Counter)
    favorite_colors: Counter = field(default_factory=Counter)
    rerolled_pairs: set[frozenset[str]] = field(default_factory=set)
    want_accent: bool = False        # "너무 무난해": prefer one point color or pattern


LIGHT_COLORS = {"white", "ivory", "beige", "sky_blue", "pink", "yellow"}
SHARED_PIECE_PENALTY = 3   # points lost per piece already shown in a higher-ranked card


def _style_score(items: list[Item], ctx: ScoreContext) -> float:
    if not ctx.style_tags and not ctx.preferred_colors:
        base = 60.0
    else:
        tag_ratio = (sum(1 for i in items if set(i.get("style_tags") or []) & ctx.style_tags) / len(items)
                     if ctx.style_tags else 0.5)
        color_ratio = (sum(1 for i in items if i["color"] in ctx.preferred_colors) / len(items)
                       if ctx.preferred_colors else 0.5)
        base = 100 * (0.6 * tag_ratio + 0.4 * color_ratio)
    if ctx.want_accent:  # "너무 무난해": one point color or pattern is what the user asked for
        accent = any(i["color"] not in tx.NEUTRAL_COLORS or i.get("pattern", "solid") != "solid" for i in items)
        base = base + 25 if accent else base - 20
    return max(0.0, min(100.0, base))


def _band_fit(items: list[Item], ctx: ScoreContext) -> float:
    if ctx.temp is None:
        return 0.8
    band = temp_band(ctx.temp, ctx.wind)
    by = {i["category"]: i for i in items}
    checks: list[bool] = []
    main = by.get("top") or by.get("dress")
    if main is not None:
        checks.append(band.top[0] <= main["warmth"] <= band.top[1])
    outer = by.get("outer")
    if band.outer == "required":
        checks.append(outer is not None)
    elif band.outer == "none":
        checks.append(outer is None)
    if outer is not None and band.outer != "none":
        checks.append(band.outer_warmth[0] <= outer["warmth"] <= band.outer_warmth[1])
    return sum(checks) / len(checks) if checks else 1.0


def _weather_fit(items: list[Item], ctx: ScoreContext) -> float:
    if ctx.temp is None:
        return 0.8
    s = 1.0
    by = {i["category"]: i for i in items}
    if ctx.rainy:
        lower = by.get("bottom") or by.get("dress")
        if lower is not None and lower["color"] in LIGHT_COLORS:
            s -= 0.4
        shoes = by.get("shoes")
        if shoes is not None and (shoes["subcategory"] in ("sandals", "slippers", "flats")
                                  or shoes.get("material") == "leather"):
            s -= 0.3
    if ctx.wind is not None and ctx.wind >= 4:
        if by.get("dress") or (by.get("bottom") and by["bottom"]["subcategory"].endswith("skirt")):
            s -= 0.2
        if "outer" not in by:
            s -= 0.2
    return max(0.0, s)


def _situation_score(items: list[Item], ctx: ScoreContext) -> float:
    if ctx.request_formality:
        avg = sum(i["formality"] for i in items) / len(items)
        formal = max(0.0, 1 - abs(avg - ctx.request_formality) / 2)
    else:
        formal = 0.8
    return 100 * (0.35 * formal + 0.5 * _band_fit(items, ctx) + 0.15 * _weather_fit(items, ctx))


def _preference_score(items: list[Item], ctx: ScoreContext) -> float:
    fit_checks: list[bool] = []
    for i in items:
        if i["category"] in ("top", "outer"):
            wanted = set(ctx.silhouette_top)
            if ctx.preferred_fit:
                wanted.add(ctx.preferred_fit)
            if wanted:
                fit_checks.append(i.get("fit") in wanted)
        elif i["category"] == "bottom" and ctx.silhouette_bottom:
            fit_checks.append(i.get("fit") in ctx.silhouette_bottom)
    fit = sum(fit_checks) / len(fit_checks) if fit_checks else 0.5

    if ctx.favorite_item_ids or ctx.favorite_colors:
        top_colors = {c for c, _ in ctx.favorite_colors.most_common(4)}
        hits = sum(1 for i in items if ctx.favorite_item_ids.get(i["id"]) or i["color"] in top_colors)
        fav = hits / len(items)
    else:
        fav = 0.5

    ids = {i["id"] for i in items}
    rerolled = any(pair <= ids for pair in ctx.rerolled_pairs)
    return 100 * (0.5 * fit + 0.3 * fav + 0.2 * (0.0 if rerolled else 1.0))


def score_outfit(items: list[Item], ctx: ScoreContext, weights: dict[str, float]) -> tuple[float, dict]:
    detail = {
        "style": round(_style_score(items, ctx), 1),
        "harmony": round(color_harmony(items), 1),
        "situation": round(_situation_score(items, ctx), 1),
        "preference": round(_preference_score(items, ctx), 1),
    }
    total = sum(weights[k] * detail[k] for k in detail)
    return round(total, 1), detail


def main_piece(items: list[Item]) -> str | None:
    """Top (or dress) id, used for the 'no shared top' diversity rule."""
    for i in items:
        if i["category"] in ("top", "dress"):
            return i["id"]
    return None


def pick_top3(scored: list[tuple[float, list[Item], Any]],
              key: Callable[[list[Item]], Any] = None) -> list[tuple[float, list[Item], Any]]:
    """Best first, never two outfits with the same key (default: same top/dress, 8.2 diversity).
    Each pick also pays a small price for every piece it shares with outfits already picked, so the
    three cards don't all reuse one blazer, one pair of slacks and one pair of loafers."""
    key = key or main_piece
    chosen: list = []
    used: set = set()
    shown: Counter = Counter()
    pool = sorted(scored, key=lambda e: -e[0])
    while pool and len(chosen) < 3:
        best = max((e for e in pool if key(e[1]) not in used),
                   key=lambda e: e[0] - SHARED_PIECE_PENALTY * sum(shown[i["id"]] for i in e[1]), default=None)
        if best is None:
            break
        chosen.append(best)
        used.add(key(best[1]))
        shown.update(i["id"] for i in best[1])
        pool.remove(best)
    return chosen


MIN_RECOMMENDED = {"top": 5, "bottom": 3, "shoes": 2}


def missing_categories(owned: list[Item]) -> list[dict]:
    have = Counter(i["category"] for i in owned)
    out = []
    for cat, need in MIN_RECOMMENDED.items():
        n = have[cat] + (have["dress"] if cat in ("top", "bottom") else 0)
        if n < need:
            out.append({"category": cat, "have": have[cat], "need": need})
    return out
