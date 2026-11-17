"""Crafting: what pays across all of a user's characters, where to sell, and how to level a profession.

Prices come from the auction house chosen on the Auction page (its latest snapshot of every item), vendor
prices from the client (the recipe reference). The arithmetic lives in app/craft.py.
"""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .. import craft
from ..auth import CurrentUser
from ..config import get_settings
from ..db import AhLatest, Character, Setting, get_session
from . import professions as prof_routes
from .market import _setting

router = APIRouter(prefix="/api/craft", tags=["craft"])
Session = Annotated[AsyncSession, Depends(get_session)]


async def _prices(session: AsyncSession) -> tuple[dict, dict]:
    """The chosen house's latest prices: item id -> {ah, qty}; and what the page should say about them."""
    cfg = await _setting(session, "market")
    state = await _setting(session, "market_state")
    if not cfg:
        return {}, {"configured": False}
    rows = (await session.execute(
        select(AhLatest.item_id, AhLatest.min_price, AhLatest.quantity)
        .where(AhLatest.ruleset == cfg["ruleset"], AhLatest.house == cfg["house"])
    )).all()
    every = get_settings().ah_poll_minutes  # the poller fetches the house this often (app/routers/market.py)
    return ({i: {"ah": p, "qty": q} for i, p, q in rows},
            {"configured": True, "at": state.get("at"), "items": len(rows), "ok": state.get("ok"), "every": every})


async def _reference() -> dict | None:
    return await prof_routes._load(prof_routes._build())


def _namer(ds: dict, lang: str):
    items = ds["items"]

    def item(i: int | None) -> dict | None:
        if not i:
            return None
        x = items.get(str(i)) or {}
        return {"id": i, "name": x.get(lang) or x.get("en") or f"#{i}", "q": x.get("q")}

    return item


@router.get("")
async def overview(user: CurrentUser, session: Session, lang: str = "ru"):
    """Every recipe each character knows (or can learn at their skill): cost, worth, profit, where to sell;
    and for every material and product of those professions, auction house or vendor."""
    lang = "ru" if lang == "ru" else "en"
    ds = await _reference()
    if not ds:
        prof_routes._start(prof_routes._build())
        return {"status": "building"}
    prices, market = await _prices(session)
    rows, used = await _rows(session, user, ds, prices, lang)
    item = _namer(ds, lang)
    advice = [{**item(a["id"]), **a} for a in craft.advice(ds["items"], prices, used)]
    return {"status": "ready", "market": market, "rows": rows, "advice": advice}


async def _rows(session: AsyncSession, user, ds: dict, prices: dict, lang: str) -> tuple[list[dict], set[int]]:
    item = _namer(ds, lang)
    chars = (await session.execute(select(Character).where(Character.user_id == user.id))).scalars().all()
    rows, used = [], set()
    for c in chars:
        p = c.profile or {}
        cname = ((p.get("summary") or {}).get(lang) or {}).get("name") or c.name
        for pr in (p.get("professions") or {}).get(lang) or []:
            ref = ds["professions"].get(str(pr.get("id")))
            if not ref:
                continue
            known, skill = set(pr.get("known") or []), pr.get("skill")
            for r in ref["recipes"]:
                is_known = r["id"] in known or r["spell"] in known
                if not is_known and (skill is None or craft.need(r)[0] > skill):
                    continue
                if not r.get("item"):
                    continue  # enchantments and the like make nothing to sell
                e = craft.economics(r, ds["items"], prices)
                used.update(x for x, _ in r["reagents"])
                used.add(r["item"])
                rows.append({
                    "cid": c.id, "char": cname, "prof": pr.get("id"), "profName": pr.get("name"), "skill": skill,
                    "recipe": r["id"], "name": r["name"][lang] or r["name"]["en"], "item": item(r["item"]),
                    "made": e["made"], "known": is_known, "color": _color(r, skill),
                    "cost": e["cost"], "value": e["value"], "profit": e["profit"], "margin": e["margin"],
                    "sale": e["sale"],
                    "parts": [{**item(x["id"]), "count": x["count"], "unit": x["unit"], "src": x["src"]} for x in e["parts"]],
                })
    return rows, used


