"""Crafting: what pays across all of a user's characters, where to sell, and how to level a profession.

Prices come from the auction house chosen on the Auction page (its latest snapshot of every item), vendor
prices from the client (the recipe reference). The arithmetic lives in app/craft.py.
"""

import json
from datetime import datetime
from email.utils import parsedate_to_datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .. import craft, fdb_sources, item_sources
from ..auth import CurrentUser
from ..config import get_settings
from ..db import AhLatest, Character, Setting, get_session, utcnow
from . import professions as prof_routes
from .market import _setting

router = APIRouter(prefix="/api/craft", tags=["craft"])
craft.VENDOR_PRICE = fdb_sources.vendor_price  # ForeverDB's vendors: who sells a reagent and for how much
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
    # the next poll as the poller scheduled it, and the server's "now", so a browser's wrong clock can't skew it
    every = get_settings().ah_poll_minutes
    left = None
    if state.get("next"):
        left = max(0, round((datetime.fromisoformat(state["next"]) - utcnow()).total_seconds()))
    # the prices' time is when Blizzard built the snapshot (its Last-Modified), else when the hub fetched it
    at = state.get("at")
    if state.get("modified"):
        try:
            at = parsedate_to_datetime(state["modified"]).isoformat()
        except (TypeError, ValueError):
            pass
    return ({i: {"ah": p, "qty": q} for i, p, q in rows},
            {"configured": True, "at": at, "items": len(rows), "ok": state.get("ok"), "every": every,
             "left": left, "checked": state.get("checked") or state.get("at")})


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
    # Tier 0 pieces and the Tier 0.5 chain's materials are kept for the chain, never advised for selling
    from .t05 import keep_ids

    keep = keep_ids()
    advice = [{**item(a["id"]), **a, "de": _de(a["id"], prices)} for a in craft.advice(ds["items"], prices, used)
              if a["id"] not in keep]
    return {"status": "ready", "market": market, "rows": rows, "advice": advice}


def _de(item_id: int, prices: dict) -> int | None:
    """What disenchanting the item fetches (armor and weapons, uncommon to epic), by ForeverDB's table."""
    from .bis import gear

    g = gear().get(str(item_id))
    if not g or g.get("cls") not in (2, 4) or not 2 <= (g.get("q") or 0) <= 4:
        return None
    res = fdb_sources.disenchant(g["q"], g["ilvl"], "weapon" if g["cls"] == 2 else "armor")
    return craft.disenchant_value(res, prices) if res else None


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
        if learn is not None:  # where to learn it, by ForeverDB (vendors of each side, the skill, Merchant's Favor…)
            learn = {**learn, "fdb": fdb_sources.learn(r.get("spell") or 0)}
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


# --- raid consumables: what to craft for the raids, for oneself or to sell (data/raid_consumables.json) ----------

_RAID: list[dict] | None = None


def _raid_items() -> list[dict]:
    global _RAID
    if _RAID is None:
        from pathlib import Path

        p = Path(__file__).resolve().parent.parent / "data" / "raid_consumables.json"
        _RAID = json.loads(p.read_text("utf-8"))["items"] if p.is_file() else []
    return _RAID


def _flat(eff: dict) -> dict[str, float]:
    """A consumable's effects as one level: {"sp": 35, "school.shadow": 40, "absorb.fire": 2600, ...}."""
    out: dict[str, float] = {}
    for k, v in eff.items():
        if isinstance(v, dict):
            out.update({f"{k}.{s}": n for s, n in v.items()})
        else:
            out[k] = v
    return out


