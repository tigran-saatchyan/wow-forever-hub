"""Everything that can be collected in Forever (mounts, pets, toys), from Blizzard's static data.

The character's own collection comes with the armory tabs; this is the other half, so the page can
say what is still missing and how it is got. Each kind is built once (index + one call per entry,
a few at a time) and kept for a week: Blizzard's static data changes with patches, not by the hour.
"""

import asyncio
import time
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth import CurrentUser
from ..bnet import BnetError, client, name_of
from ..db import Setting, get_session

router = APIRouter(prefix="/api/collections", tags=["collections"])
Session = Annotated[AsyncSession, Depends(get_session)]
KINDS = {"mounts": "mount", "pets": "pet", "toys": "toy"}
TTL = 7 * 24 * 3600
COLL_V = 1
_building: dict[str, asyncio.Task] = {}


def _get(d: Any, *keys: str) -> Any:
    for k in keys:
        d = d.get(k) if isinstance(d, dict) else None
    return d


def entry(kind: str, d: dict, lang: str) -> dict:
    """One mount / pet / toy: what the page needs to show it and to say where it comes from."""
    faction = _get(d, "requirements", "faction", "type") or _get(d, "faction", "type")
    if d.get("is_alliance_only"):
        faction = "ALLIANCE"
    elif d.get("is_horde_only"):
        faction = "HORDE"
    displays = d.get("creature_displays") or []
    item = d.get("item") or {}
    return {
        "id": d.get("id"),
        "name": name_of(d, lang) if kind != "toys" else name_of(item, lang),
        "source": name_of(d.get("source"), lang) or None,
        "description": name_of(d.get("description"), lang) or None,
        "faction": faction,  # ALLIANCE / HORDE, or None for both
        "display": displays[0].get("id") if displays and isinstance(displays[0], dict) else None,
        "icon": d.get("icon"),
        "item": item.get("id"),
        "hidden": bool(d.get("should_exclude_if_uncollected")),  # promotions and the like: not a gap if missing
    }


async def build(kind: str, lang: str) -> list[dict]:
    one = KINDS[kind]
    idx = await client().get(f"/data/wow/{one}/index", "static", lang=lang)
    refs = idx.get(kind) or []
    sem = asyncio.Semaphore(6)

    async def detail(ref: dict) -> dict:
        async with sem:
            try:
                d = await client().get(f"/data/wow/{one}/{ref.get('id')}", "static", lang=lang)
            except BnetError:
                d = {"id": ref.get("id"), "name": ref.get("name")} if kind != "toys" else {"id": ref.get("id")}
            out = entry(kind, d, lang)
            out["name"] = out["name"] or name_of(ref, lang)
            return out

    items = await asyncio.gather(*(detail(r) for r in refs))
    return sorted(items, key=lambda x: x["name"] or "")


@router.get("/{kind}")
async def collection(kind: str, _: CurrentUser, session: Session, lang: str = "ru"):
    if kind not in KINDS:
        raise HTTPException(404, "no such collection")
    lang = "ru" if lang == "ru" else "en"
    key = f"coll:{kind}:{lang}"
    row = await session.get(Setting, key)
    if row and row.value.get("v") == COLL_V and time.time() - row.value.get("t", 0) < TTL:
        return row.value["items"]
    task = _building.get(key)
    if task is None or task.done():
        task = _building[key] = asyncio.get_running_loop().create_task(build(kind, lang))
    try:
        items = await task
    except BnetError as e:
        if row:
            return row.value["items"]  # the last good list beats an error
        raise HTTPException(502, f"Blizzard API: {e}") from e
    await session.merge(Setting(key=key, value={"v": COLL_V, "t": time.time(), "items": items}))
    await session.commit()
    return items
