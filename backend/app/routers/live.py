"""Live status over Server-Sent Events.

The collector writes data/status.json (and news.json); this endpoint pushes the new content to open
pages as soon as the file changes, replacing the prototype's subscription to the artifact database.
SSE is enough here (server -> browser only); WebSocket can come later if the client needs to talk back.
"""

import asyncio
import json
from pathlib import Path

from fastapi import APIRouter, Request
from sse_starlette.sse import EventSourceResponse

from ..config import get_settings

router = APIRouter(prefix="/api/live", tags=["live"])
WATCHED = ("status", "news")


def _read(path: Path):
    try:
        return path.stat().st_mtime, json.loads(path.read_text("utf-8"))
    except (OSError, ValueError):
        return None, None


@router.get("")
async def live(request: Request):
    s = get_settings()

    async def events():
        seen: dict[str, float | None] = {}
        while not await request.is_disconnected():
            for name in WATCHED:
                mtime, data = _read(s.data_dir / f"{name}.json")
                if mtime is not None and seen.get(name) != mtime:
                    seen[name] = mtime
                    yield {"event": name, "data": json.dumps(data, ensure_ascii=False)}
            await asyncio.sleep(s.live_poll_seconds)

    return EventSourceResponse(events(), ping=20)
