"""Where wearable items and recipes drop, from the CMaNGOS classic database (github.com/cmangos/classic-db, GPL v3): which
creatures drop each item and how often, where they are (a dungeon, or a zone with the spot on its map), whether the
creature is a boss or a rare, and when an item is a world drop (shared loot tables that hundreds of creatures use).

This is the original game's data, labelled as such on the pages: Forever keeps most of its creatures and loot, but
new Forever items are not in it and Forever may have changed rates. ForeverDB uses the same database for its
"Classic drop rate". Quest rewards come from Blizzard's own Forever data (tools/build_quests.py).

    python tools/build_loot.py <ClassicDB_*.sql.gz> <locales_creature.sql> <dir with Item/UiMap/UiMapAssignment csv>

Out comes backend/app/data/loot.json. Run by hand when the database moves on; the result is committed.
"""

from __future__ import annotations

import csv
import gzip
import json
import re
import sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "backend" / "app" / "data" / "loot.json"
WEARABLE = {1, 2, 3, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 20, 21, 22, 23, 25, 26}
TOP = 6  # creatures kept per item, most likely first
WORLD = 25  # an item reached through a shared table by this many kinds of creature is a world drop


def tables(sql: str, names: set[str]) -> dict[str, list[list]]:
    """The rows of some tables from a MySQL dump (INSERT INTO `t` VALUES (...),(...);)."""
    out: dict[str, list[list]] = {n: [] for n in names}
    cols: dict[str, list[str]] = {}
    for m in re.finditer(r"CREATE TABLE `(\w+)` \((.*?)\n\)", sql, re.S):
        if m.group(1) in names:
            cols[m.group(1)] = re.findall(r"^\s+`(\w+)`", m.group(2), re.M)
    for m in re.finditer(r"INSERT INTO `(\w+)`(?: \([^)]*\))? VALUES (.*?);\n", sql, re.S):
        if m.group(1) in names:
            out[m.group(1)] += _tuples(m.group(2))
    return {n: [dict(zip(cols.get(n, []), r)) for r in rows] for n, rows in out.items()}


def _tuples(s: str) -> list[list]:
    rows, row, i, n = [], None, 0, len(s)
    while i < n:
        c = s[i]
        if c == "(" and row is None:
            row, i = [], i + 1
            continue
        if row is None:
            i += 1
            continue
        if c == "'":
            j, buf = i + 1, []
            while j < n:
                if s[j] == "\\":
                    buf.append(s[j + 1]); j += 2; continue
                if s[j] == "'":
                    if j + 1 < n and s[j + 1] == "'":
                        buf.append("'"); j += 2; continue
                    break
                buf.append(s[j]); j += 1
            row.append("".join(buf)); i = j + 1
            continue
        if c in ",) \n":
            if c == ")":
                rows.append(row); row = None
            i += 1
            continue
        j = i
        while j < n and s[j] not in ",)":
            j += 1
        tok = s[i:j].strip()
        row.append(None if tok == "NULL" else float(tok) if ("." in tok or "e" in tok) else int(tok))
        i = j
    return rows


def chances(rows: list[dict]) -> dict[int, list[tuple[int, float, bool]]]:
    """Per loot table: (item or -reference, chance in %, quest item) with groups' equal shares worked out."""
    by: dict[int, list[dict]] = defaultdict(list)
    for r in rows:
        by[r["entry"]].append(r)
    out: dict[int, list] = {}
    for entry, rs in by.items():
        groups: dict[int, list] = defaultdict(list)
        res = []
        for r in rs:
            if r["groupid"]:
                groups[r["groupid"]].append(r)
            else:
                ref = r["mincountOrRef"] < 0
                res.append((-r["mincountOrRef"] if ref else r["item"], abs(r["ChanceOrQuestChance"]), r["ChanceOrQuestChance"] < 0, ref))
        for g in groups.values():  # one of the group drops: explicit chances, the rest share what is left
            fixed = sum(abs(r["ChanceOrQuestChance"]) for r in g)
            zero = [r for r in g if not r["ChanceOrQuestChance"]]
            share = max(0.0, 100 - fixed) / len(zero) if zero else 0
            for r in g:
                ref = r["mincountOrRef"] < 0
                c = abs(r["ChanceOrQuestChance"]) or share
                res.append((-r["mincountOrRef"] if ref else r["item"], c, r["ChanceOrQuestChance"] < 0, ref))
        out[entry] = res
    return out


