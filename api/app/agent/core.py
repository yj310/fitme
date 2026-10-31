"""Code-side agent tools: context, search_wardrobe, validate, score, rules fill, outfit cards."""

from __future__ import annotations

import itertools
from collections import Counter
from dataclasses import dataclass, field
from datetime import UTC, date, datetime, timedelta, timezone

from app.config import scoring_weights
from app.db.store import outfit_item_rows
from app.domain import rules
from app.domain import taxonomy as tx

MAX_CANDIDATES = 40


# ───────────────────────── context (get_user_profile / get_style_profile) ─────────────────────────

@dataclass
class UserContext:
    user: dict
    style: dict | None                     # default style profile row
    persistent: list[dict]                 # persistent exclusion feedback rows
    favorite_item_ids: Counter = field(default_factory=Counter)
    favorite_colors: Counter = field(default_factory=Counter)
    rerolled_pairs: set = field(default_factory=set)

    @property
    def attrs(self) -> dict:
        return (self.style or {}).get("attributes") or {}

    def profile_summary(self) -> str:
        fit = tx.label(self.user.get("preferred_fit")) or "선호 핏 없음"
        return f"{fit} 선호"

    def style_summary(self) -> str:
        if not self.style:
            return "추구미 없음"
        a = self.attrs
        bits = [tx.STYLE_LABEL.get(t, t) for t in a.get("style_tags", [])[:2]] + a.get("mood", [])[:1]
        return " · ".join(bits) or self.style["style_name"]


async def load_user_context(store) -> UserContext:
    user = await store.get_user() or {}
    styles = await store.list_styles()
    style = next((s for s in styles if s.get("is_default")), styles[0] if styles else None)
    persistent = await store.list_feedback(persistent=True)
    favs = await store.list_outfits(favorite=True, limit=30)
    fav_ids, fav_colors = Counter(), Counter()
    for o in favs:
        for _, it in outfit_item_rows(o):
            fav_ids[it["id"]] += 1
            fav_colors[it["color"]] += 1
    since = datetime.now(UTC) - timedelta(days=14)
    rerolls = await store.list_feedback(types=["reroll"], since=since)
    pairs = {frozenset(r["target"].split("|")) for r in rerolls if r.get("target") and "|" in r["target"]}
    return UserContext(user, style, persistent, fav_ids, fav_colors, pairs)


# ───────────────────────── constraints ─────────────────────────

@dataclass
class Constraints:
    exclude_item_ids: set[str] = field(default_factory=set)
    exclude_subcategories: set[str] = field(default_factory=set)
    exclude_colors: set[str] = field(default_factory=set)
    include_item_ids: set[str] = field(default_factory=set)
    include_subcategories: set[str] = field(default_factory=set)
    warmth_delta: int = 0
    formality_delta: int = 0
    style_tags: list[str] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)
    labels: list[str] = field(default_factory=list)   # version badge text, e.g. "슬랙스 제외"

    def to_state(self) -> dict:
        return {"exclude_item_ids": sorted(self.exclude_item_ids),
                "exclude_subcategories": sorted(self.exclude_subcategories),
                "exclude_colors": sorted(self.exclude_colors),
                "include_item_ids": sorted(self.include_item_ids),
                "include_subcategories": sorted(self.include_subcategories),
                "warmth_delta": self.warmth_delta, "formality_delta": self.formality_delta,
                "style_tags": self.style_tags, "notes": self.notes[-5:], "labels": self.labels[-3:]}

    @classmethod
    def from_state(cls, s: dict | None) -> Constraints:
        s = s or {}
        return cls(set(s.get("exclude_item_ids", [])), set(s.get("exclude_subcategories", [])),
                   set(s.get("exclude_colors", [])), set(s.get("include_item_ids", [])),
                   set(s.get("include_subcategories", [])), s.get("warmth_delta", 0),
                   s.get("formality_delta", 0), list(s.get("style_tags", [])), list(s.get("notes", [])),
                   list(s.get("labels", [])))


def effective_exclusions(c: Constraints, uc: UserContext, occasion: str | None) -> tuple[set, set, set]:
    """Conversation exclusions + onboarding avoid lists + style avoid + persistent rules for this occasion."""
    ids, subs, colors = set(c.exclude_item_ids), set(c.exclude_subcategories), set(c.exclude_colors)
    subs |= set(uc.user.get("avoid_subcategories") or [])
    colors |= set(uc.user.get("avoid_colors") or [])
    avoid = uc.attrs.get("avoid") or {}
    subs |= set(avoid.get("subcategories") or [])
    colors |= set(avoid.get("colors") or [])
    for f in uc.persistent:
        scope = f.get("scope")
        if scope and occasion not in scope:
            continue  # decision #3: remembered only for the occasion it was said in
        t, target = f["feedback_type"], f.get("target")
        if t == "exclude_item":
            ids.add(target)
        elif t == "exclude_subcategory":
            subs.add(target)
        elif t == "exclude_color":
            colors.add(target)
    # an explicit "include" in this conversation wins over a general avoid list
    subs -= c.include_subcategories
    return ids, subs, colors


