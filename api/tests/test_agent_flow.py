"""End-to-end agent scenarios (acceptance tests 3–8, 10, 11) with a fake LLM and in-memory DB."""

import asyncio

from app.db.memory import MemoryStore
from tests.conftest import USER_A, USER_B
from tests.fakes import FakeAdapter


def run(coro):
    return asyncio.get_event_loop().run_until_complete(coro) if False else asyncio.run(coro)


def events_of(evs, name):
    return [d for e, d in evs if e == name]


def outfit_items(evs):
    ev = events_of(evs, "outfits")[-1]
    return ev, [i for o in ev["outfits"] for i in o["items"]]


def test_scenario_date_feedback_remember(h):
    run(h.seed())
    owned = {i["id"]: i for i in h.mdb.t["clothing_items"] if i["user_id"] == USER_A}

    # 3. 코디 요청 → 실행 단계(날씨 포함) → 코디 3개
    evs = h.chat("내일 소개팅인데 미니멀하고 너무 꾸민 느낌은 싫어")
    steps = [d["tool"] for d in events_of(evs, "step") if d["status"] == "done"]
    assert "get_weather" in steps and "search_wardrobe" in steps and "validate_outfit" in steps
    assert evs[0][0] == "meta" and evs[1][0] == "step"          # first step streamed right away
    ev, items = outfit_items(evs)
    assert len(ev["outfits"]) == 3 and ev["version"] == 1
    assert all(i["id"] in owned for i in items)                  # 보유 의류 ID 100%
    tops = [next(i["id"] for i in o["items"] if i["role"] == "top") for o in ev["outfits"]]
    assert len(set(tops)) == 3                                   # no shared top
    assert all(any(i["role"] == "shoes" for i in o["items"]) for o in ev["outfits"])
    assert all(any(i["role"] == "outer" for i in o["items"]) for o in ev["outfits"])  # 14° → outer required
    done = events_of(evs, "done")[0]
    conv = done["conversation_id"]

    # 4. 피드백 → v2, 슬랙스 0건 → 기억 질문
    evs = h.chat("슬랙스는 불편해. 청바지로 바꿔줘", conv)
    ev, items = outfit_items(evs)
    assert ev["version"] == 2 and ev["label"] == "슬랙스 제외"
    assert not [i for i in items if i["subcategory"] == "slacks"]
    assert any(i["subcategory"] == "denim" for i in items)
    ask = events_of(evs, "ask")[0]
    assert ask["kind"] == "remember" and "소개팅" in ask["question"]
    evs = h.chat("네, 기억해줘", conv, answer={"ask_id": ask["ask_id"], "value": "persist"})
    assert "빼둘게요" in events_of(evs, "message")[0]["delta"]

    me = h.client.get("/api/v1/me").json()
    assert me["persistent_exclusions"][0]["target"] == "slacks"
    assert me["persistent_exclusions"][0]["scope"] == ["소개팅"]
    log = h.client.get("/api/v1/me/learning-log").json()
    assert any("슬랙스 제외" in e["text"] for e in log["events"])

    # same conversation, new request: still no slacks
    evs = h.chat("내일 출근룩도 짜줘", conv)
    _, items = outfit_items(evs)
    assert not [i for i in items if i["subcategory"] == "slacks"]

    # 5 (adjusted, decision #3). 새 대화 소개팅 → 슬랙스 0건
    evs = h.chat("내일 소개팅 코디 다시 짜줘")
    _, items = outfit_items(evs)
    assert not [i for i in items if i["subcategory"] == "slacks"]
    assert events_of(evs, "done")[0]["conversation_id"] != conv


def test_validation_filters_hallucinated_and_duplicate(h):
    run(h.seed())
    evs = h.chat("내일 소개팅 코디")
    v = next(d for d in events_of(evs, "step") if d["tool"] == "validate_outfit" and d["status"] == "done")
    assert v["summary"].startswith("통과 4")  # 6 generated: 1 made-up id + 1 double top rejected


def test_llm_failure_falls_back_to_rules(h):
    run(h.seed())
    h.adapters["nvidia"] = FakeAdapter("nvidia", fail="unavailable", calls=h.calls)
    h.adapters["gemini"] = FakeAdapter("gemini", fail="unavailable", calls=h.calls)
    r = h.client.post("/api/v1/outfits/generate", json={"moods": ["neat"]})
    assert r.status_code == 200, r.text
    body = r.json()
    assert len(body["outfits"]) == 3


def test_dev_nvidia_failure_uses_gemini(h):
    run(h.seed())
    h.adapters["nvidia"] = FakeAdapter("nvidia", fail="bad_request", calls=h.calls)
    evs = h.chat("내일 소개팅 코디")
    assert len(outfit_items(evs)[0]["outfits"]) == 3
    assert any(c[0] == "gemini" for c in h.calls)