def _color(r: dict, skill: int | None) -> str | None:
    """The recipe's colour at the character's skill: orange, yellow, green or gray."""
    if skill is None:
        return None
    y, g = r.get("yellow"), r.get("gray")
    if not y or skill < y:
        return "orange"
    if g and skill >= g:
        return "gray"
    return "yellow" if not g or skill < (y + g) // 2 else "green"


@router.get("/plan")
async def leveling_plan(user: CurrentUser, session: Session, cid: int, prof: int,
                        target: Annotated[int, Query(ge=1, le=450)], resale: bool = True, lang: str = "ru"):
    """The cheapest way to raise one character's profession to `target`, with the shopping list."""
    lang = "ru" if lang == "ru" else "en"
    c = await session.get(Character, cid)
    if not c or c.user_id != user.id:
        raise HTTPException(404, "no such character")
    ds = await _reference()
    if not ds:
        prof_routes._start(prof_routes._build())
        return {"status": "building"}
    ref = ds["professions"].get(str(prof))
    pr = next((x for x in ((c.profile or {}).get("professions") or {}).get(lang) or [] if x.get("id") == prof), None)
    if not ref or not pr:
        raise HTTPException(404, "the character has no such profession")
    prices, market = await _prices(session)
    skill = pr.get("skill") or 1
    known = set(pr.get("known") or [])
    known |= {r["id"] for r in ref["recipes"] if r["spell"] in known}
    out = craft.plan(ref["recipes"], known, skill, max(skill, target), ds["items"], prices, resale=resale)
    item = _namer(ds, lang)
    by_id = {r["id"]: r for r in ref["recipes"]}
    steps = []
    for st in out["steps"]:
        r = by_id[st["id"]]
        learn = st["learn"]
        if learn and learn.get("item"):
            learn = {**learn, "item": item(learn["item"])}
        steps.append({**st, "name": r["name"][lang] or r["name"]["en"], "item": item(r.get("item")),
                      "made": r.get("count") or 1, "learn": learn})
    return {"status": "ready", "market": market, "skill": skill, "target": target, "steps": steps,
            "reagents": [{**item(x["id"]), **x} for x in out["reagents"]], "total": out["total"], "gaps": out["gaps"]}


DEFAULTS = {"minCraft": 2000, "minFlip": 100}  # 20 silver a craft, 1 silver an item


async def _cfg(session: AsyncSession, uid: int) -> dict:
    row = await session.get(Setting, f"craft_cfg:{uid}")
    return {**DEFAULTS, **(row.value if row else {})}


@router.get("/signals")
async def signals(user: CurrentUser, session: Session, lang: str = "ru"):
    """What pays right now, from the latest auction prices: crafts a character knows that, with every reagent
    bought, sell (auction house or vendor) for at least minCraft more; and items a vendor buys for at least
    minFlip more than their cheapest buyout."""
    lang = "ru" if lang == "ru" else "en"
    ds = await _reference()
    if not ds:
        prof_routes._start(prof_routes._build())
        return {"status": "building"}
    cfg = await _cfg(session, user.id)
    prices, market = await _prices(session)
    if not prices:
        return {"status": "ready", "market": market, "cfg": cfg, "crafts": [], "flips": []}
    rows, _ = await _rows(session, user, ds, prices, lang)
    crafts = sorted((r for r in rows if r["known"] and r["profit"] is not None and r["profit"] >= cfg["minCraft"]),
                    key=lambda r: -r["profit"])
    item = _namer(ds, lang)
    flips = [{**item(f["id"]), **f} for f in craft.flips(ds.get("sell") or {}, prices, cfg["minFlip"])[:100]]
    return {"status": "ready", "market": market, "cfg": cfg, "crafts": crafts[:100], "flips": flips}


class SignalCfg(BaseModel):
    minCraft: int = Field(ge=0, le=100_000_000)
    minFlip: int = Field(ge=0, le=100_000_000)


@router.put("/signals/settings")
async def set_signal_cfg(body: SignalCfg, user: CurrentUser, session: Session):
    await session.merge(Setting(key=f"craft_cfg:{user.id}", value=body.model_dump()))
    await session.commit()
    return body.model_dump()
