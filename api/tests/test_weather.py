import asyncio
import json
from datetime import date, datetime

import httpx

from app.services import regions
from app.services.weather import KST, WeatherService, in_range, latest_base, latlon_to_grid, summarize


def test_grid_matches_official_table():
    # Every 시·군·구 coordinate in the KMA table converts to its listed grid (±1 for rounding at cell edges).
    bad = []
    for r in regions.all_regions():
        nx, ny = latlon_to_grid(r["lat"], r["lon"])
        if abs(nx - r["nx"]) > 1 or abs(ny - r["ny"]) > 1:
            bad.append(r["name"])
    assert not bad
    assert latlon_to_grid(37.56071, 126.91053) == (59, 127)  # 서울 마포구


def test_latest_base_time():
    assert latest_base(datetime(2026, 10, 31, 17, 5, tzinfo=KST)).hour == 14   # 17:00 not ready until 17:10
    assert latest_base(datetime(2026, 10, 31, 17, 15, tzinfo=KST)).hour == 17
    b = latest_base(datetime(2026, 11, 1, 1, 0, tzinfo=KST))
    assert (b.day, b.hour) == (31, 23)


def test_forecast_range():
    now = datetime(2026, 10, 31, 12, tzinfo=KST)
    assert in_range(date(2026, 11, 4), now) and not in_range(date(2026, 11, 5), now)
    assert not in_range(date(2026, 10, 30), now)


def _items(d="20261101"):
    out = []
    for h in range(0, 24):
        t = f"{h:02d}00"
        temp = 8 + abs(12 - h) * -0.5 + 10
        for cat, val in (("TMP", str(round(temp))), ("SKY", "1"), ("PTY", "0"), ("POP", "10"), ("WSD", "2.1")):
            out.append({"fcstDate": d, "fcstTime": t, "category": cat, "fcstValue": val})
    out.append({"fcstDate": d, "fcstTime": "0600", "category": "TMN", "fcstValue": "9.0"})
    out.append({"fcstDate": d, "fcstTime": "1500", "category": "TMX", "fcstValue": "17.0"})
    return out


def test_summarize_evening():
    from app.services.weather import parse_items
    fc = parse_items(_items())
    now = datetime(2026, 10, 31, 12, tzinfo=KST)
    s = summarize(fc, date(2026, 11, 1), "evening", now)
    assert s["min"] == 9 and s["max"] == 17 and s["sky"] == "맑음"
    assert s["label"].startswith("내일 저녁") and s["label"].endswith("맑음")


def test_service_falls_back_to_cache_then_unavailable():
    calls = {"n": 0}

    def handler(request):
        calls["n"] += 1
        if calls["n"] == 1:
            body = {"response": {"header": {"resultCode": "00"}, "body": {"items": {"item": _items("20261031")}}}}
            return httpx.Response(200, text=json.dumps(body))
        return httpx.Response(500)

    async def go():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http:
            svc = WeatherService(http, "k", admin=None)
            now1 = datetime(2026, 10, 31, 15, 0, tzinfo=KST)
            first = await svc.summary(60, 127, date(2026, 10, 31), "evening", now1)
            assert first["available"] and not first["stale"]
            again = await svc.summary(60, 127, date(2026, 10, 31), "evening", now1)
            assert calls["n"] == 1 and again["available"]  # cached, no second API call
            later = datetime(2026, 10, 31, 18, 0, tzinfo=KST)  # new issue time, API fails
            stale = await svc.summary(60, 127, date(2026, 10, 31), "evening", later)
            assert stale["available"] and stale["stale"]
            other = await svc.summary(70, 120, date(2026, 10, 31), "all", later)
            assert other == {"available": False, "date": "2026-10-31", "reason": "UNAVAILABLE"}
            far = await svc.summary(60, 127, date(2026, 11, 20), "all", later)
            assert far["reason"] == "OUT_OF_RANGE"

    asyncio.run(go())


def test_region_search():
    assert regions.search("마포")[0]["name"] == "서울특별시 마포구"
    assert regions.nearest(37.56, 126.91)["sigungu"] == "마포구"
