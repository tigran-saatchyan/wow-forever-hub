"""Crafting economics on a small made-up reference."""

from app import craft

REF = {
    "2447": {"sell": 10},  # Peacebloom: a vendor pays 10c
    "765": {"sell": 1},  # Silverleaf
    "3371": {"sell": 1, "buy": 20, "vstack": 1},  # Empty Vial: vendors sell it for 20c
    "118": {"sell": 5},  # Minor Healing Potion
    "999": {"sell": 0, "buy": 500, "vstack": 1},  # not a vendor good, though the client knows a buy price
    "5": {"sell": 400},  # something a vendor pays well for
}
PRICES = {2447: {"ah": 30, "qty": 100}, 765: {"ah": 20, "qty": 50}, 118: {"ah": 200, "qty": 12},
          3371: {"ah": 90, "qty": 3}, 5: {"ah": 300, "qty": 2}}
POTION = {"id": 1, "skill": 1, "yellow": 55, "gray": 95, "item": 118, "count": 1,
          "reagents": [[2447, 1], [765, 1], [3371, 1]], "source": "trainer", "recipeItem": None}


def test_reagent_costs_and_sale():
    assert craft.unit_cost(3371, REF, PRICES) == (20, "vendor")  # a vendor good: cheaper at the vendor
    assert craft.unit_cost(2447, REF, PRICES) == (30, "ah")
    assert craft.unit_cost(999, REF, {}) == (None, None)  # a buy price alone does not make a vendor good
    s = craft.sale(118, REF, PRICES)
    assert s == {"ah": 190, "vendor": 5, "best": 190, "where": "ah", "qty": 12}  # 5% cut
    e = craft.economics(POTION, REF, PRICES)
    assert e["cost"] == 70 and e["value"] == 190 and e["profit"] == 120 and e["margin"] == 171.4


def test_unknown_reagent_makes_cost_unknown():
    r = {**POTION, "reagents": [[2447, 1], [12345, 2]]}
    e = craft.economics(r, REF, PRICES)
    assert e["cost"] is None and e["profit"] is None and e["parts"][1]["unit"] is None


def test_no_reagents_is_not_free():
    e = craft.economics({**POTION, "reagents": []}, REF, PRICES)
    assert e["cost"] is None and e["profit"] is None


def test_plan_takes_an_unlearned_recipe_and_its_pattern():
    pattern = {**POTION, "id": 2, "source": "item", "recipeItem": 5}
    p = craft.plan([pattern], set(), 50, 52, REF, PRICES, resale=False)
    assert p["steps"][0]["learn"] == {"source": "item", "item": 5, "price": 300}
    assert p["total"] == 2 * 70 + 300  # two crafts and the pattern bought once


def test_skill_up_chance():
    assert craft.chance(POTION, 40) == 1.0  # orange
    assert craft.chance(POTION, 75) == 0.5  # halfway from yellow to grey
    assert craft.chance(POTION, 95) == 0.0  # grey


def test_leveling_plan():
    p = craft.plan([POTION], {1}, 50, 60, REF, PRICES, resale=False)
    # 50..54 orange: 5 crafts; 55..59 yellow: 1/(40/40) + 1/(39/40) + … ≈ 5.3 -> 6 crafts in that stretch
    assert p["steps"][0]["crafts"] == 11 and p["steps"][0]["from"] == 50 and p["steps"][0]["to"] == 60
    assert p["total"] == 11 * 70 and not p["gaps"]
    assert {r["id"]: r["count"] for r in p["reagents"]} == {2447: 11, 765: 11, 3371: 11}
    resold = craft.plan([POTION], {1}, 50, 60, REF, PRICES, resale=True)
    assert resold["total"] == 11 * 70 - 11 * 190  # selling the potions pays for the leveling
    assert craft.plan([POTION], {1}, 95, 100, REF, PRICES)["gaps"] == [95, 96, 97, 98, 99]  # grey: no way up


def test_vendor_or_auction_advice():
    a = {x["id"]: x for x in craft.advice(REF, PRICES, {2447, 5, 118})}
    assert a[5]["where"] == "vendor" and a[5]["flip"] == 100  # buy at 300 on the house, a vendor pays 400
    assert a[2447]["where"] == "ah" and a[2447]["flip"] is None


def test_flips():
    sell = {"5": 400, "118": 5, "2447": 10}
    f = craft.flips(sell, PRICES, min_profit=50)
    assert f == [{"id": 5, "buy": 300, "sell": 400, "profit": 100, "qty": 2}]  # a vendor pays more than the lot costs
    assert craft.flips(sell, PRICES, min_profit=101) == []
