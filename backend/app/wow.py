"""Turn Blizzard API answers into the small shapes the hub stores and shows.

Pure functions, no network: the API shapes for Forever are not documented, so every reader here
accepts both the retail and the classic shape and skips what it does not recognise.
"""

from __future__ import annotations

from collections.abc import Iterable
from typing import Any

from .bnet import name_of


def _get(d: Any, *keys: str, default: Any = None) -> Any:
    for k in keys:
        if not isinstance(d, dict) or k not in d:
            return default
        d = d[k]
    return d


def character_summary(p: dict, lang: str | None = None) -> dict:
    """Profile summary: name, level, class, race, guild (with its API link for the roster)."""
    guild = p.get("guild") or {}
    return {
        "name": name_of(p.get("name"), lang) or "",
        "level": p.get("level"),
        # profile: character_class / race; Battle.net account list: playable_class / playable_race
        "classId": _get(p, "character_class", "id") or _get(p, "playable_class", "id"),
        "className": name_of(p.get("character_class") or p.get("playable_class"), lang),
        "race": name_of(p.get("race") or p.get("playable_race"), lang),
        "raceId": _get(p, "race", "id") or _get(p, "playable_race", "id"),
        "gender": _get(p, "gender", "type"),
        "faction": _get(p, "faction", "type"),
        "guild": {"name": name_of(guild, lang), "href": _get(guild, "key", "href")} if guild else None,
        "ruleset": name_of(p.get("ruleset") or p.get("realm"), lang) or None,
        "ilvl": p.get("equipped_item_level") or p.get("average_item_level"),
        "lastLogin": p.get("last_login_timestamp"),
        "xp": p.get("experience"),
    }


def txt(v: Any, lang: str | None = None) -> str | None:
    """A text field as a string. Asked without a locale, Blizzard sends {"en_US": …, "ru_RU": …}."""
    if v is None or isinstance(v, bool):
        return None
    if isinstance(v, str | int | float):
        return str(v)
    if isinstance(v, dict):
        if "display_string" in v:
            return txt(v["display_string"], lang)
        return name_of(v, lang) or None
    return None


def _num(v: Any) -> int | None:
    return v if isinstance(v, int) and not isinstance(v, bool) else None


def _lines(xs: Iterable[Any], lang: str | None = None) -> list[str]:
    out = []
    for x in xs or []:
        s = txt(_get(x, "display", "display_string"), lang) or txt(_get(x, "display_string"), lang)
        if s is None and isinstance(x, str):
            s = x
        if s:
            out.append(s)
    return out


def equipment(eq: dict, lang: str | None = None) -> list[dict]:
    """Equipped items: slot, item id, name, quality, item level, stats and enchant lines."""
    out = []
    for it in eq.get("equipped_items") or []:
        out.append({
            "slot": _get(it, "slot", "type"),
            "slotName": name_of(it.get("slot"), lang),
            "id": _get(it, "item", "id"),
            "name": name_of(it.get("name"), lang) or name_of(it.get("item"), lang),
            "quality": _get(it, "quality", "type"),
            "ilvl": _get(it, "level", "value"),
            "stats": _lines(it.get("stats"), lang),
            "enchants": _lines(it.get("enchantments"), lang),
            "set": name_of(_get(it, "set", "item_set"), lang) or None,
        })
    return out


def _talent_rows(x: Any) -> Iterable[dict]:
    """Every dict that looks like one chosen talent, anywhere under x."""
    if isinstance(x, dict):
        rank = x.get("rank", x.get("talent_rank"))
        talent = x.get("talent") or _get(x, "tooltip", "talent")
        if isinstance(rank, int) and (talent or "id" in x):
            yield x
            return
        for v in x.values():
            yield from _talent_rows(v)
    elif isinstance(x, list):
        for v in x:
            yield from _talent_rows(v)


