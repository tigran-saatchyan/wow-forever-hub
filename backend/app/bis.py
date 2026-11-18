"""Best in slot: for a class, a specialization and a level, the best gear of WoW: Forever in every slot.

Pure functions over the gear reference (app/data/gear.json, built by tools/build_gear.py from the client's
item tables and Blizzard's item API). An item scores the sum of its stats times the specialization's
weights (plus weapon damage for those who hit with it); every slot gets its top three.

What is left out:
- what the class can't wear or wield (armor type by level, weapon skills, the item's own class list),
  and the other faction's items;
- items above the character's level, PvP-rank gear;
- raid gear: Forever's first raids (Barrow Deeps, Hyjal Summit, Onyxia) open on 9 December and their loot is
  not in the client yet, while the original game's raid loot (Molten Core and on) is in the files but not in
  the game. Until raids are in, items above MAX_ILVL (the best dungeon and world gear) are out.

The weights are an estimate of what each stat is worth to the specialization; they are meant to be tuned.
"""

from __future__ import annotations

import re
from typing import Any

MAX_ILVL = 65  # no raid loot yet (see above)

# ---- classes and specializations (talent trees, in the game's order) ----
CLASSES: dict[int, dict[str, Any]] = {
    1: {"key": "warrior", "specs": ["arms", "fury", "protection"]},
    2: {"key": "paladin", "specs": ["holy", "protection", "retribution"]},
    3: {"key": "hunter", "specs": ["beastmastery", "marksmanship", "survival"]},
    4: {"key": "rogue", "specs": ["assassination", "combat", "subtlety"]},
    5: {"key": "priest", "specs": ["discipline", "holy", "shadow"]},
    7: {"key": "shaman", "specs": ["elemental", "enhancement", "restoration"]},
    8: {"key": "mage", "specs": ["arcane", "fire", "frost"]},
    9: {"key": "warlock", "specs": ["affliction", "demonology", "destruction"]},
    11: {"key": "druid", "specs": ["balance", "feral", "restoration"]},
}

# stat names as the API gives them, grouped: one weight for a group
GROUPS = {
    "crit": ["CRIT_RATING", "CRIT_MELEE_RATING", "CRIT_RANGED_RATING", "CRIT_SPELL_RATING", "SPELL_CRIT_RATING"],
    "hit": ["HIT_RATING", "HIT_MELEE_RATING", "HIT_RANGED_RATING", "HIT_SPELL_RATING", "SPELL_HIT_RATING"],
    "haste": ["HASTE_RATING", "HASTE_MELEE_RATING", "HASTE_RANGED_RATING", "HASTE_SPELL_RATING", "SPELL_HASTE_RATING"],
    # "damage and healing" counts for everyone who casts; "healing" only for healers
    "sp": ["SPELL_POWER", "SPELL_DAMAGE_DONE"],
    "heal": ["SPELL_HEALING_DONE"],
    "mp5": ["MANA_REGENERATION", "MANA_REGEN", "MANA_PER_5"],
    "ap": ["ATTACK_POWER"],
    "rap": ["RANGED_ATTACK_POWER"],
    "tank": ["DEFENSE_SKILL_RATING", "DODGE_RATING", "PARRY_RATING", "BLOCK_RATING", "BLOCK_VALUE"],
    "exp": ["EXPERTISE_RATING"],
}

CASTER = {"INTELLECT": 0.8, "SPIRIT": 0.3, "STAMINA": 0.35, "sp": 1.2, "hit": 1.1, "crit": 0.8, "haste": 0.8}
HEALER = {"INTELLECT": 1.0, "SPIRIT": 0.8, "STAMINA": 0.3, "sp": 1.1, "heal": 1.1, "mp5": 1.5, "crit": 0.6, "haste": 0.6}
MELEE = {"STRENGTH": 1.0, "AGILITY": 0.8, "STAMINA": 0.3, "ap": 0.45, "crit": 0.9, "hit": 1.1, "exp": 0.8, "haste": 0.6,
         "dps": 3.0}
