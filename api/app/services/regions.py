"""시·도 / 시·군·구 representative coordinates from the official KMA grid table."""

from __future__ import annotations

import json
import math
from functools import lru_cache
from pathlib import Path

_PATH = Path(__file__).resolve().parents[1] / "data" / "regions.json"


@lru_cache
def all_regions() -> list[dict]:
    return json.loads(_PATH.read_text(encoding="utf-8"))["regions"]


def by_code(code: str) -> dict | None:
    return next((r for r in all_regions() if r["code"] == code), None)


def _short(r: dict) -> str:
    sido = (r["sido"].replace("특별자치시", "").replace("특별자치도", "").replace("특별시", "")
            .replace("광역시", "").replace("도", "") if r["sido"] else "")
    return f"{sido} {r['sigungu']}".strip()


def public(r: dict) -> dict:
    return {"code": r["code"], "name": r["name"], "short_name": _short(r), "sido": r["sido"],
            "sigungu": r["sigungu"], "nx": r["nx"], "ny": r["ny"]}


def search(q: str, limit: int = 20) -> list[dict]:
    q = (q or "").replace(" ", "")
    if not q:
        return [public(r) for r in all_regions() if not r["sigungu"]][:limit]
    hits = [r for r in all_regions() if q in r["name"].replace(" ", "") or q in _short(r).replace(" ", "")]
    hits.sort(key=lambda r: (not r["sigungu"], len(r["name"])))
    return [public(r) for r in hits[:limit]]


def nearest(lat: float, lon: float) -> dict:
    def dist(r):
        dlat = math.radians(r["lat"] - lat)
        dlon = math.radians(r["lon"] - lon) * math.cos(math.radians(lat))
        return dlat * dlat + dlon * dlon
    cands = [r for r in all_regions() if r["sigungu"]] or all_regions()
    return public(min(cands, key=dist))
