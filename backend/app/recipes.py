"""Profession recipes from the client files (DB2 tables exported by wago.tools).

What the Blizzard API cannot say comes from here: every recipe of a profession, the skill it needs,
its difficulty colours, what it makes and from what, and how it is learned:
  - an item teaches it (a recipe / pattern / plans / formula / schematic / manual), or
  - it is learned on its own at a skill level (AcquireMethod 1 or 2), or
  - the profession trainer teaches it.
Where a recipe item drops or is sold is not in the client files; the page links to Wowhead.

The dataset is built once per client build on the server (it needs wago.tools, which Railway can
reach) and kept in the settings table, so later requests read it from the database.
"""

from __future__ import annotations

import asyncio
import csv
import io
import logging
from collections import defaultdict
from typing import Any

import httpx

log = logging.getLogger("uvicorn.error")
WAGO = "https://wago.tools/db2/{table}/csv?build={build}&locale={locale}"
LOCALES = {"en": "enUS", "ru": "ruRU"}
PROFESSION_CATEGORIES = {9, 11}  # secondary skills (cooking, first aid, fishing), professions
CREATE_ITEM, LEARN_SPELL = 24, 36  # SpellEffect.Effect
LOCALIZED = {"SkillLine", "SpellName", "ItemSparse"}
VERSION = 3  # bump when the dataset shape changes: a stored older one is built again (3: vendor prices)
TABLES = ["SkillLine", "SkillLineAbility", "SpellName", "SpellEffect", "SpellReagents", "ItemSparse", "ItemEffect"]


def _i(r: dict, *keys: str) -> int:
    for k in keys:
        v = r.get(k)
        if v not in (None, ""):
            try:
                return int(float(v))
            except ValueError:
                pass
    return 0


async def fetch_tables(build: str, http: httpx.AsyncClient | None = None) -> dict[str, list[dict]]:
    """Every table the dataset needs; localized ones in both languages (key "Name@ru")."""
    own = http is None
    http = http or httpx.AsyncClient(timeout=180, headers={"User-Agent": "ForeverHub/0.2"})
    sem = asyncio.Semaphore(3)

    async def one(name: str, loc: str) -> tuple[str, list[dict]]:
        async with sem:
            r = await http.get(WAGO.format(table=name, build=build, locale=loc))
        text = r.text
        if r.status_code != 200 or text.lstrip().startswith(("{", "<")):
            raise RuntimeError(f"wago.tools {name}@{build}/{loc}: HTTP {r.status_code} {text[:120]}")
        return name if loc == "enUS" else f"{name}@ru", list(csv.DictReader(io.StringIO(text)))

    jobs = [one(t, "enUS") for t in TABLES] + [one(t, "ruRU") for t in TABLES if t in LOCALIZED]
    try:
        # ItemXItemEffect links items to their effects in newer clients; older ones have ItemEffect.ParentItemID
        out = dict(await asyncio.gather(*jobs))
        try:
            out.update([await one("ItemXItemEffect", "enUS")])
        except RuntimeError:
            out["ItemXItemEffect"] = []
        return out
    finally:
        if own:
            await http.aclose()


