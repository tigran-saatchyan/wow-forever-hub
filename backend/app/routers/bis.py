"""Best in slot for one character: the top three items of every slot for their class, specialization and level
(app/bis.py), what they wear now, and which of the three the user picked.

The picks are kept per character and specialization until the character's level changes: a new level has new
best gear, so the picks start over from the top of every slot. When everything worn is as good as the picks,
the set counts as complete; the first look at a complete set each day says so ("cheer"), for the throne room.
"""

from __future__ import annotations

import json
from datetime import date
from functools import lru_cache
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from .. import bis, fdb_gear, talent_weights
from ..auth import CurrentUser
from ..db import Character, SessionLocal, Setting, get_session

router = APIRouter(prefix="/api/bis", tags=["bis"])
Session = Annotated[AsyncSession, Depends(get_session)]
GEAR = Path(__file__).resolve().parent.parent / "data" / "gear.json"


@lru_cache(maxsize=1)
def base_gear() -> dict[str, dict]:
    """The reference built from Blizzard's item API (tools/build_gear.py)."""
    if not GEAR.is_file():
        return {}
    return {k: bis.plausible_dps(v) for k, v in json.loads(GEAR.read_text("utf-8"))["items"].items()}


@lru_cache(maxsize=1)
def fixes() -> dict[str, dict]:
    """Items as the game shows them (tooltip screenshots), for where ForeverDB and Blizzard miss a bonus or carry
    the original game's numbers; see tools and data/item_fixes.json."""
    p = GEAR.parent / "item_fixes.json"
    return json.loads(p.read_text("utf-8"))["items"] if p.is_file() else {}


def gear() -> dict[str, dict]:
    """The whole reference: Blizzard's items and the ones only ForeverDB knows (app/fdb_gear.py), less the items
    ForeverDB doubts are in the game."""
    global _merged
    extra, flags = fdb_gear.extra(), fdb_gear._flags
    stamp = (len(extra), len(flags))
    if _merged[0] != stamp:  # rebuilt only when the ForeverDB half changed
        merged = {**base_gear(), **{k: bis.plausible_dps(v) for k, v in extra.items()}}
        for k, fix in fixes().items():  # what the game itself shows wins (data/item_fixes.json)
            base = merged.get(k) or {"classes": -1, "races": -1, "pvp": 0, "flags": 0, "bind": 1, "set": 0, "rep": 0,
                                     "skill": 0, "spells": [], "unique": False}
            merged[k] = {**base, **{f: v for f, v in fix.items() if v is not None}}
        _merged = (stamp, {k: v for k, v in merged.items() if not flags.get(k)})
    return _merged[1]


_merged: tuple[tuple[int, int] | None, dict] = (None, {})


def _item(i: int, lang: str, w: dict, slot: str, room: float | None = None) -> dict | None:
    it = gear().get(str(i))
    if not it:
        return None
    return {"id": i, "name": it.get(lang) or it["en"], "q": it["q"], "ilvl": it["ilvl"], "req": it["req"],
            "stats": it.get("stats") or {}, "armor": it.get("armor"), "dps": it.get("dps"), "speed": it.get("speed"),
            "spells": it.get("spells") or [], "two": it["slot"] == 17, "score": bis.score(it, w, slot, room)}


QUALITY = {"POOR": 0, "COMMON": 1, "UNCOMMON": 2, "RARE": 3, "EPIC": 4, "LEGENDARY": 5}


def _worn(x: dict, w: dict, slot: str, room: float | None = None) -> dict:
    """A worn item the gear reference lacks (Forever's item API does not know every item): told by the character's
    own equipment, which carries its stats."""
    it = {"stats": x.get("statv") or {}, "armor": x.get("armor"), "dps": x.get("dps"),
          "cls": 2 if x.get("dps") else 4, "sub": 0}
    return {"id": x["id"], "name": x.get("name") or f"#{x['id']}", "q": QUALITY.get(x.get("quality") or "", 1),
            "ilvl": x.get("ilvl") or 0, "req": 0, "stats": it["stats"], "armor": it["armor"], "dps": it["dps"],
            "speed": None, "spells": [], "two": x.get("inv") == "TWOHWEAPON", "score": bis.score(it, w, slot, room)}


