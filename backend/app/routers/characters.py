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
from ..db import Character, Setting, User, get_session, utcnow
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


class LayoutIn(BaseModel):
    order: list[int] = Field(default_factory=list, max_length=500)
    favorites: list[int] = Field(default_factory=list, max_length=500)


async def _layout(session: AsyncSession, user: User) -> dict:
    row = await session.get(Setting, f"chars:{user.id}")
    return dict(row.value) if row else {}


@router.get("")
async def list_characters(user: CurrentUser, session: Session):
    """The user's order (drag or arrows on the page), new characters last; favorites flagged."""
    rows = (await session.execute(
        select(Character).where(Character.user_id == user.id).order_by(Character.created)
    )).scalars().all()
    lay = await _layout(session, user)
    pos = {cid: i for i, cid in enumerate(lay.get("order") or [])}
    fav = set(lay.get("favorites") or [])
    rows = sorted(rows, key=lambda c: pos.get(c.id, len(pos) + c.id))
    return [_out(c) | {"favorite": c.id in fav} for c in rows]


@router.put("/layout")
async def set_layout(body: LayoutIn, user: CurrentUser, session: Session):
    """Order and favorites of the list. Ids of other users' characters are dropped."""
    mine = set((await session.execute(select(Character.id).where(Character.user_id == user.id))).scalars())
    value = {
        "order": [i for i in dict.fromkeys(body.order) if i in mine],
        "favorites": [i for i in dict.fromkeys(body.favorites) if i in mine],
    }
    await session.merge(Setting(key=f"chars:{user.id}", value=value))
    await session.commit()
    return value


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


# armory tabs: profile sub-resource and its reader
TABS = {
    "pvp": ("/pvp-summary", wow.pvp),
    "reputations": ("/reputations", wow.reputations),
    "achievements": ("/achievements", wow.achievements),
    "mounts": ("/collections/mounts", lambda p, lg: wow.collection(p, "mounts", lg)),
    "pets": ("/collections/pets", lambda p, lg: wow.collection(p, "pets", lg)),
    "dungeons": ("/encounters/dungeons", wow.encounters),
    "raids": ("/encounters/raids", wow.encounters),
    "titles": ("/titles", wow.titles),
    "quests": ("/quests/completed", wow.quests),
    "quests_active": ("/quests", wow.quests_active),
    "statistics": ("/achievements/statistics", wow.stat_tree),
}
_tab_cache: dict[tuple[int, str, str], tuple[float, dict]] = {}


@router.get("/{cid}/tab/{name}")
async def tab(cid: int, name: str, user: CurrentUser, session: Session, lang: str = "ru"):
    """One armory tab, fetched when opened (15 min cache). If Blizzard refuses, the last good copy is
    returned with available=false, so the tab can still show something and say why."""
    if name not in TABS:
        raise HTTPException(404, "no such tab")
    c = await _own(session, user, cid)
    key = (cid, name, lang)
    hit = _tab_cache.get(key)
    if hit and hit[0] > time.time():
        return hit[1]
    base = (c.profile or {}).get("path")
    if not base:
        return {"available": False, "status": 404}
    suffix, read = TABS[name]
    tabs = dict((c.profile or {}).get("tabs") or {})
    try:
        raw = await client().get(base + suffix, "profile", c.region, lang)
    except BnetError as e:
        old = (tabs.get(name) or {}).get(lang)
        return {"available": False, "status": e.status, "data": old, "at": (tabs.get(name) or {}).get("at")}
    out = {"available": True, "data": read(raw, lang), "at": utcnow().isoformat()}
    tabs[name] = {**(tabs.get(name) or {}), lang: out["data"], "at": out["at"]}
    c.profile = {**(c.profile or {}), "tabs": tabs}
    await session.commit()
    _tab_cache[key] = (time.time() + 900, out)
    return out


class KnownIn(BaseModel):
    line: int  # profession skill line
    ids: list[int] = Field(max_length=500)  # recipe ids (SkillLineAbility)
    known: bool


@router.get("/{cid}/known")
async def known_recipes(cid: int, user: CurrentUser, session: Session):
    """Recipes the user marked as learned: Blizzard does not say which ones a Forever character knows."""
    await _own(session, user, cid)
    row = await session.get(Setting, f"known:{cid}")
    return row.value if row else {}


@router.put("/{cid}/known")
async def mark_known(cid: int, body: KnownIn, user: CurrentUser, session: Session):
    await _own(session, user, cid)
    row = await session.get(Setting, f"known:{cid}")
    value = dict(row.value) if row else {}
    have = set(value.get(str(body.line), []))
    have = have | set(body.ids) if body.known else have - set(body.ids)
    value[str(body.line)] = sorted(have)
    await session.merge(Setting(key=f"known:{cid}", value=value))
    await session.commit()
    return value


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
