"""The gear of every profession, from the WoW Forever client: the tools its recipes need (a pick, a hammer, a rod,
the Philosopher's Stone...) and what adds to its skill (the gloves' enchantments); for fishing the poles, the lures, the clothes and the extras
(fishing line, the gloves' enchantment), each with its name in both languages, quality, required level and skill,
and the fishing it adds where the client says so.

The client knows a lure's bonus (its spell puts a temporary enchantment on the pole: +25 for 10 minutes...) and the
permanent ones (Eternium line, Enchant Gloves - Fishing); a pole's or a hat's own "Equip: Fishing +N" is kept on the
game's servers, so the hub reads it from the item's Blizzard description at runtime (app/routers/profgear.py).

    python tools/build_prof_gear.py <wago csv dir>

The dir holds Item, ItemSparse (_enUS, _ruRU), ItemEffect, ItemXItemEffect, SpellEffect, SpellItemEnchantment,
SkillLineAbility and SpellTotems.
Out comes backend/app/data/prof_gear.json; the result is committed.
"""

from __future__ import annotations

import csv
import json
import re
import sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "backend" / "app" / "data" / "prof_gear.json"
FISHING = 356
OTHER = {"alchemy": 171, "herbalism": 182, "cooking": 185, "first-aid": 129, "mining": 186, "skinning": 393,
         "blacksmithing": 164, "leatherworking": 165, "tailoring": 197, "engineering": 202, "enchanting": 333}
# clothes for anglers the client does not tie to the skill (Forever's own hats and mantle)
ANGLER = re.compile(r"fishing hat|\bangler|\banglin", re.I)


def read(p: Path) -> list[dict]:
    csv.field_size_limit(10**8)
    return list(csv.DictReader(p.open(encoding="utf-8")))