async def _char(session: AsyncSession, user, cid: int) -> tuple[Character, dict]:
    c = await session.get(Character, cid)
    if not c or c.user_id != user.id:
        raise HTTPException(404, "no such character")
    s = ((c.profile or {}).get("summary") or {}).get("en") or {}
    if not s.get("classId") or s["classId"] not in bis.CLASSES:
        raise HTTPException(422, "the character's class is not known yet")
    return c, s


def hit_state(cls: int, specs: list[str], spec: str, level: int, rows: list, eq: dict) -> tuple[dict | None, dict]:
    """For the casters that damage: the spell hit the character has (talents and what it wears) against the cap,
    and for every slot how much hit rating an item there can still use (the cap less all hit but that slot's).
    Nothing for the other specializations: their hit keeps its plain weight."""
    if (cls, spec) not in bis.CASTER_DPS:
        return None, {}
    talent, names = talent_weights.spell_hit(cls, specs, spec, level, rows)
    per_slot = {k: bis.hit_rating(x.get("statv") or {}) for k, x in eq.items()}
    gear_hit = sum(per_slot.values())
    cap = bis.HIT_CAP * 10
    rooms = {slot: cap - (talent * 10 + gear_hit - per_slot.get(slot, 0.0)) for slot in bis.SLOTS}
    return {"cap": bis.HIT_CAP, "talent": talent, "talents": names, "gear": round(gear_hit / 10, 2),
            "total": round(talent + gear_hit / 10, 2)}, rooms


async def _state(session: AsyncSession, cid: int) -> dict:
    row = await session.get(Setting, f"bis:{cid}")
    return dict(row.value) if row else {}


@router.get("/{cid}")
async def get_bis(cid: int, user: CurrentUser, session: Session, spec: str | None = None, lang: str = "ru"):
    lang = "ru" if lang == "ru" else "en"
    c, s = await _char(session, user, cid)
    return await build(session, c, s, spec, lang)


