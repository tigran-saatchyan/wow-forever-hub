"""Central configuration for the WoW Forever Hub collector.

Everything that may change when Blizzard renames products or the game goes
live lives here, so switching Beta -> Live is a config change, not a code change.
"""
from __future__ import annotations

import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WEB_DATA = Path(os.environ.get("FH_WEB_DATA", ROOT / "web" / "data"))
CACHE = Path(os.environ.get("FH_CACHE", ROOT / ".cache"))
DB_PATH = Path(os.environ.get("FH_DB", ROOT / "state.sqlite3"))

# Battle.net (Ribbit/TACT) product codes that carry WoW: Forever.
# Verified 2026-10-08: `wow_cn_beta` serves 1.60.1.x and contains Forever-only
# content (Skyborne race, Improved Holy Strike). Despite the "cn" in the code it
# is published to the `us` region too. When Forever launches, add the live code.
PRODUCTS = {
    "beta": os.environ.get("FH_PRODUCT_BETA", "wow_classic_beta"),
    # "live": "wow_forever",   # <- fill in on launch day (Nov 4-5, 2026)
}
# Blizzard moves Forever between product codes (wow_cn_beta until build 70245,
# wow_classic_beta from 70291 on 2026-10-08). The collector therefore scans every
# public wow* product for VERSION_PREFIX and follows the newest build; these are
# just the ones checked first. Internal/vendor branches are never followed.
PRODUCT_CANDIDATES = ["wow_classic_beta", "wow_cn_beta", "wow_beta", "wowt", "wowxptr"]
INTERNAL_PRODUCT = r"^wow(dev\d*|v\d*|nev\d*|e\d+|z|livetest\d*|_classic_titan)$"
# Only builds whose version starts with this prefix are treated as Forever
# (guards against Blizzard reusing the product code for something else).
VERSION_PREFIX = os.environ.get("FH_VERSION_PREFIX", "1.60.")

RIBBIT_REGIONS = ["us", "eu"]
RIBBIT_URL = "https://{region}.version.battle.net/v2/products/{product}/versions"

# DB2 tables are exported as CSV by wago.tools.
WAGO_BUILDS = "https://wago.tools/api/builds"
WAGO_DB2 = "https://wago.tools/db2/{table}/csv?build={build}&locale={locale}"
LOCALES = {"en": "enUS", "ru": "ruRU"}

# Icon file names come from the community listfile (FileDataID -> path).
LISTFILE_URL = "https://github.com/wowdev/wow-listfile/releases/latest/download/community-listfile.csv"
ICON_URL = "https://wow.zamimg.com/images/wow/icons/large/{name}.jpg"
# Classic talent-tree artwork, keyed by TalentTab id (same CDN as the icons)
TREE_BG_URL = "https://wow.zamimg.com/images/wow/talents/backgrounds/classic/{tab}.jpg"
ICON_SIZE = 40

# Blizzard forums (Discourse). Category ids verified 2026-10-08.
FORUM_BASE = "https://{region}.forums.blizzard.com/en/wow"
FORUM_TRACKER = FORUM_BASE + "/groups/blizzard-tracker/posts.json"
FOREVER_CATEGORIES = {
    346: "WoW: Forever",
    347: "General Discussion",
    348: "Community Connections",
    349: "Beta Discussion",
}
BETA_CATEGORY = 349
FORUM_HISTORY_DAYS = int(os.environ.get("FH_FORUM_DAYS", "45"))

# Optional: Blizzard Game Data API (realm status). Needs a client from
# https://develop.battle.net. Left empty -> realm check is skipped.
BNET_CLIENT_ID = os.environ.get("BNET_CLIENT_ID", "")
BNET_CLIENT_SECRET = os.environ.get("BNET_CLIENT_SECRET", "")
BNET_NAMESPACE = os.environ.get("BNET_NAMESPACE", "")  # e.g. "dynamic-forever-us" once known

USER_AGENT = "WoWForeverHub/0.1 (+fan site; contact via site)"

KEY_DATES = {
    "beta_start": "2026-09-17",
    "beta_end": "2026-10-21",
    "beta_closed": "2026-10-21T21:00:00Z",  # beta went offline for the live-hardware stress test
    "launch": "2026-11-04T23:00:00Z",  # 3 pm PST Nov 4 = 00:00 CET Nov 5
}

# Live game client. `wowf` appeared on 2026-10-13 and serves the launch client
# (stress test 21.10 ran on it). Beta products are archived after beta_closed.
LIVE_PRODUCTS = [p for p in os.environ.get("FH_LIVE_PRODUCTS", "wowf").split(",") if p]
BETA_PRODUCTS = ["wow_classic_beta", "wow_cn_beta", "wow_beta"]
ARCHIVE_BETA = "archive/beta/index.json"


def phase(now=None) -> str:
    """beta -> prelaunch (beta archived, launch client preloading) -> live."""
    from datetime import datetime, timezone
    now = now or datetime.now(timezone.utc)
    iso = lambda s: datetime.fromisoformat(s.replace("Z", "+00:00"))  # noqa: E731
    forced = os.environ.get("FH_PHASE")
    if forced:
        return forced
    if now >= iso(KEY_DATES["launch"]):
        return "live"
    if now >= iso(KEY_DATES["beta_closed"]):
        return "prelaunch"
    return "beta"
