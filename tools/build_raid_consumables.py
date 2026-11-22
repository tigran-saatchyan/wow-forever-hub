"""Raid consumables a profession makes, from the WoW Forever client: flasks, elixirs, food, potions (healing, mana,
protection), weapon oils and stones, bandages — each with the recipe that makes it (profession, skill, the recipe's
spell), what it gives and for how long, its kind, and who it suits (casters, healers, melee, hunters, tanks, all).

Only the higher end is kept (recipes from 225 skill, or a product for level 45 and up): what a raid buys. The
server joins prices, reagent costs and the characters' professions (app/routers/craft.py).

    python tools/build_raid_consumables.py <wago csv dir>

The dir holds SkillLineAbility, SpellEffect, SpellMisc, SpellDuration, SpellItemEnchantment, ItemEffect,
ItemXItemEffect, Item and ItemSparse (_enUS, _ruRU). Out comes backend/app/data/raid_consumables.json.
"""

from __future__ import annotations

import csv
import json
import sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "backend" / "app" / "data" / "raid_consumables.json"
PROFS = {171: "alchemy", 185: "cooking", 129: "first-aid", 333: "enchanting", 164: "blacksmithing", 202: "engineering",
         165: "leatherworking", 197: "tailoring"}
STAT = {0: "str", 1: "agi", 2: "sta", 3: "int", 4: "spi"}
SCHOOL = {1: "physical", 2: "holy", 4: "fire", 8: "nature", 16: "frost", 32: "shadow", 64: "arcane"}
MIN_SKILL, MIN_LEVEL = 240, 45  # yellow from 240 skill, or a product for level 45 and up


def read(p: Path) -> list[dict]:
    csv.field_size_limit(10**8)
    return list(csv.DictReader(p.open(encoding="utf-8")))


def num(x: str) -> float:
    v = float(x or 0)
    return int(v) if v == int(v) else v


def effects(rows: list[dict], value: float | None = None) -> dict:
    """What a spell's effects give, by kind: stats, spell power, attack power, armor and resistances, crit, mana per
    5 sec, absorbing a school's damage, and what an instant restores (health, mana)."""
    out: dict = {}

    def add(k: str, v: float, sub: str | None = None):
        if sub:
            out.setdefault(k, {})
            out[k][sub] = out[k].get(sub, 0) + v
        else:
            out[k] = out.get(k, 0) + v

    for e in rows:
        eff, a = int(e["Effect"]), int(e["EffectAura"])
        bp, misc = num(e["EffectBasePointsF"]), int(e["EffectMiscValue_0"] or 0)
        if value is not None and a:
            bp = value
        if eff == 10:  # heal at once
            add("heal_now", bp)
        elif eff == 30 and misc == 0:  # mana at once
            add("mana_now", bp)
        elif a == 29:
            for i in (STAT if misc == -1 else [misc]):
                if i in STAT:
                    add(STAT[i], bp)
        elif a == 13:
            if misc & 126 == 126:
                add("sp", bp)
            else:
                for m, s in SCHOOL.items():
                    if misc & m and m != 1:
                        add("school", bp, s)
        elif a == 135:
            add("healing", bp)
        elif a in (57, 290, 52):
            add("crit", bp)
        elif a == 55:
            add("hit", bp)
        elif a == 85:
            add("mp5", bp)
        elif a == 24 and int(e["EffectAuraPeriod"] or 0):
            add("mp5", round(bp * 5000 / int(e["EffectAuraPeriod"]), 2))
        elif a == 99:
            add("ap", bp)
        elif a == 124:
            add("rap", bp)
        elif a == 22:  # armor (physical) or a resistance
            for m, s in SCHOOL.items():
                if misc & m:
                    add("armor" if s == "physical" else "res", bp, None if s == "physical" else s)
        elif a == 34:
            add("hp", bp)
        elif a == 69:  # absorb a school's damage
            for m, s in SCHOOL.items():
                if misc & m and s != "physical":
                    add("absorb", bp, s)
        elif a == 8 or a == 20:  # healing over time (bandages, regeneration)
            add("hot", bp)
        elif a == 240:
            add("expertise", bp)
        elif a in (342, 65):
            add("haste", bp)
    return out


def roles(e: dict) -> list[str]:
    """Who a consumable suits, by what it gives. A rating Forever's servers fill in (0 in the client) still says the
    kind: hit or crit for every damage dealer, expertise and haste for melee and hunters."""
    dps_rating = any(k in e and not e[k] for k in ("hit", "crit", "haste"))
    if dps_rating or "expertise" in e:
        return ["melee", "hunter"] + (["caster"] if dps_rating and "expertise" not in e else [])
    r = []
    if e.get("sp") or e.get("school") or (e.get("crit") and e.get("int")):
        r.append("caster")
    if e.get("healing") or e.get("mp5") or e.get("mana_now") or e.get("spi") or (e.get("int") and not e.get("sp")):
        r.append("healer")
    if e.get("ap") or e.get("str") or (e.get("agi") and not e.get("rap")) or (e.get("crit") and not e.get("int") and not e.get("sp")):
        r.append("melee")
    if e.get("rap") or e.get("agi"):
        r.append("hunter")
    if e.get("armor") or e.get("hp") or e.get("sta"):
        r.append("tank")
    if e.get("res") or e.get("absorb") or e.get("heal_now") or e.get("hot"):
        r.append("all")
    if e.get("mana_now") and "caster" not in r:
        r.append("caster")
    return r or ["all"]