# ───────────────────────── search_wardrobe ─────────────────────────

@dataclass
class Search:
    candidates: list[dict]                 # item rows
    alias: dict[str, str]                  # real id → c1
    reverse: dict[str, str]                # c1 → real id
    owned: dict[str, dict]                 # all active items by id (validation)
    must_include: list[str]                # short ids
    missing_include: list[str]             # include subcategories the user doesn't own


def search_wardrobe(items: list[dict], c: Constraints, excl: tuple[set, set, set], season: str,
                    temp: float | None, style_tags: set[str], pref_colors: set[str]) -> Search:
    ids, subs, colors = excl
    owned = {i["id"]: i for i in items if i.get("is_active", True)}
    pool = [i for i in owned.values()
            if i["id"] not in ids and i["subcategory"] not in subs and i["color"] not in colors
            and rules.season_ok(i, season, temp)]
    if temp is not None:
        band = rules.temp_band(temp)
        pool = [i for i in pool if not _way_off(i, band, temp)]

    def rank(i):
        s = len(set(i.get("style_tags") or []) & style_tags) * 2 + (1 if i["color"] in pref_colors else 0)
        if i["id"] in c.include_item_ids or i["subcategory"] in c.include_subcategories:
            s += 10
        return -s

    by_cat: dict[str, list] = {}
    for i in sorted(pool, key=rank):
        by_cat.setdefault(i["category"], []).append(i)
    caps = {"top": 12, "bottom": 10, "dress": 4, "outer": 7, "shoes": 7}
    chosen = [i for cat, lst in by_cat.items() for i in lst[:caps.get(cat, 6)]][:MAX_CANDIDATES]
    alias = {i["id"]: f"c{n + 1}" for n, i in enumerate(chosen)}
    reverse = {v: k for k, v in alias.items()}
    must = [alias[i["id"]] for i in chosen
            if i["id"] in c.include_item_ids or i["subcategory"] in c.include_subcategories]
    owned_subs = {i["subcategory"] for i in owned.values()}
    missing = [s for s in c.include_subcategories if s not in owned_subs]
    return Search(chosen, alias, reverse, owned, must, missing)


def _way_off(i: dict, band: rules.TempBand, temp: float) -> bool:
    if i["category"] in ("top", "dress"):
        return i["warmth"] > band.top[1] + 1
    if i["category"] == "outer":
        return band.outer == "none" and temp >= 26
    return False


def candidate_view(i: dict, short: str) -> dict:
    return {"id": short, "cat": i["category"], "sub": tx.SUBCATEGORY_LABEL.get(i["subcategory"], i["subcategory"]),
            "color": tx.COLOR_LABEL.get(i["color"], i["color"]), "pattern": tx.PATTERN_LABEL.get(i.get("pattern", "solid")),
            "fit": tx.FIT_LABEL.get(i.get("fit", "none"), ""), "warmth": i["warmth"], "formality": i["formality"],
            "styles": [tx.STYLE_LABEL.get(s, s) for s in i.get("style_tags") or []]}


def weather_rule(temp: float | None, wind: float | None) -> str:
    if temp is None:
        return "날씨 정보 없음: 계절에 맞게만 고르세요."
    b = rules.temp_band(temp, wind)
    outer = {"none": "아우터 없음", "light": "가벼운 아우터(warmth 1)는 선택",
             "optional": f"아우터 선택(warmth {b.outer_warmth[0]}–{b.outer_warmth[1]})",
             "required": f"아우터 필수(warmth {b.outer_warmth[0]}–{b.outer_warmth[1]})"}[b.outer]
    return f"{b.label} 구간: 상의 warmth {b.top[0]}–{b.top[1]}, {outer}"


# ───────────────────────── validate + score ─────────────────────────

@dataclass
class Evaluated:
    items: list[dict]
    title: str
    reasons: list[str]
    score: float = 0.0
    detail: dict = field(default_factory=dict)
    by_rules: bool = False


