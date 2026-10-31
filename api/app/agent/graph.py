"""Styling Agent execution graph (LangGraph), spec 7.2.

parse_request → load_context → [save_feedback] → get_weather → search_wardrobe → generate_outfits
→ validate_outfit ─pass→ score_rank → respond
                  ─fail (≤2 retries)→ generate_outfits
                  ─conflict / impossible→ ask_user

Large objects (search results, evaluated outfits) live on the per-run `AgentRun`; the graph state
carries routing fields. Each tool call emits an SSE `step` (F09).
"""

from __future__ import annotations

from typing import TypedDict

from langgraph.graph import END, START, StateGraph

from app.agent import core, llm_tasks
from app.agent.run import AgentRun
from app.domain import rules
from app.domain import taxonomy as tx
from app.errors import ApiError


class GraphState(TypedDict, total=False):
    intent: str
    retries: int
    need: int
    llm_failed: bool
    has_ask: bool
    done: bool


def _run(config) -> AgentRun:
    return config["configurable"]["run"]


# ───────────────────────── nodes ─────────────────────────

async def parse_request(state: GraphState, config) -> GraphState:
    r = _run(config)
    if r.preparsed is not None:  # today screen / chip feedback: no LLM parse
        r.apply_parsed(r.preparsed)
        return {"intent": r.preparsed.get("intent", "new_request")}
    t = r.step_start("parse_request")
    parsed = await llm_tasks.parse_request(r.llm, r.message, r.recent, r.current_refs, r.today)
    r.apply_parsed(parsed)
    r.step_done(t, "parse_request", r.request_summary(parsed))
    return {"intent": parsed["intent"]}


async def load_context(state: GraphState, config) -> GraphState:
    r = _run(config)
    t = r.step_start("get_user_profile")
    r.uc = await core.load_user_context(r.store)
    r.step_done(t, "get_user_profile", r.uc.profile_summary())
    t = r.step_start("get_style_profile")
    r.step_done(t, "get_style_profile", r.uc.style_summary())
    return {}


async def save_feedback(state: GraphState, config) -> GraphState:
    r = _run(config)
    t = r.step_start("save_feedback")
    summary = await r.save_feedback()
    r.step_done(t, "save_feedback", summary)
    return {}


async def get_weather(state: GraphState, config) -> GraphState:
    r = _run(config)
    t = r.step_start("get_weather")
    await r.load_weather()
    r.step_done(t, "get_weather", r.weather_summary())
    return {}


async def search_wardrobe(state: GraphState, config) -> GraphState:
    r = _run(config)
    t = r.step_start("search_wardrobe")
    items = await r.store.list_items(active=True)
    r.owned_all = items
    excl = core.effective_exclusions(r.constraints, r.uc, r.request.get("occasion"))
    r.excl = excl
    style_tags = set(r.uc.attrs.get("style_tags", [])) | set(r.request.get("style_tags", [])) \
        | set(r.constraints.style_tags)
    r.search = core.search_wardrobe(items, r.constraints, excl, r.season, r.temp, style_tags,
                                    set(r.uc.attrs.get("preferred_colors", [])))
    s = r.search
    r.step_done(t, "search_wardrobe", f"{tx.SEASON_LABEL[r.season]} 후보 {len(s.candidates)}벌")

    if s.missing_include:
        sub = s.missing_include[0]
        cat = tx.SUBCATEGORY_TO_CATEGORY[sub]
        alts = sorted({i["subcategory"] for i in s.candidates if i["category"] == cat})[:2]
        r.ask = {"kind": "clarify",
                 "question": f"{tx.SUBCATEGORY_LABEL[sub]}{_eun(tx.SUBCATEGORY_LABEL[sub])} 옷장에 없어요. "
                             + (f"{' 또는 '.join(tx.SUBCATEGORY_LABEL[a] for a in alts)}(으)로 대신할까요?"
                                if alts else "다른 걸로 골라 드릴까요?"),
                 "options": [f"{tx.SUBCATEGORY_LABEL[a]}로 해줘" for a in alts] or ["알아서 골라줘"]}
        return {"has_ask": True}
    has_base = any(i["category"] == "dress" for i in s.candidates) or (
        any(i["category"] == "top" for i in s.candidates) and any(i["category"] == "bottom" for i in s.candidates))
    if not has_base:
        r.ask = {"kind": "clarify", "question": "조건에 맞는 상의·하의 조합이 옷장에 없어요. 옷을 더 등록하거나 "
                 "제외 조건을 줄여 볼까요?", "options": ["제외 조건 풀어줘"]}
        return {"has_ask": True}
    return {"need": min(3, core.max_distinct_mains(s)), "retries": 0, "has_ask": False}


async def generate_outfits(state: GraphState, config) -> GraphState:
    r = _run(config)
    t = r.step_start("generate_outfits")
    try:
        out = await llm_tasks.generate_outfits(r.llm, r.generation_payload(), count=6)
    except ApiError as e:
        if e.status == 429 and e.code == "FREE_QUOTA_EXCEEDED":
            raise
        r.step_fail(t, "generate_outfits", "AI 응답 실패 · 규칙으로 보완")
        return {"llm_failed": True}
    r.raw = out["outfits"]
    r.gen_summary = out.get("summary")
    r.llm_provider, r.llm_model = out["provider"], out["model"]
    if out.get("ask") and not out["outfits"]:
        r.ask = {"kind": "clarify", **out["ask"]}
        r.step_done(t, "generate_outfits", "조건 확인 필요")
        return {"has_ask": True}
    r.step_done(t, "generate_outfits", f"후보 {len(out['outfits'])}개")
    return {"llm_failed": False}


