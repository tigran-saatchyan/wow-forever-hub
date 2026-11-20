"""The buffs the pre-raid simulation can switch on, with their values from the game's own files.

Food, elixirs, flasks, the pre-pull potion and weapon oils (by item), the buffs other classes cast, and the buffs
other players give through a talent (with the class, the specialization and the talent). Every number, duration,
name and icon comes from the client tables of the build (exported by wago.tools) and the community listfile;
nothing is typed in by hand except which spells belong to the list.

Forever is not classic: its food is "Nutritious Food" whose well-fed value lives in the food's own spell (the
buff itself carries 1), Shadow Weaving and Improved Shadow Bolt only raise the caster's own damage, and the
warlock has no Curse of Shadow; so the list is built from what this client actually has.

    python tools/build_sim_buffs.py --build 1.60.1.70938 [--cache DIR] [--listfile legacy/.cache/icons_listfile.csv]
"""
from __future__ import annotations

import argparse
import collections
import csv
import json
import re
import sys
from pathlib import Path

import httpx

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "backend/app/data/sim_buffs.json"
WAGO = "https://wago.tools/db2/{table}/csv?build={build}"

# item consumables by group; one of a kind for food, flask and oil (the game keeps one), any number of elixirs
CONSUMABLES = {
    "food": [13935, 13931, 18254],
    "elixir": [13454, 9155, 9264, 13447, 20007],
    "flask": [13512, 13511, 13510],
    "potion": [250937],
    "oil": [20750, 20749],
}
# buffs other classes cast: (class token, the spell cast, the aura it leaves when that is another spell)
CLASS = [
    ("MAGE", 23028, None), ("PRIEST", 21564, None), ("PRIEST", 27681, None), ("DRUID", 21850, None),
    ("SHAMAN", 10497, 10494), ("PALADIN", 25918, None), ("PALADIN", 25898, None), ("WARLOCK", 11767, None),
]
# buffs given through another player's talent: (class token, talent id, the aura, the spell cast if not the aura)
TALENT = [
    ("PRIEST", 105836, 10060, None),      # Power Infusion
    ("PRIEST", 105823, 1326168, None),    # Dark Inspiration
    ("DRUID", 104937, 24907, 24858),      # Moonkin Form -> Moonkin Aura
    ("DRUID", 104955, 24932, 17007),      # Leader of the Pack
    ("SHAMAN", 104728, 16191, 16190),     # Mana Tide Totem
    ("SHAMAN", 104730, None, None),       # Restorative Totems: Mana Spring Totem stronger
]
STAT = {0: "str", 1: "agi", 2: "sta", 3: "int", 4: "spi"}
SCHOOL = {2: "holy", 4: "fire", 8: "nature", 16: "frost", 32: "shadow", 64: "arcane"}


def table(name: str, build: str, cache: Path, locale: str | None = None) -> list[dict]:
    f = cache / f"{name}{'_' + locale if locale else ''}.csv"
    if not f.exists():
        url = WAGO.format(table=name, build=build) + (f"&locale={locale}" if locale else "")
        r = httpx.get(url, timeout=180)
        r.raise_for_status()
        f.write_text(r.text, encoding="utf-8")
    csv.field_size_limit(10**8)
    return list(csv.DictReader(f.open(encoding="utf-8")))


def num(x: str) -> float:
    v = float(x or 0)
    return int(v) if v == int(v) else v


