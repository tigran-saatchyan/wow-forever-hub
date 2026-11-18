from app import bis


def item(i, slot, cls=4, sub=1, req=30, ilvl=35, q=3, **stats):
    return str(i), {"en": f"I{i}", "ru": f"П{i}", "q": q, "ilvl": ilvl, "req": req, "slot": slot, "cls": cls, "sub": sub,
                    "classes": -1, "races": -1, "pvp": 0, "stats": stats, "armor": 30, "dps": None}


def test_usable_armor_weapons_level_faction():
    _, cloth = item(1, 1)
    _, plate = item(2, 1, sub=4)
    _, staff = item(3, 17, cls=2, sub=10)
    _, axe = item(4, 17, cls=2, sub=1)
    assert bis.usable(cloth, 5, 40, "HORDE") and not bis.usable(plate, 5, 40, "HORDE")
    assert bis.usable(plate, 1, 40, "HORDE") and not bis.usable(plate, 1, 39, "HORDE")  # plate from 40
    assert bis.usable(staff, 5, 40, None) and not bis.usable(axe, 5, 40, None)
    assert not bis.usable(cloth, 5, 29, None)  # above the level
    _, ally = item(5, 1)
    ally["races"] = bis.ALLIANCE_RACES
    assert not bis.usable(ally, 5, 40, "HORDE") and bis.usable(ally, 5, 40, "ALLIANCE")
    _, raid = item(6, 1, ilvl=bis.MAX_ILVL + 1, req=60)
    assert not bis.usable(raid, 5, 60, None)


def test_choose_top_three_rings_and_two_hand():
    gear = dict([
        item(10, 1, INTELLECT=10), item(11, 1, INTELLECT=12, SPIRIT=5), item(12, 1, STRENGTH=40),
        item(20, 11, sub=0, INTELLECT=5), item(21, 11, sub=0, INTELLECT=8), item(22, 11, sub=0, INTELLECT=3),
        item(30, 17, cls=2, sub=10, INTELLECT=30), item(31, 21, cls=2, sub=4, INTELLECT=5),
        item(32, 23, cls=4, sub=0, INTELLECT=5),
    ])
    out = bis.choose(gear, 5, "holy", 40, "HORDE")
    head = [x["id"] for x in out["slots"]["HEAD"]]
    assert head[:2] == [11, 10]  # strength is worth nothing to a holy priest
    assert out["slots"]["FINGER_1"][0]["id"] == 21 and out["slots"]["FINGER_2"][0]["id"] == 20
    assert out["twoHand"] and out["slots"]["MAIN_HAND"][0]["id"] == 30


def test_default_spec_by_points():
    assert bis.default_spec(5, [{"points": 5}, {"points": 21}, {"points": 0}]) == "holy"
    assert bis.default_spec(5, None) == "discipline"


def test_worn_item_told_by_the_equipment():
    from app.routers.bis import _worn
    w = bis.WEIGHTS[(5, "holy")]
    x = {"id": 4040, "name": "Клобук ночного неба", "quality": "UNCOMMON", "ilvl": 35,
         "statv": {"INTELLECT": 12, "SPIRIT": 5}, "armor": 30, "dps": None}
    got = _worn(x, w, "HEAD")
    assert got["q"] == 2 and got["stats"] == {"INTELLECT": 12, "SPIRIT": 5}
    assert got["score"] == bis.score({"stats": x["statv"], "armor": 30, "dps": None, "cls": 4, "sub": 0}, w) > 0


def test_equipment_keeps_stat_numbers():
    from app import wow
    eq = {"equipped_items": [{"slot": {"type": "HEAD"}, "item": {"id": 4040}, "name": "Cowl", "quality": {"type": "UNCOMMON"},
                              "stats": [{"type": {"type": "INTELLECT"}, "value": 12, "display": {"display_string": "+12 Intellect"}}],
                              "armor": {"value": 30}}]}
    x = wow.equipment(eq, "en")[0]
    assert x["statv"] == {"INTELLECT": 12} and x["armor"] == 30


def test_foreverdb_item_converted():
    from app import fdb_gear
    d = {"id": 4040, "name": "Nightsky Gloves", "qualityId": 2, "itemLevel": 34, "requiredLevel": 29, "classId": 4,
         "subclassId": 1, "inventoryTypeId": 10, "bonding": "Binds when equipped",
         "stats": [{"statId": 7, "stat": "Stamina", "value": 7}, {"statId": 5, "stat": "Intellect", "value": 6}],
         "damage": None, "speed": None, "effects": []}
    x = fdb_gear.convert(d)
    assert x["stats"] == {"STAMINA": 7, "INTELLECT": 6} and x["slot"] == 10 and x["req"] == 29 and x["bind"] == 2
    w = fdb_gear.convert({**d, "classId": 2, "inventoryTypeId": 13, "damage": {"min": 82, "max": 153}, "speed": 1.9})
    assert w["dps"] == 61.8 and w["speed"] == 1900
    assert bis.usable(x, 5, 30, "HORDE")


def test_foreverdb_sources_brief():
    from app import fdb_sources
    from app.routers import sources
    fdb_sources._index = {"sold": {"777": [{"npc": 1, "name": "Corina Steele", "zone": "Elwynn Forest", "price": 536, "seen": True}]},
                          "made": {"888": [{"profession": "Tailoring", "recipe": "Bolt", "skill": 1, "ways": ["auto"]}]}}
    try:
        assert sources.brief(None, 777) == {"kind": "vendor", "name": "Corina Steele", "where": "Elwynn Forest", "copper": 536, "more": 0}
        assert sources.brief({}, 888)["kind"] == "craft"
        assert sources.brief(None, 999) is None
    finally:
        fdb_sources._index = {"sold": {}, "made": {}}


def test_wand_damage_counts_for_casters():
    w = bis.WEIGHTS[(5, "shadow")]
    wand = {"stats": {}, "armor": None, "dps": 30.0, "cls": 2, "sub": 19}
    assert bis.score(wand, w, "RANGED") == 30.0
    told = {"stats": {}, "armor": None, "dps": 30.0, "cls": 2, "sub": 0}  # a worn wand known only by its dps
    assert bis.score(told, w, "RANGED") == 30.0
    assert bis.score(wand, bis.WEIGHTS[(1, "arms")], "RANGED") == 0.0