def build_dataset(t: dict[str, list[dict]], build: str) -> dict:
    """Pure: tables in, {professions: {skill line id: {...recipes}}, items: {id: {...}}} out."""
    sl = {_i(r, "ID"): r for r in t["SkillLine"]}
    sl_ru = {_i(r, "ID"): r for r in t.get("SkillLine@ru", [])}
    profs = {i for i, r in sl.items()
             if _i(r, "CategoryID") in PROFESSION_CATEGORIES and not _i(r, "ParentSkillLineID")}
    owner = {i: i for i in profs}  # a profession's sub-lines (expansion tiers) count as the profession
    for i, r in sl.items():
        if _i(r, "ParentSkillLineID") in profs:
            owner[i] = _i(r, "ParentSkillLineID")

    names = {_i(r, "ID"): r.get("Name_lang", "") for r in t["SpellName"]}
    names_ru = {_i(r, "ID"): r.get("Name_lang", "") for r in t.get("SpellName@ru", [])}
    creates: dict[int, tuple[int, int]] = {}
    teaches: dict[int, set[int]] = defaultdict(set)  # teaching spell -> recipe spells it teaches
    for r in t["SpellEffect"]:
        if _i(r, "DifficultyID"):
            continue
        sid, eff = _i(r, "SpellID"), _i(r, "Effect")
        if eff == CREATE_ITEM and _i(r, "EffectItemType"):
            creates.setdefault(sid, (_i(r, "EffectItemType"), max(1, _i(r, "EffectBasePointsF", "EffectBasePoints"))))
        elif eff == LEARN_SPELL and _i(r, "EffectTriggerSpell"):
            teaches[sid].add(_i(r, "EffectTriggerSpell"))
    reagents: dict[int, list[list[int]]] = {}
    for r in t["SpellReagents"]:
        xs = [[_i(r, f"Reagent_{k}"), _i(r, f"ReagentCount_{k}")] for k in range(8)]
        reagents[_i(r, "SpellID")] = [x for x in xs if x[0] > 0 and x[1] > 0]

    items = {_i(r, "ID"): r for r in t["ItemSparse"]}
    items_ru = {_i(r, "ID"): r for r in t.get("ItemSparse@ru", [])}
    # items whose use-effect teaches a recipe spell: the recipe items
    effect_item = {_i(r, "ItemEffectID"): _i(r, "ItemID") for r in t.get("ItemXItemEffect", [])}
    item_spells: dict[int, list[int]] = defaultdict(list)
    for r in t["ItemEffect"]:
        item = _i(r, "ParentItemID") or effect_item.get(_i(r, "ID"), 0)
        if item and _i(r, "SpellID"):
            item_spells[item].append(_i(r, "SpellID"))
    # a recipe item either names the recipe spell itself (trigger "learn") or uses a spell that teaches it
    taught_by: dict[int, int] = {}
    for item, spells in sorted(item_spells.items()):
        for sp in spells:
            taught_by.setdefault(sp, item)
            for rec in teaches.get(sp, ()):
                taught_by.setdefault(rec, item)

    used: set[int] = set()
    out: dict[int, dict] = {}
    for r in t["SkillLineAbility"]:
        line, spell = owner.get(_i(r, "SkillLine")), _i(r, "Spell")
        if not line or not spell or _i(r, "ClassMask"):
            continue
        made = creates.get(spell)
        mn = _i(r, "MinSkillLineRank")
        low, high = _i(r, "TrivialSkillLineRankLow"), _i(r, "TrivialSkillLineRankHigh")
        acq = _i(r, "AcquireMethod")
        rec_item = taught_by.get(spell)
        if not made and not rec_item and acq == 0 and not low and not high:
            continue  # the profession itself, its ranks and passives: not recipes
        if not names.get(spell) and not made:
            continue  # nameless helper spells that make nothing
        src = "item" if rec_item else "auto" if acq in (1, 2) else "trainer"
        # The client keeps the skill a trainer recipe needs on the server: MinSkillLineRank is 1 for most
        # of them. A recipe item carries its own requirement; otherwise only the colour thresholds are known.
        need = mn if mn > 1 else _i(items.get(rec_item, {}), "RequiredSkillRank") if rec_item else 0
        rec = {
            "id": _i(r, "ID"), "spell": spell,
            "name": {"en": names.get(spell, ""), "ru": names_ru.get(spell) or names.get(spell, "")},
            "skill": need or None, "yellow": low or None, "gray": high or None,
            "source": src, "item": made[0] if made else None, "count": made[1] if made else None,
            "reagents": reagents.get(spell, []), "recipeItem": rec_item,
        }
        out.setdefault(line, {"id": line, "recipes": []})["recipes"].append(rec)
        used.update(x for x in (rec["item"], rec_item) if x)
        used.update(x[0] for x in rec["reagents"])

    for line, p in out.items():
        r, r_ru = sl[line], sl_ru.get(line, {})
        en = r.get("DisplayName_lang", "")
        p["name"] = {"en": en, "ru": r_ru.get("DisplayName_lang") or en}
        p["recipes"].sort(key=lambda x: (x["skill"] or x["yellow"] or 0, x["yellow"] or 0, x["name"]["en"]))
    return {
        "v": VERSION,
        "build": build,
        "professions": {str(k): v for k, v in sorted(out.items())},
        "items": {
            str(i): {"en": items[i].get("Display_lang", ""),
                     "ru": items_ru.get(i, {}).get("Display_lang") or items[i].get("Display_lang", ""),
                     "q": _i(items[i], "OverallQualityID"),
                     # what a vendor pays for one, and what one costs at a vendor (BuyPrice is for a stack of
                     # VendorStackCount), in copper: the crafting page weighs the auction house against them
                     "sell": _i(items[i], "SellPrice"), "buy": _i(items[i], "BuyPrice"),
                     "vstack": _i(items[i], "VendorStackCount") or 1}
            for i in sorted(used) if i in items
        },
    }


def summary(ds: dict) -> list[dict]:
    return [{"id": int(k), "name": p["name"], "recipes": len(p["recipes"])} for k, p in ds["professions"].items()]


Dataset = dict[str, Any]
