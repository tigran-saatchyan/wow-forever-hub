"""Auction house from Blizzard: one chosen house is polled hourly; watched items keep a history.

Forever's auction data sits under rulesets (PvP, Normal, RP, RP-PvP), not realms:
/data/wow/ruleset/{id}/auctions/ lists the houses, /data/wow/ruleset/{id}/auctions/{house} the lots.
"""

import asyncio
import logging
import time
from datetime import datetime, timedelta
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import delete, insert, select
from sqlalchemy.ext.asyncio import AsyncSession

from .. import wow
from ..auth import AdminUser, CurrentUser
from ..bnet import REGIONS, BnetError, client
from ..config import get_settings
from ..db import AhHistory, AhLatest, AhList, AhListItem, AhWatch, SessionLocal, Setting, get_session, utcnow
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


async def fetch_house(ruleset: int, house: int, region: str, data: dict | None = None) -> list[dict]:
    """All lots of a house: items sold one by one (auctions) and stackable goods (commodities: herbs,
    cloth, ore...), which Forever serves from a second address, linked from the first answer."""
    if data is None:
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


# Without a Last-Modified from the server there is no telling a new snapshot from the old one: then the house
# is downloaded whole at most this often (Blizzard rebuilds the snapshot about hourly).
BLIND_MINUTES = 55


async def poll_once(force: bool = False) -> dict:
    """Look at the chosen house; when its snapshot changed (or `force`), replace its latest prices and append
    history for watched items. Asking costs one short request: Blizzard answers 304 while nothing changed."""
    async with SessionLocal() as session:
        cfg = await _setting(session, "market")
        if not cfg or not client().configured:
            return {"skipped": True}
        r, h, region = cfg["ruleset"], cfg["house"], cfg.get("region", "eu")
        old = await _setting(session, "market_state")
        same_house = old.get("house") == [r, h]
        now_ = utcnow()
        state: dict = {"at": now_.isoformat(), "house": [r, h]}
        try:
            since = old.get("modified") if same_house and not force else None
            if same_house and not force and not since and old.get("at"):
                # the server sends no Last-Modified: download whole only now and then
                last = datetime.fromisoformat(old["at"])
                if now_ - last < timedelta(minutes=BLIND_MINUTES):
                    await _put_setting(session, "market_state", {**old, "checked": now_.isoformat()})
                    await session.commit()
                    return {"unchanged": True}
            data, modified = await client().get_if_newer(f"/data/wow/ruleset/{r}/auctions/{h}", "dynamic", region, since)
            if data is None:
                await _put_setting(session, "market_state", {**old, "checked": now_.isoformat()})
                await session.commit()
                return {"unchanged": True, "modified": modified}
            state["modified"] = modified
            lots = await fetch_house(r, h, region, data)
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
            watched = set((await session.execute(select(AhWatch.item_id))).scalars()) | \
                set((await session.execute(select(AhListItem.item_id))).scalars())
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
            # a failed look keeps the prices and the snapshot time of the last good one
            state = {**old, "ok": False, "error": str(e), "checked": now_.isoformat()}
        state["checked"] = now_.isoformat()
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
    return await poll_once(force=True)


async def _item_card(session: AsyncSession, cfg: dict, w: AhWatch | AhListItem, lang: str) -> dict:
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


# --- the user's own lists (any items) -----------------------------------------------------------------------------

DEFAULT_LIST = "Отслеживание"


class ListIn(BaseModel):
    name: str = Field(min_length=1, max_length=60)


async def _own_list(session: AsyncSession, user, lid: int) -> AhList:
    x = await session.get(AhList, lid)
    if not x or x.user_id != user.id:
        raise HTTPException(404, "no such list")
    return x


async def _first_lists(session: AsyncSession, user) -> None:
    """A user without lists gets one, and the items watched before lists existed move into it."""
    if (await session.execute(select(AhList.id).where(AhList.user_id == user.id).limit(1))).first():
        return
    lst = AhList(user_id=user.id, name=DEFAULT_LIST)
    session.add(lst)
    await session.flush()
    for w in (await session.execute(select(AhWatch).where(AhWatch.user_id == user.id))).scalars().all():
        session.add(AhListItem(list_id=lst.id, item_id=w.item_id, below=w.below, created=w.created))
        await session.delete(w)
    await session.commit()


async def _list_card(session: AsyncSession, cfg: dict, x: AhList, lang: str) -> dict:
    items = (await session.execute(select(AhListItem).where(AhListItem.list_id == x.id)
                                   .order_by(AhListItem.created, AhListItem.id))).scalars().all()
    return {"id": x.id, "name": x.name, "items": [await _item_card(session, cfg, w, lang) for w in items]}


async def _pins(session: AsyncSession, user) -> list[int]:
    return list((await _setting(session, f"ah_pins:{user.id}")).get("ids") or [])


@router.get("/lists")
async def lists(user: CurrentUser, session: Session, lang: str = "ru"):
    await _first_lists(session, user)
    cfg = await _setting(session, "market")
    pins = await _pins(session, user)
    xs = (await session.execute(select(AhList).where(AhList.user_id == user.id).order_by(AhList.created, AhList.id))).scalars().all()
    return [{**await _list_card(session, cfg, x, lang), "pinned": x.id in pins} for x in xs]


