"""The gear of a profession, from the WoW Forever client: for fishing the poles, the lures, the clothes and the extras
(fishing line, the gloves' enchantment), each with its name in both languages, quality, required level and skill,
and the fishing it adds where the client says so.

The client knows a lure's bonus (its spell puts a temporary enchantment on the pole: +25 for 10 minutes...) and the
permanent ones (Eternium line, Enchant Gloves - Fishing); a pole's or a hat's own "Equip: Fishing +N" is kept on the
game's servers, so the hub reads it from the item's Blizzard description at runtime (app/routers/profgear.py).

    python tools/build_prof_gear.py <wago csv dir>

The dir holds Item, ItemSparse (_enUS, _ruRU), ItemEffect, ItemXItemEffect, SpellEffect and SpellItemEnchantment.
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
    order = {"pole": 0, "lure": 1, "clothes": 2, "extra": 3}
    rows.sort(key=lambda x: (order[x["kind"]], x["skill"], x["req"], x["id"]))
    OUT.write_text(json.dumps({"source": "WoW Forever client (wago.tools DB2 export)", "fishing": rows},
                              ensure_ascii=False, indent=1) + "\n")
    print(f"fishing: {len(rows)} items -> {OUT.relative_to(ROOT)}")
    for x in rows:
        print(" ", x["kind"], x["id"], x["name"]["ru"], x["bonus"], x["skill"], x["req"])


if __name__ == "__main__":
    main()
