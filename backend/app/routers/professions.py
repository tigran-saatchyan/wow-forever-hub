"""Profession recipes reference (built from the client files on the server, see app/recipes.py)."""

import asyncio
import logging
import time
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from .. import recipes
from ..auth import AdminUser, CurrentUser
from ..bnet import BnetError, client, current_version, name_of
from ..config import get_settings
from ..db import SessionLocal, Setting, get_session, utcnow

router = APIRouter(prefix="/api/professions", tags=["professions"])
Session = Annotated[AsyncSession, Depends(get_session)]
log = logging.getLogger("uvicorn.error")

_data: dict[str, dict] = {}  # build -> dataset, once loaded from the database
_state: dict[str, dict] = {}  # build -> {"status": building|error, "error": …}
_lock = asyncio.Lock()


def _build() -> str:
    v = current_version(get_settings())  # 1.60.1_70755
    if not v:
        raise HTTPException(503, "no client build known")
    return v.replace("_", ".")


async def _load(build: str) -> dict | None:
    if build in _data:
        return _data[build]
    async with SessionLocal() as s:
        row = await s.get(Setting, f"recipes:{build}")
    if row and row.value.get("professions") and row.value.get("v") == recipes.VERSION:
        _data[build] = row.value
        return row.value
    return None


async def _make(build: str) -> None:
    async with _lock:
        if await _load(build):
            return
        _state[build] = {"status": "building", "since": utcnow().isoformat()}
        try:
            ds = recipes.build_dataset(await recipes.fetch_tables(build), build)
            async with SessionLocal() as s:
                await s.merge(Setting(key=f"recipes:{build}", value=ds))
                await s.commit()
            _data[build] = ds
            _state.pop(build, None)
            log.info("recipes %s: %d professions", build, len(ds["professions"]))
        except Exception as e:  # noqa: BLE001 - reported to the page, retried on the next request
            log.exception("recipes %s failed", build)
            _state[build] = {"status": "error", "error": str(e)[:300]}


def _start(build: str) -> None:
    if _state.get(build, {}).get("status") != "building":
        _state[build] = {"status": "building", "since": utcnow().isoformat()}
        asyncio.get_running_loop().create_task(_make(build))


@router.get("")
async def index(_: CurrentUser):
    """Professions with recipe counts; the first call starts building the reference (a minute or so)."""
    build = _build()
    ds = await _load(build)
    if ds:
        return {"status": "ready", "build": build, "professions": recipes.summary(ds)}
    st = _state.get(build)
    if st and st["status"] == "error":
        return {"status": "error", "build": build, "error": st["error"]}  # the page offers "try again"
    if not st:
        _start(build)
    return {"status": "building", "build": build}


CAT_TTL = 7 * 24 * 3600


@router.get("/{line}/categories")
async def categories(line: int, _: CurrentUser, session: Session, lang: str = "ru"):
    """Blizzard's own sections of a profession ("Elixirs", "Potions", "Transmutes", …): which recipe sits where.

    Recipe ids are the same ones the character profile's known_recipes uses, so they match the reference.
    """
    lang = "ru" if lang == "ru" else "en"
    key = f"pcat:{line}:{lang}"
    row = await session.get(Setting, key)
    if row and time.time() - row.value.get("t", 0) < CAT_TTL:
        return row.value["data"]
    try:
        prof = await client().get(f"/data/wow/profession/{line}", "static", lang=lang)
        order: list[str] = []
        of: dict[str, int] = {}
        for tier in prof.get("skill_tiers") or []:
            st = await client().get(f"/data/wow/profession/{line}/skill-tier/{tier.get('id')}", "static", lang=lang)
            for c in st.get("categories") or []:
                name = name_of(c, lang)
                if name not in order:
                    order.append(name)
                for r in c.get("recipes") or []:
                    of.setdefault(str(r.get("id")), order.index(name))
    except BnetError as e:
        if row:
            return row.value["data"]
        if e.status == 404:
            return {"order": [], "of": {}}  # gathering skills have no sections
        raise HTTPException(502, f"Blizzard API: {e}") from e
    data = {"order": order, "of": of}
    await session.merge(Setting(key=key, value={"t": time.time(), "data": data}))
    await session.commit()
    return data


@router.get("/{line}")
async def profession(line: int, _: CurrentUser, lang: str = "ru"):
    build = _build()
    ds = await _load(build)
    if not ds:
        _start(build)
        return {"status": "building", "build": build}
    p = ds["professions"].get(str(line))
    if not p:
        raise HTTPException(404, "no such profession")
    lg = "ru" if lang == "ru" else "en"
    items = ds["items"]

    def item(i: int | None) -> dict | None:
        if not i:
            return None
        x = items.get(str(i)) or {}
        return {"id": i, "name": x.get(lg) or x.get("en") or f"#{i}", "q": x.get("q")}

    return {
        "status": "ready", "build": build, "id": line, "name": p["name"][lg],
        "recipes": [
            {**{k: r[k] for k in ("id", "spell", "skill", "yellow", "gray", "source", "count")},
             "green": (r["yellow"] + r["gray"]) // 2 if r["yellow"] and r["gray"] else None,
             "name": r["name"][lg] or r["name"]["en"], "nameEn": r["name"]["en"],
             "item": item(r["item"]), "recipeItem": item(r["recipeItem"]),
             "reagents": [{**item(i), "count": n} for i, n in r["reagents"]]}
            for r in p["recipes"]
        ],
    }


@router.post("/rebuild")
async def rebuild(_: AdminUser, session: Session):
    """Build the reference again (after a new client build, or if the first build looked wrong)."""
    build = _build()
    _data.pop(build, None)
    row = await session.get(Setting, f"recipes:{build}")
    if row:
        await session.delete(row)
        await session.commit()
    _state.pop(build, None)
    _start(build)
    return {"status": "building", "build": build}
