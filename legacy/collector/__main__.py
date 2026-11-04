"""CLI.

  python -m collector update            # builds + talents + diffs + icons + news + status
  python -m collector news              # forums + status only (fast, run every 5 min)
  python -m collector talents BUILD     # (re)build one build's talent data
  python -m collector watch             # loop: news every 5 min, builds every 15 min
"""
from __future__ import annotations

import argparse
import json
import logging
import time
from pathlib import Path

from . import archive, config, diff, errors, forums, icons, ribbit, status, talents

log = logging.getLogger("collector")


def _write(path: Path, data) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    tmp.replace(path)


def _read(path: Path, default=None):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return default


def known_builds() -> list[dict]:
    """wago history across products + what the version server serves right now, deduped."""
    hist = ribbit.history()
    have = {b["build"] for b in hist}
    prev = {b["version"]: b for b in (_read(config.WEB_DATA / "index.json", {}) or {}).get("builds", [])}
    for product, regions in ribbit.forever_products().items():
        for v in regions.values():
            if v["build"] not in have:
                seen = prev.get(v["version"], {}).get("seen") or ribbit.now_iso()
                hist.append({"version": v["version"], "build": v["build"], "seen": seen, "product": product})
                have.add(v["build"])
    return sorted(hist, key=lambda b: b["build"])


def update_talents(builds: list[dict], keep: int = 10) -> dict:
    data = config.WEB_DATA
    index = _read(data / "index.json", {}) or {}
    done = {b["version"] for b in index.get("builds", []) if b.get("talents")}
    icon_map = talents.icon_names()
    prev_ds: dict[str, dict] = {}
    processed = []
    for b in builds[-keep:]:
        ver = b["version"]
        entry = {**b, "talents": True}
        ds_by_lang = {}
        for lang in config.LOCALES:
            path = data / "talents" / ver / f"{lang}.json"
            if ver in done and path.exists():
                ds = _read(path)
            else:
                log.info("building talents %s %s", ver, lang)
                try:
                    ds = talents.build_dataset(ver, lang, icon_map)
                except Exception as e:  # noqa: BLE001 - wago may not have exported yet
                    log.warning("skip %s: %s", ver, e)
                    ds = None
                if ds:
                    _write(path, ds)
            ds_by_lang[lang] = ds
        if not all(ds_by_lang.values()):
            continue
        if talents.add_fingerprints(ds_by_lang):
            for lang, ds in ds_by_lang.items():
                _write(data / "talents" / ver / f"{lang}.json", ds)
        for lang, ds in ds_by_lang.items():
            if lang in prev_ds:
                changes = diff.diff_talents(prev_ds[lang], ds)
                _write(data / "diffs" / f"{ver}.{lang}.json",
                       {"from": prev_ds[lang]["build"], "to": ver, "changes": changes})
                entry.setdefault("changesByLang", {})[lang] = len(changes)
                entry["changes"] = entry["changesByLang"].get("en", len(changes))
                entry["from"] = prev_ds[lang]["build"]
        prev_ds = ds_by_lang
        processed.append(entry)
    if processed:
        latest = processed[-1]["version"]
        from . import abilities
        built_ab: dict[str, dict] = {}
        for lang, loc in config.LOCALES.items():
            try:
                built_ab[lang] = abilities.build_abilities(latest, lang, loc, prev_ds[lang], icon_map)
            except Exception as e:  # noqa: BLE001
                log.warning("abilities %s/%s: %s", latest, lang, e)
        if "en" in prev_ds:
            log.info("abilities: %d links dropped by the school check", abilities.prune_school_conflicts(built_ab, prev_ds["en"]))
        for lang, ab in built_ab.items():
            _write(data / "abilities" / latest / f"{lang}.json", ab)
        abil = list(built_ab.values())
        names = sorted(set(icons.collect_names([prev_ds[l] for l in prev_ds])) | abilities.icon_names_of(abil))
        res = icons.build_sprite(names, data)
        if res["missing"]:
            log.warning("icons missing: %s", res["missing"][:20])
        icons.build_tree_art([prev_ds[l] for l in prev_ds], data)
        index = {"generated": ribbit.now_iso(), "latest": latest, "builds": processed}
        _write(data / "index.json", index)
    return index