async def build(session: AsyncSession, c: Character, s: dict, spec: str | None, lang: str, save: bool = True) -> dict:
    """The BiS list of a character for a specialization (its saved one when none is given). `save` keeps the state
    (level, the once-a-day cheer); other pages reading the list (the auction house) pass False."""
    cid = c.id
    cls, level, faction = s["classId"], s.get("level") or 1, s.get("faction")
    specs = bis.CLASSES[cls]["specs"]
    st = await _state(session, cid)
    if st.get("level") != level:  # a new level: new best gear, the picks start over (own weights stay)
        st = {"level": level, "spec": st.get("spec"), "picks": {}, "cheer": st.get("cheer"), "custom": st.get("custom")}
    allowed = [*specs, bis.CUSTOM]
    rows = (c.profile or {}).get("talents") or []
    _, points = talent_weights._taken(cls, rows)
    own_tree = specs[points.index(max(points))] if points and max(points) > 0 else None
    spec = spec if spec in allowed else (st.get("spec") if st.get("spec") in allowed else own_tree)
    if not gear():
        return {"status": "nodata"}
    custom = st.get("custom") or {}
    base = custom.get("base") if custom.get("base") in specs else specs[0]
    if spec == bis.CUSTOM:  # the player's own weights over the specialization they started from
        moved, whose = [], "custom"
    eq = {x["slot"]: x for x in (((c.profile or {}).get("equipment") or {}).get(lang) or [])}
    hit, rooms = hit_state(cls, specs, spec if spec in specs else (custom.get("base") if spec == bis.CUSTOM else specs[0]),
                           level, rows, eq)
    if spec == bis.CUSTOM:
        out = bis.choose(gear(), cls, base, level, faction, w={**bis.weights(cls, base), **(custom.get("w") or {})},
                         hit_room=rooms)
    else:
        # Pawn's weights for the specialization, moved by talents: the character's own when it plays this tree
        tw, moved, whose = talent_weights.for_spec(bis.weights(cls, spec or specs[0]), cls, specs, spec or specs[0], level, rows, lang)
        out = bis.choose(gear(), cls, spec or specs[0], level, faction, w=tw, hit_room=rooms)
    w = out["weights"]
    picks = (st.get("picks") or {}).get(spec or specs[0]) or {}
    worn = {k: x["id"] for k, x in eq.items()}
    slots, have, total = {}, 0, 0
    two_hand = out["twoHand"]
    for slot, cands in out["slots"].items():
        options = [x for x in (_item(cd["id"], lang, w, slot, rooms.get(slot)) for cd in cands) if x]
        pick = min(int(picks.get(slot, 0)), max(0, len(options) - 1))
        if slot == "MAIN_HAND" and options:
            two_hand = options[pick]["two"]
        wid = worn.get(slot)
        mine = (_item(wid, lang, w, slot, rooms.get(slot)) or _worn(eq[slot], w, slot, rooms.get(slot))) if wid else None
        # what is worn is BiS only when it is one of the three items of the list for this level, and then its place
        # in it (0 = the first); a new level brings a new list, and the item is checked against that one
        # what is worn takes part too: an item the reference lacks (Forever's API doesn't know every item) can't be
        # left below items it beats
        if mine and wid not in {o["id"] for o in options} and \
                (len(options) < 3 or mine["score"] > options[-1]["score"]):
            options = sorted([*options, {**mine, "wornOnly": True}], key=lambda o: -o["score"])[:3]
            pick = min(pick, len(options) - 1)
        if slot == "MAIN_HAND" and options:  # the main hand decides whether the off hand is free (after the worn joined)
            two_hand = options[pick]["two"]
        rank = next((n for n, o in enumerate(options) if o["id"] == wid), None) if wid else None
        slots[slot] = {"options": options, "pick": pick, "worn": mine, "wornId": wid, "wornRank": rank}
    for slot, x in slots.items():
        if slot == "OFF_HAND" and two_hand:
            x["options"], x["pick"] = [], 0
        if not x["options"]:
            x["ok"] = True
            continue
        total += 1
        # worn is BiS when it takes one of the three places
        x["ok"] = x["wornRank"] is not None
        have += x["ok"]
    complete = total > 0 and have == total
    # where each choice comes from, from the stored "where to get it" answers (fetched ahead in the background)
    from .sources import briefs
    src = await briefs(session, list({o["id"] for x in slots.values() for o in x["options"]}), lang, faction)
    for x in slots.values():
        for o in x["options"]:
            o["src"] = src.get(o["id"])
    cheer = False
    if save:
        if complete and st.get("cheer") != date.today().isoformat():
            cheer, st["cheer"] = True, date.today().isoformat()
        await session.merge(Setting(key=f"bis:{cid}", value=st))
        await session.commit()
    return {"status": "ready", "class": bis.CLASSES[cls]["key"], "specs": specs, "spec": spec or specs[0], "customBase": base, "customSet": bool(custom.get("w")), "specSaved": bool(st.get("spec")), "level": level,
            "twoHand": two_hand, "slots": slots, "have": have, "total": total, "complete": complete, "cheer": cheer,
            "weights": w, "maxIlvl": bis.MAX_ILVL, "talentsMoved": moved, "talentsFrom": whose, "hit": hit, "hitRoom": rooms}


class Pick(BaseModel):
    spec: str
    slot: str = Field(max_length=20)
    pick: int = Field(ge=0, le=2)


class SpecIn(BaseModel):
    spec: str


@router.put("/{cid}/pick")
async def set_pick(cid: int, body: Pick, user: CurrentUser, session: Session):
    _, s = await _char(session, user, cid)
    if body.spec not in [*bis.CLASSES[s["classId"]]["specs"], bis.CUSTOM] or body.slot not in bis.SLOTS:
        raise HTTPException(422, "unknown specialization or slot")
    st = await _state(session, cid)
    level = s.get("level") or 1
    if st.get("level") != level:
        st = {"level": level, "spec": st.get("spec"), "picks": {}, "cheer": st.get("cheer"), "custom": st.get("custom")}
    picks = dict(st.get("picks") or {})
    picks[body.spec] = {**(picks.get(body.spec) or {}), body.slot: body.pick}
    st["picks"] = picks
    await session.merge(Setting(key=f"bis:{cid}", value=st))
    await session.commit()
    return {"ok": True}


