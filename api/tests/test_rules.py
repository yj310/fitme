from collections import Counter
from datetime import date

import pytest

from app.domain import rules
from app.domain.taxonomy import item_name, normalize_tags, to_code


def it(id, cat, sub, color="black", warmth=2, formality=2, pattern="solid", fit="regular",
       seasons=None, styles=None):
    return {"id": id, "category": cat, "subcategory": sub, "color": color, "warmth": warmth,
            "formality": formality, "pattern": pattern, "fit": fit,
            "seasons": seasons or ["spring", "summer", "fall", "winter"], "style_tags": styles or []}


WARDROBE = [
    it("t1", "top", "knit", "ivory"), it("t2", "top", "tshirt_short", "white", warmth=1),
    it("b1", "bottom", "slacks", "gray", fit="straight"), it("b2", "bottom", "denim", "navy", fit="straight"),
    it("o1", "outer", "cardigan", "charcoal", warmth=2), it("s1", "shoes", "loafers", "black"),
    it("d1", "dress", "midi_dress", "navy", fit="none"),
]


def ctx(**kw):
    base = dict(owned={i["id"]: i for i in WARDROBE}, season="fall", temp=14, wind=1.0)
    base.update(kw)
    return rules.ValidationContext(**base)


def test_valid_outfit_passes():
    assert rules.validate_outfit(["o1", "t1", "b2", "s1"], ctx()) == []


def test_unknown_or_foreign_id_fails():
    assert rules.validate_outfit(["t1", "b2", "s1", "zzz"], ctx()) == ["UNKNOWN_ITEM:zzz"]


def test_composition_rules():
    assert "BAD_COMPOSITION" in rules.validate_outfit(["o1", "t1", "s1"], ctx())
    assert "DUPLICATE_CATEGORY:top" in rules.validate_outfit(["o1", "t1", "t2", "b1", "s1"], ctx())
    assert "BAD_COMPOSITION" in rules.validate_outfit(["o1", "d1", "b1", "s1"], ctx())
    assert rules.validate_outfit(["o1", "d1", "s1"], ctx()) == []


def test_missing_shoes_only_when_owned():
    assert "MISSING_SHOES" in rules.validate_outfit(["o1", "t1", "b2"], ctx())
    no_shoes = {i["id"]: i for i in WARDROBE if i["category"] != "shoes"}
    assert rules.validate_outfit(["o1", "t1", "b2"], ctx(owned=no_shoes)) == []


def test_exclusions():
    fails = rules.validate_outfit(["o1", "t1", "b1", "s1"], ctx(exclude_subcategories={"slacks"}))
    assert fails == ["EXCLUDED_SUBCATEGORY:b1"]
    fails = rules.validate_outfit(["o1", "t1", "b2", "s1"], ctx(exclude_item_ids={"t1"}))
    assert fails == ["EXCLUDED_ITEM:t1"]


def test_outer_required_band():
    assert "MISSING_OUTER" in rules.validate_outfit(["t1", "b2", "s1"], ctx(temp=14))
    assert rules.validate_outfit(["t1", "b2", "s1"], ctx(temp=18)) == []


def test_short_sleeves_alone_in_cold_fails():
    no_outer = {i["id"]: i for i in WARDROBE if i["category"] != "outer"}
    fails = rules.validate_outfit(["t2", "b2", "s1"], ctx(owned=no_outer, temp=4, season="winter"))
    assert "TOO_LIGHT:t2" in fails


def test_wind_shifts_band_colder():
    assert rules.temp_band(17).code == "t17"
    assert rules.temp_band(17, wind=5).code == "t12"


def test_outer_not_needed_when_hot():
    assert "OUTER_NOT_NEEDED:o1" in rules.validate_outfit(["o1", "t2", "b2", "s1"], ctx(temp=29, season="summer"))


