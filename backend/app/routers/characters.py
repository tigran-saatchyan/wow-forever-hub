"""Characters a user follows: profile, equipment and talents from profile-forever."""

import asyncio
import time
from typing import Annotated
from urllib.parse import quote, urlparse

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .. import wow
from ..auth import CurrentUser
from ..bnet import REGIONS, BnetError, client, name_of, slug
from ..db import Character, User, get_session, utcnow
from .items import get_item

router = APIRouter(prefix="/api/characters", tags=["characters"])
Session = Annotated[AsyncSession, Depends(get_session)]
LANGS = ("ru", "en")


class CharacterIn(BaseModel):
    name: str = Field(min_length=2, max_length=80)  # "Name Surname" or name-surname
    region: str = "eu"


def _out(c: Character, full: bool = False) -> dict:
    p = c.profile or {}
    d = {
        "id": c.id,
        "region": c.region,
        "slug": c.slug,
        "name": c.name,
        "source": c.source,
        "summary": p.get("summary"),
        "error": c.error,
        "fetched": c.fetched,
    }
    if full:
        d |= {"equipment": p.get("equipment"), "talents": p.get("talents"), "avatar": p.get("avatar"),
              "missing": p.get("missing", []), "account": p.get("account"), "tried": p.get("tried"),
              "model": p.get("model"), "stats": p.get("stats"), "professions": p.get("professions")}
    return d


def candidate_paths(c: Character) -> list[str]:
    """Where the profile may live. Battle.net's account list is the best guide: its link to the character,
    a surname if it sends one, a realm if Forever has them after all; then the slug we have."""
    acc = (c.profile or {}).get("account") or {}
    name = name_of(acc.get("name")) or c.name
    out = []
    href = (acc.get("key") or {}).get("href")
    if href:
        out.append(urlparse(href).path)
    for k in ("surname", "last_name", "family_name", "lastname"):
        if isinstance(acc.get(k), str) and acc[k].strip():
            out.append(f"/profile/wow/character/{quote(slug(name + ' ' + acc[k]))}")
    realm = (acc.get("realm") or {}).get("slug")
    if realm:
        out.append(f"/profile/wow/character/{quote(realm)}/{quote(slug(name))}")
    out.append(f"/profile/wow/character/{quote(c.slug)}")
    return list(dict.fromkeys(p.rstrip("/") for p in out if p))


async def refresh(session: AsyncSession, c: Character) -> Character:
    """Fetch the profile and its parts. Missing parts are listed instead of failing the whole card."""
    bn = client()
    account = (c.profile or {}).get("account")
    prof, base, last = None, "", None
    tried = candidate_paths(c)
    for path in tried:
        try:
            prof, base = await bn.get(path, "profile", c.region), path
            break
        except BnetError as e:
            last = e
            if e.status != 404:
                break
    if prof is None:
        c.error = "not_found" if last is None or last.status == 404 else f"{last.status}"
        c.profile = {"account": account, "tried": tried} if account else {"tried": tried}
        if account:
            # Blizzard keeps profiles of low characters to itself (under 10 in retail); Battle.net's
            # account list still knows their name, level, class and race
            c.profile["summary"] = {lg: wow.character_summary(account, lg) for lg in LANGS}
            lvl = account.get("level")
            if c.error == "not_found" and isinstance(lvl, int) and lvl < 10:
                c.error = "low_level"
        c.fetched = utcnow()
        await session.commit()
        return c

    async def part(suffix: str):
        try:
            return await bn.get(base + suffix, "profile", c.region)
        except BnetError as e:
            return e

    eq, specs, media, stats, profs = await asyncio.gather(
        part("/equipment"), part("/specializations"), part("/character-media"), part("/statistics"),
        part("/professions"),
    )
    missing = [n for n, x in (("equipment", eq), ("talents", specs), ("media", media), ("stats", stats),
                              ("professions", profs)) if isinstance(x, BnetError)]
    profile: dict = {"summary": {lg: wow.character_summary(prof, lg) for lg in LANGS}, "missing": missing,
                     "path": base}
    if account:
        profile["account"] = account
    if not isinstance(eq, BnetError):
        profile["equipment"] = {lg: wow.equipment(eq, lg) for lg in LANGS}
        # icons for the equipped items, cached in the items table
        ids = {x["id"] for x in profile["equipment"]["en"] if x.get("id")}
        icons = {}
        for iid in ids:
            try:
                it = await get_item(session, iid, "en")
            except BnetError:
                it = None
            icons[iid] = (it or {}).get("icon")
        for lg in LANGS:
            for x in profile["equipment"][lg]:
                x["icon"] = icons.get(x.get("id"))
    if not isinstance(specs, BnetError):
        profile["talents"] = wow.talents(specs)
    if not isinstance(media, BnetError):
        profile["avatar"] = wow.media_url(media, "avatar", "inset", "main")
        # the full-body render for the character window, transparent when Blizzard has one
        profile["model"] = wow.media_url(media, "main-raw", "main", "inset", strict=True)
    if not isinstance(stats, BnetError):
        profile["stats"] = {lg: wow.statistics(stats, lg) for lg in LANGS}
    if not isinstance(profs, BnetError):
        profile["professions"] = {lg: wow.professions(profs, lg) for lg in LANGS}
    c.profile = profile
    c.name = profile["summary"]["en"]["name"] or c.name
    c.error = None
    c.fetched = utcnow()
    await session.commit()
    return c