def main() -> None:
    dump, locales, csvdir = sys.argv[1], sys.argv[2], Path(sys.argv[3])
    sql = gzip.open(dump, "rt", encoding="utf-8", errors="replace").read()
    t = tables(sql, {"creature_template", "creature", "creature_loot_template", "reference_loot_template", "quest_template"})
    ru = {int(m.group(1)): m.group(2) for m in re.finditer(r"VALUES \((\d+), '((?:[^'\\]|\\.)*)'", open(locales, encoding="utf-8").read())}
    rows_ = list(csv.DictReader(open(csvdir / "Item.enUS.csv")))
    kind = {int(r["ID"]): int(r["InventoryType"]) for r in rows_}
    # wearable items, and recipes (item class 9): who drops a recipe is the question "where to learn it" leaves open
    wanted = {i for i, it in kind.items() if it in WEARABLE} | {int(r["ID"]) for r in rows_ if r.get("ClassID") == "9"}

    # where each creature is: its first spawn, and the zone it stands in on the open-world continents
    assign = [r for r in csv.DictReader(open(csvdir / "UiMapAssignment.enUS.csv"))]
    uitype = {r["ID"]: r["Type"] for r in csv.DictReader(open(csvdir / "UiMap.enUS.csv"))}
    zones = [r for r in assign if uitype.get(r["UiMapID"]) == "3" and r["MapID"] in ("0", "1")]

    def zone_of(mp: int, x: float, y: float):
        for z in zones:
            if int(z["MapID"]) == mp and float(z["Region_0"]) <= x <= float(z["Region_3"]) and float(z["Region_1"]) <= y <= float(z["Region_4"]):
                u = float(z["UiMin_0"]) + (float(z["Region_4"]) - y) / (float(z["Region_4"]) - float(z["Region_1"])) * (float(z["UiMax_0"]) - float(z["UiMin_0"]))
                v = float(z["UiMin_1"]) + (float(z["Region_3"]) - x) / (float(z["Region_3"]) - float(z["Region_0"])) * (float(z["UiMax_1"]) - float(z["UiMin_1"]))
                return int(z["UiMapID"]), round(u * 100, 1), round(v * 100, 1)
        return None

    spawn: dict[int, dict] = {}
    for r in t["creature"]:
        s = spawn.setdefault(r["id"], {"map": r["map"], "x": r["position_x"], "y": r["position_y"], "n": 0})
        s["n"] += 1
    loot = chances(t["creature_loot_template"])
    refs = chances(t["reference_loot_template"])

    def expand(entries, depth=0):
        """(item, chance %, quest) through references, chances multiplied down."""
        for item, c, q, ref in entries:
            if ref:
                if depth < 3:
                    for i2, c2, q2 in expand(refs.get(item, []), depth + 1):
                        yield i2, c * c2 / 100, q2
            else:
                yield item, c, q

    drops: dict[int, list] = defaultdict(list)
    via_ref: dict[int, set] = defaultdict(set)
    creatures: dict[int, dict] = {}
    for ct in t["creature_template"]:
        lid = ct.get("LootId")
        if not lid or lid not in loot or ct["Entry"] not in spawn:
            continue  # no loot, or never placed in the world (a template nothing uses)
        direct = {item for item, _, _, ref in loot[lid] if not ref}
        mine: dict[int, float] = defaultdict(float)  # one line per item and creature, however many tables lead to it
        for item, c, q in expand(loot[lid]):
            if item in wanted and c > 0:
                mine[item] += c
        for item, c in mine.items():
            drops[item].append((ct["Entry"], round(min(100.0, c), 3)))
            if item not in direct:
                via_ref[item].add(ct["Entry"])
            if ct["Entry"] not in creatures:
                sp = spawn.get(ct["Entry"]) or {}
                z = zone_of(sp["map"], sp["x"], sp["y"]) if sp.get("map") in (0, 1) else None
                creatures[ct["Entry"]] = {
                    "en": ct["Name"], "ru": ru.get(ct["Entry"]) or ct["Name"], "rank": ct.get("Rank", 0),
                    "lvl": [ct.get("MinLevel"), ct.get("MaxLevel")], "map": sp.get("map"),
                    "zone": z[0] if z else None, "x": z[1] if z else None, "y": z[2] if z else None,
                    "spawns": sp.get("n", 0),
                }
    items = {}
    used = set()
    for item, xs in drops.items():
        xs.sort(key=lambda d: (-d[1], d[0]))
        top = xs[:TOP]
        used.update(e for e, _ in top)
        items[str(item)] = {"d": top, "n": len(xs), "world": len(via_ref[item]) >= WORLD}
    # zone names (both languages) for the creatures' zones, and which quests belong to a chain
    names_en = {r["ID"]: r["Name_lang"] for r in csv.DictReader(open(csvdir / "UiMap.enUS.csv"))}
    names_ru = {r["ID"]: r["Name_lang"] for r in csv.DictReader(open(csvdir / "UiMap.ruRU.csv"))}
    zs = {str(c["zone"]) for c in creatures.values() if c.get("zone")}
    chain = sorted(q["entry"] for q in t["quest_template"]
                   if q.get("PrevQuestId") or q.get("NextQuestId") or q.get("NextQuestInChain"))
    # quests only one side can take (by the races allowed): "A" or "H"
    ally, horde = 1 | 4 | 8 | 64, 2 | 16 | 32 | 128
    side = {str(q["entry"]): ("A" if not q["RequiredRaces"] & horde else "H")
            for q in t["quest_template"] if q.get("RequiredRaces") and not (q["RequiredRaces"] & ally and q["RequiredRaces"] & horde)}
    OUT.write_text(json.dumps({"source": "CMaNGOS classic-db (GPL v3), the original game's data",
                               "items": items, "creatures": {str(e): creatures[e] for e in sorted(used)},
                               "zones": {z: [names_en.get(z, z), names_ru.get(z) or names_en.get(z, z)] for z in sorted(zs)},
                               "chain": chain, "side": side},
                              ensure_ascii=False, separators=(",", ":")), "utf-8")
    print("wrote", OUT, len(items), "items", len(used), "creatures")


if __name__ == "__main__":
    main()