def top_ids(items: list[dict]) -> set[int]:
    """What a raid buys: of each kind, every consumable no other one beats. One is beaten when another of its kind
    gives everything it gives, as much or more and for as long or longer, and more of something (+10 Intellect food
    beside +20 Intellect food, the Arcane Elixir beside the Greater). A value the server sets (0 in the client) counts as unknown, equal."""
    flat = {x["item"]: _flat(x["eff"]) for x in items}
    out = set()
    for x in items:
        a = flat[x["item"]]
        beaten = False
        for y in items:
            if y is x or y["kind"] != x["kind"] or (y.get("ms") or 0) < (x.get("ms") or 0):
                continue  # a shorter one does not replace a longer one (an hour's elixir beside half an hour's)
            b = flat[y["item"]]
            if all(k in b and (b[k] >= a[k] or not a[k] or not b[k]) for k in a) and (
                    any(b.get(k, 0) > a[k] for k in a) or len(b) > len(a)):
                beaten = True
                break
        if not beaten:
            out.add(x["item"])
    return out


@router.get("/raid")
async def raid_consumables(user: CurrentUser, session: Session, lang: str = "ru"):
    """Every raid consumable a profession makes: what it gives and who it suits, the recipe's profession and skill,
    which of the user's characters know it or can learn it, what its reagents cost and what it sells for now (and
    how many are up: few or none means nobody supplies it yet), and the profit of one craft."""
    lang = "ru" if lang == "ru" else "en"
    ds = await _reference()
    if not ds:
        prof_routes._start(prof_routes._build())
        return {"status": "building"}
    prices, market = await _prices(session)
    item = _namer(ds, lang)
    by_spell = {r["spell"]: (pid, p, r) for pid, p in ds["professions"].items() for r in p["recipes"]}
    chars = (await session.execute(select(Character).where(Character.user_id == user.id))).scalars().all()
    # the side whose vendors teach the recipes: the characters' (the first one's)
    fac = next((((c.profile or {}).get("summary") or {}).get("en") or {}).get("faction") for c in chars) if chars else None
    side = "alliance" if (fac or "").upper() == "ALLIANCE" else "horde"
    rows = []
    top = top_ids(_raid_items())
    for x in _raid_items():
        if x["item"] not in top:
            continue  # beaten by another of its kind: nobody buys it for a raid
        hit = by_spell.get(x["spell"])
        r = hit[2] if hit else None
        need = craft.need(r)[0] if r else x["yellow"]
        who = []
        for c in chars:
            p = c.profile or {}
            pr = next((y for y in (p.get("professions") or {}).get(lang) or [] if hit and str(y.get("id")) == hit[0]), None)
            if not pr:
                continue
            known = set(pr.get("known") or [])
            state = "known" if r and (r["id"] in known or r["spell"] in known) else "learn" if (pr.get("skill") or 0) >= need else "low"
            who.append({"cid": c.id, "name": ((p.get("summary") or {}).get(lang) or {}).get("name") or c.name,
                        "state": state, "skill": pr.get("skill")})
        e = craft.economics(r, ds["items"], prices) if r else None
        learn = fdb_sources.learn(x["spell"])
        rows.append({
            **{k: x[k] for k in ("kind", "eff", "ms", "roles", "prof", "spell")},
            "item": item(x["item"]) or {"id": x["item"], "name": x["name"][lang]}, "need": need,
            "profName": ((hit[1].get("name") or {}).get(lang) if hit else None) or x["prof"],
            "who": who, "cost": e["cost"] if e else None, "parts": [{**item(y["id"]), "count": y["count"], "unit": y["unit"]} for y in e["parts"]] if e else [],
            "made": e["made"] if e else 1, "sale": e["sale"] if e else None, "profit": e["profit"] if e else None,
            "learn": {"ways": learn["ways"], "skill": learn.get("skill"), "vendors": (learn.get("vendors") or {}).get(side, [])[:3]} if learn else None,
            # the recipe itself: its name, and the item that teaches it when there is one
            "recipe": {"name": (r["name"].get(lang) or r["name"]["en"]) if r else x["name"][lang],
                       "item": item(r.get("recipeItem")) if r and r.get("recipeItem") else None, "source": r.get("source") if r else None},
            # who drops the recipe item (the original game's loot tables): ForeverDB only says "a drop"
            "drops": (item_sources.drops(r["recipeItem"], lang) or {}).get("top", [])[:4] if r and r.get("recipeItem") else [],
        })
    return {"status": "ready", "market": market, "items": rows}