def test_today_weather_unavailable_uses_band(h):
    run(h.seed())
    h.weather.available = False
    r = h.client.post("/api/v1/outfits/generate", json={"temp_band": "t5"}).json()
    assert r["weather"]["available"] is False and len(r["outfits"]) == 3
    r2 = h.client.post("/api/v1/outfits/generate", json={}).json()
    assert "17°" in r2["message"]


def test_today_chip_feedback_new_version(h):
    run(h.seed())
    r = h.client.post("/api/v1/outfits/generate", json={"moods": ["comfy"]}).json()
    main = r["outfits"][0]
    top = next(i for i in main["items"] if i["role"] == "top")
    r2 = h.client.post(f"/api/v1/outfits/{main['id']}/feedback", json={"chip": "change_top"}).json()
    assert r2["version"] == 2
    assert top["id"] not in [i["id"] for o in r2["outfits"] for i in o["items"]]
    r3 = h.client.post(f"/api/v1/outfits/{r2['outfits'][0]['id']}/feedback", json={"chip": "reroll"}).json()
    assert r3["version"] == 3


def test_favorite_persists_and_lists(h):
    run(h.seed())
    r = h.client.post("/api/v1/outfits/generate", json={}).json()
    oid = r["outfits"][0]["id"]
    assert h.client.post(f"/api/v1/outfits/{oid}/favorite").json()["is_favorite"] is True
    saved = h.client.get("/api/v1/outfits?favorite=true").json()["outfits"]
    assert [o["id"] for o in saved] == [oid]
    h.client.delete(f"/api/v1/outfits/{oid}/favorite")
    assert h.client.get("/api/v1/outfits?favorite=true").json()["outfits"] == []


def test_other_user_cannot_touch_data(h):
    run(h.seed(USER_A))
    run(h.seed(USER_B, wardrobe=[]))
    r = h.client.post("/api/v1/outfits/generate", json={}).json()
    oid = r["outfits"][0]["id"]
    item_id = r["outfits"][0]["items"][0]["id"]
    h.as_user(USER_B)
    assert h.client.patch(f"/api/v1/items/{item_id}", json={"is_active": False}).status_code == 404
    assert h.client.delete(f"/api/v1/items/{item_id}").status_code == 404
    assert h.client.post(f"/api/v1/outfits/{oid}/favorite").status_code == 404
    assert h.client.post(f"/api/v1/outfits/{oid}/feedback", json={"chip": "reroll"}).status_code == 404
    assert h.client.get("/api/v1/items?active=all").json()["items"] == []
    path = f"{USER_A}/x.webp"
    assert h.client.post("/api/v1/items/tag", json={"image_path": path}).status_code == 403
    assert h.client.post("/api/v1/items", json={"image_path": path, "subcategory": "knit",
                                                "color": "ivory"}).status_code == 403


def test_free_quota(h):
    run(h.seed())
    store = MemoryStore(USER_A, h.mdb)
    for _ in range(20):
        run(store.insert_run({"is_free_tier": True, "status": "ok"}))
    evs = h.chat("내일 소개팅 코디")
    err = events_of(evs, "error")[0]
    assert err["code"] == "FREE_QUOTA_EXCEEDED" and "내 AI 키" in err["message"]
    assert h.client.post("/api/v1/outfits/generate", json={}).status_code == 429


def test_byok_failure_falls_back_with_notice(h):
    run(h.seed())
    r = h.client.post("/api/v1/ai/connections/anthropic", json={"api_key": "sk-ant-test-dummy-1234567890"})
    assert r.status_code == 200 and r.json()["key_last4"] == "7890"
    assert "sk-ant" not in r.text.replace("sk-ant-", "") or "dummy" not in r.text
    r = h.client.put("/api/v1/ai/task-settings", json={"tasks": [{"task": "chat", "provider": "anthropic",
                                                                     "model": "claude-sonnet-5-5"}]})
    assert r.status_code == 200
    h.adapters["anthropic"] = FakeAdapter("anthropic", fail="auth", calls=h.calls)
    evs = h.chat("내일 소개팅 코디")
    assert events_of(evs, "notice")[0]["code"] == "BYOK_FALLBACK"
    assert len(outfit_items(evs)[0]["outfits"]) == 3
    conns = h.client.get("/api/v1/ai/connections").json()["connections"]
    assert conns[0]["status"] == "invalid"
    # disconnect → next request uses the free default
    assert h.client.delete("/api/v1/ai/connections/anthropic").status_code == 204
    assert h.client.get("/api/v1/ai/task-settings").json()["tasks"][0]["source"] == "free"


