"""Stat weights moved by talents: what a talent does to the worth of a stat, read from its own text in Forever's
talent data (data/talents/<build>/en.json), so a change on Forever's side moves the weights with it.

- "Increases your (total) Intellect by 10%"          -> Intellect worth 10 % more
- "...spell healing by up to 25% of your total Spirit" -> each Spirit adds a quarter of a point of healing
- "Attack Power by an amount equal to 150% of your Intellect" -> each Intellect adds 1.5 attack power
- "Allows 50% of your Mana regeneration to continue while casting" -> Spirit worth a quarter more (half of its
  worth to a caster is mana; half of that mana now comes in combat too)
- "Increases your damage with Wands by 25%"           -> wand damage worth 25 % more

With the character's talents known and the chosen specialization being its own (the tree with most points), the
talents it really has count, at their real ranks. Otherwise — another specialization looked at — the talents of
that tree the character's level reaches (a row every 5 points), at full rank.
"""

from __future__ import annotations

import json
import re
from functools import lru_cache

from .config import get_settings

STAT = {"intellect": "INTELLECT", "spirit": "SPIRIT", "stamina": "STAMINA", "strength": "STRENGTH", "agility": "AGILITY"}
EXTRA_TAB = {"feral_bear": 1, "enhancement_tank": 1}  # roles that share a tree with another specialization


@lru_cache(maxsize=2)
def _data(lang: str = "en") -> dict:
    s = get_settings()
    try:
        latest = json.loads((s.data_dir / "index.json").read_text("utf-8"))["latest"]
        return json.loads((s.data_dir / "talents" / latest / f"{lang}.json").read_text("utf-8"))
    except (OSError, KeyError, ValueError):
        return {"classes": []}


def tabs(cls: int, lang: str = "en") -> list[dict]:
    return next((c["tabs"] for c in _data(lang)["classes"] if c["id"] == cls), [])


def local_name(cls: int, name_en: str, lang: str) -> str:
    """A talent's name in the page's language (the trees are the same in every language file)."""
    if lang == "en":
        return name_en
    for tab_en, tab_l in zip(tabs(cls), tabs(cls, lang)):
        for a, b in zip(tab_en["talents"], tab_l["talents"]):
            if a["name"] == name_en:
                return b["name"]
    return name_en


def apply(w: dict[str, float], texts: list[str]) -> dict[str, float]:
    """The weights after the talents (their texts at the rank taken)."""
    w = dict(w)
    heal, sp = w.get("heal", 0.0), w.get("sp", 0.0)
    dmg = max(0.0, sp - heal) if heal else sp  # the damage part of "damage and healing"
    for t in texts:
        for stat, p in re.findall(r"Increases your (?:total )?(Intellect|Spirit|Stamina|Strength|Agility) by (\d+)%", t):
            k = STAT[stat.lower()]
            if k in w:
                w[k] = w[k] * (1 + int(p) / 100)
        for p, stat in re.findall(r"spell healing by up to (\d+)% of your (?:total )?(Spirit|Intellect)", t):
            w[STAT[stat.lower()]] = w.get(STAT[stat.lower()], 0) + int(p) / 100 * heal
        for p, stat in re.findall(r"spell damage by up to (\d+)% of your (?:total )?(Spirit|Intellect)", t):
            w[STAT[stat.lower()]] = w.get(STAT[stat.lower()], 0) + int(p) / 100 * dmg
        for p, stat in re.findall(r"spell damage and healing by up to (\d+)% of your (?:total )?(Spirit|Intellect)", t):
            w[STAT[stat.lower()]] = w.get(STAT[stat.lower()], 0) + int(p) / 100 * sp
        for p in re.findall(r"Attack Power by (?:an amount equal to )?(\d+)% of your Intellect", t):
            w["INTELLECT"] = w.get("INTELLECT", 0) + int(p) / 100 * w.get("ap", 0)
        for p in re.findall(r"[Aa]llows (\d+)% of your Mana regeneration to continue while casting\.", t):
            if "SPIRIT" in w:
                w["SPIRIT"] = w["SPIRIT"] * (1 + int(p) / 100 / 2)
        for p in re.findall(r"damage with Wands by (\d+)%", t):
            if "dps_wand" in w:
                w["dps_wand"] = w["dps_wand"] * (1 + int(p) / 100)
    return {k: round(v, 3) for k, v in w.items()}


