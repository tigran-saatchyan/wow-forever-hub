"""Characters a user follows: profile, equipment and talents from profile-forever."""

import asyncio
import logging
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
from ..config import get_settings
from ..db import Character, SessionLocal, Setting, User, get_session, utcnow
from .items import get_item

router = APIRouter(prefix="/api/characters", tags=["characters"])
Session = Annotated[AsyncSession, Depends(get_session)]
LANGS = ("ru", "en")
log = logging.getLogger("uvicorn.error")


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
        "avatar": p.get("avatar"),
        # the list carries the professions without the recipe ids: the menu and the crafting overview need levels only
        "profs": {lg: [{k: x.get(k) for k in ("id", "name", "kind", "skill", "max")} for x in (v or [])]
                  for lg, v in (p.get("professions") or {}).items()} or None,
    }
    if full:
        d |= {"equipment": p.get("equipment"), "talents": p.get("talents"), "avatar": p.get("avatar"),
              "missing": p.get("missing", []), "account": p.get("account"), "tried": p.get("tried"),
              "model": p.get("model"), "stats": p.get("stats"), "professions": p.get("professions"),
              "xpLog": p.get("xp_log") or []}
    return d


XP_LOG_MAX = 500


def xp_log(log: list | None, summary: dict, now: float) -> list[dict]:
    """Level and experience over time, one point per change (or per 6 hours without one): the leveling pace."""
    out = list(log or [])
    lvl, xp = summary.get("level"), summary.get("xp")
    if not isinstance(lvl, int):
        return out
    pt = {"t": int(now), "l": lvl, "x": xp if isinstance(xp, int) else None}
    last = out[-1] if out else None
    if last and last.get("l") == lvl and last.get("x") == pt["x"] and now - last.get("t", 0) < 6 * 3600:
        return out
    out.append(pt)
    return out[-XP_LOG_MAX:]


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
    old = c.profile or {}
    profile["xp_log"] = xp_log(old.get("xp_log"), profile["summary"]["en"], time.time())
    if old.get("tabs"):
        profile["tabs"] = old["tabs"]  # the last good copy of each armory tab outlives a refresh
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
    "toys": ("/collections/toys", lambda p, lg: wow.collection(p, "toys", lg)),
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


async def refresher() -> None:
    """Every character, from Blizzard, every few hours: fresh cards and points for the leveling pace."""
    hours = get_settings().refresh_hours
    await asyncio.sleep(120)  # let the app start first
    while True:
        try:
            async with SessionLocal() as session:
                chars = (await session.execute(select(Character))).scalars().all()
                for c in chars:
                    if c.error == "low_level":
                        continue  # Blizzard keeps those profiles to itself
                    try:
                        await refresh(session, c)
                    except Exception:  # noqa: BLE001 - one character must not stop the rest
                        log.exception("refresh %s failed", c.id)
                    await asyncio.sleep(3)
        except Exception:  # noqa: BLE001
            log.exception("refresher round failed")
        await asyncio.sleep(hours * 3600)


_inst_cache: dict[tuple[int, str], tuple[float, dict]] = {}


