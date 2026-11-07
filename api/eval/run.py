"""FITME evaluation (spec 15.1–15.2).

    cd api
    uv run python eval/run.py                                  # offline: rules only, no API keys needed
    uv run python eval/run.py --llm live --env development     # real models from config/models.development.yaml
    uv run python eval/run.py --llm live --env production      # production models (weekly check, spec 10.3)
    uv run python eval/run.py --llm live --env production --tagging   # + photo tagging accuracy

Outfit metrics run the real agent graph against an in-memory copy of the sample wardrobe
(supabase/seed/wardrobe.json) with each request's weather. Live mode reads keys from api/.env.
"""

from __future__ import annotations

import argparse
import asyncio
import csv
import json
import os
import sys
import time
from datetime import date
from pathlib import Path

API = Path(__file__).resolve().parents[1]
ROOT = API.parent
sys.path.insert(0, str(API))


class StubWeather:
    def __init__(self):
        self.current: dict = {}

    async def summary(self, nx, ny, target: date, time_of_day="all", now=None):
        w = self.current
        return {"available": True, "date": target.isoformat(), "time_of_day": time_of_day, "temp": w["temp"],
                "min": w["temp"] - 4, "max": w["temp"] + 4, "sky": "흐림" if w["pty"] != "없음" else "맑음",
                "pty": w["pty"], "pop": 80 if w["pty"] != "없음" else 10, "wind": w["wind"],
                "label": f"{w['temp']}° · {w['pty'] if w['pty'] != '없음' else '맑음'}",
                "base_datetime": "eval", "stale": False}


class OfflineAdapter:
    """Rules-only mode: every LLM call 'fails', so the agent uses its code fallbacks."""

    def __init__(self, provider):
        self.provider = provider

    async def generate_json(self, **kw):
        from app.llm.base import LLMError
        raise LLMError("unavailable", "offline eval")

    async def ping(self, model):
        return None


async def run_outfits(args) -> dict:
    import httpx

    from app.agent.graph import GRAPH
    from app.agent.run import AgentRun
    from app.config import get_pricing, get_settings, load_model_config
    from app.db.memory import MemoryStore
    from app.domain import taxonomy as tx
    from app.llm.router import LLMService
    from app.routers.styles import presets

    settings = get_settings()
    cfg = load_model_config(args.env)
    wardrobe = json.loads((ROOT / "supabase/seed/wardrobe.json").read_text(encoding="utf-8"))
    requests = [json.loads(line) for line in (API / "eval/outfits/requests.jsonl").read_text(encoding="utf-8").splitlines()
                if line.strip()]
    if args.limit:
        requests = requests[: args.limit]
    weather = StubWeather()
    rows = []
    async with httpx.AsyncClient(timeout=60) as http:
        for req in requests:
            store = MemoryStore(f"eval-{req['id']}")
            await store.ensure_user("eval", None)
            await store.update_user({"grid_nx": 60, "grid_ny": 127, "preferred_fit": "semi_over"})
            for w in wardrobe:
                clean, _ = tx.normalize_tags(w)
                await store.insert_item({**clean, "name": w["name"]})
            p = next(p for p in presets() if p["key"] == "natural_minimal")
            await store.insert_style({"style_name": p["style_name"], "attributes": p["attributes"], "is_default": True})
            owned = {i["id"] for i in await store.list_items(active=True)}
            factory = None if args.llm == "live" else (lambda r: OfflineAdapter(r.provider))
            llm = LLMService(settings, cfg, get_pricing(), http, store, adapter_factory=factory)
            weather.current = req["weather"]
            conv = await store.create_conversation("eval", "chat")

            async def turn(message, current, store=store, llm=llm, conv=conv, req=req):
                run = AgentRun(store=store, storage=None, llm=llm, weather=weather, settings=settings,
                               emit=lambda e, d: None, source="chat", conversation=await store.get_conversation(conv["id"]),
                               message=message, current_outfits=current)
                t0 = time.monotonic()
                if args.llm != "live":
                    run.preparsed = {"intent": "new_request", "date": None, "time_of_day": None, "occasion": next(
                        (o for o in tx.OCCASIONS if o in message), None), "formality": None, "mood": [], "style_tags": [],
                        "include": [], "exclude": [{"type": "subcategory", "value": s}
                                                   for s in req["forbidden_subcategories"] if not req["followup"]],
                        "feedback": None}
                await GRAPH.ainvoke({}, config={"configurable": {"run": run}, "recursion_limit": 40})
                return run, time.monotonic() - t0

            r1, dt1 = await turn(req["message"], [])
            outs = (r1.result.get("outfits") or {}).get("outfits", [])
            items = [i for o in outs for i in o["items"]]
            row = {"id": req["id"], "n": len(outs), "ids_ok": all(i["id"] in owned for i in items),
                   "rules_fill": r1.used_rules_fill, "retries": sum(1 for s in r1.steps if s["tool"] == "generate_outfits") - 1,
                   "asked": bool(r1.ask), "sec": round(dt1, 1), "forbidden_hits": 0, "followup_sec": None}
            if not req["followup"]:
                row["forbidden_hits"] = sum(1 for i in items if i["subcategory"] in req["forbidden_subcategories"])
            elif args.llm == "live" and outs:
                current = [{"id": o["id"], "items": [{**i, "category": i["role"]} for i in o["items"]]} for o in outs]
                r2, dt2 = await turn(req["followup"], current)
                outs2 = (r2.result.get("outfits") or {}).get("outfits", [])
                items2 = [i for o in outs2 for i in o["items"]]
                row["forbidden_hits"] = sum(1 for i in items2 if i["subcategory"] in req["forbidden_subcategories"])
                row["ids_ok"] = row["ids_ok"] and all(i["id"] in owned for i in items2)
                row["followup_sec"] = round(dt2, 1)
            rows.append(row)
            print(f"  #{req['id']:>2} outfits={row['n']} ids_ok={row['ids_ok']} rules_fill={row['rules_fill']} "
                  f"retries={row['retries']} forbidden={row['forbidden_hits']} {row['sec']}s")
    return summarize(rows, args)