def test_byok_key_never_returned(h):
    run(h.seed())
    key = "sk-test-dummyKEYVALUE123456"
    r = h.client.post("/api/v1/ai/connections/openai", json={"api_key": key})
    assert key not in r.text
    for path in ("/api/v1/ai/connections", "/api/v1/ai/usage", "/api/v1/ai/task-settings", "/api/v1/me"):
        assert key not in h.client.get(path).text


def test_delete_account_removes_everything(h):
    run(h.seed())
    store = MemoryStore(USER_A, h.mdb)
    run(store.update_item(h.mdb.t["clothing_items"][0]["id"], {"image_path": f"{USER_A}/a.webp"}))
    h.client.post("/api/v1/outfits/generate", json={})
    assert h.client.delete("/api/v1/me").status_code == 204
    assert all(r.get("user_id", r.get("id")) != USER_A for rows in h.mdb.t.values() for r in rows)
    assert h.storages[USER_A].removed == [f"{USER_A}/a.webp"]


def test_tagging_and_items(h):
    run(h.seed(wardrobe=[]))
    r = h.client.post("/api/v1/items/tag", json={"image_path": f"{USER_A}/new.webp"}).json()
    assert r["tags"]["subcategory"] == "knit" and r["confidence"]["fit"] < 0.6 and r["name"] == "아이보리 니트"
    body = {**r["tags"], "image_path": f"{USER_A}/new.webp", "tag_source": "user_edited", "color": "navy"}
    item = h.client.post("/api/v1/items", json=body).json()
    assert item["name"] == "네이비 니트" and item["image_url"].startswith("https://storage.test/")
    assert h.client.post("/api/v1/items", json={**body, "color": "neon"}).status_code == 400
    h.client.patch(f"/api/v1/items/{item['id']}", json={"is_active": False})
    lst = h.client.get("/api/v1/items").json()
    assert lst["items"] == [] and lst["counts"]["archived"] == 1


def test_style_profiles_preset_no_llm(h):
    run(h.seed())
    before = len(h.calls)
    p = h.client.post("/api/v1/style-profiles", json={"preset": "natural_minimal"}).json()
    assert p["is_default"] and p["attributes"]["style_tags"] == ["minimal", "casual"]
    assert len(h.calls) == before
    q = h.client.post("/api/v1/style-profiles", json={"text": "꾸안꾸 느낌의 편한 캐주얼"}).json()
    assert q["style_name"] == "꾸안꾸 캐주얼" and not q["is_default"]
    h.client.patch(f"/api/v1/style-profiles/{q['id']}", json={"is_default": True})
    profiles = h.client.get("/api/v1/style-profiles").json()["profiles"]
    assert [x["is_default"] for x in profiles] == [False, True]


def test_ask_when_included_item_missing(h):
    run(h.seed(wardrobe=[w for w in __import__("tests.fakes", fromlist=["WARDROBE"]).WARDROBE
                         if w["subcategory"] != "denim"]))
    evs = h.chat("내일 소개팅인데 청바지로 해줘")
    ask = events_of(evs, "ask")[0]
    assert ask["kind"] == "clarify" and "데님" in ask["question"]
    assert not events_of(evs, "outfits")


def test_latest_chat(h):
    run(h.seed())
    h.chat("내일 소개팅 코디")
    h.client.post("/api/v1/outfits/generate", json={})  # today convs must not hijack "latest chat"
    r = h.client.get("/api/v1/chat/latest").json()
    assert [m["role"] for m in r["messages"]] == ["user", "assistant"]
    assert len(r["current"]["outfits"]) == 3
    assert r["messages"][1]["payload"]["steps"]


def test_exclude_pants_group_end_to_end(h):
    from app.domain import taxonomy as tx
    from tests.fakes import WARDROBE, item
    skirts = [item("블랙 미디스커트", "bottom", "midi_skirt", "black"), item("베이지 롱스커트", "bottom", "long_skirt", "beige")]
    run(h.seed(wardrobe=WARDROBE + skirts))
    pants = set(tx.GROUPS["pants"])
    evs = h.chat("내일 학교 코디 짜줘")
    conv = events_of(evs, "done")[0]["conversation_id"]

    # the fake model doesn't know "바지"; the rule net still removes every kind of pants
    evs = h.chat("바지 빼줘", conv)
    ev, items = outfit_items(evs)
    assert ev["label"] == "바지 전체 제외"
    assert items and not [i for i in items if i["subcategory"] in pants]
    ask = events_of(evs, "ask")[0]
    assert ask["kind"] == "remember" and "바지" in ask["question"]
    h.chat("네, 기억해줘", conv, answer={"ask_id": ask["ask_id"], "value": "persist"})
    me = h.client.get("/api/v1/me").json()
    assert me["persistent_exclusions"][0]["target"] == "pants"
    assert me["persistent_exclusions"][0]["target_label"] == "바지"

    # new conversation, same occasion: still no pants
    evs = h.chat("내일 학교 코디 다시 짜줘")
    _, items = outfit_items(evs)
    assert items and not [i for i in items if i["subcategory"] in pants]


