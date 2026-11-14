"""Test doubles: fake LLM adapter, storage, weather, plus a sample wardrobe."""

from __future__ import annotations

import itertools
import json
import re
from datetime import date

from app.domain import taxonomy as tx
from app.llm.base import LLMError, LLMResult


def item(name, cat, sub, color, warmth=2, formality=2, fit=None, styles=("minimal",), seasons=None, pattern="solid"):
    return {"name": name, "category": cat, "subcategory": sub, "color": color, "warmth": warmth,
            "formality": formality, "fit": fit or {"top": "regular", "outer": "regular", "bottom": "straight"}.get(cat, "none"),
            "style_tags": list(styles), "seasons": seasons or ["spring", "fall", "winter"], "pattern": pattern,
            "image_path": None, "tag_source": "manual"}


WARDROBE = [
    item("차콜 가디건", "outer", "cardigan", "charcoal", 2, fit="over"),
    item("베이지 트렌치코트", "outer", "trench_coat", "beige", 2, 3, styles=("french_chic", "classic")),
    item("화이트 셔츠", "top", "shirt", "white", 2, 3, styles=("office", "minimal"), seasons=["spring", "summer", "fall"]),
    item("아이보리 니트", "top", "knit", "ivory", 2, 2, fit="semi_over"),
    item("네이비 니트", "top", "knit", "navy", 2, 2),
    item("그레이 맨투맨", "top", "sweatshirt", "gray", 2, 1, styles=("casual",)),
    item("블랙 긴팔 티셔츠", "top", "tshirt_long", "black", 2, 1, styles=("casual",)),
    item("그레이 슬랙스", "bottom", "slacks", "gray", 2, 3, fit="slim", styles=("office", "minimal")),
    item("블랙 슬랙스", "bottom", "slacks", "black", 2, 3, styles=("office", "minimal")),
    item("진청 데님", "bottom", "denim", "navy", 2, 2, styles=("casual", "minimal")),
    item("연청 와이드 데님", "bottom", "denim", "sky_blue", 2, 1, fit="wide", styles=("casual",)),
    item("블랙 로퍼", "shoes", "loafers", "black", 2, 3),
    item("화이트 스니커즈", "shoes", "sneakers", "white", 2, 1, styles=("casual", "minimal")),
]