TANK = {"STAMINA": 1.0, "tank": 0.9, "STRENGTH": 0.5, "AGILITY": 0.5, "armor": 0.04, "hit": 0.4, "exp": 0.4, "dps": 1.0}


def _w(base: dict, **over: float) -> dict:
    return {**base, **over}


WEIGHTS: dict[tuple[int, str], dict[str, float]] = {
    (1, "arms"): _w(MELEE), (1, "fury"): _w(MELEE, dps=2.5, dps_off=1.8), (1, "protection"): _w(TANK),
    (2, "holy"): _w(HEALER, SPIRIT=0.3, mp5=1.3, crit=0.8), (2, "protection"): _w(TANK, sp=0.3, INTELLECT=0.2),
    (2, "retribution"): _w(MELEE, AGILITY=0.6, INTELLECT=0.15),
    (3, "beastmastery"): {"AGILITY": 1.0, "INTELLECT": 0.3, "STAMINA": 0.35, "ap": 0.2, "rap": 0.45, "crit": 0.9,
                          "hit": 1.1, "haste": 0.6, "dps_ranged": 3.0, "dps": 0.3},
    (4, "assassination"): _w(MELEE, STRENGTH=0.5, AGILITY=1.0, dps_off=2.0),
    (5, "discipline"): _w(HEALER, SPIRIT=0.7, crit=0.7), (5, "holy"): _w(HEALER),
    (5, "shadow"): _w(CASTER, INTELLECT=0.6, SPIRIT=0.4, STAMINA=0.4, BONUS_STAT_SHADOW_DAMAGE_DONE=1.1),
    (7, "elemental"): _w(CASTER, BONUS_STAT_NATURE_DAMAGE_DONE=1.1), (7, "enhancement"): _w(MELEE, INTELLECT=0.2),
    (7, "restoration"): _w(HEALER, SPIRIT=0.4, mp5=1.6),
    (8, "arcane"): _w(CASTER, BONUS_STAT_ARCANE_DAMAGE_DONE=1.1), (8, "fire"): _w(CASTER, BONUS_STAT_FIRE_DAMAGE_DONE=1.1),
    (8, "frost"): _w(CASTER, BONUS_STAT_FROST_DAMAGE_DONE=1.1),
    (9, "affliction"): _w(CASTER, STAMINA=0.6, INTELLECT=0.5, SPIRIT=0.2, BONUS_STAT_SHADOW_DAMAGE_DONE=1.1),
    (11, "balance"): _w(CASTER, BONUS_STAT_ARCANE_DAMAGE_DONE=0.6, BONUS_STAT_NATURE_DAMAGE_DONE=0.6),
    (11, "feral"): _w(MELEE, STRENGTH=0.9, AGILITY=1.0, STAMINA=0.6, armor=0.02, dps=0.0),
    (11, "restoration"): _w(HEALER),
}
# priests, mages and warlocks kill with their wand while leveling: its damage counts (healers' less)
for (_c, _s), _v in list(WEIGHTS.items()):
    if _c in (5, 8, 9):
        WEIGHTS[(_c, _s)] = {**_v, "dps_wand": 0.6 if _s in ("holy", "discipline") else 1.0}
for _c, _s in ((3, "marksmanship"), (3, "survival")):
    WEIGHTS[(_c, _s)] = WEIGHTS[(3, "beastmastery")]
for _s in ("combat", "subtlety"):
    WEIGHTS[(4, _s)] = WEIGHTS[(4, "assassination")]
for _s in ("demonology", "destruction"):
    WEIGHTS[(9, _s)] = _w(WEIGHTS[(9, "affliction")], BONUS_STAT_SHADOW_DAMAGE_DONE=0.8, BONUS_STAT_FIRE_DAMAGE_DONE=0.8)

# ---- what a class can wear ----
CLOTH, LEATHER, MAIL, PLATE, SHIELD = 1, 2, 3, 4, 6


