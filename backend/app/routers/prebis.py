"""The pre-raid best in slot of a class and specialization, as a community guide lays it out (data/prebis/): for
every slot the item that fits either way, or one for damage (hit already capped) and one for hit (still short of
the 17 % cap). Shown only for a character of that class playing that specialization.

The character's state against it: the spell hit it has (talents and worn gear), what of the list it has (worn, or
marked by hand: an item in the bags or kept for another specialization), and where to put the effort — the hit
items that close the gap to the cap first, damage everywhere else.
"""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from .. import bis, instances, talent_weights
from ..auth import CurrentUser
from ..db import Setting, get_session
from . import bis as bis_routes

router = APIRouter(prefix="/api/prebis", tags=["prebis"])
Session = Annotated[AsyncSession, Depends(get_session)]
DATA = Path(__file__).resolve().parent.parent / "data" / "prebis"
# the guide's slots against the character's equipment slots
EQUIP = {"FINGER": ["FINGER_1", "FINGER_2"], "TRINKET": ["TRINKET_1", "TRINKET_2"], "TWO_HAND": ["MAIN_HAND"]}


@lru_cache(maxsize=8)
def guide(cls: int, spec: str) -> dict | None:
    key = bis.CLASSES.get(cls, {}).get("key")
    p = DATA / f"{key}_{spec}.json"
    return json.loads(p.read_text("utf-8")) if p.is_file() else None


def current_spec(st: dict, specs: list[str], cls: int, rows: list) -> str:
    """As the throne room picks it: the one chosen by hand, else the tree with most points in the game."""
    if st.get("spec") in specs:
        return st["spec"]
    _, points = talent_weights._taken(cls, rows)
    return specs[points.index(max(points))] if points and max(points) > 0 else specs[0]


def _dungeons() -> dict[int, dict]:
    return {x["id"]: x for x in instances.snapshot() if x.get("id") is not None}


def source(src: dict, lang: str) -> dict:
    """The item's source with the names in the page's language (bosses from the game data, dungeons from the list)."""
    out = dict(src)
    d = _dungeons().get(src.get("dungeon")) if src.get("dungeon") else None
    if d:
        out["dungeonName"] = d["ru"] if lang == "ru" else d["en"]
        out["levels"] = d.get("levels")
        out["entrance"] = (d.get("entranceParts") or {}).get(src.get("part") or "") or d.get("entrance")
    if src.get("boss"):  # Forever's own bosses are named in the dungeon list (the game's encounter table)
        out["bossName"] = ((d or {}).get("bossRu") or {}).get(src["boss"]) if lang == "ru" else None
        out["bossName"] = out["bossName"] or instances.boss_name(src["boss"], lang)
    if src.get("bosses"):
        out["bossNames"] = [instances.boss_name(b, lang) for b in src["bosses"]]
    return out


async def _owned(session: AsyncSession, cid: int) -> set[int]:
    row = await session.get(Setting, f"prebis:{cid}")
    return set((row.value or {}).get("owned") or []) if row else set()