def evaluate(raw: list[dict], s: Search, vctx: rules.ValidationContext) -> tuple[list[Evaluated], list[str]]:
    valid, fails = [], []
    seen = set()
    for o in raw:
        real = [s.reverse.get(x, x) for x in o["items"]]
        f = rules.validate_outfit(real, vctx)
        if s.must_include and not any(x in s.must_include for x in o["items"]):
            f.append("MISSING_REQUIRED_ITEM")
        if f:
            fails.extend(f)
            continue
        key = frozenset(real)
        if key in seen:
            continue
        seen.add(key)
        items = sorted((vctx.owned[r] for r in real), key=lambda i: tx.ROLE_ORDER.index(i["category"]))
        valid.append(Evaluated(items, o.get("title") or "", o.get("reasons") or []))
    return valid, fails


def score_all(cands: list[Evaluated], sctx: rules.ScoreContext) -> list[Evaluated]:
    w = scoring_weights()
    for e in cands:
        e.score, e.detail = rules.score_outfit(e.items, sctx, w)
    return cands


def top3(cands: list[Evaluated]) -> list[Evaluated]:
    picked = rules.pick_top3([(e.score, e.items, e) for e in cands])
    return [p[2] for p in picked]


def max_distinct_mains(s: Search) -> int:
    return len({i["id"] for i in s.candidates if i["category"] in ("top", "dress")})


# ───────────────────────── rules fill (backup when the LLM can't produce enough) ─────────────────────────

def fill_with_rules(s: Search, vctx: rules.ValidationContext, sctx: rules.ScoreContext,
                    have: list[Evaluated], limit: int = 400) -> list[Evaluated]:
    by = {c: [i for i in s.candidates if i["category"] == c] for c in tx.CATEGORIES}
    outers = [None] + by["outer"]
    shoes = by["shoes"] or [None]
    bases = [(t, b) for t in by["top"] for b in by["bottom"]] + [(d, None) for d in by["dress"]]
    seen = {frozenset(i["id"] for i in e.items) for e in have}
    out: list[Evaluated] = []
    w = scoring_weights()
    for (main, bottom), outer, shoe in itertools.islice(itertools.product(bases, outers, shoes), limit):
        items = [x for x in (outer, main, bottom, shoe) if x]
        ids = [i["id"] for i in items]
        if frozenset(ids) in seen or rules.validate_outfit(ids, vctx):
            continue
        if s.must_include and not any(s.alias[i] in s.must_include for i in ids):
            continue
        seen.add(frozenset(ids))
        e = Evaluated(items, rule_title(items), rule_reasons(items, vctx), by_rules=True)
        e.score, e.detail = rules.score_outfit(items, sctx, w)
        out.append(e)
    return out


def rule_title(items: list[dict]) -> str:
    main = [i for i in items if i["category"] in ("top", "dress", "bottom")]
    return " + ".join(tx.item_name(i["color"], i["subcategory"]) for i in main[:2])


def rule_reasons(items: list[dict], vctx: rules.ValidationContext) -> list[str]:
    out = []
    if vctx.temp is not None:
        outer = next((i for i in items if i["category"] == "outer"), None)
        out.append(f"{int(vctx.temp)}° 기준으로 " + (f"{tx.SUBCATEGORY_LABEL[outer['subcategory']]}을 걸쳐 보온"
                                                  if outer else "가볍게 입기 좋은 조합"))
    neutral = all(i["color"] in tx.NEUTRAL_COLORS for i in items)
    out.append("뉴트럴 톤으로 차분하게 맞춘 색 조합" if neutral else "포인트 컬러 하나로 생기를 준 조합")
    return out


# ───────────────────────── outfit cards ─────────────────────────

async def outfit_cards(outfits: list[dict], storage) -> list[dict]:
    paths = [it.get("image_path") for o in outfits for _, it in outfit_item_rows(o)]
    urls = await storage.signed_urls([p for p in paths if p]) if storage else {}
    return [outfit_card(o, urls) for o in outfits]


def outfit_card(o: dict, urls: dict[str, str]) -> dict:
    rows = sorted(outfit_item_rows(o), key=lambda r: tx.ROLE_ORDER.index(r[0]))
    return {
        "id": o["id"], "rank": o.get("rank", 1), "title": o["title"], "score": float(o.get("score") or 0),
        "score_detail": o.get("score_detail") or {}, "reasons": o.get("reasons") or [],
        "is_favorite": bool(o.get("is_favorite")), "occasion": o.get("occasion"),
        "target_date": o.get("target_date"), "version": o.get("version", 1), "source": o.get("source", "chat"),
        "created_at": o.get("created_at"),
        "items": [{"id": it["id"], "role": role, "name": it["name"], "subcategory": it["subcategory"],
                   "color": it["color"], "image_url": urls.get(it.get("image_path") or "")}
                  for role, it in rows],
    }


def today_kst() -> date:
    return datetime.now(timezone(timedelta(hours=9))).date()

