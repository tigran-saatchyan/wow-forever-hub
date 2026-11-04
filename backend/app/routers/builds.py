"""Saved talent builds. Stored per user, keyed by node id with fingerprints (see docs/SPEC.md, calculator)."""

import secrets
import time
from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth import CurrentUser
from ..db import Build, get_session

router = APIRouter(prefix="/api/builds", tags=["builds"])
Session = Annotated[AsyncSession, Depends(get_session)]


class SavedTalent(BaseModel):
    r: int = Field(ge=1, le=10)
    fp: str | None = None
    n: str | None = None  # name at save time, shown if the talent disappears
    d: str | None = None  # rank text at save time


class BuildIn(BaseModel):
    name: str = Field(min_length=1, max_length=40)
    cls: str = Field(min_length=3, max_length=16)
    level: int = Field(ge=5, le=60, default=60)
    legacy: int = Field(ge=0, le=5, default=0)
    version: str = Field(max_length=32)
    order: list[int] = Field(default_factory=list, max_length=60)
    talents: dict[str, SavedTalent] = Field(default_factory=dict)
    tags: list[str] = Field(default_factory=list, max_length=12)
    id: str | None = None  # when set, overwrite this build


class BuildOut(BuildIn):
    id: str
    created: datetime
    updated: datetime


def _out(b: Build) -> BuildOut:
    return BuildOut(
        id=b.id,
        name=b.name,
        cls=b.cls,
        level=b.level,
        legacy=b.legacy,
        version=b.version,
        order=b.order,
        talents=b.talents,
        tags=b.tags,
        created=b.created,
        updated=b.updated,
    )


@router.get("", response_model=list[BuildOut])
async def list_builds(user: CurrentUser, session: Session):
    rows = await session.execute(select(Build).where(Build.user_id == user.id).order_by(Build.updated.desc()))
    return [_out(b) for b in rows.scalars()]


@router.put("", response_model=BuildOut)
async def save_build(body: BuildIn, user: CurrentUser, session: Session):
    """Create or overwrite. Same name (case-insensitive) within a class overwrites, like the prototype."""
    key = body.name.strip().lower()
    b = None
    if body.id:
        b = await session.get(Build, body.id)
        if b and b.user_id != user.id:
            raise HTTPException(404, "no such build")
    if b is None:
        q = select(Build).where(Build.user_id == user.id, Build.cls == body.cls, Build.name_key == key)
        b = (await session.execute(q)).scalar_one_or_none()
    if b is None:
        b = Build(id="b" + format(int(time.time() * 1000), "x") + secrets.token_hex(2), user_id=user.id)
        session.add(b)
    b.name, b.name_key, b.cls = body.name.strip(), key, body.cls
    b.level, b.legacy, b.version, b.order, b.tags = body.level, body.legacy, body.version, body.order, body.tags
    b.talents = {k: v.model_dump(exclude_none=True) for k, v in body.talents.items()}
    await session.commit()
    await session.refresh(b)
    return _out(b)


@router.delete("/{build_id}", status_code=204)
async def delete_build(build_id: str, user: CurrentUser, session: Session):
    b = await session.get(Build, build_id)
    if not b or b.user_id != user.id:
        raise HTTPException(404, "no such build")
    await session.delete(b)
    await session.commit()