def summarize(rows, args) -> dict:
    n = len(rows)
    llm_success = sum(1 for r in rows if r["n"] == 3 and not r["rules_fill"] and r["retries"] <= 2)
    any_success = sum(1 for r in rows if r["n"] == 3)
    secs = sorted(r["sec"] for r in rows)
    return {
        "requests": n,
        "보유 의류 ID 유효성": f"{100 * sum(r['ids_ok'] for r in rows) / n:.0f}% (기준 100%)",
        "제외 아이템 재추천": f"{sum(r['forbidden_hits'] for r in rows)}건 (기준 0건)",
        "코디 3개 생성 (LLM, 재시도 2회 이내)": f"{100 * llm_success / n:.0f}% (기준 90%)" if args.llm == "live" else "— (offline)",
        "코디 3개 생성 (규칙 보완 포함)": f"{100 * any_success / n:.0f}%",
        "응답 시간 p50 / max": f"{secs[n // 2]}s / {secs[-1]}s (기준 15s)",
    }


async def run_tagging(args) -> dict:
    import httpx

    from app.agent.llm_tasks import tag_clothing_image
    from app.config import get_pricing, get_settings, load_model_config
    from app.db.memory import MemoryStore
    from app.llm.router import LLMService

    settings = get_settings()
    cfg = load_model_config(args.env)
    folder = API / "eval/tagging"
    labels = list(csv.DictReader((folder / "labels.csv").open(encoding="utf-8")))
    store = MemoryStore("eval-tagging")
    cat_ok = color_ok = 0
    async with httpx.AsyncClient(timeout=60) as http:
        llm = LLMService(settings, cfg, get_pricing(), http, store)
        for row in labels:
            data = (folder / row["file"]).read_bytes()
            t0 = time.monotonic()
            tags, conf = await tag_clothing_image(llm, data, "image/webp")
            cat_ok += tags["category"] == row["category"]
            color_ok += tags["color"] == row["color"]
            print(f"  {row['file']}: {tags['category']}/{tags['subcategory']}/{tags['color']} "
                  f"(정답 {row['category']}/{row['subcategory']}/{row['color']}) {time.monotonic() - t0:.1f}s")
    n = len(labels)
    return {"태깅 카테고리 정확도": f"{100 * cat_ok / n:.0f}% (기준 90%)", "태깅 색 정확도": f"{100 * color_ok / n:.0f}% (기준 80%)"}


async def run_parse(args) -> dict:
    """Request understanding: does the parser pull out what the user wants removed? (live LLM)"""
    import httpx

    from app.agent.llm_tasks import exclusion_targets, parse_request
    from app.config import get_pricing, get_settings, load_model_config
    from app.db.memory import MemoryStore
    from app.domain import taxonomy as tx
    from app.llm.router import LLMService

    def expand(xs):
        out = set()
        for x in xs:
            out |= set(tx.GROUPS[x[1:]]) if x.startswith("@") else {x}
        return out

    cases = [json.loads(line) for line in (API / "eval/parse/cases.jsonl").read_text(encoding="utf-8").splitlines()
             if line.strip()]
    current = [{"ref": "i1", "name": "베이지 울 코트", "subcategory": "coat", "color": "beige"},
               {"ref": "i2", "name": "화이트 셔츠", "subcategory": "shirt", "color": "white"},
               {"ref": "i3", "name": "진청 데님", "subcategory": "denim", "color": "denim_blue"},
               {"ref": "i4", "name": "브라운 부츠", "subcategory": "boots", "color": "brown"}]
    ok = 0
    async with httpx.AsyncClient(timeout=60) as http:
        llm = LLMService(get_settings(), load_model_config(args.env), get_pricing(), http, MemoryStore("eval-parse"))
        for c in cases:
            p = await parse_request(llm, c["message"], ["학교 코디 추천해줘"], current, date.today())
            got = exclusion_targets(p)
            want = expand(c["exclude"])
            passed = want <= got and got <= want | expand(c.get("allow", []))
            ok += passed
            print(f"  {'O' if passed else 'X'} {c['id']:2} {c['message']}  → {sorted(got)}"
                  + ("" if passed else f"  (정답 {sorted(want)})"))
    return {"제외 표현 인식": f"{100 * ok / len(cases):.0f}% ({ok}/{len(cases)})"}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--env", choices=["development", "production"], default="development")
    ap.add_argument("--llm", choices=["offline", "live"], default="offline")
    ap.add_argument("--tagging", action="store_true")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--parse", action="store_true", help="only the request-understanding set (needs --llm live)")
    args = ap.parse_args()
    os.environ["APP_ENV"] = args.env
    print(f"FITME eval · env={args.env} · llm={args.llm}")
    if args.parse:
        if args.llm != "live":
            sys.exit("--parse needs --llm live")
        results = asyncio.run(run_parse(args))
        print("\n| 지표 | 결과 |\n|---|---|")
        for k, v in results.items():
            print(f"| {k} | {v} |")
        return
    results = asyncio.run(run_outfits(args))
    if args.tagging:
        if args.llm != "live":
            sys.exit("--tagging needs --llm live")
        results.update(asyncio.run(run_tagging(args)))
    print("\n| 지표 | 결과 |\n|---|---|")
    for k, v in results.items():
        print(f"| {k} | {v} |")


if __name__ == "__main__":
    main()