def armor_type(cls: int, level: int) -> int:
    """The heaviest armor a class wears at a level (warriors and paladins learn plate, hunters and shamans
    mail at 40)."""
    if cls in (1, 2):
        return PLATE if level >= 40 else MAIL
    if cls in (3, 7):
        return MAIL if level >= 40 else LEATHER
    if cls in (4, 11):
        return LEATHER
    return CLOTH


WEAPONS = {  # weapon subclasses each class can learn
    1: {0, 1, 2, 3, 4, 5, 6, 7, 8, 10, 13, 15, 16, 18}, 2: {0, 1, 4, 5, 6, 7, 8},
    3: {0, 1, 2, 3, 6, 7, 8, 10, 13, 15, 16, 18}, 4: {2, 3, 4, 7, 13, 15, 16, 18}, 5: {4, 10, 15, 19},
    7: {0, 1, 4, 5, 10, 13, 15}, 8: {7, 10, 15, 19}, 9: {7, 10, 15, 19}, 11: {4, 5, 10, 13, 15},
}
SHIELDS = {1, 2, 7}
DUAL = {1, 3, 4}  # classes that can dual-wield
NO_OFF_WEAPON = {(1, "arms"), (1, "protection")}  # two-hand or shield specs
TWO_HAND_SUB = {1, 5, 6, 8, 10}
RANGED_SUB = {2, 3, 16, 18, 19}

HORDE_RACES = (1 << 1) | (1 << 4) | (1 << 5) | (1 << 7)  # orc, undead, tauren, troll
ALLIANCE_RACES = (1 << 0) | (1 << 2) | (1 << 3) | (1 << 6)  # human, dwarf, night elf, gnome

# the equipment slots (as the character profile names them) and the item inventory types that go in them
SLOTS: dict[str, set[int]] = {
    "HEAD": {1}, "NECK": {2}, "SHOULDER": {3}, "BACK": {16}, "CHEST": {5, 20}, "WRIST": {9}, "HANDS": {10},
    "WAIST": {6}, "LEGS": {7}, "FEET": {8}, "FINGER_1": {11}, "FINGER_2": {11}, "TRINKET_1": {12}, "TRINKET_2": {12},
    "MAIN_HAND": {13, 17, 21}, "OFF_HAND": {13, 14, 22, 23}, "RANGED": {15, 25, 26},
}


# PvP vendor gear names its rank; the other faction's ranks are not for the character (Forever's own PvP items
# carry no rank requirement, only the name tells)
ALLIANCE_PVP = re.compile(r"\b(Marshal|Knight-|Lieutenant Commander|Commander's|Sergeant Major|Corporal)")
HORDE_PVP = re.compile(r"\b(Warlord|General's|Blood Guard|Legionnaire|Centurion|Stone Guard|Champion's|First Sergeant)")
DEPRECATED = 0x10


def pvp_faction(it: dict) -> str | None:
    n = it.get("en", "")
    return "ALLIANCE" if ALLIANCE_PVP.search(n) else "HORDE" if HORDE_PVP.search(n) else None


def usable(it: dict, cls: int, level: int, faction: str | None) -> bool:
    if it["req"] > level or it["ilvl"] > MAX_ILVL or it.get("pvp") or it.get("flags", 0) & DEPRECATED:
        return False
    if it["req"] <= 1 and (it["ilvl"] > level + 5 or it["ilvl"] >= 20):
        return False  # real gear asks for a level; these are copies of other items (legendaries at item level 45…)
    if it["q"] >= 5:
        return False  # legendaries are not anyone's gear plan
    pf = pvp_faction(it)
    if pf and faction and pf != faction:
        return False
    if it["classes"] not in (0, -1) and not it["classes"] & (1 << (cls - 1)):
        return False
    races = it.get("races", -1)
    if races not in (0, -1) and faction:
        if not races & (HORDE_RACES if faction == "HORDE" else ALLIANCE_RACES):
            return False
    if it["cls"] == 4:  # armor
        if it["sub"] == SHIELD:
            return cls in SHIELDS
        if it["slot"] == 16 or it["sub"] == 0:  # cloaks are cloth for everyone; rings, necks, trinkets, held items
            return True
        return it["sub"] == armor_type(cls, level)
    if it["cls"] == 2:  # weapons
        return it["sub"] in WEAPONS.get(cls, set())
    return False