def main() -> None:
    d = Path(sys.argv[1])
    item = {int(r["ID"]): r for r in read(d / "Item.csv")}
    en = {int(r["ID"]): r for r in read(d / "ItemSparse_enUS.csv")}
    ru = {int(r["ID"]): r["Display_lang"] for r in read(d / "ItemSparse_ruRU.csv")}
    effect = {r["ID"]: r for r in read(d / "ItemEffect.csv")}
    uses = defaultdict(list)
    for r in read(d / "ItemXItemEffect.csv"):
        x = effect.get(r["ItemEffectID"])
        if x:
            uses[int(r["ItemID"])].append(int(x["SpellID"]))
    spell = defaultdict(list)
    for r in read(d / "SpellEffect.csv"):
        spell[int(r["SpellID"])].append(r)
    ench = {int(r["ID"]): r for r in read(d / "SpellItemEnchantment.csv")}

    def fishing_of(spell_id: int) -> tuple[int, int | None, bool] | None:
        """What a use spell adds to fishing: (points, minutes, permanent) through the enchantment it puts on."""
        for e in spell[spell_id]:
            if e["Effect"] in ("53", "54"):  # permanent or temporary enchantment of an item
                x = ench.get(int(e["EffectMiscValue_0"]))
                if not x:
                    continue
                for e2 in spell[int(x["EffectArg_0"])]:
                    if e2["EffectAura"] == "30" and e2["EffectMiscValue_0"] == str(FISHING):
                        dur = int(x["Duration"] or 0)
                        return int(float(e2["EffectBasePointsF"])), (dur // 60 if dur else None), e["Effect"] == "53"
        return None

    rows = []
    for i, s in en.items():
        it = item.get(i)
        if not it or s["Display_lang"].startswith(("Monster", "Deprecated")) or int(it["ClassID"]) == 9:  # 9: recipes
            continue
        cls, sub, inv = int(it["ClassID"]), int(it["SubclassID"]), int(it["InventoryType"])
        skill = int(s["RequiredSkill"] or 0)
        lure = next((f for sp in uses[i] if (f := fishing_of(sp))), None)
        kind = None
        if cls == 2 and sub == 20:
            kind = "pole"
        elif cls == 4 and inv and (skill == FISHING or ANGLER.search(s["Display_lang"])):
            kind = "clothes"
        elif lure:
            kind = "extra" if lure[2] else "lure"
        if not kind:
            continue
        rows.append({"id": i, "kind": kind, "name": {"en": s["Display_lang"], "ru": ru.get(i) or s["Display_lang"]},
                     "q": int(s["OverallQualityID"]), "req": int(s["RequiredLevel"] or 0),
                     "skill": int(s["RequiredSkillRank"] or 0) if skill == FISHING else 0,
                     "bonus": lure[0] if lure else None, "minutes": lure[1] if lure and not lure[2] else None,
                     "lure": bool(lure) and kind == "clothes"})
    order = {"tool": 0, "pole": 0, "lure": 1, "clothes": 2, "extra": 3}
    rows.sort(key=lambda x: (order[x["kind"]], x["skill"], x["req"], x["id"]))
    out = {"source": "WoW Forever client (wago.tools DB2 export)", "fishing": rows}

    # every other profession: the tools its recipes need (the client's totem categories) and what adds to its
    # skill (the gloves' enchantments)
    abil = defaultdict(set)
    for r in read(d / "SkillLineAbility.csv"):
        abil[int(r["SkillLine"])].add(int(r["Spell"]))
    cats = defaultdict(set)
    for r in read(d / "SpellTotems.csv"):
        for k in ("RequiredTotemCategoryID_0", "RequiredTotemCategoryID_1"):
            if int(r.get(k) or 0):
                cats[int(r["SpellID"])].add(int(r[k]))
    by_cat = defaultdict(list)
    for i, x in en.items():
        if int(x.get("TotemCategoryID") or 0):
            by_cat[int(x["TotemCategoryID"])].append(i)

    def skill_of(spell_id: int, skill: int) -> int | None:
        for e in spell[spell_id]:
            if e["Effect"] == "53":
                x = ench.get(int(e["EffectMiscValue_0"]))
                for e2 in spell[int(x["EffectArg_0"])] if x else []:
                    if e2["EffectAura"] == "30" and e2["EffectMiscValue_0"] == str(skill):
                        return int(float(e2["EffectBasePointsF"]))
        return None

    for slug, skill in OTHER.items():
        prof_rows, seen = [], set()

        def row(i: int, kind: str, bonus: int | None):
            s_ = en[i]
            seen.add(i)
            prof_rows.append({"id": i, "kind": kind, "name": {"en": s_["Display_lang"], "ru": ru.get(i) or s_["Display_lang"]},
                              "q": int(s_["OverallQualityID"]), "req": int(s_["RequiredLevel"] or 0),
                              "skill": int(s_["RequiredSkillRank"] or 0) if int(s_["RequiredSkill"] or 0) == skill else 0,
                              "bonus": bonus, "minutes": None, "lure": False})

        for c in sorted({c for sp in abil[skill] for c in cats.get(sp, ())}):
            for i in by_cat.get(c, []):
                if i not in seen and i in item and int(item[i]["ClassID"]) != 9:
                    row(i, "tool", None)
        for i, sps in uses.items():
            if i in seen or i not in en or i not in item or int(item[i]["ClassID"]) == 9:
                continue
            b = next((v for sp in sps if (v := skill_of(sp, skill))), None)
            if b:
                row(i, "extra", b)
        prof_rows.sort(key=lambda x: (order[x["kind"]], x["skill"], x["req"], x["id"]))
        out[slug] = prof_rows
        print(f"{slug}: {[(x['kind'], x['name']['ru'], x['bonus']) for x in prof_rows]}")
    OUT.write_text(json.dumps(out, ensure_ascii=False, indent=1) + "\n")
    print(f"fishing: {len(rows)} items -> {OUT.relative_to(ROOT)}")
    for x in rows:
        print(" ", x["kind"], x["id"], x["name"]["ru"], x["bonus"], x["skill"], x["req"])


if __name__ == "__main__":
    main()
