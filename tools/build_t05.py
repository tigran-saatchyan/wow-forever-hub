"""The Dungeon Set 2 (Tier 0.5) chain: from a class's Tier 0 pieces to its Tier 0.5 set, every quest in order with
who gives it and where, what it asks for (items and counts, gold, creatures), and the four class quests that
trade Tier 0 pieces for Tier 0.5 ones — for every class and both sides.

The quests come from the CMaNGOS classic database (GPL v3): the chain, its givers and their places, the items and
counts. The quest ids are the ones WoW Forever uses (its own quest data names them, data/quest_rewards.json),
and the pages take the quests' names and texts in the page's language from Forever's data. Where Forever differs —
the set has a second, Shadow, version to choose — the server asks ForeverDB (app/routers/t05.py).

    python tools/build_t05.py <ClassicDB_*.sql.gz> <locales_creature.sql> <wago csv dir>

The csv dir holds the Forever client's UiMap, UiMapAssignment, ItemSparse (_enUS, _ruRU). Out comes
frontend/src/lib/t05.json (the map's chain, the raids page) and backend/app/data/t05.json (the server); both committed.
"""

from __future__ import annotations

import csv
import gzip
import json
import re
import sys
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_loot import _tuples, tables  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "frontend" / "src" / "lib" / "t05.json"
OUT_SERVER = ROOT / "backend" / "app" / "data" / "t05.json"  # the same data for the server
HORDE, ALLIANCE = 2 | 16 | 32 | 128, 1 | 4 | 8 | 64
CLASSES = {1: "WARRIOR", 2: "PALADIN", 3: "HUNTER", 4: "ROGUE", 5: "PRIEST", 7: "SHAMAN", 8: "MAGE", 9: "WARLOCK", 11: "DRUID"}
# the four class quests, by their (classic) titles: the Tier 0 pieces each takes
CLASS_QUESTS = ["An Earnest Proposition", "Just Compensation", "Anthion's Parting Words", "Saving the Best for Last"]
# instances where chain NPCs and summoned bosses stand, by the classic map id, and their area (meeting stone)
INSTANCE = {329: 2017, 289: 2057, 429: 2557, 229: 1583, 230: 1584}
# NPCs the event brings (no spawn of their own): where they appear
APPEAR = {"Ysida Harmon": 2017, "Spirit of Lord Valthalak": 1583}
# the summoned bosses have no spawn: where each is called (well-known from the original game)
SUMMONED = {"Mor Grayhoof": 1583, "Isalien": 2557, "Jarien": 2017, "Sothos": 2017, "Kormok": 2057, "Lord Valthalak": 1583}
SLOT = {1: "HEAD", 3: "SHOULDER", 5: "CHEST", 20: "CHEST", 6: "WAIST", 7: "LEGS", 8: "FEET", 9: "WRIST", 10: "HANDS"}


def read(p: Path) -> list[dict]:
    csv.field_size_limit(10**8)
    return list(csv.DictReader(p.open(encoding="utf-8")))