def test_unclear_exclusion_asks_instead_of_guessing(h):
    from tests.fakes import FakeAdapter

    class Unsure(FakeAdapter):
        def _parse(self, user):
            out = super()._parse(user)
            if "레깅스" in user:
                out["intent"] = "feedback"
                out["feedback"] = {"type": "exclude_subcategory", "target": "leggings"}
            return out

    run(h.seed())
    h.adapters["nvidia"] = Unsure("nvidia", calls=h.calls)
    evs = h.chat("내일 학교 코디 짜줘")
    conv = events_of(evs, "done")[0]["conversation_id"]
    evs = h.chat("레깅스 빼줘", conv)
    ask = events_of(evs, "ask")[0]
    assert ask["kind"] == "clarify" and "어떤 옷을 뺄까요" in ask["question"]
    assert not events_of(evs, "outfits")


def test_remember_twice_keeps_one_rule(h):
    run(h.seed())
    for _ in range(2):
        evs = h.chat("내일 소개팅 코디")
        conv = events_of(evs, "done")[0]["conversation_id"]
        evs = h.chat("슬랙스는 빼줘", conv)
        ask = events_of(evs, "ask")[0]
        h.chat("네, 기억해줘", conv, answer={"ask_id": ask["ask_id"], "value": "persist"})
    me = h.client.get("/api/v1/me").json()
    assert len(me["persistent_exclusions"]) == 1


def _first_turn(h, msg="내일 출근룩 짜줘"):
    run(h.seed())
    evs = h.chat(msg)
    return events_of(evs, "done")[0]["conversation_id"], events_of(evs, "outfits")[-1]


def test_swap_one_part_keeps_the_rest(h):
    conv, before = _first_turn(h)
    card = before["outfits"][1]
    keep = {i["id"] for i in card["items"] if i["role"] != "shoes"}
    old_shoes = next(i["id"] for i in card["items"] if i["role"] == "shoes")
    calls = len(h.calls)
    evs = h.chat("2번 좋은데 신발만 바꿔줘", conv)
    ev = events_of(evs, "outfits")[-1]
    assert len(h.calls) == calls + 1                      # parse only, no outfit generation call
    assert ev["label"] == "2번 신발만 교체"
    for o in ev["outfits"]:
        assert {i["id"] for i in o["items"] if i["role"] != "shoes"} == keep
        assert next(i["id"] for i in o["items"] if i["role"] == "shoes") != old_shoes
    assert "신발만 바꿔 봤어요" in events_of(evs, "message")[0]["delta"]
    assert not events_of(evs, "ask")                       # not an exclusion: nothing to remember


def test_like_saves_favorite_without_regenerating(h):
    conv, before = _first_turn(h)
    evs = h.chat("1번이 제일 마음에 들어", conv)
    assert not events_of(evs, "outfits")
    assert "즐겨찾기" in events_of(evs, "message")[0]["delta"]
    favs = h.client.get("/api/v1/outfits", params={"favorite": "true"}).json()
    assert [o["id"] for o in favs["outfits"]] == [before["outfits"][0]["id"]]


def test_question_about_cards_is_answered_not_regenerated(h):
    conv, _ = _first_turn(h)
    evs = h.chat("왜 이렇게 골랐어?", conv)
    assert not events_of(evs, "outfits")
    assert events_of(evs, "message")[0]["delta"] == "1번은 니트로 포근하게 골랐어요."


def test_reroll_shows_new_looks(h):
    conv, before = _first_turn(h)
    seen = {frozenset(i["id"] for i in o["items"] if i["role"] in ("top", "bottom", "dress")) for o in before["outfits"]}
    evs = h.chat("다른 거 보여줘", conv)
    after = events_of(evs, "outfits")[-1]
    now = {frozenset(i["id"] for i in o["items"] if i["role"] in ("top", "bottom", "dress")) for o in after["outfits"]}
    assert now and not (now & seen)
    assert after["label"] == "다른 조합"


def test_include_main_piece_still_gives_three_cards(h):
    conv, _ = _first_turn(h)
    evs = h.chat("니트 넣어줘", conv)
    ev = events_of(evs, "outfits")[-1]
    assert len(ev["outfits"]) == 3
    assert all(any(i["subcategory"] == "knit" for i in o["items"]) for o in ev["outfits"])
    assert ev["label"] == "니트 포함"
    assert events_of(evs, "message")[0]["delta"].startswith("니트를 넣어서 다시 짰어요.")


def test_small_talk_replies(h):
    run(h.seed())
    assert events_of(h.chat("안녕"), "message")[0]["delta"].startswith("안녕하세요!")
    assert events_of(h.chat("고마워"), "message")[0]["delta"].startswith("천만에요!")
