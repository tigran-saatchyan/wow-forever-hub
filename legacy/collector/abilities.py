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
import re

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


# ---------------------------------------------------------------------------------------------
# School check for the links above. Class masks alone over-match: Holy Precision ("chance to hit
# with Holy spells") carries a mask that covers Shadow spells too, so Vampiric Embrace or
# Shadowform showed it as a modifier. A link is dropped when the talent's English text limits
# it to schools ("Fire, Frost, and Nature spells", "Holy damage") that the spell's own text
# does not have, unless the talent names the spell outright.
# ---------------------------------------------------------------------------------------------
_SCHOOLS = "Holy|Shadow|Fire|Frost|Arcane|Nature|Physical"
_SCHOOL_LIST = re.compile(
    rf"\b((?:(?:{_SCHOOLS}),?\s+(?:and\s+|or\s+)?)*(?:{_SCHOOLS}))\s+(?:damage\s+)?(?:spells?|damage|magic|resistance)\b", re.I
)


def _strip_names(text: str, names: list[str]) -> str:
    for n in names:  # longest first: "Holy Fire" before "Holy"
        text = text.replace(n, " ")
    return text


def talent_schools(text: str, names: list[str]) -> set[str]:
    out: set[str] = set()
    for m in _SCHOOL_LIST.finditer(_strip_names(text, names)):
        out |= {s.capitalize() for s in re.findall(_SCHOOLS, m.group(1), re.I)}
    return out


_SPELL_SCHOOL = re.compile(r"\b(Holy|Shadow|Fire|Frost|Arcane|Nature)\s+(?:damage|energy|magic|spells?|resistance)\b", re.I)


def spell_schools(text: str, names: list[str]) -> set[str]:
    return {s.capitalize() for s in _SPELL_SCHOOL.findall(_strip_names(text, names))}


def school_conflicts(ab_en: dict, talents_en: dict) -> dict[str, set[tuple[str, int]]]:
    """Per class: (spell key, talent node) pairs whose schools contradict. Spell key is the
    spell id for trainer rows and "t<node>" for talents that are spells themselves."""
    bad: dict[str, set[tuple[str, int]]] = {}
    for c in talents_en["classes"]:
        token = c["token"]
        M = {x["id"]: x for tb in c["tabs"] for x in tb["talents"]}
        rows = ab_en.get("classes", {}).get(token, [])
        names = sorted({r["n"] for r in rows} | {x["name"] for x in M.values()}, key=len, reverse=True)
        spells = [(str(r["s"]), r["n"], r.get("d", ""), r.get("a", [])) for r in rows]
        spells += [("t" + k, M[int(k)]["name"], M[int(k)]["ranks"][0], v)
                   for k, v in ab_en.get("talentLinks", {}).get(token, {}).items() if int(k) in M]
        for key, name, desc, aff in spells:
            for tid in aff:
                x = M.get(tid)
                if not x:
                    continue
                tt = " ".join(x["ranks"])
                if name in tt:
                    continue
                ts, ss = talent_schools(tt, names), spell_schools(desc, names)
                if ts and ss and not ts & ss:
                    bad.setdefault(token, set()).add((key, tid))
    return bad


def prune_school_conflicts(abil_by_lang: dict[str, dict], talents_en: dict) -> int:
    """Drop contradicting links from every language (node ids are the same in all). Returns the count."""
    en = abil_by_lang.get("en")
    if not en:
        return 0
    bad = school_conflicts(en, talents_en)
    n = 0
    for ab in abil_by_lang.values():
        for token, pairs in bad.items():
            for r in ab.get("classes", {}).get(token, []):
                if r.get("a"):
                    keep = [t for t in r["a"] if (str(r["s"]), t) not in pairs]
                    n += len(r["a"]) - len(keep)
                    if keep:
                        r["a"] = keep
                    else:
                        del r["a"]
            links = ab.get("talentLinks", {}).get(token, {})
            for k in list(links):
                keep = [t for t in links[k] if ("t" + k, t) not in pairs]
                n += len(links[k]) - len(keep)
                if keep:
                    links[k] = keep
                else:
                    del links[k]
    return n


