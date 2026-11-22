"""Dungeon Set 2 (Tier 0.5) for one character (data/t05.json, tools/build_t05.py): the set slot by slot — the
Tier 0 piece handed in, the Tier 0.5 piece given for it (and Forever's Shadow version, when the hub's item
reference knows it), what the character has of both (worn, or marked by hand: bags are not in the API) — and the
chain's materials: what can be bought or gathered ahead (with the auction price, ticked when collected), and the
quest items that drop only while their quest is taken."""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth import CurrentUser
from ..db import Setting, get_session
from . import bis as bis_routes
from .prebis import auction

router = APIRouter(prefix="/api/t05", tags=["t05"])
Session = Annotated[AsyncSession, Depends(get_session)]
DATA = Path(__file__).resolve().parent.parent / "data" / "t05.json"
SLOTS = ["HEAD", "SHOULDER", "CHEST", "WRIST", "HANDS", "WAIST", "LEGS", "FEET"]
SLOT_ID = {"HEAD": 1, "SHOULDER": 3, "CHEST": 5, "WRIST": 9, "HANDS": 10, "WAIST": 6, "LEGS": 7, "FEET": 8}


@lru_cache(maxsize=1)
def data() -> dict:
    return json.loads(DATA.read_text("utf-8")) if DATA.is_file() else {"quests": {}, "chains": {}, "sets": {}}


def keep_ids() -> set[int]:
    """Every Tier 0 piece and every material of the chains: not to be advised for selling."""
    d = data()
    out = {x[k]["id"] for s in d["sets"].values() for x in s.values() for k in ("t0",) if x.get(k)}
    for q in d["quests"].values():
        out.update(n["id"] for n in q["need"] if n.get("bind") == 0)
    return out


def shadow_of(t05_id: int, slot: str, lang: str) -> dict | None:
    """Forever's second version of a Tier 0.5 piece (Shadow damage instead of healing): an item of the same slot
    and set name, of about the same level, in the hub's item reference (ForeverDB's hidden items included)."""
    g = bis_routes.gear()
    base = g.get(str(t05_id))
    if not base:
        return None
    word = (base.get("en") or "").split(" ")[0]
    for k, v in g.items():
        if int(k) == t05_id or not (v.get("en") or "").startswith(word + " ") or v.get("slot") != base.get("slot"):
            continue
        if v.get("set") and base.get("set") and v["set"] != base["set"] or abs((v.get("ilvl") or 0) - (base.get("ilvl") or 0)) > 8:
            continue
        return {"id": int(k), "name": v.get(lang) or v.get("en"), "q": v.get("q")}
    return None


async def _state(session: AsyncSession, cid: int) -> dict:
    row = await session.get(Setting, f"t05:{cid}")
    return dict(row.value or {}) if row else {}


@router.get("/{cid}")
async def t05(cid: int, user: CurrentUser, session: Session, lang: str = "ru"):
    lang = "ru" if lang == "ru" else "en"
    c, s = await bis_routes._char(session, user, cid)
    key = f"{s['classId']}:{(s.get('faction') or 'HORDE').upper()}"
    d = data()
    if key not in d["chains"]:
        return {"available": False}
    gear = bis_routes.gear()
    eq = (((c.profile or {}).get("equipment") or {}).get(lang) or [])
    worn = {x["id"] for x in eq}
    st = await _state(session, cid)
    marked, have = set(st.get("owned") or []), set(st.get("have") or [])

    def piece(x: dict | None) -> dict | None:
        if not x:
            return None
        g = gear.get(str(x["id"])) or {}
        return {"id": x["id"], "name": g.get(lang) or x["name"][lang], "q": g.get("q"), "worn": x["id"] in worn,
                "marked": x["id"] in marked, "owned": x["id"] in worn or x["id"] in marked}

    sets = d["sets"][key]
    slots = []
    for sl in SLOTS:
        x = sets.get(sl)
        if not x:
            continue
        sh = shadow_of(x["t05"]["id"], sl, lang) if x.get("t05") else None
        if sh:
            sh = {**sh, "worn": sh["id"] in worn, "marked": sh["id"] in marked, "owned": sh["id"] in worn or sh["id"] in marked}
        slots.append({"slot": sl, "quest": x["quest"], "t0": piece(x["t0"]), "t05": piece(x.get("t05")), "shadow": sh})

    # the chain's materials: one quest of each step (the variants ask the same kind of things)
    mats: dict[int, dict] = {}
    quest_items: dict[int, dict] = {}
    t0_ids = {x["t0"]["id"] for x in sets.values()}
    for step in d["chains"][key]:
        q = d["quests"][str(step[0])]
        for n in q["need"]:
            if n["id"] in t0_ids:
                continue
            bucket = mats if n.get("bind") == 0 else quest_items if n.get("bind") == 4 else None
            if bucket is None:
                continue  # what the chain itself hands out (distiller, braziers...)
            row = bucket.setdefault(n["id"], {"id": n["id"], "name": n["name"][lang], "count": 0, "quest": q["id"]})
            row["count"] += n["count"]
    ah = await auction(session, user, list(mats))
    for m in mats.values():
        m["have"] = m["id"] in have
        price = ah["items"].get(m["id"])
        m["ah"] = price if price and price["price"] else None
    gold = sum(d["quests"][str(st_[0])]["gold"] for st_ in d["chains"][key])
    return {"available": True, "key": key, "level": s.get("level"), "slots": slots, "market": ah["configured"],
            "materials": sorted(mats.values(), key=lambda m: m["quest"]),
            "questItems": sorted(quest_items.values(), key=lambda m: m["quest"]), "gold": gold}


class MarkIn(BaseModel):
    item_id: int
    on: bool
    kind: str = "owned"  # "owned": a set piece had; "have": a material collected


@router.put("/{cid}/mark")
async def mark(cid: int, body: MarkIn, user: CurrentUser, session: Session):
    await bis_routes._char(session, user, cid)
    st = await _state(session, cid)
    k = "have" if body.kind == "have" else "owned"
    xs = set(st.get(k) or [])
    (xs.add if body.on else xs.discard)(body.item_id)
    st[k] = sorted(xs)
    await session.merge(Setting(key=f"t05:{cid}", value=st))
    await session.commit()
    return st