class PinIn(BaseModel):
    pinned: bool


@router.put("/lists/{lid}/pin")
async def list_pin(lid: int, body: PinIn, user: CurrentUser, session: Session):
    """A pinned list stands at the top of the auction page, above everything else."""
    x = await _own_list(session, user, lid)
    pins = [i for i in await _pins(session, user) if i != x.id] + ([x.id] if body.pinned else [])
    await _put_setting(session, f"ah_pins:{user.id}", {"ids": pins})
    await session.commit()
    return {"id": x.id, "pinned": body.pinned}


@router.post("/lists")
async def list_add(body: ListIn, user: CurrentUser, session: Session):
    x = AhList(user_id=user.id, name=body.name.strip())
    session.add(x)
    await session.commit()
    return {"id": x.id, "name": x.name, "items": []}


@router.patch("/lists/{lid}")
async def list_rename(lid: int, body: ListIn, user: CurrentUser, session: Session):
    x = await _own_list(session, user, lid)
    x.name = body.name.strip()
    await session.commit()
    return {"id": x.id, "name": x.name}


@router.delete("/lists/{lid}", status_code=204)
async def list_delete(lid: int, user: CurrentUser, session: Session):
    x = await _own_list(session, user, lid)
    await session.execute(delete(AhListItem).where(AhListItem.list_id == x.id))
    await session.delete(x)
    await session.commit()


async def _seed_history(session: AsyncSession, cfg: dict, item_id: int) -> None:
    """Start an item's history with the latest snapshot, so its chart does not wait for the next one."""
    if not cfg:
        return
    r, h = cfg["ruleset"], cfg["house"]
    latest = await session.get(AhLatest, (r, h, item_id))
    seen = (await session.execute(select(AhHistory.id).where(
        AhHistory.item_id == item_id, AhHistory.ruleset == r, AhHistory.house == h).limit(1))).first()
    if latest and not seen:
        session.add(AhHistory(ruleset=r, house=h, item_id=item_id, min_price=latest.min_price,
                              median_price=latest.median_price, quantity=latest.quantity, ts=latest.ts))


@router.post("/lists/{lid}/items")
async def list_item_add(lid: int, body: WatchIn, user: CurrentUser, session: Session, lang: str = "ru"):
    x = await _own_list(session, user, lid)
    q = select(AhListItem).where(AhListItem.list_id == x.id, AhListItem.item_id == body.item_id)
    w = (await session.execute(q)).scalar_one_or_none()
    if w is None:
        w = AhListItem(list_id=x.id, item_id=body.item_id)
        session.add(w)
    w.below = body.below
    cfg = await _setting(session, "market")
    await _seed_history(session, cfg, body.item_id)
    await session.commit()
    return await _item_card(session, cfg, w, lang)


@router.delete("/lists/{lid}/items/{iid}", status_code=204)
async def list_item_delete(lid: int, iid: int, user: CurrentUser, session: Session):
    x = await _own_list(session, user, lid)
    w = await session.get(AhListItem, iid)
    if not w or w.list_id != x.id:
        raise HTTPException(404, "not in the list")
    await session.delete(w)
    await session.commit()


# --- BiS on the auction house -------------------------------------------------------------------------------------

@router.get("/bis/{cid}")
async def bis_on_sale(cid: int, user: CurrentUser, session: Session, spec: str | None = None, lang: str = "ru"):
    """A character's BiS list for its level (and the chosen specialization) reduced to what is on sale now in the
    chosen house: each item with its place in its slot's list (1, 2, 3, as on the throne room) and its price.
    Items bound on pickup never reach the auction house, so the list holds the rest only."""
    from . import bis as bis_routes

    lang = "ru" if lang == "ru" else "en"
    c, s = await bis_routes._char(session, user, cid)
    out = await bis_routes.build(session, c, s, spec, lang, save=False)
    if out.get("status") != "ready":
        return {"status": out.get("status")}
    cfg = await _setting(session, "market")
    rows, ids = [], 0
    for slot, x in out["slots"].items():
        for rank, o in enumerate(x["options"]):
            if o.get("wornOnly"):
                continue
            ids += 1
            latest = await session.get(AhLatest, (cfg["ruleset"], cfg["house"], o["id"])) if cfg else None
            if not latest:
                continue
            rows.append({"slot": slot, "rank": rank + 1, "id": o["id"], "name": o["name"], "q": o["q"],
                         "ilvl": o["ilvl"], "req": o["req"], "worn": o["id"] == x.get("wornId"),
                         "better": x.get("wornRank") is None or rank < x["wornRank"],
                         "full": o, "wornItem": x.get("worn"),  # both sides of the throne room's comparison
                         "latest": {"min": latest.min_price, "median": latest.median_price,
                                    "quantity": latest.quantity, "ts": latest.ts}})
    return {"status": "ready", "level": out["level"], "spec": out["spec"], "specs": out["specs"],
            "customSet": out["customSet"], "class": out["class"], "rows": rows, "checked": ids,
            "configured": bool(cfg)}