def effects(rows: list[dict], value: float | None = None) -> dict:
    """What an aura's effects add, by stat; `value` replaces the points (food passes its own to the buff)."""
    out: dict = {}

    def add(k: str, v: float, sub: str | None = None):
        if sub:
            out.setdefault(k, {})
            out[k][sub] = out[k].get(sub, 0) + v
        else:
            out[k] = out.get(k, 0) + v

    for e in rows:
        a, bp, misc = int(e["EffectAura"]), num(e["EffectBasePointsF"]), int(e["EffectMiscValue_0"] or 0)
        if value is not None:
            bp = value
        if a == 29:  # stat
            for i in (STAT if misc == -1 else [misc]):
                if i in STAT:
                    add(STAT[i], bp)
        elif a == 137:  # stat, per cent; which stats is a mask in the second value (31 all five, 16 spirit)
            mask = int(e["EffectMiscValue_1"] or 0) or (31 if misc == -1 else 1 << misc)
            for i in STAT:
                if mask & (1 << i):
                    add("pct", bp, STAT[i])
        elif a == 13:  # spell damage
            if misc & 126 == 126:
                add("sp", bp)
            else:
                for m, s in SCHOOL.items():
                    if misc & m:
                        add("school", bp, s)
        elif a == 79 and misc & 32:  # damage done, per cent (counted for Shadow)
            add("dmgPct", bp)
        elif a in (57, 290):
            add("crit", bp)
        elif a == 55:
            add("hit", bp)
        elif a == 85:
            add("mp5", bp)
        elif a == 24 and int(e["EffectAuraPeriod"] or 0):  # mana every few seconds
            add("mp5", round(bp * 5000 / int(e["EffectAuraPeriod"]), 2))
        elif a == 34:
            add("hp", bp)
        elif a == 418:
            add("mana", bp)
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--build", required=True)
    ap.add_argument("--cache", default="/tmp/fh-sim-cache")
    ap.add_argument("--listfile", default=str(ROOT / "legacy/.cache/icons_listfile.csv"))
    a = ap.parse_args()
    cache = Path(a.cache)
    cache.mkdir(parents=True, exist_ok=True)

    eff = collections.defaultdict(list)
    for r in table("SpellEffect", a.build, cache):
        eff[int(r["SpellID"])].append(r)
    misc = {int(r["SpellID"]): r for r in table("SpellMisc", a.build, cache)}
    dur = {int(r["ID"]): int(r["Duration"]) for r in table("SpellDuration", a.build, cache)}
    names = {lg: {int(r["ID"]): r["Name_lang"] for r in table("SpellName", a.build, cache, loc)}
             for lg, loc in (("en", "enUS"), ("ru", "ruRU"))}
    items = {lg: {int(r["ID"]): r for r in table("ItemSparse", a.build, cache, loc)} for lg, loc in (("en", "enUS"), ("ru", "ruRU"))}
    ie = {r["ID"]: r for r in table("ItemEffect", a.build, cache)}
    use = collections.defaultdict(list)
    for r in table("ItemXItemEffect", a.build, cache):
        x = ie.get(r["ItemEffectID"])
        if x and x["TriggerType"] == "0":
            use[int(r["ItemID"])].append(int(x["SpellID"]))
    ench = {int(r["ID"]): r for r in table("SpellItemEnchantment", a.build, cache)}
    item_icon = {int(r["ID"]): int(r["IconFileDataID"] or 0) for r in table("Item", a.build, cache)}
    lf = {}
    for line in Path(a.listfile).open(encoding="utf-8"):
        fid, _, path = line.strip().partition(";")
        if path.startswith("interface/icons/"):
            lf[int(fid)] = path.rsplit("/", 1)[-1].removesuffix(".blp")
    talents = {lg: json.loads((ROOT / f"data/talents/{a.build}/{lg}.json").read_text()) for lg in ("en", "ru")}

    def duration(sid: int) -> int | None:
        m = misc.get(sid)
        return dur.get(int(m["DurationIndex"])) if m else None

    def icon(sid: int) -> str | None:
        m = misc.get(sid)
        return lf.get(int(m["SpellIconFileDataID"])) if m else None

    def nm(sid: int) -> dict:
        return {lg: names[lg].get(sid) or names["en"].get(sid) for lg in ("en", "ru")}

    def cls_info(token: str) -> dict:
        c = {lg: next(x for x in talents[lg]["classes"] if x["token"] == token) for lg in ("en", "ru")}
        return {"id": c["en"]["id"], "token": token, "name": {lg: c[lg]["name"] for lg in c}, "color": c["en"]["color"],
                "icon": c["en"]["icon"]}

    out = []
    for group, ids in CONSUMABLES.items():
        for iid in ids:
            sp = use[iid][0]
            row = {"key": f"{group}:{iid}", "group": group, "item": iid,
                   "name": {lg: items[lg][iid]["Display_lang"] for lg in ("en", "ru")},
                   "req": int(items["en"][iid]["RequiredLevel"] or 0), "itemIcon": lf.get(item_icon.get(iid, 0))}
            enchant = next((e for e in eff[sp] if e["Effect"] == "54"), None)
            food = next((e for e in eff[sp] if e["EffectAura"] == "227" and int(e["EffectTriggerSpell"])), None)
            if enchant:  # a weapon oil: the enchantment's spell
                en = ench[int(enchant["EffectMiscValue_0"])]
                aura = int(en["EffectArg_0"])
                row |= {"spell": aura, "aura": {"en": en["Name_lang"], "ru": nm(sp)["ru"]}, "eff": effects(eff[aura]),
                        "dur": int(en["Duration"]) * 1000, "icon": lf.get(int(en["IconFileDataID"])) or icon(sp)}
            elif food:  # the well-fed buff takes the food's own value
                aura = int(food["EffectTriggerSpell"])
                row |= {"spell": aura, "aura": nm(aura), "eff": effects(eff[aura], num(food["EffectBasePointsF"])),
                        "dur": duration(aura), "icon": icon(aura)}
            else:
                row |= {"spell": sp, "aura": nm(sp), "eff": effects(eff[sp]), "dur": duration(sp), "icon": icon(sp)}
            out.append(row)
    for token, cast, aura in CLASS:
        aura = aura or cast
        out.append({"key": f"class:{cast}", "group": "class", "class": cls_info(token), "spell": cast, "name": nm(cast),
                    "aura": nm(cast), "eff": effects(eff[aura]), "dur": duration(cast), "icon": icon(cast)})
    for token, tid, aura, cast in TALENT:
        tal = {}
        for lg in ("en", "ru"):
            c = next(x for x in talents[lg]["classes"] if x["token"] == token)
            for ti, tb in enumerate(c["tabs"]):
                for t in tb["talents"]:
                    if t["id"] == tid:
                        tal[lg] = (ti, tb["name"], t)
        ti, _, t = tal["en"]
        row = {"key": f"talent:{tid}", "group": "talent", "class": cls_info(token), "talent": tid,
               "spec": {"tab": ti, "name": {lg: tal[lg][1] for lg in tal}}, "talentName": {lg: tal[lg][2]["name"] for lg in tal},
               "talentIcon": t["icon"], "text": {lg: tal[lg][2]["ranks"][-1] for lg in tal}}
        if aura:
            row |= {"spell": aura, "name": nm(cast or aura), "aura": nm(aura), "eff": effects(eff[aura]),
                    "dur": duration(cast or aura), "icon": icon(cast or aura) or t["icon"]}
        else:  # Restorative Totems: a share more from Mana Spring Totem
            pct = int(re.search(r"Mana Spring Totem by (\d+)%", t["ranks"][-1]).group(1))
            spring = next(x for x in out if x["key"] == "class:10497")
            row |= {"spell": t["spell"], "name": {lg: tal[lg][2]["name"] for lg in tal}, "aura": spring["aura"],
                    "eff": {"mp5": round(spring["eff"]["mp5"] * pct / 100, 2)}, "dur": spring["dur"], "icon": t["icon"],
                    "needs": "class:10497"}
        out.append(row)
    for x in out:
        if not x.get("eff"):
            sys.exit(f"no effect parsed for {x['key']}")
    OUT.write_text(json.dumps({"build": a.build, "source": "the game's files (wago.tools DB2 export) and the community listfile",
                               "buffs": out}, ensure_ascii=False, indent=1) + "\n")
    print(f"{len(out)} buffs -> {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
