"""The simulation's buff list, built from the game's files: the values Forever has, not classic's."""
from app.routers.prebis import sim_buffs


def by_key():
    return {b["key"]: b for b in sim_buffs()}


def test_every_buff_has_an_effect_a_name_and_an_icon():
    for b in sim_buffs():
        assert b["eff"], b["key"]
        assert b["name"]["en"] and b["name"]["ru"], b["key"]
        assert b["icon"], b["key"]


def test_forever_values():
    b = by_key()
    assert b["food:13935"]["eff"] == {"sp": 28} and b["food:13935"]["dur"] == 900000  # well fed takes the food's value
    assert b["food:18254"]["eff"] == {"int": 15}
    assert b["flask:13512"]["eff"] == {"sp": 150}
    assert b["oil:20749"]["eff"] == {"sp": 36, "crit": 1}
    assert b["class:25898"]["eff"]["pct"] == {k: 10 for k in ("str", "agi", "sta", "int", "spi")}
    assert b["talent:105823"]["eff"] == {"pct": {"spi": 15}}  # Dark Inspiration: spirit, by the stat mask
    assert b["talent:105836"]["eff"] == {"dmgPct": 20}
    assert b["class:10497"]["eff"] == {"mp5": 25.0, "tick": {"n": 10, "every": 2.0}}  # 10 mana every 2 sec
    assert b["talent:104730"]["boost"] == 25 and b["talent:104730"]["dur"] is None  # a talent, not a buff of its own
    assert b["talent:104730"]["needs"] == "class:10497"


def test_talent_buffs_name_class_spec_and_talent():
    t = by_key()["talent:104937"]
    assert t["class"]["token"] == "DRUID" and t["spec"]["tab"] == 0 and t["talentName"]["en"] == "Moonkin Form"
