"""Items from static-forever, cached in the database (both languages from one request)."""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from .. import wow
from ..auth import CurrentUser
from ..bnet import BnetError, client, name_of
from ..db import Item, get_session

router = APIRouter(prefix="/api/items", tags=["items"])
Session = Annotated[AsyncSession, Depends(get_session)]
LANGS = ("ru", "en")


async def get_item(session: AsyncSession, item_id: int, lang: str) -> dict | None:
    """Cached item, or fetched once from Blizzard (None if Blizzard does not know it)."""
    lang = lang if lang in LANGS else "en"
    row = await session.get(Item, (item_id, lang))
    if row:
        return row.data
    try:
        raw = await client().get(f"/data/wow/item/{item_id}", "static")
    except BnetError as e:
        if e.status == 404:
            return None
        raise
    try:
        media = await client().get(f"/data/wow/media/item/{item_id}", "static")
    except BnetError:
        media = None
    out = None
    for lg in LANGS:
        data = wow.item(raw, media, lg)
        await session.merge(Item(id=item_id, lang=lg, data=data))
        if lg == lang:
            out = data
    await session.commit()
    return out


def _err(e: BnetError) -> HTTPException:
    return HTTPException(503 if e.status in (0, 503) else 502, f"Blizzard API: {e}")


@router.get("/search")
async def search(_: CurrentUser, q: Annotated[str, Query(min_length=2, max_length=60)], lang: str = "ru"):
    """Item search by name via Blizzard's search API, or a plain item id."""
    if q.strip().isdigit():
        return [{"id": int(q), "name": "", "quality": None}]
    loc = "ru_RU" if lang == "ru" else "en_US"
    try:
        r = await client().get(
            f"/data/wow/search/item?name.{loc}={q.strip()}&orderby=id&_pageSize=20", "static"
        )
    except BnetError as e:
        raise _err(e) from e
    out = []
    for x in r.get("results") or []:
        d = x.get("data") or {}
        if "id" in d:
            quality = (d.get("quality") or {}).get("type")
            out.append({"id": d["id"], "name": name_of(d.get("name"), lang), "quality": quality})
    return out


@router.get("/{item_id}")
async def item(item_id: int, _: CurrentUser, session: Session, lang: str = "ru"):
    try:
        data = await get_item(session, item_id, lang)
    except BnetError as e:
        raise _err(e) from e
    if data is None:
        raise HTTPException(404, "no such item")
    return data