# ---------------------------------------------------------------------------------------------
# Clean-up of the trainer list. Two problems of the raw rows:
#  * helper spells share the name of the spell that uses them (Shadowguard's bolt, the burn of
#    Immolation Trap, the heal of Holy Nova): one spell shows twice on the same level;
#  * for many classes the files do not link ranks (SupercedesSpell), so every rank reads "1".
# Ranks are rebuilt by level; rank 1 of the spells a class starts with is learned at level 1,
# which the list leaves out, so their first row here is rank 2. Classes whose chains are
# linked (warrior, rogue) agree with this rule, which the tests check.
# ---------------------------------------------------------------------------------------------
STARTERS = {
    "WARRIOR": {"Heroic Strike"},
    "PALADIN": {"Holy Light", "Seal of Righteousness", "Devotion Aura"},
    "HUNTER": {"Raptor Strike"},
    "ROGUE": {"Sinister Strike", "Eviscerate", "Stealth"},
    "PRIEST": {"Smite", "Lesser Heal", "Power Word: Fortitude"},
    "SHAMAN": {"Lightning Bolt", "Healing Wave", "Rockbiter Weapon"},
    "MAGE": {"Fireball", "Frost Armor", "Arcane Intellect"},
    "WARLOCK": {"Shadow Bolt", "Demon Skin"},
    "DRUID": {"Wrath", "Healing Touch", "Mark of the Wild"},
}


def _prefix(r: dict) -> str:
    return (r.get("d") or "")[:25]


def clean_rows(token: str, rows_en: list[dict]) -> dict[int, int]:
    """English rows of one class -> {spell id: rank} of the rows to keep."""
    by_name: dict[str, list[dict]] = {}
    for r in rows_en:
        by_name.setdefault(r["n"], []).append(r)
    keep: dict[int, int] = {}
    for name, rows in by_name.items():
        # the spell's own text: the prefix seen on most levels, ties to the longer text; never an empty one
        score: dict[str, tuple[int, int]] = {}
        for r in rows:
            p = _prefix(r)
            if p:
                n, ln = score.get(p, (0, 0))
                score[p] = (n + 1, max(ln, len(r["d"])))
        main = max(score, key=lambda p: score[p]) if score else ""
        by_lv: dict[int, list[dict]] = {}
        for r in rows:
            by_lv.setdefault(r["l"], []).append(r)
        chain: list[dict] = []
        for lv in sorted(by_lv):
            xs = by_lv[lv]
            mine = [r for r in xs if _prefix(r) == main] or [r for r in xs if r.get("d")] or xs
            if len({r.get("d") for r in mine}) == 1:  # same text twice: one spell, keep the lower id
                mine = [min(mine, key=lambda r: r["s"])]
            chain += sorted(mine, key=lambda r: r["s"])
        linked = any(r["r"] > 1 for r in chain)
        first = chain[0]["r"] if linked else 1 + (name in STARTERS.get(token, set())) + bool(chain[0].get("t"))
        for i, r in enumerate(chain):
            keep[r["s"]] = first + i
    return keep


def clean_abilities(abil_by_lang: dict[str, dict]) -> int:
    """Apply clean_rows (decided on English) to every language. Returns the number of rows dropped."""
    en = abil_by_lang.get("en")
    if not en:
        return 0
    plan = {token: clean_rows(token, rows) for token, rows in en.get("classes", {}).items()}
    dropped = 0
    for ab in abil_by_lang.values():
        for token, rows in ab.get("classes", {}).items():
            keep = plan.get(token, {})
            out = []
            for r in rows:
                if r["s"] in keep:
                    out.append({**r, "r": keep[r["s"]]})
            dropped += len(rows) - len(out)
            ab["classes"][token] = out
    return dropped
