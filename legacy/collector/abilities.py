"""Class abilities by level, from the client files (what the class trainer teaches).

SkillLineAbility links every class spell to a class skill line; rows with the
class's ClassMask and AcquireMethod 0 are the ones learned from the trainer, and
SpellLevels.BaseLevel is the level they become available. Rank chains come from
SupercedesSpell. A spell whose chain starts at a talent's spell (Mutilate,
Hemorrhage...) is only trained by characters that have that talent: such rows
carry `t` = talent node id, so the planner can show them only for builds with it.

Output (per language): abilities/<build>/<lang>.json
    {build, lang, classes: {TOKEN: [{l: level, s: spell, n: name, r: rank, i: icon, d: text, t?: node}]}}
"""
from __future__ import annotations

import logging

from . import db2
from .tooltip import Renderer

log = logging.getLogger(__name__)

CLASS_SKILL_CATEGORY = 7


def build_abilities(build: str, lang: str, locale: str, talent_ds: dict, icons: dict[int, str]) -> dict:
    sl = db2.table("SkillLine", build)
    lines = {int(r["ID"]) for r in sl if int(r["CategoryID"]) == CLASS_SKILL_CATEGORY
             and not r["DisplayName_lang"].startswith("Pet -")}
    sla = [r for r in db2.table("SkillLineAbility", build) if int(r["SkillLine"]) in lines]
    en_names = {int(r["ID"]): r["Name_lang"] for r in db2.table("SpellName", build, "enUS")}
    beast = {int(r["ID"]) for r in sl if r["DisplayName_lang"] == "Beast Training"}
    levels = {}
    for r in db2.table("SpellLevels", build):
        if int(r["DifficultyID"]) == 0:
            levels[int(r["SpellID"])] = int(r["BaseLevel"]) or int(r["SpellLevel"])
    classes = {int(r["ID"]): r["Filename"] for r in db2.table("ChrClasses", build)}
    db = db2.SpellDB(build, locale)
    rnd = Renderer(db, lang)

    # talent spells (by class) -> node id, so talent-gated ranks can be tied to the talent
    talent_spell: dict[str, dict[int, int]] = {}
    for c in talent_ds["classes"]:
        m = talent_spell.setdefault(c["token"], {})
        for tb in c["tabs"]:
            for x in tb["talents"]:
                if x.get("spell"):
                    m[int(x["spell"])] = x["id"]

    supersedes = {int(r["Spell"]): int(r["SupercedesSpell"]) for r in sla if int(r["SupercedesSpell"])}

    # Which talents modify which spells: a talent's aura effects carry a class mask
    # (EffectSpellClassMask) that matches the SpellClassMask of the spells it changes,
    # within the same spell family. Triggered spells are followed two levels deep.
    eff: dict[int, list[dict]] = {}
    for r in db2.table("SpellEffect", build):
        if int(r["DifficultyID"]) == 0:
            eff.setdefault(int(r["SpellID"]), []).append(r)
    opts = {int(r["SpellID"]): r for r in db2.table("SpellClassOptions", build)}

    def fam_mask(sid: int) -> tuple[int, tuple[int, ...]] | None:
        o = opts.get(sid)
        if not o:
            return None
        return int(o["SpellClassSet"]), tuple(int(o[f"SpellClassMask_{i}"]) & 0xFFFFFFFF for i in range(4))

    def effect_masks(sid: int, depth: int = 0, seen: set | None = None) -> list[tuple[int, ...]]:
        seen = seen if seen is not None else set()
        if sid in seen or depth > 2:
            return []
        seen.add(sid)
        out = []
        for e in eff.get(sid, []):
            m = tuple(int(e[f"EffectSpellClassMask_{i}"]) & 0xFFFFFFFF for i in range(4))
            if any(m):
                out.append(m)
            if int(e["EffectTriggerSpell"]):
                out += effect_masks(int(e["EffectTriggerSpell"]), depth + 1, seen)
        return out

    talent_masks: dict[str, list[tuple[int, int | None, list]]] = {}
    for c in talent_ds["classes"]:
        lst = talent_masks.setdefault(c["token"], [])
        for tb in c["tabs"]:
            for x in tb["talents"]:
                sp = int(x.get("spell") or 0)
                ms = effect_masks(sp) if sp else []
                if ms:
                    fm = fam_mask(sp)
                    lst.append((x["id"], fm[0] if fm else None, ms))

    def affected_by(token: str, sid: int, exclude: int | None = None) -> list[int]:
        fm = fam_mask(sid)
        if not fm or not any(fm[1]):
            return []
        fam, am = fm
        return [nid for nid, tf, ms in talent_masks.get(token, [])
                if nid != exclude and (tf is None or tf == fam) and any(any(a & b for a, b in zip(am, m)) for m in ms)]

    def chain_root(sid: int) -> tuple[int, int]:
        rank, seen = 1, set()
        while sid in supersedes and sid not in seen:
            seen.add(sid)
            sid = supersedes[sid]
            rank += 1
        return sid, rank

    out: dict[str, list[dict]] = {}
    for cid, token in classes.items():
        bit = 1 << (cid - 1)
        rows, seen = [], set()
        for r in sla:
            mask = int(r["ClassMask"])
            if not mask or not mask & bit or int(r["AcquireMethod"]) != 0:
                continue
            sid = int(r["Spell"])
            lv = levels.get(sid, 0)
            # level 1 spells come with the class; Season of Discovery rune engravings are left in the files;
            # Beast Training lists the pet's abilities, not the hunter's
            if lv <= 1 or sid in seen or en_names.get(sid, "").startswith("Engrave"):
                continue
            if int(r["SkillLine"]) in beast and en_names.get(sid) != "Beast Training":
                continue
            seen.add(sid)
            root, rank = chain_root(sid)
            node = talent_spell.get(token, {}).get(root) or talent_spell.get(token, {}).get(sid)
            misc = db.misc.get(sid)
            text = ""
            try:
                text = rnd.render(sid)
            except Exception:  # noqa: BLE001 - a broken tooltip must not drop the ability
                pass
            row = {"l": lv, "s": sid, "n": db.name(sid), "r": rank,
                   "i": icons.get(int(misc["SpellIconFileDataID"]), "inv_misc_questionmark") if misc else "inv_misc_questionmark",
                   "d": text[:260]}
            if node:
                row["t"] = node
            aff = affected_by(token, sid, exclude=node)
            if aff:
                row["a"] = aff
            rows.append(row)
        # a talent's own first rank is not a trainer purchase
        rows = [r for r in rows if not (r.get("t") and r["r"] == 1 and r["s"] in talent_spell.get(token, {}))]
        out[token] = sorted(rows, key=lambda r: (r["l"], r["n"], r["r"]))
    # the same for talents that are spells themselves (Mutilate, Ghostly Strike...)
    links: dict[str, dict[str, list[int]]] = {}
    for c in talent_ds["classes"]:
        m = links.setdefault(c["token"], {})
        for tb in c["tabs"]:
            for x in tb["talents"]:
                aff = affected_by(c["token"], int(x.get("spell") or 0), exclude=x["id"]) if x.get("spell") else []
                if aff:
                    m[str(x["id"])] = aff
    return {"build": build, "lang": lang, "classes": out, "talentLinks": links}


def icon_names_of(datasets: list[dict]) -> set[str]:
    return {r["i"] for ds in datasets for rows in ds["classes"].values() for r in rows}