@router.put("/{cid}/spec")
async def set_spec(cid: int, body: SpecIn, user: CurrentUser, session: Session):
    """The specialization the BiS mode shows for this character (kept across levels)."""
    _, s = await _char(session, user, cid)
    if body.spec not in [*bis.CLASSES[s["classId"]]["specs"], bis.CUSTOM]:
        raise HTTPException(422, "unknown specialization")
    st = await _state(session, cid)
    st["spec"] = body.spec
    await session.merge(Setting(key=f"bis:{cid}", value=st))
    await session.commit()
    return {"ok": True}


class CustomIn(BaseModel):
    base: str
    weights: dict[str, float] = Field(max_length=60)


@router.put("/{cid}/custom")
async def set_custom(cid: int, body: CustomIn, user: CurrentUser, session: Session):
    """The player's own weights: the specialization they start from and their numbers (kept across levels)."""
    _, s = await _char(session, user, cid)
    if body.base not in bis.CLASSES[s["classId"]]["specs"]:
        raise HTTPException(422, "unknown specialization")
    w = {k[:48]: max(-10.0, min(20.0, float(v))) for k, v in body.weights.items()}
    st = await _state(session, cid)
    st["custom"], st["spec"] = {"base": body.base, "w": w}, bis.CUSTOM
    await session.merge(Setting(key=f"bis:{cid}", value=st))
    await session.commit()
    return {"ok": True}


async def upcoming_items() -> list[int]:
    """Every item in the BiS lists of every character for their level and the next one, in their chosen
    specialization (all of the class's before one is chosen): what the "where to get it" panel will be asked
    about, fetched ahead (app/routers/sources.py prefetcher)."""
    from sqlalchemy import select

    if not gear():
        return []
    out: list[int] = []
    async with SessionLocal() as session:
        chars = (await session.execute(select(Character))).scalars().all()
        for c in chars:
            s = ((c.profile or {}).get("summary") or {}).get("en") or {}
            cls, level = s.get("classId"), s.get("level") or 1
            if cls not in bis.CLASSES:
                continue
            st = await _state(session, c.id)
            specs = [st["spec"]] if st.get("spec") in bis.CLASSES[cls]["specs"] else bis.CLASSES[cls]["specs"]
            for lv in {level, min(60, level + 1)}:
                for sp in specs:
                    for cands in bis.choose(gear(), cls, sp, lv, s.get("faction"))["slots"].values():
                        out += [x["id"] for x in cands]
    return list(dict.fromkeys(out))


@router.get("/{cid}/compare")
async def compare_items(cid: int, user: CurrentUser, session: Session, ids: str = "", lang: str = "ru"):
    """Any items against what the character wears, by its specialization's weights: for each item that is gear it
    can wear, the item as the BiS mode shows it and the worn one in the same slot (of two rings or trinkets, the
    weaker); `gear` false for anything else (a key, a quest item), which keeps its plain tooltip."""
    lang = "ru" if lang == "ru" else "en"
    c, s = await _char(session, user, cid)
    b = await build(session, c, s, None, lang, save=False)
    out = []
    want = [int(x) for x in ids.split(",") if x.strip().isdigit()][:30]
    if b.get("status") != "ready":
        return [{"id": i, "gear": False} for i in want]
    w, spec, cls = b["weights"], b["spec"], s["classId"]
    for i in want:
        it = gear().get(str(i))
        slots = [sl for sl in bis.SLOTS if it and bis.fits(it, sl, cls, spec)] if it else []
        if not slots:
            out.append({"id": i, "gear": False})
            continue
        slot = min(slots, key=lambda sl: ((b["slots"].get(sl) or {}).get("worn") or {}).get("score") or 0.0)
        out.append({"id": i, "gear": True, "slot": slot, "full": _item(i, lang, w, slot, (b.get("hitRoom") or {}).get(slot)),
                    "worn": (b["slots"].get(slot) or {}).get("worn")})
    return out
