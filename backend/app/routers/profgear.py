"""A profession's gear for one character (data/prof_gear.json, from the Forever client): for fishing the poles,
lures, clothes and extras with the fishing each adds, the skill and level each needs, whether the character has it
(worn, by Blizzard's equipment; or marked by hand, since bags are not in the API), and its auction price.

A lure's bonus is in the client; a pole's or a hat's "Equip: Fishing +N" only in the item's description, which
Blizzard gives (cached with the item)."""

from __future__ import annotations

import json
import re
from functools import lru_cache
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth import CurrentUser
from ..db import Setting, get_session
from . import bis as bis_routes
from .items import get_item
from .prebis import auction

router = APIRouter(prefix="/api/profgear", tags=["profgear"])
Session = Annotated[AsyncSession, Depends(get_session)]
DATA = Path(__file__).resolve().parent.parent / "data" / "prof_gear.json"
PROFS = {"fishing": 356, "alchemy": 171, "herbalism": 182, "cooking": 185, "first-aid": 129, "mining": 186,
         "skinning": 393, "blacksmithing": 164, "leatherworking": 165, "tailoring": 197, "engineering": 202,
         "enchanting": 333}
# the profession as an item's description names it ("Equip: Increased Fishing +25." / "Рыбная ловля +25")
NAMES = {"fishing": r"fishing|рыбн\w*\s+ловл\w*", "mining": r"mining|горн\w*\s+дел\w*", "herbalism": r"herbalism|травничеств\w*",
         "skinning": r"skinning|снят\w*\s+шкур", "alchemy": r"alchemy|алхими\w*", "blacksmithing": r"blacksmithing|кузнечн\w*",
         "engineering": r"engineering|инженерн\w*", "enchanting": r"enchanting|наложени\w*\s+чар", "cooking": r"cooking|кулинари\w*",
         "first-aid": r"first aid|перв\w*\s+помощ\w*", "leatherworking": r"leatherworking|кожевничеств\w*", "tailoring": r"tailoring|портняжн\w*"}


@lru_cache(maxsize=1)
def gear() -> dict:
    return json.loads(DATA.read_text("utf-8")) if DATA.is_file() else {}


def bonus_of(texts: list[str], prof: str = "fishing") -> int | None:
    rx = re.compile(rf"(?:{NAMES[prof]})\D{{0,24}}?\+?\s*(\d+)", re.I)
    for t in texts:
        m = rx.search(t)
        if m:
            return int(m.group(1))
    return None


async def _marked(session: AsyncSession, cid: int) -> set[int]:
    row = await session.get(Setting, f"profgear:{cid}")
    return set((row.value or {}).get("owned") or []) if row else set()


@router.get("/{cid}/{prof}")
async def prof_gear(cid: int, prof: str, user: CurrentUser, session: Session, lang: str = "ru"):
    lang = "ru" if lang == "ru" else "en"
    if prof not in PROFS:
        raise HTTPException(404, "no gear list for this profession")
    c, s = await bis_routes._char(session, user, cid)
    p = c.profile or {}
    mine = next((x for x in (p.get("professions") or {}).get(lang) or [] if x.get("id") == PROFS[prof]), None)
    worn = {x["id"] for x in (p.get("equipment") or {}).get(lang) or []}
    marked = await _marked(session, cid)
    rows = gear().get(prof) or []
    if not rows:
        return {"prof": prof, "level": s.get("level"), "skill": mine.get("skill") if mine else None,
                "max": mine.get("max") if mine else None, "market": False, "items": []}
    ah = await auction(session, user, [x["id"] for x in rows])
    out = []
    for x in rows:
        b = x.get("bonus")
        if b is None:  # poles and clothes: their bonus is in the description only
            try:
                info = await get_item(session, x["id"], lang)
            except Exception:  # noqa: BLE001 - Blizzard not answering: the bonus stays unknown
                info = None
            b = bonus_of((info or {}).get("spells") or [], prof)
        price = ah["items"].get(x["id"])
        out.append({**x, "name": x["name"][lang], "bonus": b, "worn": x["id"] in worn, "marked": x["id"] in marked,
                    "owned": x["id"] in worn or x["id"] in marked, "ah": price if price and price["price"] else None})
    return {"prof": prof, "level": s.get("level"), "skill": mine.get("skill") if mine else None,
            "max": mine.get("max") if mine else None, "market": ah["configured"], "items": out}


class OwnedIn(BaseModel):
    item_id: int
    owned: bool


@router.put("/{cid}/owned")
async def set_owned(cid: int, body: OwnedIn, user: CurrentUser, session: Session):
    """Mark a piece as had (in the bags) or not."""
    await bis_routes._char(session, user, cid)
    have = await _marked(session, cid)
    (have.add if body.owned else have.discard)(body.item_id)
    await session.merge(Setting(key=f"profgear:{cid}", value={"owned": sorted(have)}))
    await session.commit()
    return {"owned": sorted(have)}
