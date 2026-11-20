"""The world map's optional layers: dungeon and raid entrances, flight masters, boats and zeppelins, class and
profession trainers — each point in world-map coordinates (0..1 across Azeroth's map, as components/Seamless).

Where each comes from:
  - flight masters: the WoW Forever client (TaxiNodes: place, name in both languages, which side can fly there);
  - boats and zeppelins: the routes of the classic transports (CMaNGOS `transports` and their gameobject, which names
    the taxi path) and that path's stops in the Forever client (TaxiPathNode nodes that wait at a dock);
  - dungeon and raid entrances: the meeting stones of the classic world (CMaNGOS, a stone stands at every entrance
    and names its instance by area), matched to the hub's dungeon list (names, levels, raid or not); Molten Core and
    Blackwing Lair have their door inside Blackrock Mountain, at its stones; Forever's own dungeons only where the
    hub has their entrance (data/dungeons.json, approximate);
  - trainers: the classic world's creatures (CMaNGOS, GPL v3) that train a class or a profession, with their side
    from the Forever client's faction templates. Classic data, labelled as such: Forever keeps most of its NPCs.

    python tools/build_map_layers.py <ClassicDB_*.sql.gz> <locales_creature.sql> <wago csv dir> [--build 1.60.1.70938]

The csv dir holds the Forever client's TaxiNodes (enUS and _ruRU), TaxiPathNode, UiMapAssignment, AreaTable and
FactionTemplate (wago.tools exports). Out comes frontend/public/map-layers.json; the result is committed.
"""

from __future__ import annotations

import argparse
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
OUT = ROOT / "frontend" / "public" / "map-layers.json"
TRANSPORT_SHIP, TRANSPORT_ZEPPELIN = 3015, 3031  # the transports' display ids
# professions by the words of a trainer's title (classic titles: "Alchemy Trainer", "Expert Leatherworker", ...)
PROF = [(171, r"alchem"), (164, r"blacksmith|armorsmith|weaponsmith"), (333, r"enchant"), (202, r"engineer"),
        (182, r"herbalis"), (165, r"leatherwork"), (186, r"\bmin(er|ing)\b"), (393, r"skinn"), (197, r"tailor"),
        (185, r"\bcook|\bchef"), (129, r"first aid|physician|\bsurgeon|\btrauma"), (356, r"fish")]
NOT_REAL = re.compile(r"^(Transport|Generic|Quest Path|zzOLD|Programmer)", re.I)