@router.get("/{cid}/instances")
async def instances(cid: int, user: CurrentUser, session: Session, lang: str = "ru"):
    """Dungeons and raids for the character: Forever's list with levels and bosses (ForeverDB), last-boss kills
    (Blizzard's statistics), and the upgrades each holds for the character's current specialization."""
    from .. import instances as inst
    from ..item_sources import INSTANCES
    from . import bis as bis_routes

    lang = "ru" if lang == "ru" else "en"
    c = await _own(session, user, cid)
    hit = _inst_cache.get((cid, lang))
    if hit and hit[0] > time.time():
        return hit[1]
    base = (c.profile or {}).get("path")
    stats_en, stats_l, err = {}, {}, None
    if base:
        try:
            stats_en = await client().get(base + "/achievements/statistics", "profile", c.region, "en")
            stats_l = stats_en if lang == "en" else await client().get(base + "/achievements/statistics", "profile", c.region, lang)
        except BnetError as e:
            err = e.status
    killed = inst.kills(stats_en, stats_l)
    live = True
    try:  # read from the cache the background sync fills; a cold start does not keep the page waiting long
        cat = await asyncio.wait_for(inst.catalog(), 20)
    except Exception as e:  # noqa: BLE001 - ForeverDB slow, out of its daily share or down: the shipped list
        if not isinstance(e, asyncio.TimeoutError):
            log.exception("instances: ForeverDB dungeons")
        cat, live = inst.snapshot(), False
    s = ((c.profile or {}).get("summary") or {}).get("en") or {}
    level = s.get("level") or 1
    up_ctx = None
    bis_ids: dict[int, tuple] = {}
    try:
        _, s2 = await bis_routes._char(session, user, cid)
        b = await bis_routes.build(session, c, s2, None, lang, save=False)
        if b.get("status") == "ready":
            worn = {k: (x.get("worn") or {}).get("score") or 0.0 for k, x in b["slots"].items()}
            up_ctx = (s2["classId"], b["weights"], worn, b["spec"], {k: x.get("worn") for k, x in b["slots"].items()},
                      b.get("hitRoom") or {})
            # the character's BiS for its level: item -> (slot, place 1-3), to mark the dungeons that drop it
            bis_ids = {o["id"]: (slot, n + 1, x.get("wornId") == o["id"]) for slot, x in b["slots"].items()
                       for n, o in enumerate(x["options"]) if not o.get("wornOnly")}
    except Exception:  # noqa: BLE001 - the list is still worth showing without upgrades
        log.exception("instances: upgrades for %s", cid)
    rows = []
    for d in cat:
        mine = [k for k in killed if inst.norm(k["instance"]) == inst.norm(d["en"])
                or inst.norm(k["boss"]) in {inst.norm(b) for b in d.get("bosses") or []}]
        names = d["ru"] if lang == "ru" else d["en"]
        try:
            ups = inst.upgrades(d["id"], d.get("notableLoot") or [], bis_routes.gear(), up_ctx[0], level, s.get("faction"),
                                up_ctx[1], up_ctx[2], lang, spec=up_ctx[3], hit_room=up_ctx[5]) if up_ctx else []
            for u in ups[:12]:  # both sides of the comparison tooltip: the item and what is worn in its slot
                u["full"] = bis_routes._item(u["id"], lang, up_ctx[1], u["slot"], up_ctx[5].get(u["slot"]))
                u["worn"] = up_ctx[4].get(u["slot"])
        except Exception:  # noqa: BLE001 - one odd item must not take the tab down
            log.exception("instances: upgrades in %s", d.get("id"))
            ups = []
        rows.append({"id": d["id"], "name": names, "nameEn": d["en"], "kind": d.get("kind"), "players": d.get("players"),
                     "levels": d.get("levels"), "new": bool(d.get("new")), "open": bool(d.get("open")), "url": d.get("url"),
                     "bosses": [{"en": b, "name": ((d.get("bossRu") or {}).get(b) if lang == "ru" else None) or inst.boss_name(b, lang),
                                 "model": inst.boss_model(b),
                                 "kills": next((k["kills"] for k in mine if inst.norm(k["boss"]) == inst.norm(b)), None)}
                                for b in d.get("bosses") or []],
                     "kills": [{"boss": k["bossLocal"] or k["boss"], "kills": k["kills"]} for k in mine],
                     "cleared": sum(k["kills"] for k in mine[:1]), "upgrades": ups[:12], "upgradeCount": len(ups),
                     "bis": [{**x, "full": bis_routes._item(x["id"], lang, up_ctx[1], x["slot"], up_ctx[5].get(x["slot"])),
                              "wornItem": up_ctx[4].get(x["slot"])}
                             if up_ctx else x for x in inst.bis_here(d["id"], d.get("notableLoot") or [], bis_ids, bis_routes.gear(), lang)],
                     "lootKnown": "classic" if d["id"] in INSTANCES else ("notable" if d.get("notableLoot") else "none")})
    # what the statistics count but the list lacks (ForeverDB not reached): shown all the same
    listed = {inst.norm(r["nameEn"]) for r in rows}
    for k in killed:
        if inst.norm(k["instance"]) not in listed:
            listed.add(inst.norm(k["instance"]))
            name = (k["instanceLocal"] or k["instance"]) if lang == "ru" else k["instance"]
            same = [x for x in killed if inst.norm(x["instance"]) == inst.norm(k["instance"])]
            rows.append({"id": -len(rows) - 1, "name": name[:1].upper() + name[1:], "nameEn": k["instance"], "kind": "dungeon",
                         "players": None, "levels": None, "new": False, "open": True, "url": None, "bosses": [],
                         "kills": [{"boss": x["bossLocal"] or x["boss"], "kills": x["kills"]} for x in same],
                         "cleared": same[0]["kills"], "upgrades": [], "upgradeCount": 0, "bis": [], "lootKnown": "none"})
    rows.sort(key=lambda r: ((r["levels"] or [99])[0], r["kind"] != "dungeon", r["nameEn"]))
    out = {"available": bool(stats_en), "status": err, "level": level, "spec": up_ctx[3] if up_ctx else None,
           "visited": inst.stat_value(stats_en, "Total 5-player dungeons entered"),
           "deaths": inst.stat_value(stats_en, "Total deaths in 5-player dungeons"),
           "fdb": live and inst.fdb().configured, "rows": rows}
    if live:  # the shipped list (ForeverDB not reached) is asked again next time
        _inst_cache[(cid, lang)] = (time.time() + 900, out)
    return out