def main() -> None:
    d = Path(sys.argv[1])
    spell = defaultdict(list)
    for r in read(d / "SpellEffect.csv"):
        spell[int(r["SpellID"])].append(r)
    misc = {int(r["SpellID"]): r for r in read(d / "SpellMisc.csv")}
    dur = {int(r["ID"]): int(r["Duration"]) for r in read(d / "SpellDuration.csv")}
    ench = {int(r["ID"]): r for r in read(d / "SpellItemEnchantment.csv")}
    effect = {r["ID"]: r for r in read(d / "ItemEffect.csv")}
    uses = defaultdict(list)
    for r in read(d / "ItemXItemEffect.csv"):
        x = effect.get(r["ItemEffectID"])
        if x and x["TriggerType"] == "0":
            uses[int(r["ItemID"])].append(int(x["SpellID"]))
    en = {int(r["ID"]): r for r in read(d / "ItemSparse_enUS.csv")}
    ru = {int(r["ID"]): r["Display_lang"] for r in read(d / "ItemSparse_ruRU.csv")}
    item = {int(r["ID"]): r for r in read(d / "Item.csv")}

    def duration(sid: int) -> int | None:
        m = misc.get(sid)
        return dur.get(int(m["DurationIndex"])) if m else None

    def buff_of(i: int, bandage: bool = False) -> tuple[str, dict, int | None] | None:
        """(kind, effects, milliseconds) of what using the item gives."""
        for sid in uses.get(i, []):
            rows = spell[sid]
            food = next((e for e in rows if e["EffectAura"] == "227" and int(e["EffectTriggerSpell"])), None)
            if food:
                t = int(food["EffectTriggerSpell"])
                e = effects(spell[t], num(food["EffectBasePointsF"]))
                if e:
                    return "food", e, duration(t)
            enc = next((e for e in rows if e["Effect"] == "54"), None)
            if enc:  # a weapon oil or stone: what the enchantment adds
                x = ench.get(int(enc["EffectMiscValue_0"]))
                if x:
                    e: dict = {}
                    for k in range(3):
                        typ, arg, pts = int(x[f"Effect_{k}"]), int(x[f"EffectArg_{k}"] or 0), int(x[f"EffectPointsMin_{k}"] or 0)
                        if typ == 3 and arg:
                            for kk, vv in effects(spell[arg]).items():
                                e[kk] = vv
                        elif typ == 2 and pts:
                            e["weapon_dmg"] = e.get("weapon_dmg", 0) + pts
                    if e:
                        return "weapon", e, int(x["Duration"] or 0) * 1000
            e = effects(rows)
            if not e:
                continue
            ms = duration(sid)
            if e.get("absorb") or e.get("res") and not e.get("sp"):
                kind = "protection"
            elif e.get("hot") and bandage:
                kind = "bandage"
            elif e.get("heal_now") or e.get("mana_now") or (ms and 0 < ms <= 120000):
                kind = "potion"  # restores at once, or a short burst drunk at the pull (30 sec of spell power)
            elif e.get("hot") and bandage:
                kind = "bandage"
            elif e.get("hot"):
                kind = "potion"
            elif ms and ms >= 7200000:
                kind = "flask"
            else:
                kind = "elixir"
            return kind, e, ms
        return None

    rows, seen = [], set()
    for r in read(d / "SkillLineAbility.csv"):
        skill, sid = int(r["SkillLine"]), int(r["Spell"])
        if skill not in PROFS:
            continue
        for e in spell[sid]:
            if e["Effect"] != "24":
                continue
            i = int(e["EffectItemType"] or 0)
            if not i or i in seen or i not in en or i not in item or int(item[i]["ClassID"]) != 0:
                continue  # consumables only
            # Forever's client keeps no learning skill; the recipe turns yellow at TrivialSkillLineRankLow
            yellow, gray = int(r["TrivialSkillLineRankLow"] or 0), int(r["TrivialSkillLineRankHigh"] or 0)
            lvl = int(en[i]["RequiredLevel"] or 0)
            if yellow < MIN_SKILL and lvl < MIN_LEVEL:
                continue
            b = buff_of(i, skill == 129)
            if not b:
                continue
            kind, eff, ms = b
            seen.add(i)
            rows.append({"item": i, "name": {"en": en[i]["Display_lang"], "ru": ru.get(i) or en[i]["Display_lang"]},
                         "q": int(en[i]["OverallQualityID"]), "req": lvl, "kind": kind, "eff": eff, "ms": ms,
                         "roles": roles(eff), "prof": PROFS[skill], "yellow": yellow, "gray": gray, "spell": sid})
    order = ["flask", "elixir", "food", "potion", "protection", "weapon", "bandage"]
    rows.sort(key=lambda x: (order.index(x["kind"]), x["prof"], -x["yellow"]))
    OUT.write_text(json.dumps({"source": "WoW Forever client (wago.tools DB2 export)", "items": rows}, ensure_ascii=False, indent=1) + "\n")
    print(f"{len(rows)} consumables -> {OUT.relative_to(ROOT)}")
    for x in rows:
        print(f"  {x['kind']:10} {x['prof']:12} {x['yellow']:3} {x['name']['ru'][:40]:40} {x['roles']} {x['eff']}")


if __name__ == "__main__":
    main()
