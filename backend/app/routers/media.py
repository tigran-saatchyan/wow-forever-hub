"""Blizzard's images through the hub.

Ad blockers drop some render.worldofwarcraft.com icons (net::ERR_BLOCKED_BY_CLIENT), so item icons
and character renders are served from our own origin. Only Blizzard and Wowhead image hosts are
allowed: this is not an open proxy.
"""

import re
import tempfile
from collections import OrderedDict
from pathlib import Path
from urllib.parse import urlparse

from fastapi import APIRouter, HTTPException, Response
from fastapi.responses import FileResponse

from ..auth import CurrentUser
from ..bnet import client

router = APIRouter(prefix="/api/media", tags=["media"])
HOSTS = {
    "render.worldofwarcraft.com", "render-eu.worldofwarcraft.com", "render-us.worldofwarcraft.com",
    "wow.zamimg.com",
}
MAX_BYTES = 3 * 1024 * 1024
_cache: OrderedDict[str, tuple[bytes, str]] = OrderedDict()
CACHE_ITEMS = 600


@router.get("")
async def media(u: str, _: CurrentUser):
    p = urlparse(u)
    if p.scheme != "https" or p.hostname not in HOSTS:
        raise HTTPException(422, "not a Blizzard image")
    hit = _cache.get(u)
    if hit is None:
        try:
            r = await client().http.get(u)
        except Exception as e:  # noqa: BLE001 - any network failure is a 502 for the browser
            raise HTTPException(502, "image unavailable") from e
        ctype = r.headers.get("content-type", "")
        if r.status_code != 200 or not ctype.startswith("image/") or len(r.content) > MAX_BYTES:
            raise HTTPException(404 if r.status_code == 404 else 502, "image unavailable")
        hit = (r.content, ctype)
        _cache[u] = hit
        while len(_cache) > CACHE_ITEMS:
            _cache.popitem(last=False)
    else:
        _cache.move_to_end(u)
    return Response(hit[0], media_type=hit[1], headers={"Cache-Control": "private, max-age=604800"})


# ---------- game sounds from the client files (wago.tools), by an allow-list ----------
# Only these files can be asked for, so this is not a way to pull anything from the client.
GAME_FILES: dict[int, str] = {
    8181003: "audio/mpeg", 8181005: "audio/mpeg", 8181007: "audio/mpeg",  # Forever: Undercity music
    8181009: "audio/mpeg",  # Forever: Undercity intro moment
    53216: "audio/mpeg", 53217: "audio/mpeg", 53218: "audio/mpeg", 53219: "audio/mpeg",  # classic Undercity
    53221: "audio/mpeg",  # Lament of the Highborne (Sylvanas' song, her music box)
    537437: "audio/ogg", 537439: "audio/ogg",  # Undercity ambience, the throne room
    561230: "audio/ogg", 561256: "audio/ogg", 561225: "audio/ogg", 561242: "audio/ogg",  # Sylvanas, quest turn-in
    561241: "audio/ogg", 561268: "audio/ogg", 561231: "audio/ogg",
    544832: "audio/ogg", 544831: "audio/ogg",  # banshee wail, banshee death
    567431: "audio/ogg", 567439: "audio/ogg",  # level up, quest complete
    537908: "audio/ogg",  # ethereal window opening: passing through the veil, between pages
    # Nathanos Blightcaller, her champion: short spoken lines (no battle cries), in both client languages
    1239071: "audio/ogg", 1239113: "audio/ogg", 1239115: "audio/ogg", 1239117: "audio/ogg",
    1239131: "audio/ogg", 1239135: "audio/ogg", 1355059: "audio/ogg", 1355061: "audio/ogg",
}
GAME_BUILD = "1.60.1.70938"
CACHE_DIR = Path(tempfile.gettempdir()) / "fh-game-media"


LOCALES = {"ru": "ruRU", "en": "enUS"}


@router.get("/game/{fdid}")
async def game_file(fdid: int, _: CurrentUser, lang: str = "en"):
    """A client file; voice lines exist per language (the Russian client has its own recordings)."""
    mime = GAME_FILES.get(fdid)
    if not mime:
        raise HTTPException(404, "not an allowed file")
    locale = LOCALES.get(lang, "enUS")
    path = CACHE_DIR / f"{fdid}-{locale}"
    if not path.is_file():
        try:
            r = await client().http.get(
                f"https://wago.tools/api/casc/{fdid}?version={GAME_BUILD}&locale={locale}", timeout=60
            )
        except Exception as e:  # noqa: BLE001
            raise HTTPException(502, "file unavailable") from e
        if r.status_code != 200 or len(r.content) < 64:
            raise HTTPException(502, "file unavailable")
        CACHE_DIR.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(".part")
        tmp.write_bytes(r.content)
        tmp.replace(path)
    return FileResponse(path, media_type=mime, headers={"Cache-Control": "private, max-age=2592000"})


# ---------- Wowhead's 3D model viewer, through the hub ----------
# wow.zamimg.com refuses requests that carry another site's Origin (the browser's XHR does), so the viewer's
# files (its script, model meta, models, textures, animations) are fetched here without one and cached.
ZAM = "https://wow.zamimg.com/modelviewer/"
ZAM_PATH = re.compile(r"^(live|classic)/[a-z0-9]{2,16}/[A-Za-z0-9_./-]{1,160}$")  # retail or classic viewer
ZAM_DIR = Path(tempfile.gettempdir()) / "fh-zam"
ZAM_TYPES = {".js": "application/javascript", ".json": "application/json", ".webp": "image/webp", ".png": "image/png",
             ".jpg": "image/jpeg", ".css": "text/css"}


@router.get("/zam/{path:path}")
async def zam(path: str, _: CurrentUser):
    if ".." in path or not ZAM_PATH.match(path):
        raise HTTPException(404, "not a model viewer file")
    file = ZAM_DIR / path
    if not file.is_file():
        try:
            r = await client().http.get(ZAM + path, timeout=60)
        except Exception as e:  # noqa: BLE001
            raise HTTPException(502, "viewer file unavailable") from e
        if r.status_code != 200:
            raise HTTPException(404 if r.status_code in (403, 404) else 502, "viewer file unavailable")
        file.parent.mkdir(parents=True, exist_ok=True)
        tmp = file.with_suffix(file.suffix + ".part")
        tmp.write_bytes(r.content)
        tmp.replace(file)
    ctype = ZAM_TYPES.get(file.suffix, "application/octet-stream")
    return FileResponse(file, media_type=ctype, headers={"Cache-Control": "private, max-age=2592000"})