def score(it: dict, w: dict[str, float], slot: str = "") -> float:
    st = it.get("stats") or {}
    s = 0.0
    for k, v in st.items():
        s += w.get(k, 0.0) * v
    for g, names in GROUPS.items():
        if g in w:
            s += w[g] * sum(st.get(n, 0) for n in names if n not in w)
    if "armor" in w and it.get("armor"):
        s += w["armor"] * it["armor"]
    if it.get("dps") and it["cls"] == 2:
        if it["sub"] == 19 or (slot == "RANGED" and not it["sub"]):  # a wand (or a ranged weapon told only by its dps)
            s += max(w.get("dps_wand", 0.0), w.get("dps_ranged", 0.0) if it["sub"] else 0.0) * it["dps"]
        elif it["sub"] in RANGED_SUB:
            s += w.get("dps_ranged", 0.0) * it["dps"]
        elif it["sub"] != 19:
            s += (w.get("dps_off", w.get("dps", 0.0)) if slot == "OFF_HAND" else w.get("dps", 0.0)) * it["dps"]
    return round(s, 2)


def choose(gear: dict[str, dict], cls: int, spec: str, level: int, faction: str | None, top: int = 3) -> dict:
    """For every slot, the best `top` items (ids, best first) with their scores; and whether a two-hand weapon
    beats a main hand plus an off hand."""
    w = WEIGHTS.get((cls, spec)) or WEIGHTS[(cls, CLASSES[cls]["specs"][0])]
    pool = [(int(i), it) for i, it in gear.items() if usable(it, cls, level, faction)]
    out: dict[str, list[dict]] = {}
    for slot, types in SLOTS.items():
        cands = []
        for i, it in pool:
            if it["slot"] not in types:
                continue
            if slot == "OFF_HAND" and it["slot"] in (13, 22) and (cls not in DUAL or (cls, spec) in NO_OFF_WEAPON):
                continue
            if slot == "RANGED" and it["cls"] == 2 and it["sub"] == 19 and cls not in (5, 8, 9):
                continue
            cands.append({"id": i, "score": score(it, w, slot), "two": it["slot"] == 17})
        cands.sort(key=lambda x: (-x["score"], x["id"]))
        out[slot] = cands
    # rings and trinkets: the second slot starts from the next best, the same item can't go in twice
    for a, b in (("FINGER_1", "FINGER_2"), ("TRINKET_1", "TRINKET_2")):
        out[b] = out[b][1:] + out[b][:1]
    # one two-hand weapon, or a main hand and an off hand: whichever adds up to more
    best_two = next((c for c in out["MAIN_HAND"] if c["two"]), None)
    best_one = next((c for c in out["MAIN_HAND"] if not c["two"]), None)
    off = out["OFF_HAND"][0]["score"] if out["OFF_HAND"] else 0.0
    two_hand = bool(best_two and (not best_one or best_two["score"] > best_one["score"] + off))
    mains = [c for c in out["MAIN_HAND"] if c["two"] == two_hand] + [c for c in out["MAIN_HAND"] if c["two"] != two_hand]
    out["MAIN_HAND"] = mains
    return {"twoHand": two_hand, "slots": {k: v[:top] for k, v in out.items()}, "weights": w}


def default_spec(cls: int, trees: list[dict] | None) -> str:
    """The talent tree with the most points spent; the class's first when nothing is spent."""
    specs = CLASSES[cls]["specs"]
    best = None
    for i, t in enumerate(trees or []):
        if i < len(specs) and (best is None or (t.get("points") or 0) > best[0]):
            best = (t.get("points") or 0, specs[i])
    return best[1] if best and best[0] > 0 else specs[0]
