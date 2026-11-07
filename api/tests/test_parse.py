"""Request understanding without an LLM: group words, the rule safety net, unknown targets."""

from datetime import date

import pytest

from app.agent.llm_tasks import exclusion_targets, normalize_parse
from app.domain import taxonomy as tx

PANTS = set(tx.GROUPS["pants"])
EMPTY = {"intent": "new_request", "date": None, "time_of_day": None, "occasion": None, "formality": None,
         "mood": [], "style_tags": [], "include": [], "exclude": [], "feedback": None}


def parse(message, raw=None, refs=("i1", "i2")):
    return normalize_parse({**EMPTY, **(raw or {})}, date(2026, 11, 7), set(refs), message)


@pytest.mark.parametrize("message, want", [
    ("바지 빼줘", PANTS),
    ("아니 그냥 세상 모든 바지를 안입는다고", PANTS),
    ("바지는 절대 추천하지 마", PANTS),
    ("팬츠류 다 빼", PANTS),
    ("치마는 싫어", set(tx.GROUPS["skirts"])),
    ("스커트 빼줘", set(tx.GROUPS["skirts"])),
    ("원피스는 안 입어", set(tx.GROUPS["dresses"])),
    ("아우터 없이 입고 싶어", set(tx.GROUPS["outerwear"])),
    ("면바지 말고 다른 걸로", {"cotton_pants"}),          # longer word wins over 바지
    ("청바지 말고", {"denim"}),
    ("슬랙스랑 데님 둘 다 빼", {"slacks", "denim"}),
    ("구두 신기 싫어", {"flats"}),
    ("검은색 옷 빼줘", {"black"}),
])
def test_rule_net_catches_what_the_model_missed(message, want):
    assert exclusion_targets(parse(message)) == want


@pytest.mark.parametrize("message", ["내일 소개팅 코디 짜줘", "셔츠 입고 싶어", "그 코트 빼줘", "니트로 바꿔줘"])
def test_rule_net_ignores_non_removals_and_specific_items(message):
    assert exclusion_targets(parse(message)) == set()


def test_model_single_kind_is_widened_to_group():
    # the model picked only denim for "바지"; the group word wins
    p = parse("바지 빼줘", {"intent": "feedback", "exclude": [{"type": "subcategory", "value": "denim"}],
                          "feedback": {"type": "exclude_subcategory", "target": "denim"}})
    assert exclusion_targets(p) == PANTS
    assert p["feedback"] == {"type": "exclude_group", "target": "pants"}


def test_group_words_from_model_map_to_groups():
    p = parse("", {"intent": "feedback", "exclude": [{"type": "subcategory", "value": "skirt"}],
                   "feedback": {"type": "exclude_subcategory", "target": "스커트"}})
    assert p["exclude"] == [{"type": "group", "value": "skirts"}]
    assert p["feedback"] == {"type": "exclude_group", "target": "skirts"}


def test_unknown_target_is_dropped_not_guessed():
    p = parse("레깅스 빼줘", {"intent": "feedback", "feedback": {"type": "exclude_subcategory", "target": "leggings"}})
    assert p["feedback"] == {"type": "exclude_subcategory", "target": None}
    assert exclusion_targets(p) == set()


def test_removal_after_outfits_is_feedback():
    assert parse("바지 빼줘")["intent"] == "feedback"
    assert parse("바지 빼줘", refs=())["intent"] == "new_request"


def test_rule_parse_when_ai_is_down():
    from app.agent.llm_tasks import rule_parse
    p = rule_parse("바지 빼줘", date(2026, 11, 7), {"i1"})
    assert p["intent"] == "feedback" and exclusion_targets(p) == PANTS
    p = rule_parse("내일 소개팅 코디", date(2026, 11, 7), set())
    assert p["occasion"] == "소개팅" and p["date"] == "2026-11-08"
    assert rule_parse("음 글쎄 잘 모르겠어", date(2026, 11, 7), {"i1"}) is None