def talents(specs: dict) -> list[dict]:
    """Chosen talents of the active loadout (retail shape) or group (classic shape).

    Each row: node (TraitNode id when given), talent id, spell id, name, rank. The calculator maps
    them to its own nodes by node id, then spell, then name.
    """
    active: Any = None
    for sp in specs.get("specializations") or []:  # retail: specializations[].loadouts[]
        for lo in sp.get("loadouts") or []:
            if lo.get("is_active"):
                active = lo
    if active is None:
        for g in specs.get("specialization_groups") or []:  # classic: specialization_groups[]
            if g.get("is_active"):
                active = g
    if active is None:
        active = specs
    out, seen = [], set()
    for x in _talent_rows(active):
        tal = x.get("talent") or _get(x, "tooltip", "talent") or {}
        spell = _get(x, "spell_tooltip", "spell") or _get(x, "tooltip", "spell_tooltip", "spell") or {}
        row = {
            "node": x.get("id") if "tooltip" in x else None,
            "talent": tal.get("id"),
            "spell": spell.get("id"),
            "name": name_of(tal) or name_of(spell),
            "rank": x.get("rank", x.get("talent_rank")),
        }
        k = (row["node"], row["talent"], row["spell"], row["name"])
        if k not in seen:
            seen.add(k)
            out.append(row)
    return out


def media_url(m: dict, *keys: str, strict: bool = False) -> str | None:
    """First asset URL from a media answer (keys tried in order, e.g. "avatar", "inset", "icon").

    Without `strict`, any asset will do when none of the keys is there.
    """
    assets = m.get("assets") or []
    for k in keys:
        for a in assets:
            if a.get("key") == k and a.get("value"):
                return a["value"]
    return None if strict or not assets else assets[0].get("value")


def item(it: dict, media: dict | None, lang: str | None = None) -> dict:
    preview = it.get("preview_item") or {}
    return {
        "id": it.get("id"),
        "name": name_of(it.get("name"), lang),
        "quality": _get(it, "quality", "type"),
        "level": _num(it.get("level")),
        "required": _num(it.get("required_level")),
        "class": name_of(it.get("item_class"), lang),
        "subclass": name_of(it.get("item_subclass"), lang),
        "slot": name_of(it.get("inventory_type"), lang),
        "binding": name_of(preview.get("binding"), lang) or None,
        "stats": _lines(preview.get("stats"), lang),
        "spells": [d for x in preview.get("spells") or [] if (d := txt(x.get("description"), lang))],
        "armor": txt(_get(preview, "armor", "display"), lang),
        "damage": txt(_get(preview, "weapon", "damage"), lang),
        "speed": txt(_get(preview, "weapon", "attack_speed"), lang),
        "sell": _num(_get(preview, "sell_price", "value", default=it.get("sell_price"))),
        "description": txt(preview.get("description") or it.get("description"), lang),
        "icon": media_url(media or {}, "icon"),
    }


def summarize_auctions(rows: Iterable[dict]) -> dict[int, dict]:
    """Per item: lowest and median unit buyout (copper), total quantity, number of auctions.

    Classic auctions carry `buyout` for the whole stack and `quantity`; commodities carry `unit_price`.
    Auctions with no buyout (bid only) count for quantity but not for prices.
    """
    acc: dict[int, dict] = {}
    for a in rows:
        iid = _get(a, "item", "id")
        if not isinstance(iid, int):
            continue
        q = int(a.get("quantity") or 1)
        unit = a.get("unit_price")
        if unit is None and a.get("buyout"):
            unit = int(a["buyout"]) // max(q, 1)
        e = acc.setdefault(iid, {"units": [], "quantity": 0, "auctions": 0})
        e["quantity"] += q
        e["auctions"] += 1
        if unit:
            e["units"].append((int(unit), q))
    out = {}
    for iid, e in acc.items():
        if not e["units"]:
            continue
        units = sorted(e["units"])
        # median by quantity, so one cheap single does not stand for a whole stack
        total, half, med = sum(q for _, q in units), 0, units[-1][0]
        for u, q in units:
            half += q
            if half * 2 >= total:
                med = u
                break
        out[iid] = {
            "min": units[0][0],
            "median": med,
            "quantity": e["quantity"],
            "auctions": e["auctions"],
        }
    return out


