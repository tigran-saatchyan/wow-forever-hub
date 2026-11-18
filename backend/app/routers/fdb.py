"""ForeverDB for the map page: any quest (who gives it and where, who takes it back, the chain around it) and the
vendors on the map. Everything goes through app/foreverdb.py (the key stays on the server, answers are cached)."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException

from .. import fdb_sources, foreverdb
from ..auth import CurrentUser

router = APIRouter(prefix="/api/fdb", tags=["foreverdb"])


def _zone(z) -> str | None:
    """A zone as ForeverDB gives it: a name, or an object with one."""
    return z.get("name") if isinstance(z, dict) else z


def _place(p: dict | None) -> dict | None:
    if not p:
        return None
    loc = p.get("location") or {}
    return {"type": p.get("type"), "id": p.get("id"), "name": p.get("name"), "map": loc.get("uiMapId"),
            "x": loc.get("x"), "y": loc.get("y"), "zone": loc.get("zone"), "instance": p.get("instance"),
            "source": p.get("source")}


async def _ask(path: str, params: dict | None = None, ttl: float = 30) -> dict:
    c = foreverdb.client()
    if not c.configured:
        raise HTTPException(503, "ForeverDB is not configured")
    try:
        return await c.get(path, params, ttl_days=ttl)
    except foreverdb.FdbError as e:
        raise HTTPException(502 if e.status != 404 else 404, str(e)) from e


@router.get("/quests")
async def quests(_: CurrentUser, q: str, side: str | None = None):
    """Quests whose name contains q (25 at most), with their level and zone."""
    if len(q.strip()) < 3:
        return []
    params = {"q": q.strip(), "limit": 25}
    if side in ("horde", "alliance"):
        params["side"] = side
    d = await _ask("quests", params, ttl=7)
    return [{"id": x["id"], "name": x.get("name"), "level": x.get("level"), "req": x.get("requiredLevel"),
             "zone": _zone(x.get("zone")), "side": x.get("side")} for x in d.get("data") or []]


@router.get("/quests/{qid}")
async def quest(qid: int, _: CurrentUser):
    d = (await _ask(f"quests/{qid}"))["data"]
    ch = d.get("chain") or {}
    return {
        "id": d["id"], "name": d.get("name"), "level": d.get("level"), "req": d.get("requiredLevel"),
        "side": d.get("side"), "zone": _zone(d.get("zone")), "known": d.get("knownInForever"), "url": d.get("url"),
        "starts": _place(d.get("starts")), "ends": _place(d.get("ends")),
        "prev": [{"id": x["questId"], "name": x.get("name"), "rel": x.get("relation")} for x in ch.get("previous") or []],
        "next": [{"id": x["questId"], "name": x.get("name"), "rel": x.get("relation")} for x in ch.get("next") or []],
    }


@router.get("/vendors")
async def vendors_on_map(_: CurrentUser):
    return fdb_sources.vendors()
