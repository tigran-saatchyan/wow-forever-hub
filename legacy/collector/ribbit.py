"""Build tracking: Battle.net version server (live) + wago.tools history."""
from __future__ import annotations

import re
from datetime import datetime, timezone

from . import config, net


def current_versions(product: str) -> dict[str, dict]:
    """Region -> {build, version} straight from the Battle.net version server."""
    out: dict[str, dict] = {}
    for region in config.RIBBIT_REGIONS:
        try:
            text = net.get(config.RIBBIT_URL.format(region=region, product=product), timeout=15).text
        except RuntimeError:
            continue
        header: list[str] = []
        for line in text.splitlines():
            if not line or line.startswith("#"):
                continue
            if "!" in line:
                header = [h.split("!")[0] for h in line.split("|")]
                continue
            row = dict(zip(header, line.split("|")))
            if row.get("Region") == region:
                out[region] = {"build": int(row["BuildId"]), "version": row["VersionsName"]}
    return out


def forever_products() -> dict[str, dict[str, dict]]:
    """Every public wow* product currently serving a Forever build (VERSION_PREFIX).

    Returns {product: {region: {build, version}}}. Candidates are checked first,
    then the rest of the version-server summary, skipping internal branches.
    """
    try:
        summary = net.get("https://us.version.battle.net/v2/summary", timeout=20).text
        codes = {l.split("|")[0] for l in summary.splitlines() if l.startswith("wow")}
    except RuntimeError:
        codes = set()
    internal = re.compile(config.INTERNAL_PRODUCT)
    ordered = list(dict.fromkeys(config.PRODUCT_CANDIDATES + sorted(codes)))
    out = {}
    for product in ordered:
        if internal.match(product):
            continue
        regions = {r: v for r, v in current_versions(product).items() if v["version"].startswith(config.VERSION_PREFIX)}
        if regions:
            out[product] = regions
    return out


def history(product: str | None = None) -> list[dict]:
    """Forever builds wago.tools has seen (all products unless one is given), oldest first."""
    data = net.get(config.WAGO_BUILDS, timeout=30).json()
    rows: dict[str, dict] = {}
    for prod, builds in data.items():
        if product and prod != product:
            continue
        for b in builds:
            if b["version"].startswith(config.VERSION_PREFIX):
                rows.setdefault(b["version"], {"version": b["version"], "build": int(b["version"].rsplit(".", 1)[1]),
                                               "seen": b["created_at"], "product": prod})
    return sorted(rows.values(), key=lambda r: r["build"])


def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
