"""Where a recipe comes from: the trainers who teach it (and for how much) and the vendors who sell its recipe item
(and whether their stock is limited), each with their place (zone, map coordinates) and side — from the CMaNGOS
classic database (GPL v3), the original game's NPCs, which Forever keeps nearly all of. ForeverDB, where it knows
more (Forever's own vendors, prices players saw), comes first on the pages; this fills what it leaves open.

    python tools/build_recipe_sources.py <ClassicDB_*.sql.gz> <locales_creature.sql> <wago csv dir>

The csv dir holds the Forever client's SkillLineAbility, SpellEffect, Item, UiMap (_ruRU too), UiMapAssignment and
FactionTemplate. Out comes backend/app/data/recipe_sources.json; the result is committed.
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
from build_map_layers import PROF  # noqa: E402  (a profession trainer's profession by the words of their title)

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "backend" / "app" / "data" / "recipe_sources.json"
PROFS = {171, 164, 333, 202, 182, 186, 393, 165, 197, 185, 129, 356}
# the capitals' map ids (a trainer there is "in the city")
CITIES = {1453, 1454, 1455, 1456, 1457, 1458}


def read(p: Path) -> list[dict]:
    csv.field_size_limit(10**8)
    return list(csv.DictReader(p.open(encoding="utf-8")))


def main() -> None:
    dump, locales, d = sys.argv[1], sys.argv[2], Path(sys.argv[3])
    sql = gzip.open(dump, "rt", encoding="utf-8", errors="replace").read()
    t = tables(sql, {"npc_trainer", "npc_trainer_template", "npc_vendor", "npc_vendor_template", "creature_template", "creature"})
    ru = {}
    for m in re.finditer(r"VALUES \((.*?)\);\n", Path(locales).read_text(encoding="utf-8")):
        row = _tuples(f"({m.group(1)})")[0]
        ru[int(row[0])] = (row[1], row[2] if len(row) > 2 else "")

    recipe_spells = {int(r["Spell"]) for r in read(d / "SkillLineAbility.csv") if int(r["SkillLine"]) in PROFS}
    learn = {}  # a trainer's "teach" spell -> the recipe spell it teaches
    for r in read(d / "SpellEffect.csv"):
        if r["Effect"] == "36" and int(r["EffectTriggerSpell"] or 0):
            learn[int(r["SpellID"])] = int(r["EffectTriggerSpell"])
    recipe_items = {int(r["ID"]) for r in read(d / "Item.csv") if r["ClassID"] == "9"}

    # where each creature stands: its zone (UiMap) and the place on it
    uitype = {r["ID"]: r["Type"] for r in read(d / "UiMap.csv")}
    zones = [r for r in read(d / "UiMapAssignment.csv") if uitype.get(r["UiMapID"]) in ("3", "4", "5") and r["MapID"] in ("0", "1")]
    # cities (type 3 too in this client, nested in their zone) first: the smallest region wins
    zones.sort(key=lambda z: (float(z["Region_3"]) - float(z["Region_0"])) * (float(z["Region_4"]) - float(z["Region_1"])))

    def zone_of(mp: int, x: float, y: float) -> dict | None:
        for z in zones:
            if int(z["MapID"]) == mp and float(z["Region_0"]) <= x <= float(z["Region_3"]) and float(z["Region_1"]) <= y <= float(z["Region_4"]):
                u = float(z["UiMin_0"]) + (float(z["Region_4"]) - y) / (float(z["Region_4"]) - float(z["Region_1"])) * (float(z["UiMax_0"]) - float(z["UiMin_0"]))
                v = float(z["UiMin_1"]) + (float(z["Region_3"]) - x) / (float(z["Region_3"]) - float(z["Region_0"])) * (float(z["UiMax_1"]) - float(z["UiMin_1"]))
                return {"map": int(z["UiMapID"]), "x": round(u * 100, 1), "y": round(v * 100, 1)}
        return None

    spawn = {}
    for r in t["creature"]:
        if r["id"] not in spawn and r["map"] in (0, 1):
            spawn[r["id"]] = zone_of(r["map"], r["position_x"], r["position_y"])
    ft = {int(r["ID"]): r for r in read(d / "FactionTemplate.csv")}

    def side(fid: int) -> str | None:
        f = ft.get(fid)
        if not f:
            return None
        grp, friend, enemy = int(f["FactionGroup"]), int(f["FriendGroup"]), int(f["EnemyGroup"])
        a_ok = not enemy & 2 and bool((friend | grp) & 2)
        h_ok = not enemy & 4 and bool((friend | grp) & 4)
        return "both" if a_ok and h_ok else "alliance" if a_ok else "horde" if h_ok else "both"

    by_tpl_trainer, by_tpl_vendor = defaultdict(list), defaultdict(list)
    for c in t["creature_template"]:
        if c.get("TrainerTemplateId"):
            by_tpl_trainer[c["TrainerTemplateId"]].append(c["Entry"])
        if c.get("VendorTemplateId"):
            by_tpl_vendor[c["VendorTemplateId"]].append(c["Entry"])

    trainers: dict[int, dict[int, int]] = defaultdict(dict)  # recipe spell -> {creature: cost}
    for rows, tpl in ((t["npc_trainer"], False), (t["npc_trainer_template"], True)):
        for r in rows:
            sp = learn.get(r["spell"], r["spell"])
            if sp not in recipe_spells:
                continue
            for e in (by_tpl_trainer[r["entry"]] if tpl else [r["entry"]]):
                trainers[sp][e] = r["spellcost"]
    vendors: dict[int, dict[int, int]] = defaultdict(dict)  # recipe item -> {creature: limited stock (0: no limit)}
    for rows, tpl in ((t["npc_vendor"], False), (t["npc_vendor_template"], True)):
        for r in rows:
            if r["item"] not in recipe_items:
                continue
            for e in (by_tpl_vendor[r["entry"]] if tpl else [r["entry"]]):
                vendors[r["item"]][e] = r["maxcount"] or 0

    cr = {c["Entry"]: c for c in t["creature_template"]}
    # every profession trainer (the original game's teaching spells are mostly not in Forever's client, so who
    # teaches which recipe can't be told for most: a recipe "from a trainer" points to its profession's trainers)
    by_prof: dict[int, list[int]] = defaultdict(list)
    for c in t["creature_template"]:
        if c["NpcFlags"] & 16 and c["TrainerType"] == 2 and spawn.get(c["Entry"]):
            pid = next((p for p, rx in PROF if re.search(rx, c["SubName"] or "", re.I)), None)
            if pid:
                by_prof[pid].append(c["Entry"])
    used = {e for x in list(trainers.values()) + list(vendors.values()) for e in x if e in spawn and spawn[e]}
    used |= {e for xs in by_prof.values() for e in xs}
    npcs = {}
    for e in used:
        c = cr[e]
        name_ru, sub_ru = ru.get(e, (None, None))
        npcs[str(e)] = {"en": c["Name"], "ru": name_ru or c["Name"], "sub": {"en": c["SubName"] or "", "ru": sub_ru or c["SubName"] or ""},
                        "side": side(c["Faction"]), **spawn[e], "city": spawn[e]["map"] in CITIES}
    names = {r["ID"]: r["Name_lang"] for r in read(d / "UiMap.csv")}
    names_ru = {r["ID"]: r["Name_lang"] for r in read(d / "UiMap_ruRU.csv")} if (d / "UiMap_ruRU.csv").exists() else {}
    zone_ids = {str(n["map"]) for n in npcs.values()}
    out = {"source": "CMaNGOS classic database (GPL v3)",
           "trainers": {str(k): {str(e): c for e, c in v.items() if str(e) in npcs} for k, v in trainers.items()},
           "vendors": {str(k): {str(e): n for e, n in v.items() if str(e) in npcs} for k, v in vendors.items()},
           "profTrainers": {str(k): [str(e) for e in v] for k, v in by_prof.items()},
           "npcs": npcs, "zones": {z: {"en": names.get(z, z), "ru": names_ru.get(z) or names.get(z, z)} for z in zone_ids}}
    out["trainers"] = {k: v for k, v in out["trainers"].items() if v}
    out["vendors"] = {k: v for k, v in out["vendors"].items() if v}
    OUT.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")) + "\n")
    print(f"recipe spells taught: {len(out['trainers'])}, recipe items sold: {len(out['vendors'])}, npcs: {len(npcs)} -> {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
