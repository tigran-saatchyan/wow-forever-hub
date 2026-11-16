"""Blizzard API status, endpoint probe, and Battle.net sign-in (imports your Forever characters)."""

import secrets
import time
from datetime import UTC, datetime, timedelta
from typing import Annotated
from urllib.parse import urlencode, urlparse

import jwt
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import RedirectResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .. import wow
from ..auth import AdminUser, CurrentUser
from ..bnet import REGIONS, TOKEN_URL, BnetError, client, current_version, name_of, slug
from ..config import get_settings
from ..db import Character, Setting, get_session
from .characters import refresh

router = APIRouter(prefix="/api/bnet", tags=["bnet"])
Session = Annotated[AsyncSession, Depends(get_session)]
AUTHORIZE_URL = "https://oauth.battle.net/authorize"
USERINFO_URL = "https://oauth.battle.net/userinfo"
STATE_COOKIE = "fh_bnet_state"
_status_cache: dict[str, tuple[float, dict]] = {}


@router.get("/status")
async def status(_: CurrentUser, region: str | None = None, lang: str = "ru"):
    """Is the API configured and answering? Forever has no realms, so its rulesets stand in for them."""
    bn = client()
    region = (region or get_settings().bnet_region).lower()
    out: dict = {"configured": bn.configured, "region": region, "version": current_version(get_settings())}
    if not bn.configured:
        return out
    key = f"{region}:{lang}"
    hit = _status_cache.get(key)
    if hit and hit[0] > time.time():
        return hit[1]
    t0 = time.monotonic()
    try:
        out["rulesets"] = wow.rulesets(await bn.get("/data/wow/ruleset/index", "dynamic", region, lang), lang)
        out["ok"] = True
    except BnetError as e:
        out |= {"ok": False, "error": str(e)}
    out["ms"] = int((time.monotonic() - t0) * 1000)
    out["checked"] = datetime.now(UTC).isoformat()
    _status_cache[key] = (time.time() + (600 if out.get("ok") else 60), out)
    return out


@router.get("/probe")
async def probe(_: AdminUser, region: str | None = None, character: str | None = None):
    """What answers right now: status code and the start of the body for every endpoint the hub uses."""
    return [p.__dict__ for p in await client().probe(region, character)]


@router.get("/raw")
async def raw(_: AdminUser, path: str, kind: str = "dynamic", region: str | None = None, lang: str | None = None):
    """Blizzard's answer as is (superadmin), to see the shape of an undocumented Forever endpoint."""
    if kind not in ("static", "dynamic", "profile") or not path.startswith(("/data/wow/", "/profile/wow/")):
        raise HTTPException(422, "path must start with /data/wow/ or /profile/wow/, kind static|dynamic|profile")
    try:
        return await client().get(path, kind, region, lang)
    except BnetError as e:
        raise HTTPException(502, f"Blizzard API: {e}") from e


# ---------- Battle.net sign-in ----------

def _redirect_uri(request: Request) -> str:
    base = get_settings().public_url.rstrip("/")
    if not base:
        proto = request.headers.get("x-forwarded-proto", request.url.scheme)
        base = f"{proto}://{request.headers.get('host', request.url.netloc)}"
    return base + "/api/bnet/callback"


@router.get("/login")
async def login(request: Request, user: CurrentUser, region: str | None = None):
    """Send the signed-in hub user to Battle.net; the callback imports their Forever characters."""
    s = get_settings()
    if not client().configured:
        raise HTTPException(503, "Blizzard API keys are not set")
    region = (region or s.bnet_region).lower()
    if region not in REGIONS:
        raise HTTPException(422, "region must be eu or us")
    nonce = secrets.token_urlsafe(16)
    state = jwt.encode(
        {"uid": user.id, "n": nonce, "r": region, "exp": datetime.now(UTC) + timedelta(minutes=10)},
        s.jwt_secret, algorithm="HS256",
    )
    q = urlencode({
        "client_id": s.bnet_client_id, "redirect_uri": _redirect_uri(request), "response_type": "code",
        "scope": "openid wow.profile", "state": nonce,
    })
    resp = RedirectResponse(f"{AUTHORIZE_URL}?{q}")
    resp.set_cookie(STATE_COOKIE, state, httponly=True, samesite="lax", secure=s.cookie_secure, max_age=600)
    return resp


def _char_slug(ch: dict) -> str:
    """name-surname from the character's API link, else from its name."""
    href = (ch.get("key") or {}).get("href") or ""
    path = urlparse(href).path
    if "/character/" in path:
        return path.split("/character/", 1)[1].strip("/")
    return slug(name_of(ch.get("name")))


@router.get("/callback")
async def callback(request: Request, session: Session, code: str = "", state: str = "", error: str = ""):
    s = get_settings()
    done = lambda st: RedirectResponse(f"/characters?bnet={st}")  # noqa: E731
    try:
        st = jwt.decode(request.cookies.get(STATE_COOKIE, ""), s.jwt_secret, algorithms=["HS256"])
    except jwt.PyJWTError:
        return done("expired")
    if error or not code or state != st.get("n"):
        return done("denied" if error else "bad_state")
    bn = client()
    r = await bn.http.post(
        TOKEN_URL,
        data={"grant_type": "authorization_code", "code": code, "redirect_uri": _redirect_uri(request)},
        auth=(s.bnet_client_id, s.bnet_client_secret),
    )
    if r.status_code != 200:
        return done("token")
    token = r.json()["access_token"]
    region = st.get("r", s.bnet_region)
    uid = int(st["uid"])
    battletag = None
    try:
        ui = await bn.http.get(USERINFO_URL, headers={"Authorization": f"Bearer {token}"})
        battletag = ui.json().get("battletag") if ui.status_code == 200 else None
    except Exception:  # noqa: BLE001 - the battletag is only a label
        pass
    try:
        prof = await bn.get("/profile/user/wow", "profile", region, token=token)
    except BnetError as e:
        await session.merge(Setting(key=f"bnet:{uid}", value={"battletag": battletag, "error": str(e)}))
        await session.commit()
        return done("profile")
    found = []
    for acc in prof.get("wow_accounts") or []:
        for ch in acc.get("characters") or []:
            sl = _char_slug(ch)
            if not sl:
                continue
            q = select(Character).where(Character.user_id == uid, Character.region == region, Character.slug == sl)
            c = (await session.execute(q)).scalar_one_or_none()
            first = slug(name_of(ch.get("name")))
            if c is None and first and sl != first:
                # imported earlier by first name only: keep that card (its marks, order) and give it the full slug
                q = select(Character).where(
                    Character.user_id == uid, Character.region == region, Character.slug == first
                )
                c = (await session.execute(q)).scalar_one_or_none()
                if c is not None:
                    c.slug = sl
            if c is None:
                c = Character(user_id=uid, region=region, slug=sl, name=name_of(ch.get("name")) or sl, source="bnet")
                session.add(c)
            # what Battle.net said about the character: its link, and maybe a surname the lookup needs
            c.profile = {**(c.profile or {}), "account": ch}
            found.append(c)
    await session.merge(Setting(key=f"bnet:{uid}", value={
        "battletag": battletag, "region": region, "characters": len(found), "linked": datetime.now(UTC).isoformat(),
    }))
    await session.commit()
    for c in found[:20]:
        await refresh(session, c)
    resp = done("ok")
    resp.delete_cookie(STATE_COOKIE)
    return resp


@router.get("/account")
async def account(user: CurrentUser, session: Session):
    row = await session.get(Setting, f"bnet:{user.id}")
    return row.value if row else None
