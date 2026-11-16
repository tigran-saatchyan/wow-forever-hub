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


SURNAME_KEYS = ("surname", "last_name", "lastname", "family_name", "familyname", "second_name", "character_surname")


def surname(p: Any, lang: str | None = None, depth: int = 0) -> str | None:
    """Forever's character surname, wherever Blizzard puts it: a top-level field (plain or localized),
    or one level down (e.g. inside "name" or "character"). Not documented yet, so several names are tried."""
    if not isinstance(p, dict) or depth > 2:
        return None
    for k in SURNAME_KEYS:
        v = p.get(k)
        s = v if isinstance(v, str) else name_of(v, lang) if isinstance(v, dict) else None
        if s and s.strip():
            return s.strip()
    # "name_search": "Asavar Kul" next to "name": "Asavar"
    full, first = p.get("name_search"), name_of(p.get("name"), lang)
    if isinstance(full, str) and first and full.lower().startswith(first.lower() + " "):
        return full[len(first):].strip() or None
    for k, v in p.items():
        if k in ("_links", "guild", "realm", "race", "character_class", "playable_class", "playable_race",
                 "faction", "gender", "active_spec", "covenant_progress"):
            continue
        if isinstance(v, dict):
            s = surname(v, lang, depth + 1)
            if s:
                return s
    return None


def surname_from_href(ch: dict) -> str | None:
    """Roster entries carry no surname field, but their link is /character/name-surname."""
    href = _get(ch, "key", "href") or ""
    slug = href.split("/character/", 1)[1].split("?")[0] if "/character/" in href else ""
    first = (name_of(ch.get("name")) or "").lower()
    if first and slug.lower().startswith(first + "-"):
        rest = slug[len(first) + 1:]
        return " ".join(w.capitalize() for w in rest.split("-") if w) or None
    return None


def character_summary(p: dict, lang: str | None = None) -> dict:
    """Profile summary: name, level, class, race, guild (with its API link for the roster)."""
    guild = p.get("guild") or {}
    return {
        "name": name_of(p.get("name"), lang) or "",
        "surname": surname(p, lang) or surname_from_href(p),
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
            "surname": surname(ch, lang) or surname_from_href(ch),
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
            known = [r for t in ([x] + tiers) for r in (t.get("known_recipes") or []) if isinstance(r, dict)]
            if name:
                out.append({
                    "name": name, "id": _get(x, "profession", "id"),
                    "kind": "primary" if kind == "primaries" else "secondary", "skill": _num(skill), "max": _num(mx),
                    # recipes the character knows, when Blizzard lists them (retail shape: per tier)
                    "known": [r.get("id") for r in known if isinstance(r.get("id"), int)],
                    "knownNames": [n for r in known if (n := name_of(r, "en"))],
                    "hasKnown": any("known_recipes" in t for t in [x] + tiers),
                })
    return out


# ---------- armory tabs: every reader tolerates the retail and classic shapes and missing parts ----------

def pvp(p: dict, lang: str | None = None) -> dict:
    out: dict = {}
    for k in ("honorable_kills", "honor_level", "pvp_rank", "lifetime_honorable_kills", "dishonorable_kills"):
        v = p.get(k)
        if isinstance(v, dict):
            v = v.get("value", v.get("id"))
        if _num(v) is not None:
            out[k] = v
    rank = p.get("pvp_rank") or p.get("rank")
    if isinstance(rank, dict) and name_of(rank, lang):
        out["rankName"] = name_of(rank, lang)
    out["maps"] = []
    for m in p.get("pvp_map_statistics") or []:
        mp = m.get("match_statistics") or {}
        out["maps"].append({"name": name_of(m.get("world_map"), lang), "played": _num(mp.get("played")),
                            "won": _num(mp.get("won")), "lost": _num(mp.get("lost"))})
    out["brackets"] = [name_of(b, lang) or _get(b, "href") for b in p.get("brackets") or []]
    return out


def reputations(p: dict, lang: str | None = None) -> list[dict]:
    out = []
    for r in p.get("reputations") or []:
        st = r.get("standing") or {}
        out.append({"name": name_of(r.get("faction"), lang), "standing": name_of(st, lang),
                    "tier": _num(st.get("tier")), "value": _num(st.get("value")), "max": _num(st.get("max")),
                    "raw": _num(st.get("raw"))})
    return sorted(out, key=lambda x: (-(x["tier"] or 0), -(x["raw"] or 0)))


def achievements(p: dict, lang: str | None = None) -> dict:
    done = [a for a in p.get("achievements") or [] if a.get("completed_timestamp")]
    done.sort(key=lambda a: -a["completed_timestamp"])
    return {
        "points": _num(p.get("total_points")),
        "count": _num(p.get("total_quantity")) or len(done),
        "recent": [{"name": name_of(a.get("achievement"), lang), "id": _get(a, "achievement", "id"),
                    "at": a["completed_timestamp"]} for a in done[:30]],
        "categories": [{"name": name_of(c.get("category"), lang),
                        "done": _num(_get(c, "progress", "quantity")), "points": _num(_get(c, "progress", "points"))}
                       for c in p.get("category_progress") or []],
    }


def collection(p: dict, key: str, lang: str | None = None) -> list[dict]:
    out = []
    for x in p.get(key) or []:
        inner = x.get(key[:-1]) or x.get("species") or x.get("mount") or x.get("toy") or x
        out.append({"name": name_of(inner, lang), "id": _get(inner, "id"),
                    "favorite": bool(x.get("is_favorite")), "level": _num(x.get("level"))})
    return sorted(out, key=lambda x: x["name"] or "")


def encounters(p: dict, lang: str | None = None) -> list[dict]:
    out = []
    for ex in p.get("expansions") or []:
        for inst in ex.get("instances") or []:
            modes = []
            for m in inst.get("modes") or []:
                pr = m.get("progress") or {}
                bosses = [{"name": name_of(e.get("encounter"), lang), "kills": _num(e.get("completed_count"))}
                          for e in pr.get("encounters") or []]
                modes.append({"mode": name_of(m.get("difficulty"), lang), "done": _num(pr.get("completed_count")),
                              "total": _num(pr.get("total_count")), "bosses": bosses})
            out.append({"name": name_of(inst.get("instance"), lang), "modes": modes})
    return out


def titles(p: dict, lang: str | None = None) -> dict:
    return {"active": name_of(p.get("active_title"), lang) or None,
            "all": sorted(n for t in p.get("titles") or [] if (n := name_of(t, lang)))}


def quests(p: dict, lang: str | None = None) -> dict:
    qs = p.get("quests") or []
    return {"count": len(qs), "recent": [n for q in qs[-15:] if (n := name_of(q, lang))]}



def quests_active(p: dict, lang: str | None = None) -> list[dict]:
    """Quests in the character's log (/quests -> in_progress)."""
    return [{"id": q.get("id"), "name": name_of(q, lang)} for q in p.get("in_progress") or [] if isinstance(q, dict)]
