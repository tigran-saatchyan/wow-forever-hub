"""The game data collector (legacy/collector) run by the hub itself, so data/ follows Forever on its own.

Until now it ran by hand and data/ was a snapshot baked into the image: the news page went stale and a
new client build reached the talent calculator only when someone committed it. Here, in the background:

- news and server status every 15 minutes (Blizzard's forums: blue posts, maintenance);
- a check for a new Forever build every 2 hours, and if there is one, talents, abilities, icons and the
  list of changes rebuilt for it (a minute or two, once per patch);
- the error-code search on the forums every 6 hours (rate-limited by Blizzard).

The collector is synchronous (requests, Pillow), so each step runs in a worker thread; a failed step is
logged and tried again next time. Files land in FH_DATA_DIR, the folder the hub already serves; on a
redeploy the image brings the committed snapshot back and the collector catches up from there.
"""

import asyncio
import json
import logging
import os
import sys
import tempfile
import time
from pathlib import Path

from .config import REPO_ROOT, get_settings

log = logging.getLogger("uvicorn.error")
NEWS_S, BUILDS_S, ERRORS_S = 15 * 60, 2 * 3600, 6 * 3600


def _collector():
    """The collector package, configured to write into the hub's data folder."""
    s = get_settings()
    work = Path(tempfile.gettempdir()) / "fh-collector"
    os.environ.setdefault("FH_WEB_DATA", str(s.data_dir))
    os.environ.setdefault("FH_CACHE", str(work / "cache"))
    os.environ.setdefault("FH_DB", str(work / "state.sqlite3"))
    for root in (REPO_ROOT / "legacy", Path("/app/legacy")):
        if (root / "collector").is_dir() and str(root) not in sys.path:
            sys.path.insert(0, str(root))
    from collector import __main__ as cli  # noqa: PLC0415 - imported once the environment is set

    return cli


def news_step() -> None:
    cli = _collector()
    n = cli.update_news()
    status_path = get_settings().data_dir / "status.json"
    try:
        builds = json.loads(status_path.read_text("utf-8")).get("builds", [])
    except (OSError, ValueError):
        builds = []
    cli.update_status(builds, n["topics"])
    cli.update_notes(n["topics"])


def builds_step() -> str | None:
    """Rebuild the talent data when wago.tools knows a newer Forever build; the latest build either way."""
    cli = _collector()
    s = get_settings()
    try:
        have = json.loads((s.data_dir / "index.json").read_text("utf-8")).get("latest")
    except (OSError, ValueError):
        have = None
    builds = cli.known_builds()
    newest = builds[-1]["version"] if builds else None
    if newest and newest != have:
        log.info("game data: new build %s (had %s), rebuilding", newest, have)
        idx = cli.update_talents(builds)
        n = cli.update_news()
        cli.update_status(builds, n["topics"])
        return idx.get("latest")
    return have


def errors_step() -> None:
    _collector().update_errors(budget_s=300)


async def runner() -> None:
    await asyncio.sleep(90)  # let the app start first
    last = {"news": 0.0, "builds": 0.0, "errors": 0.0}
    steps = (("builds", BUILDS_S, builds_step), ("news", NEWS_S, news_step), ("errors", ERRORS_S, errors_step))
    while True:
        for name, every, fn in steps:
            if time.time() - last[name] < every:
                continue
            try:
                await asyncio.to_thread(fn)
            except Exception:  # noqa: BLE001 - one step must not stop the others or the next round
                log.exception("game data: %s failed", name)
            last[name] = time.time()
        await asyncio.sleep(60)
