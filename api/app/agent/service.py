"""Entry points that run the Styling Agent: chat (SSE), today (JSON), outfit feedback, ask answers."""

from __future__ import annotations

import asyncio
import json
import logging
from collections.abc import AsyncIterator

from app.agent import core
from app.agent.graph import GRAPH
from app.agent.run import AgentRun
from app.db.store import outfit_item_rows
from app.deps import Ctx, check_agent_quota
from app.domain import taxonomy as tx
from app.errors import ApiError, not_found
from app.services import regions

log = logging.getLogger("fitme.agent")


def sse(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


async def _current_outfits(ctx: Ctx, conversation: dict) -> list[dict]:
    ids = (conversation.get("state") or {}).get("current_outfit_ids") or []
    out = []
    for oid in ids[:3]:
        o = await ctx.store.get_outfit(oid)
        if o:
            out.append(_card_brief(o))
    return out


def _card_brief(o: dict) -> dict:
    """What the agent needs to know about a card on screen (refs, likes, swaps, '왜?')."""
    return {"id": o["id"], "title": o.get("title"), "reasons": o.get("reasons") or [],
            "weather": (o.get("weather_snapshot") or {}).get("label"),
            "items": [{"id": it["id"], "name": it["name"], "subcategory": it["subcategory"],
                       "color": it["color"], "category": it["category"]} for _, it in outfit_item_rows(o)]}


async def _execute(ctx: Ctx, run: AgentRun, source: str, request_text: str) -> None:
    """Run the graph, record agent_runs. Raises ApiError for user-facing failures."""
    route = await ctx.llm.route("chat")
    await check_agent_quota(ctx, route.is_free)
    row = await ctx.store.insert_run({"conversation_id": run.conversation["id"], "source": source,
                                      "request_text": request_text[:500], "llm_provider": route.provider,
                                      "llm_model": route.model, "is_free_tier": route.is_free, "status": "ok"})
    run.run_id = row["id"]
    run.emit("meta", {"conversation_id": run.conversation["id"], "run_id": row["id"]})
    status = "ok"
    try:
        await GRAPH.ainvoke({}, config={"configurable": {"run": run}, "recursion_limit": 40})
        status = "asked" if run.ask else "ok"
    except Exception:
        status = "failed"
        raise
    finally:
        for n in ctx.llm.notices:
            run.emit("notice", {"code": n["code"], "message": n["message"]})
        await ctx.store.update_run(row["id"], {
            "trace": run.steps, "tool_calls": run.tool_calls, "latency_ms": run.elapsed_ms(), "status": status,
            "llm_provider": run.llm_provider or route.provider, "llm_model": run.llm_model or route.model})


# ───────────────────────── chat (SSE) ─────────────────────────

async def chat_stream(ctx: Ctx, conversation_id: str | None, message: str,
                      answer: dict | None) -> AsyncIterator[str]:
    queue: asyncio.Queue = asyncio.Queue()

    def emit(event: str, data: dict) -> None:
        queue.put_nowait((event, data))

    async def work() -> None:
        try:
            await _chat(ctx, conversation_id, message, answer, emit)
        except ApiError as e:
            emit("error", {"code": e.code, "message": e.message})
        except Exception:
            log.exception("chat run failed")
            emit("error", {"code": "INTERNAL", "message": "문제가 생겼어요. 잠시 후 다시 시도해 주세요."})
        finally:
            queue.put_nowait(None)

    task = asyncio.create_task(work())
    try:
        while True:
            item = await queue.get()
            if item is None:
                break
            yield sse(*item)
    finally:
        if not task.done():
            task.cancel()


async def _chat(ctx: Ctx, conversation_id: str | None, message: str, answer: dict | None, emit) -> None:
    message = (message or "").strip()[:1000]
    if not message and not answer:
        raise ApiError("EMPTY_MESSAGE", "메시지를 입력해 주세요.", 400)
    conv = await ctx.store.get_conversation(conversation_id) if conversation_id else None
    if conversation_id and not conv:
        raise not_found("대화")
    if conv is None:
        conv = await ctx.store.create_conversation(message[:30] or "새 대화", "chat")
    await ctx.store.add_message(conv["id"], "user", message, None)

    if answer:
        await _answer_ask(ctx, conv, answer, emit)
        return

    history = await ctx.store.list_messages(conv["id"], limit=20)
    recent = [f"{'사용자' if m['role'] == 'user' else 'FITME'}: {m['content'][:150]}" for m in history[:-1]]
    run = AgentRun(store=ctx.store, storage=ctx.storage, llm=ctx.llm, weather=ctx.app.weather,
                   settings=ctx.settings, emit=emit, source="chat", conversation=conv, message=message,
                   recent=recent, current_outfits=await _current_outfits(ctx, conv))
    await _execute(ctx, run, "chat", message)
    done = {"run_id": run.run_id, "conversation_id": conv["id"], "steps": len(run.steps), "ms": run.elapsed_ms()}
    emit("done", done)
    await ctx.store.add_message(conv["id"], "assistant", run.result["message"], {
        "steps": run.steps, "run": {"steps": len(run.steps), "ms": done["ms"]},
        "outfits": run.result.get("outfits"), "ask": run.result.get("ask")})


async def _answer_ask(ctx: Ctx, conv: dict, answer: dict, emit) -> None:
    fb = await ctx.store.get_feedback(answer.get("ask_id", ""))
    if not fb:
        raise ApiError("ASK_NOT_FOUND", "이미 처리된 질문이에요.", 404)
    target = tx.label(fb.get("target"))
    if fb["feedback_type"] == "exclude_item":
        item = await ctx.store.get_item(fb["target"])
        target = item["name"] if item else "그 옷"
    scope = fb.get("scope")
    if answer.get("value") == "persist":
        same = [f for f in await ctx.store.list_feedback(persistent=True)
                if f["feedback_type"] == fb["feedback_type"] and f.get("target") == fb.get("target")
                and (f.get("scope") or None) == (scope or None)]
        if not same:  # already remembered: don't add a duplicate rule
            await ctx.store.update_feedback(fb["id"], {"is_persistent": True})
        where = f"{scope[0]} 코디에서 " if scope else ""
        text = f"알겠어요. 앞으로 {where}{target}{_eun(target)} 빼둘게요. 내 프로필에서 언제든 바꿀 수 있어요."
    else:
        text = "알겠어요. 이번 대화에서만 빼둘게요."
    emit("message", {"delta": text})
    emit("done", {"run_id": None, "conversation_id": conv["id"], "steps": 0, "ms": 0})
    await ctx.store.add_message(conv["id"], "assistant", text, {"answered": True})
    # mark the original ask as answered so the chips don't show again after reload
    for m in reversed(await ctx.store.list_messages(conv["id"], limit=100)):
        p = m.get("payload") or {}
        if (p.get("ask") or {}).get("ask_id") == fb["id"]:
            await ctx.store.update_message(m["id"], {"payload": {**p, "answered": True}})
            break


def _eun(word: str) -> str:
    code = ord(word[-1]) - 0xAC00 if word else -1
    return "은" if 0 <= code < 11172 and code % 28 else "는"


async def latest_chat(ctx: Ctx) -> dict:
    conv = await ctx.store.latest_conversation("chat")
    if not conv:
        return {"conversation": None, "messages": [], "current": None}
    msgs = await ctx.store.list_messages(conv["id"], limit=100)
    current = None
    # refresh signed image URLs for the latest outfits panel
    ids = (conv.get("state") or {}).get("current_outfit_ids") or []
    if ids:
        outfits = [o for o in [await ctx.store.get_outfit(i) for i in ids] if o]
        cards = await core.outfit_cards(outfits, ctx.storage)
        last = next((m["payload"]["outfits"] for m in reversed(msgs)
                     if (m.get("payload") or {}).get("outfits")), None) or {}
        current = {**last, "outfits": cards}
    return {"conversation": {"id": conv["id"], "title": conv.get("title"), "updated_at": conv.get("updated_at")},
            "messages": [{"id": m["id"], "role": m["role"], "content": m["content"], "created_at": m["created_at"],
                          "payload": _strip_urls(m.get("payload"))} for m in msgs],
            "current": current}


def _strip_urls(payload: dict | None) -> dict | None:
    """Old signed URLs in stored payloads expire; drop them (the panel uses `current`)."""
    if not payload or not payload.get("outfits"):
        return payload
    ev = dict(payload["outfits"])
    ev["outfits"] = [{**o, "items": [{**i, "image_url": None} for i in o.get("items", [])]}
                     for o in ev.get("outfits", [])]
    return {**payload, "outfits": ev}


# ───────────────────────── today (JSON) ─────────────────────────

MOOD_EFFECT = {"neat": {"formality": 2}, "comfy": {"formality": 1}, "dressy": {"formality_delta": 1},
               "warm": {"warmth_delta": 1}}


def _today_parsed(body: dict, today) -> dict:
    moods = [m for m in body.get("moods") or [] if m in MOOD_EFFECT]
    formality = None
    for m in moods:
        formality = MOOD_EFFECT[m].get("formality", formality)
    schedule = (body.get("schedule") or "").strip()[:100]
    occasion = None
    for occ in tx.OCCASIONS:
        if occ in schedule:
            occasion = occ
            break
    return {"intent": "new_request", "date": body.get("date") or today.isoformat(),
            "time_of_day": body.get("time_of_day") or "all", "occasion": occasion or ("일상" if not schedule else None),
            "formality": formality, "mood": [tx.TODAY_MOODS[m] for m in moods], "style_tags": [],
            "include": [], "exclude": [], "feedback": None}


def _region(ctx_user: dict, body: dict) -> tuple[int, int] | None:
    if body.get("region_code"):
        r = regions.by_code(body["region_code"])
        if r:
            return r["nx"], r["ny"]
    if body.get("nx") and body.get("ny"):
        return int(body["nx"]), int(body["ny"])
    if ctx_user.get("grid_nx") and ctx_user.get("grid_ny"):
        return ctx_user["grid_nx"], ctx_user["grid_ny"]
    return None


async def run_today(ctx: Ctx, body: dict) -> dict:
    user = await ctx.store.get_user() or {}
    conv = await ctx.store.create_conversation("오늘의 코디", "today")
    events: list[tuple[str, dict]] = []
    today = core.today_kst()
    parsed = _today_parsed(body, today)
    run = AgentRun(store=ctx.store, storage=ctx.storage, llm=ctx.llm, weather=ctx.app.weather,
                   settings=ctx.settings, emit=lambda e, d: events.append((e, d)), source="today",
                   conversation={**conv, "state": {"kind": "today"}}, preparsed=parsed,
                   region=_region(user, body), temp_band=body.get("temp_band"),
                   schedule=(body.get("schedule") or None))
    for m in body.get("moods") or []:
        eff = MOOD_EFFECT.get(m, {})
        run.constraints.formality_delta += eff.get("formality_delta", 0)
        run.constraints.warmth_delta += eff.get("warmth_delta", 0)
    await _execute(ctx, run, "today", body.get("schedule") or "오늘의 코디")
    run.state.update(kind="today", today_body={k: body.get(k) for k in
                                               ("date", "time_of_day", "region_code", "nx", "ny", "schedule",
                                                "moods", "temp_band")})
    await ctx.store.update_conversation(conv["id"], {"state": run.state})
    return _today_result(run)


def _today_result(run: AgentRun) -> dict:
    ev = run.result.get("outfits") or {}
    weather = run.weather or {"available": False, "date": run.request.get("date"), "reason": "UNAVAILABLE"}
    message = run.result.get("message") or None
    if not (run.weather or {}).get("available") and run.temp is not None and not run.temp_band:
        message = (message or "") + " 예보가 없어 17° 기준으로 골랐어요. 기온 구간을 직접 고를 수 있어요."
    return {"weather": weather, "outfits": ev.get("outfits", []), "missing": ev.get("missing", []),
            "message": message.strip() if message else None, "run_id": run.run_id, "version": ev.get("version"),
            "label": ev.get("label"), "ask": run.result.get("ask"),
            "notice": ({"code": run.llm.notices[0]["code"], "message": run.llm.notices[0]["message"]}
                       if run.llm.notices else None)}


# ───────────────────────── outfit feedback (chips or text) ─────────────────────────

CHIP_FEEDBACK = {"change_top": "exclude_item", "too_plain": "more_accent", "warmer": "warmer", "reroll": "reroll"}


async def outfit_feedback(ctx: Ctx, outfit_id: str, chip: str | None, message: str | None) -> dict:
    outfit = await ctx.store.get_outfit(outfit_id)
    if not outfit:
        raise not_found("코디")
    conv = await ctx.store.get_conversation(outfit["conversation_id"]) if outfit.get("conversation_id") else None
    if not conv:
        conv = await ctx.store.create_conversation(outfit.get("title") or "코디", outfit.get("source") or "today")
    state = conv.get("state") or {}
    body = state.get("today_body") or {}
    user = await ctx.store.get_user() or {}
    items = outfit_item_rows(outfit)
    current = [_card_brief(outfit)]
    events: list = []
    source = outfit.get("source") or "today"
    run = AgentRun(store=ctx.store, storage=ctx.storage, llm=ctx.llm, weather=ctx.app.weather,
                   settings=ctx.settings, emit=lambda e, d: events.append((e, d)), source=source,
                   conversation=conv, message=message or "", current_outfits=current,
                   region=_region(user, body), temp_band=body.get("temp_band"), schedule=body.get("schedule"))
    if chip:
        if chip not in CHIP_FEEDBACK:
            raise ApiError("BAD_CHIP", "알 수 없는 피드백이에요.", 400)
        top = next((it for role, it in items if role in ("top", "dress")), None)
        bottom = next((it for role, it in items if role == "bottom"), None)
        fb_type = CHIP_FEEDBACK[chip]
        target = None
        if chip == "change_top" and top:
            target = next(ref for ref, it in run.ref_map.items() if it["id"] == top["id"])
        if chip == "reroll" and top:
            target = f"{top['id']}|{bottom['id'] if bottom else ''}"
        prev = state.get("request") or {}
        run.preparsed = {"intent": "feedback", "date": prev.get("date"), "time_of_day": prev.get("time_of_day"),
                         "occasion": prev.get("occasion"), "formality": prev.get("formality"),
                         "mood": prev.get("mood") or [], "style_tags": prev.get("style_tags") or [],
                         "include": [], "exclude": [], "feedback": {"type": fb_type, "target": target}}
        if chip == "too_plain":
            run.message = "너무 무난해요. 포인트 컬러나 패턴을 하나 넣어 주세요."
            run.constraints.accent = True
        if chip == "reroll":
            run.constraints.notes.append("방금 조합과 다른 상의·하의 조합으로")
    elif not message:
        raise ApiError("EMPTY_MESSAGE", "피드백 내용을 알려 주세요.", 400)
    await _execute(ctx, run, source, message or chip or "")
    return _today_result(run)