def houses(index: dict, lang: str | None = None) -> list[dict]:
    """Auction houses of a ruleset index: [{id, name}]; accepts auctions[] or houses[] lists."""
    out = []
    for k in ("auctions", "houses", "auction_houses"):
        for h in index.get(k) or []:
            if isinstance(h, dict) and "id" in h:
                out.append({"id": h["id"], "name": name_of(h, lang) or str(h["id"])})
        if out:
            break
    return out


def rulesets(index: dict, lang: str | None = None) -> list[dict]:
    out = []
    for r in index.get("rulesets") or []:
        if isinstance(r, dict) and "id" in r:
            # Forever's index gives bare ids (1, 2, 3, 15); the UI names them when no name comes
            out.append({"id": r["id"], "name": name_of(r, lang) or "", "type": _get(r, "type", "type")})
    return out



def roster(r: dict, lang: str | None = None) -> list[dict]:
    """Guild members: name, level, class id, race, rank (0 = guild master); highest rank and level first."""
    out = []
    for m in r.get("members") or []:
        ch = m.get("character") or {}
        out.append({
            "name": name_of(ch.get("name"), lang),
            "level": ch.get("level"),
            "classId": _get(ch, "playable_class", "id"),
            "raceId": _get(ch, "playable_race", "id"),
            "rank": m.get("rank"),
        })
    return sorted(out, key=lambda x: (x["rank"] if x["rank"] is not None else 99, -(x["level"] or 0), x["name"]))


# stat key -> how to read it; percentages are shown with "%"
_STATS = [
    ("health", "n"), ("power", "n"), ("strength", "e"), ("agility", "e"), ("stamina", "e"), ("intellect", "e"),
    ("spirit", "e"), ("armor", "e"), ("attack_power", "n"), ("melee_crit", "p"), ("ranged_crit", "p"),
    ("spell_crit", "p"), ("spell_power", "n"), ("mana_regen", "n"), ("dodge", "p"), ("parry", "p"), ("block", "p"),
    ("defense", "e"), ("melee_haste", "p"), ("spell_haste", "p"), ("versatility", "n"), ("mastery", "p"),
]


def statistics(st: dict, lang: str | None = None) -> dict:
    """Character sheet numbers: {key: value}, plus the power type's name (Mana, Rage, Energy)."""
    out: dict = {}
    for key, how in _STATS:
        v = st.get(key)
        if isinstance(v, dict):
            v = v.get("effective", v.get("value", v.get("base")))
        if isinstance(v, int | float) and not isinstance(v, bool):
            out[key] = round(v, 2) if how == "p" else int(v) if float(v).is_integer() else round(v, 1)
    power = name_of(st.get("power_type"), lang)
    if power:
        out["powerName"] = power
    return out


def professions(p: dict, lang: str | None = None) -> list[dict]:
    """Primary and secondary professions with skill: classic gives skill_points directly, retail per tier."""
    out = []
    for kind in ("primaries", "secondaries"):
        for x in p.get(kind) or []:
            name = name_of(x.get("profession"), lang)
            skill, mx = x.get("skill_points"), x.get("max_skill_points")
            tiers = x.get("tiers") or []
            if skill is None and tiers:
                t = tiers[-1]
                skill, mx = t.get("skill_points"), t.get("max_skill_points")
            if name:
                out.append({
                    "name": name, "id": _get(x, "profession", "id"),
                    "kind": "primary" if kind == "primaries" else "secondary", "skill": _num(skill), "max": _num(mx),
                })
    return out