def read(p: Path) -> list[dict]:
    csv.field_size_limit(10**8)
    return list(csv.DictReader(p.open(encoding="utf-8")))


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("dump")
    ap.add_argument("locales")
    ap.add_argument("csvdir")
    a = ap.parse_args()
    d = Path(a.csvdir)

    # world coordinates of each continent on Azeroth's map (UiMap 947)
    region = {}
    for r in read(d / "UiMapAssignment.csv"):
        if r["UiMapID"] == "947" and r["MapID"] in ("0", "1"):
            region[int(r["MapID"])] = [float(r[k]) for k in ("Region_0", "Region_1", "Region_3", "Region_4",
                                                             "UiMin_0", "UiMin_1", "UiMax_0", "UiMax_1")]

    def world(mp: int, x: float, y: float) -> dict | None:
        if mp not in region:
            return None
        minx, miny, maxx, maxy, u0, v0, u1, v1 = region[mp]
        return {"u": round(u0 + (maxy - y) / (maxy - miny) * (u1 - u0), 5),
                "v": round(v0 + (maxx - x) / (maxx - minx) * (v1 - v0), 5)}

    sql = gzip.open(a.dump, "rt", encoding="utf-8", errors="replace").read()
    t = tables(sql, {"creature_template", "creature", "gameobject_template", "gameobject", "transports"})
    ru_rows = {}
    for m in re.finditer(r"VALUES \((.*?)\);\n", Path(a.locales).read_text(encoding="utf-8")):
        row = _tuples(f"({m.group(1)})")[0]
        ru_rows[int(row[0])] = (row[1], row[2] if len(row) > 2 else "")

    # --- flight masters (the Forever client) ---
    ru_taxi = {r["ID"]: r["Name_lang"] for r in read(d / "TaxiNodes_ruRU.csv")}
    flights = []
    for r in read(d / "TaxiNodes.csv"):
        i, cont, flags = int(r["ID"]), int(r["ContinentID"]), int(r["Flags"])
        horde, alliance = r["MountCreatureID_0"] != "0", r["MountCreatureID_1"] != "0"
        if cont not in (0, 1) or NOT_REAL.match(r["Name_lang"]) or not (horde or alliance):
            continue
        if i < 1000 and not flags & 3:  # the classic nodes nobody flies to (Northshire, the old Booty Bay one)
            continue
        w = world(cont, float(r["Pos_0"]), float(r["Pos_1"]))
        if w:
            flights.append({**w, "name": {"en": r["Name_lang"], "ru": ru_taxi.get(r["ID"]) or r["Name_lang"]},
                            "side": "both" if horde and alliance else "horde" if horde else "alliance"})

    # --- boats and zeppelins: the classic transports' paths, their stops in the Forever client ---
    nodes = defaultdict(list)
    for r in read(d / "TaxiPathNode.csv"):
        nodes[int(r["PathID"])].append(r)
    gobj = {r["entry"]: r for r in t["gameobject_template"]}
    transport = []
    for tr in t["transports"]:
        g = gobj.get(tr["entry"])
        if not g or g["displayId"] not in (TRANSPORT_SHIP, TRANSPORT_ZEPPELIN):
            continue
        stops = [n for n in sorted(nodes[g["data0"]], key=lambda n: int(n["NodeIndex"])) if int(n["Delay"]) > 0]
        seen = set()
        pts = []
        for n in stops:
            w = world(int(n["ContinentID"]), float(n["Loc_0"]), float(n["Loc_1"]))
            key = (round(float(n["Loc_0"])), round(float(n["Loc_1"])))
            if w and key not in seen:
                seen.add(key)
                pts.append(w)
        kind = "zeppelin" if g["displayId"] == TRANSPORT_ZEPPELIN else "boat"
        for p in pts:
            transport.append({**p, "kind": kind, "route": tr["name"]})

    # --- dungeon and raid entrances: the classic meeting stones, the hub's list of instances ---
    area = {int(r["ID"]): r["AreaName_lang"] for r in read(d / "AreaTable.csv")}
    hub = json.loads((ROOT / "backend/app/data/dungeons.json").read_text())["dungeons"]
    by_name = {x["en"].lower(): x for x in hub}
    stone_t = {r["entry"]: r for r in t["gameobject_template"] if r["type"] == 23}
    stones = {}
    for r in t["gameobject"]:
        s = stone_t.get(r["id"])
        if s and s["data2"] and r["map"] in (0, 1):
            stones.setdefault(s["data2"], world(r["map"], r["position_x"], r["position_y"]))
    inside = {"Molten Core": "Blackrock Depths", "Blackwing Lair": "Blackrock Spire"}  # doors inside the mountain
    dungeons, placed = [], set()

    def add(x: dict, w: dict | None, how: str):
        if w and x["en"] not in placed:
            placed.add(x["en"])
            dungeons.append({**w, "name": {"en": x["en"], "ru": x["ru"]}, "levels": x.get("levels"),
                             "raid": x.get("kind") == "raid", "how": how})

    # the client's area names where they differ from the instance names of the list
    alias = {"the deadmines": "deadmines", "the stockade": "stormwind stockade", "the temple of atal'hakkar": "sunken temple"}
    for aid, w in stones.items():
        name = (area.get(aid) or "").lower()
        x = by_name.get(alias.get(name, name))
        if x:
            add(x, w, "stone")
    for raid, door in inside.items():
        host = next((p for p in dungeons if p["name"]["en"] == door), None)
        if raid.lower() in by_name and host:
            add(by_name[raid.lower()], {"u": host["u"], "v": host["v"]}, "inside")
    for x in hub:  # Forever's own: the hub's approximate entrance
        e = x.get("entrance")
        if e and x["en"] not in placed:
            from_map = e  # {map, x, y} in a zone's per cent
            add(x, {"map": from_map["map"], "x": from_map["x"], "y": from_map["y"]}, "approx")

    # --- trainers (classic creatures, their side by the Forever client's faction templates) ---
    ft = {int(r["ID"]): r for r in read(d / "FactionTemplate.csv")}

    def side(fid: int) -> str | None:
        f = ft.get(fid)
        if not f:
            return None
        grp, friend, enemy = int(f["FactionGroup"]), int(f["FriendGroup"]), int(f["EnemyGroup"])
        a_ok = not enemy & 2 and bool((friend | grp) & 2)
        h_ok = not enemy & 4 and bool((friend | grp) & 4)
        return "both" if a_ok and h_ok else "alliance" if a_ok else "horde" if h_ok else None

    spawn = {}
    for r in t["creature"]:
        if r["map"] in (0, 1):
            spawn.setdefault(r["id"], world(r["map"], r["position_x"], r["position_y"]))
    trainers = []
    for c in t["creature_template"]:
        if not c["NpcFlags"] & 16 or c["Entry"] not in spawn or not spawn[c["Entry"]]:
            continue
        sub = c["SubName"] or ""
        ru_name, ru_sub = ru_rows.get(c["Entry"], (None, None))
        row = {**spawn[c["Entry"]], "name": {"en": c["Name"], "ru": ru_name or c["Name"]},
               "title": {"en": sub, "ru": ru_sub or sub}, "side": side(c["Faction"])}
        if row["side"] is None:
            continue
        if c["TrainerType"] == 0 and c["TrainerClass"]:
            trainers.append({**row, "kind": "class", "cls": c["TrainerClass"]})
        elif c["TrainerType"] == 2:
            prof = next((pid for pid, rx in PROF if re.search(rx, sub, re.I)), None)
            if prof:
                trainers.append({**row, "kind": "prof", "prof": prof})

    out = {"source": {"flights": "WoW Forever client (TaxiNodes)", "transport": "CMaNGOS classic transports, Forever client paths",
                      "dungeons": "CMaNGOS classic meeting stones; Forever's own approximate", "trainers": "CMaNGOS classic (GPL v3)"},
           "flights": flights, "transport": transport, "dungeons": dungeons, "trainers": trainers}
    OUT.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")) + "\n")
    print(f"flights {len(flights)}, transport {len(transport)}, dungeons {len(dungeons)}, trainers {len(trainers)} -> {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
