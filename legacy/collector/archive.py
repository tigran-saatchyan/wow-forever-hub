"""Frozen archive of the WoW: Forever beta (17.09 - 21.10.2026).

Built once when the beta closed (`python -m collector archive-beta`), then only
appended to if Blizzard pushes another beta-product build. Talent diffs stay at
data/diffs/<version>.<lang>.json; the archive index just lists them.
"""
from __future__ import annotations

import json
import logging
from pathlib import Path

from . import config, forums, ribbit

log = logging.getLogger(__name__)


def _read(p: Path):
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def build_beta_archive(index: dict, diffs_dir: Path, history: list[dict], forum_days: int = 60) -> dict:
    beta_builds = [b for b in history if b["product"] in config.BETA_PRODUCTS]
    final = max((b["build"] for b in beta_builds), default=0)
    entries = {e["version"]: e for e in index.get("builds", [])}
    builds = []
    first_with_talents = None
    for b in history:
        if b["build"] > final:
            continue
        e = {"version": b["version"], "build": b["build"], "seen": b["seen"], "product": b["product"], "talents": False}
        d = _read(diffs_dir / f"{b['version']}.en.json")
        if d is not None:
            by_lang = {}
            for lang in config.LOCALES:
                dl = _read(diffs_dir / f"{b['version']}.{lang}.json")
                if dl is not None:
                    by_lang[lang] = len(dl.get("changes", []))
            e.update(talents=True, changes=by_lang.get("en", len(d.get("changes", []))), changesByLang=by_lang,
                     **{"from": d.get("from")})
        elif b["version"] in entries and entries[b["version"]].get("talents"):
            src = entries[b["version"]]
            e.update(talents=True, changes=src.get("changes"), **({"from": src["from"]} if src.get("from") else {}))
        if e["talents"] and first_with_talents is None:
            first_with_talents = b["version"]
        builds.append(e)
    # the oldest build with talent data has nothing to compare to
    for e in builds:
        if e["version"] == first_with_talents and "from" not in e:
            e["talents"], e["first"] = True, True

    posts = []
    for region in ("us", "eu"):
        try:
            posts += forums.fetch_tracker(region, days=forum_days)
        except RuntimeError as err:
            log.warning("forums %s: %s", region, err)
    beta_topics = forums.dedupe_regions([t for t in forums.topics(posts) if t.get("beta")], "first", window_h=6)
    maintenance = forums.maintenance_windows(beta_topics, fetch_days=forum_days)

    final_v = next((b["version"] for b in builds if b["build"] == final), None)
    return {
        "generated": ribbit.now_iso(),
        "start": config.KEY_DATES["beta_start"],
        "end": config.KEY_DATES["beta_end"],
        "final": final_v,
        "builds": builds,
        "maintenance": maintenance,
        "topics": beta_topics,
        "stats": {
            "builds": len(builds),
            "withTalents": sum(1 for b in builds if b["talents"]),
            "talentChanges": sum(b.get("changes") or 0 for b in builds),
            "buildsWithChanges": sum(1 for b in builds if b.get("changes")),
            "maintenance": len(maintenance),
            "topics": len(beta_topics),
        },
    }


def record_beta_builds(archive: dict, history: list[dict]) -> bool:
    """Append beta-product builds pushed after the archive was made (record only)."""
    have = {b["version"] for b in archive.get("builds", [])}
    added = [
        {"version": b["version"], "build": b["build"], "seen": b["seen"], "product": b["product"],
         "talents": False, "afterClose": True}
        for b in history if b["product"] in config.BETA_PRODUCTS and b["version"] not in have
    ]
    if added:
        archive["builds"] = sorted(archive.get("builds", []) + added, key=lambda b: b["build"])
        archive["stats"]["builds"] = len(archive["builds"])
    return bool(added)