@router.get("/{cid}")
async def prebis(cid: int, user: CurrentUser, session: Session, lang: str = "ru"):
    lang = "ru" if lang == "ru" else "en"
    c, s = await bis_routes._char(session, user, cid)
    cls, level = s["classId"], s.get("level") or 1
    specs = bis.CLASSES[cls]["specs"]
    rows = (c.profile or {}).get("talents") or []
    spec = current_spec(await bis_routes._state(session, cid), specs, cls, rows)
    g = guide(cls, spec)
    if not g:
        return {"available": False, "spec": spec}
    b = await bis_routes.build(session, c, s, spec, lang, save=False)
    if b.get("status") != "ready":
        return {"available": False, "spec": spec}
    eq = {x["slot"]: x for x in (((c.profile or {}).get("equipment") or {}).get(lang) or [])}
    worn = {x["id"] for x in eq.values()}
    marked = await _owned(session, cid)
    w, rooms, gear = b["weights"], b.get("hitRoom") or {}, bis_routes.gear()
    # the hit the character's own talents give, at their real ranks (another specialization's tree gives none)
    t_hit, t_names, _ = talent_weights.spell_hit_taken(cls, rows)
    worn_hit = sum(bis.hit_rating(x.get("statv") or {}) for x in eq.values()) / 10
    ranks, _ = talent_weights._taken(cls, rows)
    flat = [t for x in talent_weights.tabs(cls) for t in x["talents"]]
    have_rank = {flat[i]["name"]: rk for i, rk in ranks.items()}
    hit_tal = [{**h, "rank": have_rank.get(h["en"], 0)} for h in talent_weights.hit_talents(cls, lang)
               if h["tab"] == specs.index(spec)]
    hit = {"talent": t_hit, "talents": t_names, "gear": round(worn_hit, 2), "total": round(t_hit + worn_hit, 2),
           "talentList": hit_tal}

    def item(entry: dict, slot: str) -> dict:
        i = entry["id"]
        it = gear.get(str(i)) or {}
        equip = EQUIP.get(slot, [slot])
        room = max((rooms.get(e, 0.0) for e in equip), default=None) if rooms else None
        full = bis_routes._item(i, lang, w, equip[0], room)
        return {"id": i, "name": (it.get("ru") if lang == "ru" else None) or it.get("en") or f"#{i}", "q": it.get("q", 3),
                "ilvl": it.get("ilvl"), "req": it.get("req"), "bind": it.get("bind"), "alt": entry.get("alt", False),
                "note": entry.get("note"), "hit": round(bis.hit_rating(it.get("stats") or {}) / 10, 2),
                "src": source(entry["src"], lang), "worn": i in worn, "marked": i in marked,
                "owned": i in worn or i in marked, "author": i in g["author"], "full": full,
                "wornItem": weakest([(b["slots"].get(e) or {}).get("worn") for e in equip])}

    def weakest(xs: list) -> dict | None:
        """Of two rings or trinkets worn, the one a new item would replace."""
        xs = [x for x in xs if x]
        return min(xs, key=lambda x: x.get("score") or 0) if xs else None

    slots = []
    for sl in g["slots"]:
        row = {"slot": sl["slot"], "count": sl.get("count", 1)}
        for k in ("center", "damage", "hit"):
            row[k] = [item(e, sl["slot"]) for e in sl.get(k) or []]
        slots.append(row)

    # hit with the list's items the character has: theirs where it has one, else what it wears there
    def slot_hit(row: dict) -> float:
        have = sorted((x["hit"] for k in ("center", "damage", "hit") for x in row[k] if x["owned"]), reverse=True)
        equip = EQUIP.get(row["slot"], [row["slot"]])
        worn_hit = sorted((bis.hit_rating((eq.get(e) or {}).get("statv") or {}) / 10 for e in equip), reverse=True)
        n = row["count"]
        return sum((have + worn_hit[len(have):])[:n]) if have else sum(worn_hit[:n])

    planned = t_hit + sum(slot_hit(r) for r in slots if r["slot"] != "TWO_HAND")
    need = max(0.0, g["hitCap"] - planned)
    # the effort: in every slot still short of items, the hit items that close the gap to the cap first (most hit
    # first), damage items in the rest; a slot with what it needs (one, or two for rings and trinkets) asks for nothing
    free = {r["slot"]: r["count"] - min(r["count"], sum(1 for k in ("center", "damage", "hit") for x in r[k] if x["owned"]))
            for r in slots}
    for r in slots:  # what fits either way comes first in its slot
        free[r["slot"]] -= sum(1 for x in r["center"] if not x["owned"])
    open_hit = sorted(((x["hit"], r["slot"], x["id"]) for r in slots for x in r["hit"] if not x["owned"] and not x["alt"]),
                      reverse=True)
    focus_hit, left, taken = set(), need - sum(x["hit"] for r in slots for x in r["center"] if not x["owned"]), {}
    for h, sl, i in open_hit:
        if left <= 0:
            break
        if taken.get(sl, 0) >= max(0, free[sl]):
            continue
        focus_hit.add(i)
        taken[sl] = taken.get(sl, 0) + 1
        left -= h
    for r in slots:
        dmg_left = max(0, free[r["slot"]] - taken.get(r["slot"], 0))
        for x in r["center"]:  # the staff is the other way to fill both hands: shown, never asked for
            x["focus"] = not x["owned"] and r["slot"] != "TWO_HAND"
        for x in r["hit"]:
            x["focus"] = x["id"] in focus_hit
        for x in r["damage"]:
            x["focus"] = not x["owned"] and not x["alt"] and dmg_left > 0
            if x["focus"]:
                dmg_left -= 1
    owned_slots = sum(min(r["count"], sum(1 for k in ("center", "damage", "hit") for x in r[k] if x["owned"]))
                      for r in slots if r["slot"] != "TWO_HAND")
    return {"available": True, "class": cls, "spec": spec, "level": level, "hit": {**hit, "cap": g["hitCap"],
            "planned": round(planned, 2), "need": round(need, 2)},
            "slots": slots, "author": g["author"], "owned": owned_slots,
            "summary": {
                "worn": summary([x.get("statv") or {} for x in eq.values()], t_hit),
                # the best combination, with the hit talents at full rank
                "sim": summary([(gear.get(str(i)) or {}).get("stats") or {} for i in g["author"]],
                               sum(h["full"] for h in hit_tal)),
            },
            "talents": g.get("talents"), "stats": g.get("stats"), "rotation": g.get("rotation"),
            "consumables": g.get("consumables"), "enchants": enchant_state(g, eq),
            "total": sum(r["count"] for r in slots if r["slot"] != "TWO_HAND")}