def main() -> None:
    dump, locales, d = sys.argv[1], sys.argv[2], Path(sys.argv[3])
    sql = gzip.open(dump, "rt", encoding="utf-8", errors="replace").read()
    t = tables(sql, {"quest_template", "creature_questrelation", "creature_involvedrelation", "item_template",
                     "creature_template", "creature", "gameobject", "gameobject_template"})
    Q = {q["entry"]: q for q in t["quest_template"]}
    item = {i["entry"]: i for i in t["item_template"]}
    cr = {c["Entry"]: c for c in t["creature_template"]}
    ru_cr = {}
    for m in re.finditer(r"VALUES \((.*?)\);\n", Path(locales).read_text(encoding="utf-8")):
        row = _tuples(f"({m.group(1)})")[0]
        ru_cr[int(row[0])] = row[1]
    ru_item = {int(r["ID"]): r["Display_lang"] for r in read(d / "ItemSparse_ruRU.csv")}

    # where a creature stands: its zone map and the place on it; inside an instance, the instance's entrance
    uitype = {r["ID"]: r["Type"] for r in read(d / "UiMap.csv")}
    zones = [r for r in read(d / "UiMapAssignment.csv") if uitype.get(r["UiMapID"]) == "3" and r["MapID"] in ("0", "1")]

    def zone_of(mp: int, x: float, y: float) -> dict | None:
        for z in zones:
            if int(z["MapID"]) == mp and float(z["Region_0"]) <= x <= float(z["Region_3"]) and float(z["Region_1"]) <= y <= float(z["Region_4"]):
                u = float(z["UiMin_0"]) + (float(z["Region_4"]) - y) / (float(z["Region_4"]) - float(z["Region_1"])) * (float(z["UiMax_0"]) - float(z["UiMin_0"]))
                v = float(z["UiMin_1"]) + (float(z["Region_3"]) - x) / (float(z["Region_3"]) - float(z["Region_0"])) * (float(z["UiMax_1"]) - float(z["UiMin_1"]))
                return {"map": int(z["UiMapID"]), "x": round(u * 100, 1), "y": round(v * 100, 1)}
        return None

    stone_t = {r["entry"]: r["data2"] for r in t["gameobject_template"] if r["type"] == 23}
    entrance = {}
    for r in t["gameobject"]:
        a = stone_t.get(r["id"])
        if a and r["map"] in (0, 1) and a not in entrance:
            entrance[a] = zone_of(r["map"], r["position_x"], r["position_y"])
    spawn = {}
    for r in t["creature"]:
        if r["id"] in spawn:
            continue
        if r["map"] in (0, 1):
            spawn[r["id"]] = zone_of(r["map"], r["position_x"], r["position_y"])
        elif r["map"] in INSTANCE:
            e = entrance.get(INSTANCE[r["map"]])
            spawn[r["id"]] = {**e, "inside": INSTANCE[r["map"]]} if e else None

    def npc(cid: int) -> dict:
        c = cr[cid]
        at = spawn.get(cid)
        if not at and c["Name"] in APPEAR and entrance.get(APPEAR[c["Name"]]):
            at = {**entrance[APPEAR[c["Name"]]], "inside": APPEAR[c["Name"]]}
        return {"id": cid, "who": {"en": c["Name"], "ru": ru_cr.get(cid) or c["Name"]}, **(at or {})}

    givers, enders = defaultdict(list), defaultdict(list)
    for r in t["creature_questrelation"]:
        givers[r["quest"]].append(r["id"])
    for r in t["creature_involvedrelation"]:
        enders[r["quest"]].append(r["id"])

    def iname(i: int) -> dict:
        en = item.get(i, {}).get("name") or f"#{i}"
        return {"en": en, "ru": ru_item.get(i) or en}

    def quest(e: int) -> dict:
        q = Q[e]
        # the item's class (7 trade goods, 0 consumables, 12 quest items...) and binding (1 on pickup): what can be
        # bought or gathered ahead apart from what the chain itself or a dungeon hands out
        need = [{"id": q[f"ReqItemId{i}"], "count": q[f"ReqItemCount{i}"], "name": iname(q[f"ReqItemId{i}"]),
                 "cls": item.get(q[f"ReqItemId{i}"], {}).get("class"), "bind": item.get(q[f"ReqItemId{i}"], {}).get("bonding")}
                for i in range(1, 5) if q[f"ReqItemId{i}"]]
        kill = []
        for i in range(1, 5):
            c = q[f"ReqCreatureOrGOId{i}"]
            if c > 0 and c in cr:
                where = SUMMONED.get(cr[c]["Name"])
                kill.append({"id": c, "name": {"en": cr[c]["Name"], "ru": ru_cr.get(c) or cr[c]["Name"]},
                             "count": q[f"ReqCreatureOrGOCount{i}"],
                             "at": ({**entrance[where], "inside": where} if where and entrance.get(where) else spawn.get(c)),
                             "summon": cr[c]["Name"] in SUMMONED})
        rew = [q[f"RewChoiceItemId{i}"] for i in range(1, 7) if q[f"RewChoiceItemId{i}"]] + \
              [q[f"RewItemId{i}"] for i in range(1, 5) if q[f"RewItemId{i}"]]
        return {"id": e, "title": q["Title"], "level": q["MinLevel"], "giver": [npc(g) for g in givers[e] if g in cr][:1],
                "turnin": [npc(g) for g in enders[e] if g in cr][:1], "need": need, "kill": kill,
                "gold": max(0, -q["RewOrReqMoney"]) if q["RewOrReqMoney"] < 0 else 0,
                "given": q["SrcItemId"] or None, "reward": [{"id": r, "name": iname(r)} for r in rew]}

    # what follows a quest: the next in its chain (else the one it opens), and every quest that needs it done
    nxt = defaultdict(set)
    for q in Q.values():
        if q["PrevQuestId"] > 0:
            nxt[q["PrevQuestId"]].add(q["entry"])
        n = q["NextQuestInChain"] if q["NextQuestInChain"] > 0 else q["NextQuestId"]
        if n > 0:
            nxt[q["entry"]].add(n)

    def walk(start: int, races: int, cls_bit: int) -> list[list[int]]:
        """The chain from its first quest, as steps: one quest, or the variants of a step (one of them is done)."""
        steps, cur, seen = [], [start], set()
        while cur:
            ok = [e for e in cur if e in Q and e not in seen and (not Q[e]["RequiredRaces"] or Q[e]["RequiredRaces"] & races)
                  and (not Q[e]["RequiredClasses"] or Q[e]["RequiredClasses"] & cls_bit)]
            if not ok:
                break
            seen.update(ok)
            steps.append(sorted(ok))
            # the next step: what follows any of these (the variants join again into one)
            cur = sorted({n for e in ok for n in nxt[e]} - seen)
            # a branch of variants whose next quests join: keep the variants together, step by step
        return steps

    out = {"source": "CMaNGOS classic database (GPL v3); quest ids as in WoW Forever", "quests": {}, "chains": {}, "sets": {}}
    for cid, token in CLASSES.items():
        bit = 1 << (cid - 1)
        for side, races in (("HORDE", HORDE), ("ALLIANCE", ALLIANCE)):
            start = next((q["entry"] for q in Q.values() if q["Title"] == CLASS_QUESTS[0] and q["RequiredClasses"] & bit
                          and q["RequiredRaces"] & races), None)
            if not start:
                continue
            steps = walk(start, races, bit)
            out["chains"][f"{cid}:{side}"] = steps
            for st in steps:
                for e in st:
                    out["quests"].setdefault(str(e), quest(e))
            # the set: Tier 0 pieces handed in and the Tier 0.5 ones given, by slot
            sets = {}
            for st in steps:
                for e in st:
                    q = Q[e]
                    if q["Title"] not in CLASS_QUESTS:
                        continue
                    t0 = [q[f"ReqItemId{i}"] for i in range(1, 5) if q[f"ReqItemId{i}"] and item.get(q[f"ReqItemId{i}"], {}).get("InventoryType") in SLOT]
                    t5 = [q[f"RewChoiceItemId{i}"] for i in range(1, 7) if q[f"RewChoiceItemId{i}"]] + \
                         [q[f"RewItemId{i}"] for i in range(1, 5) if q[f"RewItemId{i}"]]
                    for a in t0:
                        slot = SLOT[item[a]["InventoryType"]]
                        b = next((x for x in t5 if SLOT.get(item.get(x, {}).get("InventoryType")) == slot), None)
                        sets[slot] = {"t0": {"id": a, "name": iname(a)}, "t05": {"id": b, "name": iname(b)} if b else None, "quest": e}
            out["sets"][f"{cid}:{side}"] = sets
    text = json.dumps(out, ensure_ascii=False, separators=(",", ":")) + "\n"
    OUT.write_text(text)
    OUT_SERVER.write_text(text)
    print(f"chains {len(out['chains'])}, quests {len(out['quests'])} -> {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