async def _own(session: AsyncSession, user: User, cid: int) -> Character:
    c = await session.get(Character, cid)
    if not c or c.user_id != user.id:
        raise HTTPException(404, "no such character")
    return c


@router.get("")
async def list_characters(user: CurrentUser, session: Session):
    rows = await session.execute(select(Character).where(Character.user_id == user.id).order_by(Character.created))
    return [_out(c) for c in rows.scalars()]


@router.post("")
async def add_character(body: CharacterIn, user: CurrentUser, session: Session):
    region = body.region.lower()
    if region not in REGIONS:
        raise HTTPException(422, "region must be eu or us")
    sl = slug(body.name)
    q = select(Character).where(Character.user_id == user.id, Character.region == region, Character.slug == sl)
    c = (await session.execute(q)).scalar_one_or_none()
    if c is None:
        c = Character(user_id=user.id, region=region, slug=sl, name=body.name.strip())
        session.add(c)
        await session.commit()
    if client().configured:
        await refresh(session, c)
    else:
        c.error = "not_configured"
        await session.commit()
    return _out(c, full=True)


@router.get("/{cid}")
async def get_character(cid: int, user: CurrentUser, session: Session):
    return _out(await _own(session, user, cid), full=True)


@router.post("/{cid}/refresh")
async def refresh_character(cid: int, user: CurrentUser, session: Session):
    c = await _own(session, user, cid)
    if not client().configured:
        raise HTTPException(503, "Blizzard API keys are not set")
    return _out(await refresh(session, c), full=True)


_roster_cache: dict[str, tuple[float, dict]] = {}


@router.get("/{cid}/guild")
async def guild(cid: int, user: CurrentUser, session: Session, lang: str = "ru"):
    """The roster of the character's guild, through the guild link of its profile (cached 30 min)."""
    c = await _own(session, user, cid)
    g = ((c.profile or {}).get("summary") or {}).get("en", {}).get("guild") or {}
    href = g.get("href")
    if not href:
        raise HTTPException(404, "no guild")
    path = urlparse(href).path.rstrip("/") + "/roster"
    key = f"{c.region}:{path}:{lang}"
    hit = _roster_cache.get(key)
    if hit and hit[0] > time.time():
        return hit[1]
    try:
        r = await client().get(path, "profile", c.region, lang)
    except BnetError as e:
        raise HTTPException(404 if e.status == 404 else 502, f"Blizzard API: {e}") from e
    out = {"name": wow.name_of(r.get("guild"), lang) or g.get("name"), "members": wow.roster(r, lang)}
    _roster_cache[key] = (time.time() + 1800, out)
    return out


@router.delete("/{cid}", status_code=204)
async def delete_character(cid: int, user: CurrentUser, session: Session):
    await session.delete(await _own(session, user, cid))
    await session.commit()