def enchant_state(g: dict, eq: dict) -> list[dict]:
    """Every slot the guide enchants against what the character's gear carries (Blizzard gives the enchantment as
    its text, in the page's language): the right one, another one, or none; nothing to check on an empty slot."""
    import re

    two = (eq.get("MAIN_HAND") or {}).get("inv") == "TWOHWEAPON"
    out = []
    for e in g.get("enchants") or []:
        if "twoHand" in e and e["twoHand"] != two:
            continue
        for slot in e["slots"]:
            x = eq.get(slot)
            if not x or (slot == "OFF_HAND" and two):
                continue
            texts = [str(t) for t in x.get("enchants") or []]
            m = e["match"]

            def ok(t: str) -> bool:
                if m.get("sp"):
                    return bool(re.search(rf"\b{m['sp']}\b", t)) and bool(re.search(r"spell|заклин", t, re.I))
                if m.get("speed"):
                    return bool(re.search(r"speed|скорост", t, re.I))
                if m.get("wisdom"):
                    return bool(re.search(r"intellect|интеллект", t, re.I)) and bool(re.search(r"spirit|дух", t, re.I))
                return False
            state = "ok" if any(ok(t) for t in texts) else ("other" if texts else "none")
            out.append({"key": e["key"], "slot": slot, "alt": bool(e.get("alt")), "state": state, "have": texts,
                        "item": e.get("item"), "maker": e["maker"], "value": e.get("value"), "itemName": x.get("name")})
    # the boots: speed instead of the armor kit is a choice, either one counts
    feet = [o for o in out if o["slot"] == "FEET"]
    if any(o["state"] == "ok" for o in feet):
        for o in feet:
            o["covered"] = True
    return out


STAT_KEYS = {"sp": ("SPELL_POWER", "SPELL_DAMAGE_DONE"), "shadow": ("BONUS_STAT_SHADOW_DAMAGE_DONE",),
             "crit": ("CRIT_RATING", "CRIT_SPELL_RATING", "SPELL_CRIT_RATING"), "hit": bis.HIT_KEYS,
             "pen": ("SPELL_PENETRATION",), "int": ("INTELLECT",), "spi": ("SPIRIT",), "sta": ("STAMINA",),
             "mp5": ("MANA_REGENERATION",)}


def summary(stats_list: list[dict], talent_hit: float) -> dict:
    """The stats a set of items adds up to, as the game shows them: spell power and Shadow damage, crit and hit in
    per cent (14 and 10 rating a per cent; hit with the talents), spell penetration, intellect, spirit, stamina."""
    tot = {k: sum(sum(st.get(n, 0) for n in names) for st in stats_list) for k, names in STAT_KEYS.items()}
    return {"sp": tot["sp"], "shadow": tot["sp"] + tot["shadow"], "crit": round(tot["crit"] / 14, 2),
            "hit": round(talent_hit + tot["hit"] / 10, 2), "pen": tot["pen"], "int": tot["int"], "spi": tot["spi"],
            "sta": tot["sta"], "mp5": tot["mp5"]}


class OwnedIn(BaseModel):
    item_id: int
    owned: bool


@router.put("/{cid}/owned")
async def set_owned(cid: int, body: OwnedIn, user: CurrentUser, session: Session):
    """Mark an item of the list as had (in the bags, kept for another specialization) or not."""
    await bis_routes._char(session, user, cid)
    have = await _owned(session, cid)
    (have.add if body.owned else have.discard)(body.item_id)
    await session.merge(Setting(key=f"prebis:{cid}", value={"owned": sorted(have)}))
    await session.commit()
    return {"owned": sorted(have)}