async def validate_outfit(state: GraphState, config) -> GraphState:
    r = _run(config)
    t = r.step_start("validate_outfit")
    valid, fails = core.evaluate(r.raw if not state.get("llm_failed") else [], r.search, r.vctx())
    known = {frozenset(i["id"] for i in e.items) for e in r.valid}
    r.valid += [e for e in valid if frozenset(i["id"] for i in e.items) not in known]
    r.fails = fails
    mains = len({rules.main_piece(e.items) for e in r.valid})
    excluded_hits = sum(1 for f in fails if f.startswith("EXCLUDED"))
    summary = f"통과 {len(valid)}" + (f" · 제외 아이템 {excluded_hits}건 걸러냄" if excluded_hits else "")
    if mains >= state.get("need", 3):
        summary += f" → 상위 {min(3, mains)}"
    elif fails and not state.get("llm_failed"):
        summary += " · 다시 생성"
    r.step_done(t, "validate_outfit", summary)
    return {"retries": state.get("retries", 0)}


def after_validate(state: GraphState, config) -> str:
    r = _run(config)
    mains = len({rules.main_piece(e.items) for e in r.valid})
    if mains >= state.get("need", 3):
        return "score_rank"
    can_retry = (not state.get("llm_failed") and state.get("retries", 0) < r.settings.max_generation_retries
                 and r.tool_calls + 2 <= r.settings.max_tool_calls)
    return "retry" if can_retry else "score_rank"


async def bump_retry(state: GraphState, config) -> GraphState:
    return {"retries": state.get("retries", 0) + 1}


async def score_rank(state: GraphState, config) -> GraphState:
    r = _run(config)
    t = r.step_start("score_outfits")
    sctx = r.sctx()
    cands = core.score_all(r.valid, sctx)
    mains = len({rules.main_piece(e.items) for e in cands})
    if mains < state.get("need", 3):
        cands += core.fill_with_rules(r.search, r.vctx(), sctx, cands)
        r.used_rules_fill = True
    r.final = core.top3(cands)
    if not r.final:
        r.step_fail(t, "score_outfits", "조건에 맞는 조합 없음")
        reason = rules.describe_fails(r.fails[:2]) if r.fails else ""
        r.ask = {"kind": "clarify", "question": "조건을 모두 맞추는 조합을 찾지 못했어요. "
                 + ("기온에 맞는 아우터가 부족해요. " if any("OUTER" in f for f in r.fails) else "")
                 + "조건을 하나 풀어 볼까요?", "options": ["제외 조건 풀어줘", "날씨는 신경 쓰지 마"]}
        r.debug_reason = reason
        return {"has_ask": True}
    r.step_done(t, "score_outfits", f"상위 {len(r.final)}개 · 최고 {round(r.final[0].score)}점")
    return {}


async def respond(state: GraphState, config) -> GraphState:
    await _run(config).respond()
    return {"done": True}


async def ask_user(state: GraphState, config) -> GraphState:
    await _run(config).respond_ask()
    return {"done": True}


async def answer_only(state: GraphState, config) -> GraphState:
    await _run(config).respond_text("저는 내 옷장 안에서 코디를 짜 드려요. '내일 출근룩 짜줘'처럼 날짜와 상황을 말해 주세요.")
    return {"done": True}


def after_parse(state: GraphState, config) -> str:
    r = _run(config)
    if state.get("intent") in ("question", "other") and not r.current_refs:
        return "answer_only"
    return "load_context"


def after_context(state: GraphState, config) -> str:
    return "save_feedback" if _run(config).pending_feedback else "get_weather"


def after_flag(state: GraphState) -> str:
    return "ask_user" if state.get("has_ask") else "next"


def _eun(word: str) -> str:
    """은/는 particle."""
    if not word:
        return "는"
    code = ord(word[-1]) - 0xAC00
    return "은" if 0 <= code < 11172 and code % 28 else "는"


# ───────────────────────── build ─────────────────────────

def build_graph():
    g = StateGraph(GraphState)
    for name, fn in [("parse_request", parse_request), ("load_context", load_context),
                     ("save_feedback", save_feedback), ("get_weather", get_weather),
                     ("search_wardrobe", search_wardrobe), ("generate_outfits", generate_outfits),
                     ("validate_outfit", validate_outfit), ("bump_retry", bump_retry),
                     ("score_rank", score_rank), ("respond", respond), ("ask_user", ask_user),
                     ("answer_only", answer_only)]:
        g.add_node(name, fn)
    g.add_edge(START, "parse_request")
    g.add_conditional_edges("parse_request", after_parse, {"answer_only": "answer_only",
                                                           "load_context": "load_context"})
    g.add_conditional_edges("load_context", after_context, {"save_feedback": "save_feedback",
                                                            "get_weather": "get_weather"})
    g.add_edge("save_feedback", "get_weather")
    g.add_edge("get_weather", "search_wardrobe")
    g.add_conditional_edges("search_wardrobe", after_flag, {"ask_user": "ask_user", "next": "generate_outfits"})
    g.add_conditional_edges("generate_outfits", after_flag, {"ask_user": "ask_user", "next": "validate_outfit"})
    g.add_conditional_edges("validate_outfit", after_validate, {"retry": "bump_retry", "score_rank": "score_rank"})
    g.add_edge("bump_retry", "generate_outfits")
    g.add_conditional_edges("score_rank", after_flag, {"ask_user": "ask_user", "next": "respond"})
    g.add_edge("respond", END)
    g.add_edge("ask_user", END)
    g.add_edge("answer_only", END)
    return g.compile()


GRAPH = build_graph()
