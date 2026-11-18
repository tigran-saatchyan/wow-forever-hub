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
