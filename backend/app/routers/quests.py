"""A quest's details (zone, description, rewards) from Blizzard's static data, kept for good once fetched.

Quests do not change between visits, and the quest log asks for the same few again and again.
"""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from .. import wow
from ..auth import CurrentUser
from ..bnet import BnetError, client
from ..db import Setting, get_session

router = APIRouter(prefix="/api/quests", tags=["quests"])
Session = Annotated[AsyncSession, Depends(get_session)]
QUEST_V = 1


@router.get("/{quest_id}")
async def get_quest(quest_id: int, _: CurrentUser, session: Session, lang: str = "ru"):
    lang = "ru" if lang == "ru" else "en"
    key = f"quest:{quest_id}:{lang}"
    row = await session.get(Setting, key)
    if row and row.value.get("v") == QUEST_V:
        return row.value["data"]
    try:
        raw = await client().get(f"/data/wow/quest/{quest_id}", "static", lang=lang)
    except BnetError as e:
        raise HTTPException(404 if e.status == 404 else 502, f"Blizzard API: {e}") from e
    data = wow.quest(raw, lang)
    await session.merge(Setting(key=key, value={"v": QUEST_V, "data": data}))
    await session.commit()
    return data
