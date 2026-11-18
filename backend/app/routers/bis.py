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

from .. import bis
from ..auth import CurrentUser
from ..db import Character, Setting, get_session

router = APIRouter(prefix="/api/bis", tags=["bis"])
Session = Annotated[AsyncSession, Depends(get_session)]
GEAR = Path(__file__).resolve().parent.parent / "data" / "gear.json"


@lru_cache(maxsize=1)
def gear() -> dict[str, dict]:
    if not GEAR.is_file():
        return {}
    return json.loads(GEAR.read_text("utf-8"))["items"]


def _item(i: int, lang: str, w: dict, slot: str) -> dict | None:
    it = gear().get(str(i))
    if not it:
        return None
    return {"id": i, "name": it.get(lang) or it["en"], "q": it["q"], "ilvl": it["ilvl"], "req": it["req"],
            "stats": it.get("stats") or {}, "armor": it.get("armor"), "dps": it.get("dps"), "speed": it.get("speed"),
            "spells": it.get("spells") or [], "two": it["slot"] == 17, "score": bis.score(it, w, slot)}


async def _char(session: AsyncSession, user, cid: int) -> tuple[Character, dict]:
    c = await session.get(Character, cid)
    if not c or c.user_id != user.id:
        raise HTTPException(404, "no such character")
    s = ((c.profile or {}).get("summary") or {}).get("en") or {}
    if not s.get("classId") or s["classId"] not in bis.CLASSES:
        raise HTTPException(422, "the character's class is not known yet")
    return c, s


async def _state(session: AsyncSession, cid: int) -> dict:
    row = await session.get(Setting, f"bis:{cid}")
    return dict(row.value) if row else {}


@router.get("/{cid}")
async def get_bis(cid: int, user: CurrentUser, session: Session, spec: str | None = None, lang: str = "ru"):
    lang = "ru" if lang == "ru" else "en"
    c, s = await _char(session, user, cid)
    cls, level, faction = s["classId"], s.get("level") or 1, s.get("faction")
    specs = bis.CLASSES[cls]["specs"]
    st = await _state(session, cid)
    if st.get("level") != level:  # a new level: new best gear, the picks start over
        st = {"level": level, "spec": st.get("spec"), "picks": {}, "cheer": st.get("cheer")}
    spec = spec if spec in specs else (st.get("spec") if st.get("spec") in specs else None)
    if not gear():
        return {"status": "nodata"}
    out = bis.choose(gear(), cls, spec or specs[0], level, faction)
    w = out["weights"]
    picks = (st.get("picks") or {}).get(spec or specs[0]) or {}
    worn = {x["slot"]: x["id"] for x in (((c.profile or {}).get("equipment") or {}).get(lang) or [])}
    slots, have, total = {}, 0, 0
    two_hand = out["twoHand"]
    for slot, cands in out["slots"].items():
        options = [x for x in (_item(cd["id"], lang, w, slot) for cd in cands) if x]
        pick = min(int(picks.get(slot, 0)), max(0, len(options) - 1))
        if slot == "MAIN_HAND" and options:
            two_hand = options[pick]["two"]
        wid = worn.get(slot)
        mine = _item(wid, lang, w, slot) if wid else None
        slots[slot] = {"options": options, "pick": pick, "worn": mine, "wornId": wid}
    for slot, x in slots.items():
        if slot == "OFF_HAND" and two_hand:
            x["options"], x["pick"] = [], 0
        if not x["options"]:
            x["ok"] = True
            continue
        total += 1
        best = x["options"][x["pick"]]
        # as good as the pick: the same item, or one that scores at least as much
        x["ok"] = bool(x["wornId"] == best["id"] or (x["worn"] and x["worn"]["score"] >= best["score"]))
        have += x["ok"]
    complete = total > 0 and have == total
    cheer = False
    if complete and st.get("cheer") != date.today().isoformat():
        cheer, st["cheer"] = True, date.today().isoformat()
    await session.merge(Setting(key=f"bis:{cid}", value=st))
    await session.commit()
    return {"status": "ready", "class": bis.CLASSES[cls]["key"], "specs": specs, "spec": spec or specs[0], "specSaved": bool(st.get("spec")), "level": level,
            "twoHand": two_hand, "slots": slots, "have": have, "total": total, "complete": complete, "cheer": cheer,
            "weights": w, "maxIlvl": bis.MAX_ILVL}


class Pick(BaseModel):
    spec: str
    slot: str = Field(max_length=20)
    pick: int = Field(ge=0, le=2)


class SpecIn(BaseModel):
    spec: str


@router.put("/{cid}/pick")
async def set_pick(cid: int, body: Pick, user: CurrentUser, session: Session):
    _, s = await _char(session, user, cid)
    if body.spec not in bis.CLASSES[s["classId"]]["specs"] or body.slot not in bis.SLOTS:
        raise HTTPException(422, "unknown specialization or slot")
    st = await _state(session, cid)
    level = s.get("level") or 1
    if st.get("level") != level:
        st = {"level": level, "spec": st.get("spec"), "picks": {}, "cheer": st.get("cheer")}
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
    if body.spec not in bis.CLASSES[s["classId"]]["specs"]:
        raise HTTPException(422, "unknown specialization")
    st = await _state(session, cid)
    st["spec"] = body.spec
    await session.merge(Setting(key=f"bis:{cid}", value=st))
    await session.commit()
    return {"ok": True}
