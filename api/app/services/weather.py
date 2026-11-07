"""KMA short-term forecast (기상청 단기예보 getVilageFcst), spec 11.2.

- Lambert conformal conic grid conversion (lat/lon → nx, ny)
- Latest issue time: 02,05,08,11,14,17,20,23 KST, usable ~10 min after
- Cache per (nx, ny, base_datetime) in weather_cache (service role) + in-process
- 5 s timeout; on failure fall back to the previous cached issue, else unavailable
"""

from __future__ import annotations

import logging
import math
from datetime import UTC, date, datetime, timedelta, timezone
from typing import Any

import httpx

from app.db.postgrest import PostgREST, eq

log = logging.getLogger("fitme.weather")
KST = timezone(timedelta(hours=9))
URL = "https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/getVilageFcst"
BASE_HOURS = [2, 5, 8, 11, 14, 17, 20, 23]
FORECAST_DAYS = 5  # today + 4 more days

SKY = {"1": "맑음", "3": "구름많음", "4": "흐림"}
PTY = {"0": "없음", "1": "비", "2": "비/눈", "3": "눈", "4": "소나기"}
TIME_HOURS = {"morning": [7, 8, 9, 10], "afternoon": [12, 13, 14, 15, 16], "evening": [18, 19, 20, 21],
              "all": list(range(9, 19))}
TIME_LABEL = {"morning": "아침", "afternoon": "낮", "evening": "저녁", "all": ""}


# ───────────────────────── grid conversion ─────────────────────────

def latlon_to_grid(lat: float, lon: float) -> tuple[int, int]:
    RE, GRID = 6371.00877, 5.0
    SLAT1, SLAT2, OLON, OLAT, XO, YO = 30.0, 60.0, 126.0, 38.0, 43, 136
    DEG = math.pi / 180.0
    re = RE / GRID
    slat1, slat2, olon, olat = SLAT1 * DEG, SLAT2 * DEG, OLON * DEG, OLAT * DEG
    sn = math.tan(math.pi * 0.25 + slat2 * 0.5) / math.tan(math.pi * 0.25 + slat1 * 0.5)
    sn = math.log(math.cos(slat1) / math.cos(slat2)) / math.log(sn)
    sf = math.tan(math.pi * 0.25 + slat1 * 0.5)
    sf = math.pow(sf, sn) * math.cos(slat1) / sn
    ro = math.tan(math.pi * 0.25 + olat * 0.5)
    ro = re * sf / math.pow(ro, sn)
    ra = math.tan(math.pi * 0.25 + lat * DEG * 0.5)
    ra = re * sf / math.pow(ra, sn)
    theta = lon * DEG - olon
    if theta > math.pi:
        theta -= 2.0 * math.pi
    if theta < -math.pi:
        theta += 2.0 * math.pi
    theta *= sn
    x = math.floor(ra * math.sin(theta) + XO + 0.5)
    y = math.floor(ro - ra * math.cos(theta) + YO + 0.5)
    return int(x), int(y)


# ───────────────────────── issue time ─────────────────────────

def latest_base(now: datetime) -> datetime:
    t = now.astimezone(KST) - timedelta(minutes=10)
    hours = [h for h in BASE_HOURS if h <= t.hour]
    if hours:
        return t.replace(hour=hours[-1], minute=0, second=0, microsecond=0)
    prev = t - timedelta(days=1)
    return prev.replace(hour=23, minute=0, second=0, microsecond=0)


def in_range(target: date, now: datetime) -> bool:
    today = now.astimezone(KST).date()
    return today <= target < today + timedelta(days=FORECAST_DAYS)


# ───────────────────────── parsing ─────────────────────────

def parse_items(items: list[dict]) -> dict[str, dict[str, dict[str, str]]]:
    """→ {"20261101": {"0900": {"TMP": "14", ...}}, ...} plus daily TMN/TMX under "daily"."""
    out: dict[str, Any] = {}
    for it in items:
        d, t = it.get("fcstDate"), it.get("fcstTime")
        cat, val = it.get("category"), it.get("fcstValue")
        if not (d and t and cat):
            continue
        out.setdefault(d, {}).setdefault(t, {})[cat] = val
    return out


def _num(v: Any) -> float | None:
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _rel_day(target: date, now: datetime) -> str:
    diff = (target - now.astimezone(KST).date()).days
    return {0: "오늘", 1: "내일", 2: "모레"}.get(diff, f"{target.month}월 {target.day}일")


