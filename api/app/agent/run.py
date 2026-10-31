"""Per-run state and side effects for the Styling Agent (one chat turn or one today request)."""

from __future__ import annotations

import time
import uuid
from collections.abc import Callable
from datetime import UTC, date, datetime
from typing import Any

from app.agent import core
from app.config import Settings
from app.domain import rules
from app.domain import taxonomy as tx

TOD_LABEL = {"morning": "아침", "afternoon": "낮", "evening": "저녁", "all": ""}


def eul(word: str) -> str:
    code = ord(word[-1]) - 0xAC00 if word else -1
    return "을" if 0 <= code < 11172 and code % 28 else "를"


def eun(word: str) -> str:
    code = ord(word[-1]) - 0xAC00 if word else -1
    return "은" if 0 <= code < 11172 and code % 28 else "는"


class AgentRun:
    def __init__(self, *, store, storage, llm, weather, settings: Settings, emit: Callable[[str, dict], Any],
                 source: str, conversation: dict, message: str = "", preparsed: dict | None = None,
                 recent: list[str] | None = None, current_outfits: list[dict] | None = None,
                 run_id: str | None = None, today: date | None = None, region: tuple[int, int] | None = None,
                 temp_band: str | None = None, schedule: str | None = None):
        self.store, self.storage, self.llm, self.weather_svc = store, storage, llm, weather
        self.settings = settings
        self.emit = emit
        self.source = source
        self.conversation = conversation
        self.state = dict(conversation.get("state") or {})
        self.message = message
        self.preparsed = preparsed
        self.recent = recent or []
        self.run_id = run_id
        self.today = today or core.today_kst()
        self.region = region
        self.temp_band = temp_band
        self.schedule = schedule
        self.started = time.monotonic()

        # current outfits shown to the user → item refs i1.. for parse_request
        self.current_outfits = current_outfits or []
        self.ref_map: dict[str, dict] = {}
        refs = []
        for o in self.current_outfits:
            for it in o["items"]:
                if it["id"] not in {v["id"] for v in self.ref_map.values()}:
                    ref = f"i{len(self.ref_map) + 1}"
                    self.ref_map[ref] = it
                    refs.append({"ref": ref, **it})
        self.current_refs = refs

        self.request: dict = {}
        self.constraints = core.Constraints.from_state(self.state.get("constraints"))
        self.pending_feedback: dict | None = None
        self.feedback_row: dict | None = None
        self.remember: dict | None = None
        self.uc: core.UserContext | None = None
        self.owned_all: list[dict] = []
        self.excl: tuple[set, set, set] = (set(), set(), set())
        self.search: core.Search | None = None
        self.raw: list[dict] = []
        self.valid: list[core.Evaluated] = []
        self.fails: list[str] = []
        self.final: list[core.Evaluated] = []
        self.ask: dict | None = None
        self.gen_summary: str | None = None
        self.llm_provider: str | None = None
        self.llm_model: str | None = None
        self.used_rules_fill = False
        self.debug_reason = ""
        self.weather: dict | None = None
        self.temp: float | None = None
        self.wind: float | None = None
        self.rainy = False
        self.season = rules.season_for(self.today)
        self.steps: list[dict] = []
        self.tool_calls = 0
        self.result: dict = {"message": "", "outfits": None, "ask": None}

    # ── steps (F09) ──
    def step_start(self, tool: str) -> float:
        self.tool_calls += 1
        self.emit("step", {"tool": tool, "summary": "", "status": "running", "ms": 0})
        return time.monotonic()

    def _finish(self, t0: float, tool: str, summary: str, status: str) -> None:
        step = {"tool": tool, "summary": summary, "status": status, "ms": int((time.monotonic() - t0) * 1000)}
        self.steps.append(step)
        self.emit("step", step)

    def step_done(self, t0: float, tool: str, summary: str) -> None:
        self._finish(t0, tool, summary, "done")

    def step_fail(self, t0: float, tool: str, summary: str) -> None:
        self._finish(t0, tool, summary, "failed")

    # ── request ──
    def apply_parsed(self, p: dict) -> None:
        prev = self.state.get("request") or {}
        feedback = p.get("intent") == "feedback"
        if not feedback:
            # New request: keep this conversation's exclusions, reset the rest.
            c = self.constraints
            c.include_item_ids.clear()
            c.include_subcategories.clear()
            c.warmth_delta = c.formality_delta = 0
            c.notes, c.labels, c.style_tags = [], [], []
        base = prev if feedback else {}
        self.request = {
            "date": p.get("date") or base.get("date") or self.today.isoformat(),
            "time_of_day": p.get("time_of_day") or base.get("time_of_day") or "all",
            "occasion": p.get("occasion") or base.get("occasion"),
            "formality": p.get("formality") or base.get("formality"),
            "mood": p.get("mood") or base.get("mood") or [],
            "style_tags": p.get("style_tags") or base.get("style_tags") or [],
        }
        self.request["date"] = max(self.request["date"], self.today.isoformat())
        self.season = rules.season_for(date.fromisoformat(self.request["date"]))
        c = self.constraints
        for ref in p.get("exclude", []):
            if ref["type"] == "subcategory":
                c.exclude_subcategories.add(ref["value"])
                c.include_subcategories.discard(ref["value"])
            elif ref["type"] == "color":
                c.exclude_colors.add(ref["value"])
            elif ref["type"] == "item" and ref["value"] in self.ref_map:
                c.exclude_item_ids.add(self.ref_map[ref["value"]]["id"])
        for ref in p.get("include", []):
            if ref["type"] == "subcategory":
                c.include_subcategories.add(ref["value"])
                c.exclude_subcategories.discard(ref["value"])
            elif ref["type"] == "item" and ref["value"] in self.ref_map:
                c.include_item_ids.add(self.ref_map[ref["value"]]["id"])
        if feedback:
            self.pending_feedback = p.get("feedback") or {"type": "other", "target": None}

    def request_summary(self, p: dict) -> str:
        if p.get("intent") == "feedback":
            fb = p.get("feedback") or {}
            return f"피드백 · {self._feedback_label(fb) or '요청 반영'}"
        d = date.fromisoformat(self.request["date"])
        diff = (d - self.today).days
        day = {0: "오늘", 1: "내일", 2: "모레"}.get(diff, f"{d.month}월 {d.day}일")
        parts = [x for x in (self.request.get("occasion"), f"{day} {TOD_LABEL[self.request['time_of_day']]}".strip()) if x]
        return " · ".join(parts)

    def _target_label(self, target: str | None) -> str:
        if not target:
            return ""
        if target in self.ref_map:
            return self.ref_map[target]["name"]
        return tx.label(target)

    def _feedback_label(self, fb: dict) -> str:
        t, target = fb.get("type"), fb.get("target")
        name = self._target_label(target)
        return {
            "exclude_item": f"{name} 제외", "exclude_subcategory": f"{name} 제외", "exclude_color": f"{name} 제외",
            "include_item": f"{name} 포함", "warmer": "더 따뜻하게", "cooler": "더 시원하게",
            "more_formal": "더 단정하게", "more_casual": "더 편하게", "change_style": "스타일 변경",
            "reroll": "다시 짜기", "other": "요청 반영",
        }.get(t, "요청 반영")

    async def save_feedback(self) -> str:
        fb = self.pending_feedback or {"type": "other", "target": None}
        c = self.constraints
        t, target = fb["type"], fb.get("target")
        real_target = target
        if t == "exclude_item" and target in self.ref_map:
            real_target = self.ref_map[target]["id"]
            c.exclude_item_ids.add(real_target)
        elif t == "exclude_item" and target and target in tx.SUBCATEGORY_TO_CATEGORY:
            t = "exclude_subcategory"
        if t == "exclude_subcategory" and target in tx.SUBCATEGORY_TO_CATEGORY:
            c.exclude_subcategories.add(target)
            c.include_subcategories.discard(target)
        elif t == "exclude_color" and target in tx.COLOR_LABEL:
            c.exclude_colors.add(target)
        elif t == "include_item":
            if target in self.ref_map:
                real_target = self.ref_map[target]["id"]
                c.include_item_ids.add(real_target)
            elif target in tx.SUBCATEGORY_TO_CATEGORY:
                c.include_subcategories.add(target)
        elif t == "warmer":
            c.warmth_delta = min(2, c.warmth_delta + 1)
        elif t == "cooler":
            c.warmth_delta = max(-2, c.warmth_delta - 1)
        elif t == "more_formal":
            c.formality_delta = min(2, c.formality_delta + 1)
        elif t == "more_casual":
            c.formality_delta = max(-2, c.formality_delta - 1)
        elif t == "change_style":
            c.style_tags = self.request.get("style_tags") or c.style_tags
        if self.message and t in ("other", "change_style"):
            c.notes.append(self.message[:120])
        label = self._feedback_label({"type": t, "target": target})
        c.labels = [label]
        outfit_id = self.current_outfits[0]["id"] if self.current_outfits else None
        self.feedback_row = await self.store.insert_feedback({
            "outfit_id": outfit_id, "feedback_type": t, "target": real_target,
            "scope": [self.request["occasion"]] if self.request.get("occasion") else None,
            "is_persistent": False, "comment": (self.message or label)[:300]})
        if t in ("exclude_item", "exclude_subcategory", "exclude_color") and self.source == "chat":
            self.remember = {"feedback_id": self.feedback_row["id"], "label": self._target_label(target)}
        return label

    # ── weather ──
    async def load_weather(self) -> None:
        d = date.fromisoformat(self.request["date"])
        nx, ny = self.region or (self.uc.user.get("grid_nx"), self.uc.user.get("grid_ny"))
        self.weather = await self.weather_svc.summary(nx, ny, d, self.request.get("time_of_day") or "all")
        base_temp = None
        if self.weather.get("available"):
            base_temp, self.wind = self.weather["temp"], self.weather.get("wind")
            self.rainy = self.weather.get("pty") not in (None, "없음") or (self.weather.get("pop") or 0) >= 60
        elif self.temp_band and self.temp_band in tx.TEMP_BANDS:
            base_temp = tx.TEMP_BANDS[self.temp_band]["temp"]
        elif self.source == "today":
            base_temp = 17
        if base_temp is not None:
            self.temp = base_temp - 4 * self.constraints.warmth_delta

    def weather_summary(self) -> str:
        if self.weather and self.weather.get("available"):
            return self.weather["label"]
        if self.temp is not None:
            return f"예보 없음 · {round(self.temp)}° 기준"
        return "예보 없음 · 계절 기준"

    # ── generation input ──
    def formality(self) -> int | None:
        f = self.request.get("formality")
        if f is None and not self.constraints.formality_delta:
            return None
        return max(1, min(3, (f or 2) + self.constraints.formality_delta))

    def generation_payload(self) -> dict:
        s = self.search
        a = self.uc.attrs
        ids, subs, colors = self.excl
        w = self.weather if self.weather and self.weather.get("available") else None
        avoid = []
        for pair in self.uc.rerolled_pairs:
            shorts = [s.alias.get(x) for x in pair]
            if all(shorts):
                avoid.append(shorts)
        return {
            "situation": {"occasion": self.request.get("occasion"), "formality": self.formality(),
                          "mood": self.request.get("mood", []), "schedule": self.schedule,
                          "date": self.request["date"], "time_of_day": self.request.get("time_of_day")},
            "weather": ({"temp": self.temp, "min": w.get("min"), "max": w.get("max"), "pty": w.get("pty"),
                         "wind": w.get("wind")} if w else {"temp": self.temp}),
            "weather_rule": core.weather_rule(self.temp, self.wind),
            "style": {"name": (self.uc.style or {}).get("style_name"),
                      "tags": [tx.STYLE_LABEL.get(t, t) for t in set(a.get("style_tags", []))
                               | set(self.request.get("style_tags", [])) | set(self.constraints.style_tags)],
                      "colors": [tx.COLOR_LABEL.get(c, c) for c in a.get("preferred_colors", [])],
                      "silhouette": {k: [tx.FIT_LABEL.get(f, f) for f in v]
                                     for k, v in (a.get("silhouette") or {}).items()}},
            # Only trait chips and usual size — never body measurement numbers (spec F01, 10.6).
            "body_traits": [tx.BODY_TRAIT_LABEL.get(b, b) for b in self.uc.user.get("body_traits") or []],
            "exclude": {"subcategories": [tx.SUBCATEGORY_LABEL.get(x, x) for x in subs],
                        "colors": [tx.COLOR_LABEL.get(x, x) for x in colors]},
            "must_include": s.must_include,
            "notes": self.constraints.notes[-3:],
            "previous_failures": self.fails[:8],
            "avoid_combos": avoid[:5],
            "candidates": [core.candidate_view(i, s.alias[i["id"]]) for i in s.candidates],
        }

    def vctx(self) -> rules.ValidationContext:
        ids, subs, colors = self.excl
        s = self.search
        return rules.ValidationContext(owned=s.owned, season=self.season, temp=self.temp, wind=self.wind,
                                       exclude_item_ids=ids, exclude_subcategories=subs, exclude_colors=colors,
                                       alias=lambda real: s.alias.get(real, "x"))

    def sctx(self) -> rules.ScoreContext:
        a = self.uc.attrs
        sil = a.get("silhouette") or {}
        return rules.ScoreContext(
            style_tags=set(a.get("style_tags", [])) | set(self.request.get("style_tags", []))
            | set(self.constraints.style_tags),
            preferred_colors=set(a.get("preferred_colors", [])), request_formality=self.formality(),
            temp=self.temp, wind=self.wind, rainy=self.rainy, preferred_fit=self.uc.user.get("preferred_fit"),
            silhouette_top=set(sil.get("top", [])), silhouette_bottom=set(sil.get("bottom", [])),
            favorite_item_ids=self.uc.favorite_item_ids, favorite_colors=self.uc.favorite_colors,
            rerolled_pairs=self.uc.rerolled_pairs)

    # ── responses ──
    def _message_text(self, n: int, missing: list[dict]) -> str:
        fb = self.feedback_row
        if fb:
            t = fb["feedback_type"]
            name = self._target_label(self.pending_feedback.get("target") if self.pending_feedback else None)
            if t.startswith("exclude") and name:
                head = f"{name}{eul(name)} 빼고 다시 짰어요."
            elif t == "warmer":
                head = "더 따뜻하게 다시 짰어요."
            elif t == "cooler":
                head = "더 가볍게 다시 짰어요."
            elif t == "reroll":
                head = "다른 조합으로 다시 짰어요."
            else:
                head = "말씀하신 대로 다시 짰어요."
        else:
            name = (self.uc.style or {}).get("style_name")
            head = f"{name}로 {n}개 골랐어요." if name else f"코디 {n}개 골랐어요."
        text = head + (" " + self.gen_summary if self.gen_summary and not self.used_rules_fill else "")
        if missing:
            cats = ", ".join(tx.CATEGORY_LABEL[m["category"]] for m in missing)
            text += f" 옷장에 {cats}이(가) 부족해서 {n}개만 만들었어요."
        return text.strip()

    async def respond(self) -> None:
        version = int(self.state.get("version", 0)) + 1
        label = self.constraints.labels[-1] if (self.feedback_row and self.constraints.labels) else None
        occasion = self.request.get("occasion")
        title = f"{occasion} 코디" if occasion else ("오늘의 코디" if self.source == "today" else "추천 코디")
        weather_snap = self.weather if self.weather and self.weather.get("available") else None
        saved = []
        for rank, e in enumerate(self.final, start=1):
            row = {"run_id": self.run_id, "conversation_id": self.conversation["id"],
                   "style_profile_id": (self.uc.style or {}).get("id"), "occasion": occasion,
                   "target_date": self.request["date"], "title": e.title or core.rule_title(e.items),
                   "reasons": e.reasons[:3] or core.rule_reasons(e.items, self.vctx()), "score": e.score,
                   "score_detail": e.detail, "weather_snapshot": weather_snap, "version": version, "rank": rank,
                   "label": label, "source": self.source}
            o = await self.store.insert_outfit(row, [(i["id"], i["category"]) for i in e.items])
            o["outfit_items"] = [{"role": i["category"], "clothing_item_id": i["id"], "clothing_items": i}
                                 for i in e.items]
            saved.append(o)
        cards = await core.outfit_cards(saved, self.storage)
        missing = rules.missing_categories(self.owned_all) if len(saved) < 3 else []
        text = self._message_text(len(saved), missing)
        event = {"version": version, "label": label, "occasion": occasion, "title": title, "outfits": cards,
                 "missing": missing}
        self.emit("message", {"delta": text})
        self.emit("outfits", event)
        self.result.update(message=text, outfits=event)
        if self.remember:
            what = self.remember["label"]
            where = f"{occasion} 코디에서 " if occasion else "코디에서 "
            ask = {"ask_id": self.remember["feedback_id"], "kind": "remember",
                   "question": f"앞으로 {where}{what}{eun(what)} 빼둘까요?",
                   "options": [{"label": "네, 기억해줘", "value": "persist"}, {"label": "이번만", "value": "once"}]}
            self.emit("ask", ask)
            self.result["ask"] = ask
        self.state.update(request=self.request, constraints=self.constraints.to_state(), version=version,
                          current_outfit_ids=[o["id"] for o in saved], title=title)
        await self.store.update_conversation(self.conversation["id"], {"state": self.state, "title": title})

    async def respond_ask(self) -> None:
        ask = self.ask or {"question": "조건을 다시 알려 주세요.", "options": []}
        out = {"ask_id": str(uuid.uuid4()), "kind": "clarify", "question": ask["question"],
               "options": [{"label": o, "value": o} for o in ask.get("options", [])]}
        self.emit("message", {"delta": ask["question"]})
        self.emit("ask", out)
        self.result.update(message=ask["question"], ask=out)
        if self.request:
            self.state.update(request=self.request, constraints=self.constraints.to_state())
            await self.store.update_conversation(self.conversation["id"], {"state": self.state})

    async def respond_text(self, text: str) -> None:
        self.emit("message", {"delta": text})
        self.result["message"] = text

    def elapsed_ms(self) -> int:
        return int((time.monotonic() - self.started) * 1000)


def now_iso() -> str:
    return datetime.now(UTC).isoformat()