def update_news() -> dict:
    posts = []
    for region in ("us", "eu"):
        try:
            posts += forums.fetch_tracker(region)
        except RuntimeError as e:
            log.warning("forums %s: %s", region, e)
    topics = forums.topics(posts)
    if config.phase() != "beta":
        # The beta forum is archived, but Blizzard keeps posting launch notes into its threads
        # (e.g. "Development Notes – Updated November 2" lives in Beta Discussion): keep any
        # notes topic with a blue post after the beta closed (beta maintenance posts stay out).
        closed = config.KEY_DATES["beta_closed"]
        topics = [t for t in topics if not t.get("beta") or (t["kind"] == "patch" and (t.get("last") or "") >= closed)]
    # the same blue post goes up on the US and EU forums: show it once, newest activity first
    topics = sorted(forums.dedupe_regions(topics, "first", window_h=6), key=lambda t: t.get("last") or "", reverse=True)
    _write(config.WEB_DATA / "news.json", {"generated": ribbit.now_iso(), "topics": topics[:120]})
    return {"topics": topics}


def update_notes(topics: list[dict], ds: dict | None = None) -> bool:
    """Blizzard's latest class notes checked against the latest client build. True if changed."""
    from . import notes
    idx = _read(config.WEB_DATA / "index.json", {}) or {}
    latest = idx.get("latest")
    if ds is None and latest:
        ds = _read(config.WEB_DATA / "talents" / str(latest) / "en.json")
    if not ds:
        log.warning("notes: no talent data for %s", latest)
        return False
    try:
        new = notes.update(ds, topics)
    except Exception as e:  # noqa: BLE001 - notes are optional; never fail the run for them
        log.warning("notes: %s", e)
        return False
    if not new:
        return False
    path = config.WEB_DATA / "notes.json"
    old = _read(path, {}) or {}
    strip = lambda d: {k: v for k, v in d.items() if k != "generated"}
    if strip(old) == strip(new):
        return False
    _write(path, new)
    return True


def update_errors(budget_s: float | None = None) -> None:
    _write(config.WEB_DATA / "errors.json",
           errors.build_errors(previous=_read(config.WEB_DATA / "errors.json"), budget_s=budget_s))


def update_status(builds: list[dict], topics: list[dict]) -> None:
    st = status.build_status(builds, forums.maintenance_windows(topics))
    _write(config.WEB_DATA / "status.json", st)


def main(argv=None) -> None:
    ap = argparse.ArgumentParser(prog="collector")
    ap.add_argument("cmd", choices=["update", "news", "talents", "errors", "watch", "scheduled", "archive-beta", "notes"])
    ap.add_argument("--state", help="scheduled: dir with the artifact's currently published data files")
    ap.add_argument("build", nargs="?")
    ap.add_argument("--interval", type=int, default=300)
    ap.add_argument("-v", action="store_true")
    a = ap.parse_args(argv)
    logging.basicConfig(level=logging.DEBUG if a.v else logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

    if a.cmd == "talents":
        for lang in config.LOCALES:
            _write(config.WEB_DATA / "talents" / a.build / f"{lang}.json", talents.build_dataset(a.build, lang))
        return
    if a.cmd == "news":
        n = update_news()
        update_status(_read(config.WEB_DATA / "status.json", {}).get("builds", []), n["topics"])
        return
    if a.cmd == "notes":
        print("changed" if update_notes(update_news()["topics"]) else "unchanged")
        return
    if a.cmd == "archive-beta":
        arch = archive.build_beta_archive(_read(config.WEB_DATA / "index.json", {}) or {},
                                          config.WEB_DATA / "diffs", ribbit.history())
        _write(config.WEB_DATA / config.ARCHIVE_BETA, arch)
        print(json.dumps({"final": arch["final"], **arch["stats"]}, ensure_ascii=False))
        return
    if a.cmd == "scheduled":
        from .scheduled import run
        m = run(Path(a.state or "state"))
        print("MANIFEST", config.WEB_DATA / "manifest.json")
        print(json.dumps({k: m[k] for k in ("publish", "latest", "server", "notes")}, ensure_ascii=False))
        return
    if a.cmd == "errors":
        update_errors()
        return
    if a.cmd == "update":
        builds = known_builds()
        update_talents(builds)
        n = update_news()
        update_status(builds, n["topics"])
        update_notes(n["topics"])
        update_errors()
        return
    # watch
    last_builds = last_errors = 0.0
    builds: list[dict] = []
    while True:
        try:
            if time.time() - last_builds > 900:
                builds = known_builds()
                update_talents(builds)
                last_builds = time.time()
            n = update_news()
            update_status(builds, n["topics"])
            if time.time() - last_errors > 1800:  # forum search is rate-limited; every 30 min
                update_errors()
                last_errors = time.time()
        except Exception:  # noqa: BLE001
            log.exception("cycle failed")
        time.sleep(a.interval)


if __name__ == "__main__":
    main()