def test_season_mismatch_and_shoulder_weeks():
    coat = it("o2", "outer", "padding", "black", warmth=3, seasons=["winter"])
    owned = {**{i["id"]: i for i in WARDROBE}, "o2": coat}
    # Warm fall day: winter padding is a season mismatch.
    assert "SEASON_MISMATCH:o2" in rules.validate_outfit(["o2", "t1", "b2", "s1"], ctx(owned=owned, temp=14))
    # Cold fall day (4°): winter items are fine.
    fails = rules.validate_outfit(["o2", "t1", "b2", "s1"], ctx(owned=owned, temp=4))
    assert not any(f.startswith("SEASON_MISMATCH") for f in fails)


def test_color_harmony():
    neutral = [it("a", "top", "knit", "ivory"), it("b", "bottom", "denim", "navy")]
    assert rules.color_harmony(neutral) == 100
    loud = [it("a", "top", "knit", "red"), it("b", "bottom", "denim", "green"), it("c", "shoes", "sneakers", "yellow")]
    assert rules.color_harmony(loud) == 60
    two_fams = [it("a", "top", "knit", "red"), it("b", "bottom", "denim", "green")]
    assert rules.color_harmony(two_fams) == 85
    patterns = [it("a", "top", "shirt", "white", pattern="stripe"), it("b", "bottom", "midi_skirt", "black", pattern="check")]
    # two patterns −30, but white+black share the mono family → tone-on-tone +10
    assert rules.color_harmony(patterns) == 80


def test_score_weights_and_detail():
    sc = rules.ScoreContext(
        style_tags={"minimal"}, preferred_colors={"ivory", "navy"}, request_formality=2, temp=14, wind=1,
        rainy=False, preferred_fit="regular", silhouette_top={"regular"}, silhouette_bottom={"straight"},
    )
    items = [WARDROBE[4], it("t1", "top", "knit", "ivory", styles=["minimal"]), WARDROBE[3], WARDROBE[5]]
    total, detail = rules.score_outfit(items, sc, {"style": 0.35, "harmony": 0.25, "situation": 0.2, "preference": 0.2})
    assert set(detail) == {"style", "harmony", "situation", "preference"}
    assert 0 <= total <= 100
    assert detail["harmony"] == 100


def test_reroll_penalty():
    base = dict(style_tags=set(), preferred_colors=set(), request_formality=None, temp=None, wind=None,
                rainy=False, preferred_fit=None, silhouette_top=set(), silhouette_bottom=set())
    items = [WARDROBE[0], WARDROBE[3], WARDROBE[5]]
    plain = rules._preference_score(items, rules.ScoreContext(**base))
    penalized = rules._preference_score(items, rules.ScoreContext(**base, rerolled_pairs={frozenset({"t1", "b2"})}))
    assert penalized == pytest.approx(plain - 20)


def test_pick_top3_no_shared_top():
    a = [WARDROBE[0], WARDROBE[2]]
    b = [WARDROBE[0], WARDROBE[3]]
    c = [WARDROBE[1], WARDROBE[3]]
    d = [WARDROBE[6]]
    picked = rules.pick_top3([(90, a, 1), (89, b, 2), (80, c, 3), (70, d, 4)])
    assert [p[2] for p in picked] == [1, 3, 4]


def test_missing_categories():
    owned = [WARDROBE[0], WARDROBE[2], WARDROBE[5]]
    cats = {m["category"] for m in rules.missing_categories(owned)}
    assert cats == {"top", "bottom", "shoes"}


def test_season_for():
    assert rules.season_for(date(2026, 10, 31)) == "fall"
    assert rules.season_for(date(2026, 1, 5)) == "winter"


def test_taxonomy_helpers():
    assert to_code("슬랙스") == "slacks"
    assert to_code("청바지") == "denim"
    assert to_code("차콜") == "charcoal"
    assert item_name("charcoal", "cardigan") == "차콜 가디건"
    clean, invalid = normalize_tags({"subcategory": "니트", "color": "아이보리", "fit": "세미오버",
                                     "style_tags": ["미니멀", "nope"], "warmth": 9, "seasons": ["fall"]})
    assert clean["category"] == "top" and clean["subcategory"] == "knit" and clean["color"] == "ivory"
    assert clean["style_tags"] == ["minimal"] and clean["warmth"] == 3
    assert "fit" in invalid and clean["fit"] == "regular"


def test_counter_import_used():
    assert Counter("aa")["a"] == 2