class FakeAdapter:
    """Answers parse/generate/tag/style prompts deterministically.

    generate: builds outfits from the candidates respecting composition, and (when `sloppy`)
    also returns one outfit with a made-up id and one with a duplicate category, so validation is exercised.
    """

    def __init__(self, provider="nvidia", fail: str | None = None, sloppy=True, calls=None):
        self.provider = provider
        self.fail = fail
        self.sloppy = sloppy
        self.calls = calls if calls is not None else []

    async def ping(self, model):
        if self.fail:
            raise LLMError(self.fail)

    async def generate_json(self, *, model, system, user, schema, images=None, max_tokens=4000):
        self.calls.append((self.provider, model, system[:40]))
        if self.fail:
            raise LLMError(self.fail, "fake")
        if "request parser" in system:
            data = self._parse(user)
        elif "FITME's stylist" in system:
            data = self._generate(json.loads(user))
        elif "questions about FITME outfit cards" in system:
            data = {"answer": "1번은 니트로 포근하게 골랐어요."}
        elif "tag one clothing photo" in system:
            data = {"category": "top", "subcategory": "knit", "color": "ivory", "pattern": "solid", "fit": "semi_over",
                    "material": "knit", "seasons": ["fall", "winter"], "style_tags": ["minimal"], "formality": 2,
                    "warmth": 2, "confidence": {"category": 0.96, "color": 0.93, "fit": 0.52}}
        else:
            data = {"style_name": "꾸안꾸 캐주얼", "style_tags": ["casual", "minimal"], "preferred_colors": ["white", "navy"],
                    "silhouette": {"top": ["regular"], "bottom": ["straight"]}, "mood": ["편한"],
                    "avoid": {"subcategories": [], "colors": []}}
        return LLMResult(data, self.provider, model, 100, 50)

    def _parse(self, user: str) -> dict:
        msg = re.search(r"<user_message>\n(.*)\n</user_message>", user, re.S).group(1)
        has_current = bool(re.search(r"<current_outfits>\n.+\n</current_outfits>", user, re.S))
        out = {"intent": "new_request", "date": None, "time_of_day": None, "occasion": None, "formality": None,
               "mood": [], "style_tags": [], "include": [], "exclude": [], "feedback": None}
        for occ in tx.OCCASIONS:
            if occ in msg:
                out["occasion"] = occ
        if "내일" in msg:
            from datetime import timedelta

            from app.agent.core import today_kst
            out["date"] = (today_kst() + timedelta(days=1)).isoformat()
            out["time_of_day"] = "evening"
        if "미니멀" in msg:
            out["style_tags"], out["mood"], out["formality"] = ["minimal"], ["미니멀", "힘 뺀"], 2
        if "슬랙스" in msg and ("불편" in msg or "빼" in msg):
            out["exclude"].append({"type": "subcategory", "value": "slacks"})
            if has_current:
                out["intent"] = "feedback"
                out["feedback"] = {"type": "exclude_subcategory", "target": "slacks"}
        if "청바지" in msg:
            out["include"].append({"type": "subcategory", "value": "denim"})
        if "따뜻" in msg and has_current:
            out["intent"], out["feedback"] = "feedback", {"type": "warmer", "target": None}
        num = re.search(r"(\d)번", msg)
        n = int(num.group(1)) if num else None
        if has_current and "마음에" in msg:
            out["intent"], out["feedback"] = "feedback", {"type": "like", "target": None, "outfit": n}
        if has_current and "만 바꿔" in msg:
            part = "shoes" if "신발" in msg else "outer" if "아우터" in msg else "bottom"
            out["intent"], out["feedback"] = "feedback", {"type": "swap", "target": part, "outfit": n}
        if has_current and "다른 거" in msg:
            out["intent"], out["feedback"] = "feedback", {"type": "reroll", "target": None, "outfit": None}
        if has_current and "넣어" in msg and "니트" in msg:
            out["intent"] = "feedback"
            out["include"] = [{"type": "subcategory", "value": "knit"}]
            out["feedback"] = {"type": "include_item", "target": None, "outfit": None}
        if has_current and msg.startswith("왜"):
            out["intent"] = "question"
        if any(w in msg for w in ("안녕", "고마워")):
            out["intent"] = "other"
        return out

    def _generate(self, p: dict) -> dict:
        cands = p["candidates"]
        by = {c: [x for x in cands if x["cat"] == c] for c in tx.CATEGORIES}
        need_outer = "아우터 필수" in p["weather_rule"]
        no_outer = "아우터 없음" in p["weather_rule"]
        must = set(p.get("must_include") or [])
        outfits, used_tops = [], set()
        for top, bottom in itertools.product(by["top"], by["bottom"]):
            if top["id"] in used_tops:
                continue
            if must and not ({top["id"], bottom["id"]} & must):
                continue
            ids = [top["id"], bottom["id"]]
            if by["outer"] and need_outer:
                ids.insert(0, by["outer"][len(outfits) % len(by["outer"])]["id"])
            if by["shoes"]:
                ids.append(by["shoes"][len(outfits) % len(by["shoes"])]["id"])
            outfits.append({"items": ids, "title": f"{top['color']} {top['sub']} + {bottom['sub']}",
                            "reason": ["부드럽고 단정한 톤", "날씨에 맞춘 구성"]})
            used_tops.add(top["id"])
            if len(outfits) == 4:
                break
        if self.sloppy and cands:
            outfits.append({"items": ["c999", cands[0]["id"]], "title": "환각", "reason": ["x"]})
            if len(by["top"]) >= 2 and by["bottom"]:
                outfits.append({"items": [by["top"][0]["id"], by["top"][1]["id"], by["bottom"][0]["id"]],
                                "title": "상의 두 개", "reason": ["x"]})
        if no_outer:
            for o in outfits:
                o["items"] = [i for i in o["items"] if i not in {x["id"] for x in by["outer"]}]
        return {"outfits": outfits, "summary": "1번은 니트로 부드럽게 풀었어요.", "ask": None}


class FakeStorage:
    def __init__(self, user_id):
        self.user_id = user_id
        self.removed = []

    def owns(self, path):
        return path.startswith(self.user_id + "/")

    def new_path(self, ct):
        return f"{self.user_id}/new.webp"

    async def signed_upload_url(self, path):
        return f"https://storage.test/upload/{path}?token=t"

    async def signed_urls(self, paths, expires_in=3600):
        return {p: f"https://storage.test/sign/{p}" for p in paths if p}

    async def download(self, path):
        return b"\x00fake", "image/webp"

    async def remove(self, paths):
        self.removed += paths


class FakeWeather:
    def __init__(self, temp=14, available=True):
        self.temp = temp
        self.available = available
        self.calls = 0

    async def summary(self, nx, ny, target: date, time_of_day="all", now=None):
        self.calls += 1
        if not self.available or nx is None:
            return {"available": False, "date": target.isoformat(), "reason": "UNAVAILABLE"}
        return {"available": True, "date": target.isoformat(), "time_of_day": time_of_day, "temp": self.temp,
                "min": self.temp - 5, "max": self.temp + 3, "sky": "맑음", "pty": "없음", "pop": 0, "wind": 1.5,
                "label": f"내일 저녁 {self.temp}° · 맑음", "base_datetime": "2026-10-31T17:00:00+09:00", "stale": False}
