"""Auction house from Blizzard: one chosen house is polled hourly; watched items keep a history.

Forever's auction data sits under rulesets (PvP, Normal, RP, RP-PvP), not realms:
/data/wow/ruleset/{id}/auctions/ lists the houses, /data/wow/ruleset/{id}/auctions/{house} the lots.
"""

import asyncio
import logging
import time
from datetime import timedelta
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import delete, insert, select
from sqlalchemy.ext.asyncio import AsyncSession

from .. import wow
from ..auth import AdminUser, CurrentUser
from ..bnet import REGIONS, BnetError, client
from ..config import get_settings
from ..db import AhHistory, AhLatest, AhWatch, SessionLocal, Setting, get_session, utcnow
from .items import get_item

router = APIRouter(prefix="/api/market", tags=["market"])
Session = Annotated[AsyncSession, Depends(get_session)]
log = logging.getLogger("uvicorn.error")
HISTORY_DAYS = 30


async def _setting(session: AsyncSession, key: str) -> dict:
    row = await session.get(Setting, key)
    return dict(row.value) if row else {}


async def _put_setting(session: AsyncSession, key: str, value: dict) -> None:
    await session.merge(Setting(key=key, value=value))


class MarketIn(BaseModel):
    region: str = "eu"
    ruleset: int
    house: int


class WatchIn(BaseModel):
    item_id: int = Field(gt=0)
    below: int | None = Field(default=None, ge=0)  # copper


@router.get("/config")
async def config(_: CurrentUser, session: Session, lang: str = "ru"):
    """The chosen house, the rulesets and houses to choose from, and how the last poll went."""
    cfg = await _setting(session, "market")
    state = await _setting(session, "market_state")
    out = {"configured": client().configured, "selected": cfg or None, "state": state, "rulesets": [], "houses": []}
    if not client().configured:
        return out
    region = cfg.get("region") or get_settings().bnet_region
    try:
        out["rulesets"] = wow.rulesets(await client().get("/data/wow/ruleset/index", "dynamic", region, lang), lang)
        rid = cfg.get("ruleset") or (out["rulesets"][0]["id"] if out["rulesets"] else None)
        if rid is not None:
            idx = await client().get(f"/data/wow/ruleset/{rid}/auctions/", "dynamic", region, lang)
            out["houses"] = wow.houses(idx, lang)
    except BnetError as e:
        out["error"] = str(e)
    return out


@router.get("/houses")
async def houses(_: CurrentUser, ruleset: int, region: str = "eu", lang: str = "ru"):
    try:
        return wow.houses(await client().get(f"/data/wow/ruleset/{ruleset}/auctions/", "dynamic", region, lang), lang)
    except BnetError as e:
        raise HTTPException(502, f"Blizzard API: {e}") from e


@router.put("/config")
async def set_config(body: MarketIn, _: AdminUser, session: Session):
    if body.region not in REGIONS:
        raise HTTPException(422, "region must be eu or us")
    await _put_setting(session, "market", body.model_dump())
    await session.commit()
    return body


async def fetch_house(ruleset: int, house: int, region: str) -> list[dict]:
    """All lots of a house: items sold one by one (auctions) and stackable goods (commodities: herbs,
    cloth, ore...), which Forever serves from a second address, linked from the first answer."""
    data = await client().get(f"/data/wow/ruleset/{ruleset}/auctions/{house}", "dynamic", region)
    lots = list(data.get("auctions") or [])
    com = data.get("commodities")
    if com:
        try:
            more = await client().get(f"/data/wow/ruleset/{ruleset}/auctions/{house}/commodities", "dynamic", region)
            lots += more.get("auctions") or []
        except BnetError as e:
            log.warning("commodities %s/%s: %s", ruleset, house, e)
    return lots


async def poll_once() -> dict:
    """Fetch the chosen house once: replace its latest prices, append history for watched items."""
    async with SessionLocal() as session:
        cfg = await _setting(session, "market")
        if not cfg or not client().configured:
            return {"skipped": True}
        r, h, region = cfg["ruleset"], cfg["house"], cfg.get("region", "eu")
        state: dict = {"at": utcnow().isoformat()}
        try:
            lots = await fetch_house(r, h, region)
            summary = wow.summarize_auctions(lots)
            now = utcnow()
            await session.execute(delete(AhLatest).where(AhLatest.ruleset == r, AhLatest.house == h))
            rows = [
                {"ruleset": r, "house": h, "item_id": iid, "min_price": v["min"], "median_price": v["median"],
                 "quantity": v["quantity"], "auctions": v["auctions"], "ts": now}
                for iid, v in summary.items()
            ]
            for i in range(0, len(rows), 2000):
                await session.execute(insert(AhLatest), rows[i:i + 2000])
            watched = set((await session.execute(select(AhWatch.item_id))).scalars())
            hist = [
                {"ruleset": r, "house": h, "item_id": iid, "min_price": summary[iid]["min"],
                 "median_price": summary[iid]["median"], "quantity": summary[iid]["quantity"], "ts": now}
                for iid in watched if iid in summary
            ]
            if hist:
                await session.execute(insert(AhHistory), hist)
            await session.execute(delete(AhHistory).where(AhHistory.ts < now - timedelta(days=HISTORY_DAYS)))
            state |= {"ok": True, "items": len(rows), "auctions": len(lots)}
        except BnetError as e:
            state |= {"ok": False, "error": str(e)}
        await _put_setting(session, "market_state", state)
        await session.commit()
        return state