def summarize(forecast: dict, target: date, time_of_day: str, now: datetime) -> dict | None:
    day = forecast.get(target.strftime("%Y%m%d"))
    if not day:
        return None
    hours = TIME_HOURS.get(time_of_day, TIME_HOURS["all"])
    slots = [day.get(f"{h:02d}00") for h in hours]
    slots = [s for s in slots if s and "TMP" in s]
    if not slots:  # e.g. today's morning already passed → nearest available hours
        slots = [v for k, v in sorted(day.items()) if "TMP" in v][:4]
    if not slots:
        return None
    temps = [_num(s.get("TMP")) for s in slots if _num(s.get("TMP")) is not None]
    all_temps = [_num(v.get("TMP")) for v in day.values() if _num(v.get("TMP")) is not None]
    tmn = next((_num(v["TMN"]) for v in day.values() if "TMN" in v), None)
    tmx = next((_num(v["TMX"]) for v in day.values() if "TMX" in v), None)
    temp = round(sum(temps) / len(temps)) if temps else None
    rep = slots[len(slots) // 2]
    ptys = [PTY.get(s.get("PTY", "0"), "없음") for s in slots]
    pty = next((p for p in ptys if p != "없음"), "없음")
    pop = max((_num(s.get("POP")) or 0) for s in slots)
    wind = max((_num(s.get("WSD")) or 0) for s in slots)
    sky = SKY.get(rep.get("SKY", "1"), "맑음")
    shown = pty if pty != "없음" else sky
    tlabel = TIME_LABEL.get(time_of_day, "")
    label = f"{_rel_day(target, now)} {tlabel} {temp}° · {shown}".replace("  ", " ")
    return {
        "available": True, "date": target.isoformat(), "time_of_day": time_of_day,
        "temp": temp, "min": tmn if tmn is not None else (min(all_temps) if all_temps else None),
        "max": tmx if tmx is not None else (max(all_temps) if all_temps else None),
        "sky": sky, "pty": pty, "pop": int(pop), "wind": round(wind, 1), "label": label,
    }


# ───────────────────────── client ─────────────────────────

class WeatherService:
    def __init__(self, http: httpx.AsyncClient, service_key: str, admin: PostgREST | None,
                 timeout_s: float = 5.0):
        self.http = http
        self.key = service_key
        self.admin = admin
        self.timeout = timeout_s
        self._mem: dict[tuple[int, int, str], dict] = {}

    async def forecast(self, nx: int, ny: int, now: datetime | None = None) -> tuple[dict, str, bool] | None:
        """→ (forecast, base_iso, stale) or None."""
        now = now or datetime.now(UTC)
        base = latest_base(now)
        key = (nx, ny, base.isoformat())
        if key in self._mem:
            return self._mem[key], base.isoformat(), False
        cached = await self._cache_get(nx, ny, base)
        if cached:
            self._mem[key] = cached
            return cached, base.isoformat(), False
        fresh = await self._fetch(nx, ny, base)
        if fresh:
            self._mem[key] = fresh
            await self._cache_put(nx, ny, base, fresh)
            return fresh, base.isoformat(), False
        prev = await self._cache_latest(nx, ny)
        if prev:
            return prev[0], prev[1], True
        return None

    async def summary(self, nx: int | None, ny: int | None, target: date, time_of_day: str = "all",
                      now: datetime | None = None) -> dict:
        now = now or datetime.now(UTC)
        if nx is None or ny is None:
            return {"available": False, "date": target.isoformat(), "reason": "NO_REGION"}
        if not in_range(target, now):
            return {"available": False, "date": target.isoformat(), "reason": "OUT_OF_RANGE"}
        got = await self.forecast(nx, ny, now)
        if not got:
            return {"available": False, "date": target.isoformat(), "reason": "UNAVAILABLE"}
        fc, base_iso, stale = got
        s = summarize(fc, target, time_of_day, now)
        if not s:
            return {"available": False, "date": target.isoformat(), "reason": "UNAVAILABLE"}
        return {**s, "base_datetime": base_iso, "stale": stale}

    async def _fetch(self, nx: int, ny: int, base: datetime) -> dict | None:
        if not self.key:
            return None
        params = {"serviceKey": self.key, "numOfRows": "2000", "pageNo": "1", "dataType": "JSON",
                  "base_date": base.strftime("%Y%m%d"), "base_time": base.strftime("%H%M"),
                  "nx": str(nx), "ny": str(ny)}
        try:
            r = await self.http.get(URL, params=params, timeout=self.timeout)
            data = r.json()
            header = data["response"]["header"]
            if header.get("resultCode") != "00":
                log.warning("KMA result %s", header.get("resultCode"))
                return None
            items = data["response"]["body"]["items"]["item"]
            return parse_items(items)
        except (httpx.HTTPError, ValueError, KeyError, TypeError) as e:
            # Never log params: they contain the service key.
            log.warning("KMA fetch failed (%s)", type(e).__name__)
            return None

    async def _cache_get(self, nx, ny, base) -> dict | None:
        if not self.admin:
            return None
        try:
            row = await self.admin.select_one("weather_cache", {"grid_nx": eq(nx), "grid_ny": eq(ny),
                                                                "base_datetime": eq(base.isoformat())})
            return row["forecast"] if row else None
        except Exception:  # cache is best-effort
            return None

    async def _cache_latest(self, nx, ny) -> tuple[dict, str] | None:
        mem = sorted((k for k in self._mem if k[0] == nx and k[1] == ny), key=lambda k: k[2])
        if mem:
            return self._mem[mem[-1]], mem[-1][2]
        if not self.admin:
            return None
        try:
            row = await self.admin.select_one("weather_cache", {"grid_nx": eq(nx), "grid_ny": eq(ny),
                                                                "order": "base_datetime.desc"})
            return (row["forecast"], row["base_datetime"]) if row else None
        except Exception:
            return None

    async def _cache_put(self, nx, ny, base, fc) -> None:
        if not self.admin:
            return
        try:
            await self.admin.upsert("weather_cache", {"grid_nx": nx, "grid_ny": ny,
                                                      "base_datetime": base.isoformat(), "forecast": fc},
                                    on_conflict="grid_nx,grid_ny,base_datetime")
        except Exception:
            log.warning("weather cache write failed")