def _taken(cls: int, rows: list[dict]) -> tuple[dict[int, int], list[int]]:
    """The character's talents as (index in all talents of the class -> rank), and points per tree; matched by
    node, then spell, then name, as the calculator does."""
    by_node, by_spell, by_name, where = {}, {}, {}, {}
    n = 0
    for ti, tab in enumerate(tabs(cls)):
        for t in tab["talents"]:
            by_node[t["id"]], by_spell[t.get("spell")], by_name[t["name"].strip().lower()] = n, n, n
            where[n] = (ti, t)
            n += 1
    ranks: dict[int, int] = {}
    for r in rows or []:
        i = (by_node.get(r.get("node")) if r.get("node") is not None else None)
        if i is None and r.get("spell") is not None:
            i = by_spell.get(r["spell"])
        if i is None and r.get("name"):
            i = by_name.get(r["name"].strip().lower())
        if i is not None and (r.get("rank") or 0) > 0:
            ranks[i] = min(where[i][1]["max"], max(ranks.get(i, 0), r["rank"]))
    points = [0] * len(tabs(cls))
    for i, rk in ranks.items():
        points[where[i][0]] += rk
    return ranks, points


def texts_for(cls: int, specs: list[str], spec: str, level: int, rows: list[dict] | None) -> tuple[list[tuple[str, str]], str]:
    """The talents (name, text at the rank taken) that may move the weights, and whose they are: "real" (the
    character's own) or "tree" (the specialization's tree as far as the level reaches)."""
    ts = tabs(cls)
    tab = EXTRA_TAB.get(spec, specs.index(spec) if spec in specs else 0)
    if not ts or tab >= len(ts):
        return [], "none"
    ranks, points = _taken(cls, rows or [])
    if ranks and max(points) > 0 and points.index(max(points)) == tab:
        flat = [t for x in ts for t in x["talents"]]
        return [(flat[i]["name"], flat[i]["ranks"][rk - 1]) for i, rk in ranks.items() if flat[i]["ranks"]], "real"
    reach = max(0, (level - 10) // 5)  # rows the level opens: 5 points in a tree open the next row
    return [(t["name"], t["ranks"][-1]) for t in ts[tab]["talents"] if t["ranks"] and t["row"] <= reach], "tree"


def for_spec(w: dict[str, float], cls: int, specs: list[str], spec: str, level: int,
             rows: list[dict] | None, lang: str = "en") -> tuple[dict[str, float], list[str], str]:
    """The weights after the talents, the names of the talents that moved them, and whose talents they are."""
    texts, whose = texts_for(cls, specs, spec, level, rows)
    out, moved = dict(w), []
    for name, text in texts:
        after = apply(out, [text])
        if after != {k: round(v, 3) for k, v in out.items()}:
            moved.append(local_name(cls, name, lang))
        out = after
    return out, moved, whose


HIT_TEXT = [re.compile(r"Improves your chance to hit with (?:\w+ )?spells by (\d+)%", re.I),
            re.compile(r"Improves your chance to hit with (\w+) spells by (\d+)%", re.I),
            re.compile(r"Reduces the chance for enemies to resist your [\w ,]+? spells by (\d+)%", re.I)]


def spell_hit(cls: int, specs: list[str], spec: str, level: int, rows: list[dict] | None) -> tuple[float, list[str]]:
    """Spell hit the talents give (Shadow Focus: 1 % a rank), from the same talents as the weights: the character's
    own when it plays the tree, else the tree's as far as the level reaches. With the names of those talents."""
    texts, _ = texts_for(cls, specs, spec, level, rows)
    total, names = 0.0, []
    for name, t in texts:
        t = re.sub(r"\s+", " ", t)
        m = HIT_TEXT[1].search(t) or HIT_TEXT[0].search(t) or HIT_TEXT[2].search(t)
        if m:
            total += float(m.groups()[-1])
            names.append(local_name(cls, name, "ru"))
    return total, names


def spell_hit_taken(cls: int, rows: list[dict] | None) -> tuple[float, list[str], float]:
    """Spell hit from the talents the character really has (their ranks), the names, and what full ranks of those
    talents would give — to tell "Shadow Focus 2/5: 3 % more from three ranks"."""
    ranks, _ = _taken(cls, rows or [])
    flat = [t for x in tabs(cls) for t in x["talents"]]
    have, names = 0.0, []
    for i, rk in ranks.items():
        t = flat[i]
        txt = re.sub(r"\s+", " ", t["ranks"][rk - 1]) if t["ranks"] else ""
        m = HIT_TEXT[1].search(txt) or HIT_TEXT[0].search(txt) or HIT_TEXT[2].search(txt)
        if m:
            have += float(m.groups()[-1])
            names.append(local_name(cls, t["name"], "ru"))
    return have, names, 0.0


def hit_talents(cls: int, lang: str = "ru") -> list[dict]:
    """Every talent of the class that gives spell hit: name, tree, ranks and hit at full rank."""
    out = []
    for ti, tab in enumerate(tabs(cls)):
        for t in tab["talents"]:
            txt = re.sub(r"\s+", " ", t["ranks"][-1]) if t["ranks"] else ""
            m = HIT_TEXT[1].search(txt) or HIT_TEXT[0].search(txt) or HIT_TEXT[2].search(txt)
            if m:
                out.append({"id": t["id"], "name": local_name(cls, t["name"], lang), "en": t["name"], "tab": ti,
                            "max": t["max"], "full": float(m.groups()[-1]), "icon": t.get("icon")})
    return out