async def poller() -> None:
    minutes = get_settings().ah_poll_minutes
    while True:
        try:
            await poll_once()
        except Exception:  # noqa: BLE001 - the loop must survive anything
            log.exception("auction poll failed")
        try:  # when the next poll comes, for the pages' countdown (the server's clock, not the browser's)
            async with SessionLocal() as session:
                state = await _setting(session, "market_state")
                if state:
                    await _put_setting(session, "market_state", {**state, "next": (utcnow() + timedelta(minutes=minutes)).isoformat()})
                    await session.commit()
        except Exception:  # noqa: BLE001
            log.exception("auction poll: saving the next time failed")
        await asyncio.sleep(minutes * 60)


_compare_cache: dict[tuple[str, int], tuple[float, list[dict]]] = {}


@router.get("/compare")
async def compare(_: AdminUser, ruleset: int, region: str = "eu", item: int = 2589, lang: str = "ru"):
    """Every house of a ruleset side by side: lots, items, and one item's price, to tell which is yours.

    Blizzard names Forever's houses only "Alliance / Horde / Blackwater" (several of each) and says
    nothing else about them, so the only way to recognise your own is by what is on sale there.
    """
    bn = client()
    key = (region, ruleset)
    hit = _compare_cache.get(key)
    if hit and hit[0] > time.time():
        houses_ = hit[1]
    else:
        try:
            idx = await bn.get(f"/data/wow/ruleset/{ruleset}/auctions/", "dynamic", region, lang)
        except BnetError as e:
            raise HTTPException(502, f"Blizzard API: {e}") from e
        sem = asyncio.Semaphore(4)

        async def one(h: dict) -> dict:
            async with sem:
                try:
                    lots = await fetch_house(ruleset, h["id"], region)
                except BnetError as e:
                    return {**h, "error": str(e), "summary": {}}
            return {**h, "lots": len(lots), "summary": wow.summarize_auctions(lots)}

        houses_ = await asyncio.gather(*(one(h) for h in wow.houses(idx, lang)))
        _compare_cache[key] = (time.time() + 1800, houses_)
    out = []
    for h in houses_:
        x = h["summary"].get(item) or {}
        out.append({"id": h["id"], "name": h["name"], "lots": h.get("lots", 0), "items": len(h["summary"]),
                    "error": h.get("error"), "itemMin": x.get("min"), "itemQty": x.get("quantity")})
    return out


@router.post("/refresh")
async def refresh(_: AdminUser):
    return await poll_once()


async def _item_card(session: AsyncSession, cfg: dict, w: AhWatch, lang: str) -> dict:
    r, h = cfg.get("ruleset"), cfg.get("house")
    latest = await session.get(AhLatest, (r, h, w.item_id)) if r is not None else None
    hist = (await session.execute(
        select(AhHistory).where(AhHistory.item_id == w.item_id, AhHistory.ruleset == r, AhHistory.house == h)
        .order_by(AhHistory.ts)
    )).scalars().all()
    try:
        info = await get_item(session, w.item_id, lang)
    except BnetError:
        info = None
    return {
        "id": w.id,
        "itemId": w.item_id,
        "below": w.below,
        "item": info,
        "latest": {"min": latest.min_price, "median": latest.median_price, "quantity": latest.quantity,
                   "auctions": latest.auctions, "ts": latest.ts} if latest else None,
        "history": [{"t": x.ts, "min": x.min_price, "median": x.median_price, "q": x.quantity} for x in hist],
        "alert": bool(latest and w.below is not None and latest.min_price <= w.below),
    }


@router.get("/watch")
async def watch_list(user: CurrentUser, session: Session, lang: str = "ru"):
    cfg = await _setting(session, "market")
    ws = (await session.execute(select(AhWatch).where(AhWatch.user_id == user.id).order_by(AhWatch.created))).scalars()
    return [await _item_card(session, cfg, w, lang) for w in ws.all()]


@router.post("/watch")
async def watch_add(body: WatchIn, user: CurrentUser, session: Session, lang: str = "ru"):
    q = select(AhWatch).where(AhWatch.user_id == user.id, AhWatch.item_id == body.item_id)
    w = (await session.execute(q)).scalar_one_or_none()
    if w is None:
        w = AhWatch(user_id=user.id, item_id=body.item_id)
        session.add(w)
    w.below = body.below
    # start the history with the latest snapshot, so the chart does not wait an hour for its first point
    cfg = await _setting(session, "market")
    if cfg:
        r, h = cfg["ruleset"], cfg["house"]
        latest = await session.get(AhLatest, (r, h, body.item_id))
        seen = (await session.execute(select(AhHistory.id).where(
            AhHistory.item_id == body.item_id, AhHistory.ruleset == r, AhHistory.house == h).limit(1))).first()
        if latest and not seen:
            session.add(AhHistory(ruleset=r, house=h, item_id=body.item_id, min_price=latest.min_price,
                                  median_price=latest.median_price, quantity=latest.quantity, ts=latest.ts))
    await session.commit()
    return await _item_card(session, cfg, w, lang)


@router.delete("/watch/{wid}", status_code=204)
async def watch_delete(wid: int, user: CurrentUser, session: Session):
    w = await session.get(AhWatch, wid)
    if not w or w.user_id != user.id:
        raise HTTPException(404, "not watched")
    await session.delete(w)
    await session.commit()


@router.get("/price/{item_id}")
async def price(item_id: int, _: CurrentUser, session: Session):
    """Latest price of any item in the chosen house (not only watched ones)."""
    cfg = await _setting(session, "market")
    if not cfg:
        return None
    x = await session.get(AhLatest, (cfg["ruleset"], cfg["house"], item_id))
    return {"min": x.min_price, "median": x.median_price, "quantity": x.quantity, "ts": x.ts} if x else None
