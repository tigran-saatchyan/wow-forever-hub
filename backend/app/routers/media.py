"""Blizzard's images through the hub.

Ad blockers drop some render.worldofwarcraft.com icons (net::ERR_BLOCKED_BY_CLIENT), so item icons
and character renders are served from our own origin. Only Blizzard and Wowhead image hosts are
allowed: this is not an open proxy.
"""

from collections import OrderedDict
from urllib.parse import urlparse

from fastapi import APIRouter, HTTPException, Response

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
