"""One unattended run for the scheduled task (fresh session, no local history).

Input: a state dir with the files currently published in the artifact
(data/index.json, status.json, news.json, errors.json, optionally
talents/<latest>/{en,ru}.json). Output: web/data/... plus manifest.json that
tells the caller what to write to the artifact database (live status, every
run) and which files to republish (only on a new game build or every ~12 h).

    python -m collector scheduled --state DIR
"""
from __future__ import annotations

import json
import logging
import shutil
from datetime import datetime, timezone
from pathlib import Path

from . import abilities, archive, config, diff, icons, ribbit, talents
from .__main__ import _read, _write, known_builds, update_errors, update_news, update_notes, update_status

log = logging.getLogger("collector.scheduled")
STATIC_EVERY_H = 11.5   # republish static JSON (for viewers without live data) about twice a day
ERRORS_BUDGET_S = 35    # forum search is rate-limited: refresh error codes a few per run
KEEP_BUILDS = 10


def _age_h(iso: str | None) -> float:
    if not iso:
        return 1e9
    t = datetime.fromisoformat(iso.replace("Z", "+00:00"))
    return (datetime.now(timezone.utc) - t).total_seconds() / 3600


def _ver_build(v: str) -> int:
    return int(v.rsplit(".", 1)[1])


def run(state: Path) -> dict:
    data = config.WEB_DATA
    data.mkdir(parents=True, exist_ok=True)
    for name in ("index.json", "status.json", "news.json", "errors.json", "icons.json", "notes.json"):
        if (state / name).exists():
            shutil.copy(state / name, data / name)
    index = _read(data / "index.json", {}) or {}
    prev_latest = index.get("latest")
    files: dict[str, str | None] = {}
    notes: list[str] = []

    phase = config.phase()
    # ---- 1. new game builds -> talents, diffs, icons
    builds = known_builds()
    if phase != "beta":  # the beta is archived: only the live client feeds the calculator
        builds_live = [b for b in builds if b.get("product") in config.LIVE_PRODUCTS]
    else:
        builds_live = builds
    new = [b for b in builds_live if not prev_latest or b["build"] > _ver_build(prev_latest)]
    built: list[dict] = []
    if new:
        icon_map = talents.icon_names()
        prev: dict[str, dict] = {}
        if prev_latest:
            for lang in config.LOCALES:
                p = state / "talents" / prev_latest / f"{lang}.json"
                prev[lang] = _read(p) if p.exists() else talents.build_dataset(prev_latest, lang, icon_map)
            talents.add_fingerprints(prev)
        for b in new:
            try:
                ds = {lang: talents.build_dataset(b["version"], lang, icon_map) for lang in config.LOCALES}
            except Exception as e:  # noqa: BLE001 - wago.tools may not have exported the new build yet
                notes.append(f"build {b['version']}: talent data not available yet ({e}); retry next run")
                break
            talents.add_fingerprints(ds)
            entry = {**b, "talents": True}
            for lang, d in ds.items():
                _write(data / "talents" / b["version"] / f"{lang}.json", d)
                if prev:
                    changes = diff.diff_talents(prev[lang], d)
                    _write(data / "diffs" / f"{b['version']}.{lang}.json",
                           {"from": prev[lang]["build"], "to": b["version"], "changes": changes})
                    files[f"data/diffs/{b['version']}.{lang}.json"] = f"web/data/diffs/{b['version']}.{lang}.json"
                    entry.setdefault("changesByLang", {})[lang] = len(changes)
                    entry["changes"], entry["from"] = entry["changesByLang"].get("en", len(changes)), prev[lang]["build"]
            prev = ds
            built.append(entry)
            notes.append(f"new build {b['version']}: {entry.get('changes', 0)} talent changes")
        if built:
            latest = built[-1]["version"]
            # trainer abilities by level for the leveling plan (optional: never block a talent update)
            built_ab: dict[str, dict] = {}
            for lang, loc in config.LOCALES.items():
                try:
                    built_ab[lang] = abilities.build_abilities(latest, lang, loc, prev[lang], icon_map)
                except Exception as e:  # noqa: BLE001
                    notes.append(f"abilities {latest}/{lang}: {e}")
            # class masks over-match (Holy Precision on Shadow spells): drop links whose schools contradict
            if "en" in prev:
                abilities.prune_school_conflicts(built_ab, prev["en"])
            for lang, ab in built_ab.items():
                _write(data / "abilities" / latest / f"{lang}.json", ab)
                files[f"data/abilities/{latest}/{lang}.json"] = f"web/data/abilities/{latest}/{lang}.json"
                if prev_latest and prev_latest != latest:
                    files[f"data/abilities/{prev_latest}/{lang}.json"] = None
            abil = list(built_ab.values())
            names = sorted(set(icons.collect_names(list(prev.values()))) | abilities.icon_names_of(abil))
            icons.build_sprite(names, data)
            index["builds"] = (index.get("builds", []) + built)[-KEEP_BUILDS:]
            index["latest"] = latest
            index["generated"] = ribbit.now_iso()
            for lang in config.LOCALES:
                files[f"data/talents/{latest}/{lang}.json"] = f"web/data/talents/{latest}/{lang}.json"
                if prev_latest and prev_latest != latest:
                    files[f"data/talents/{prev_latest}/{lang}.json"] = None  # page only loads the latest
            files["data/icons.jpg"] = "web/data/icons.jpg"
            for rel in icons.build_tree_art(list(prev.values()), data):
                files["data/" + rel] = "web/data/" + rel
            files["data/icons.json"] = "web/data/icons.json"

    index["phase"] = phase
    index["archive"] = config.ARCHIVE_BETA

    # ---- 1b. beta archive: record any late beta-product build (only if the archive came with the state)
    arch_state = state / config.ARCHIVE_BETA
    if phase != "beta" and arch_state.exists():
        arch = _read(arch_state, {}) or {}
        if arch and archive.record_beta_builds(arch, builds):
            _write(data / config.ARCHIVE_BETA, arch)
            files["data/" + config.ARCHIVE_BETA] = "web/data/" + config.ARCHIVE_BETA
            notes.append("beta archive: late beta build recorded")

    # ---- 2. news + status every run, error codes a few per run
    topics = update_news()["topics"]
    update_status(builds_live, topics)
    # Blizzard's class notes, re-checked against the client (status flips when a build lands)
    latest_now = index.get("latest")
    ds_en = (_read(data / "talents" / str(latest_now) / "en.json") or _read(state / "talents" / str(latest_now) / "en.json")) if latest_now else None
    notes_changed = update_notes(topics, ds_en)
    if notes_changed:
        files["data/notes.json"] = "web/data/notes.json"
        notes.append("class notes updated")
    # A few error codes per run (oldest first) within a small time budget, so the
    # whole run stays well under the 2-minute default command timeout.
    update_errors(budget_s=ERRORS_BUDGET_S if not built else 10)

    # ---- 3. live docs for the artifact database (page updates without a republish)
    db = {}
    for name in ("status", "news", "errors"):
        text = (data / f"{name}.json").read_text(encoding="utf-8")
        doc = data / "db" / f"{name}.json"
        _write(doc, {"json": text, "generated": json.loads(text).get("generated")})
        db[name] = str(doc)

    # ---- 4. decide on a republish
    publish = bool(built) or notes_changed or _age_h(index.get("staticPublished")) > STATIC_EVERY_H
    if publish:
        index["staticPublished"] = ribbit.now_iso()
        for name in ("status", "news", "errors"):
            files[f"data/{name}.json"] = f"web/data/{name}.json"
        files["data/index.json"] = "web/data/index.json"
    _write(data / "index.json", index)

    st = _read(data / "status.json", {})
    m0 = (st.get("maintenance") or [{}])[0]
    manifest = {
        "db": db,
        "publish": publish,
        "files": files,
        "latest": index.get("latest"),
        "server": {"build": (next(iter(st.get("regions", {}).values()), {}) or {}).get("version"),
                   "lastMaintenance": m0.get("title"), "crowdReports": len((st.get("crowd") or {}).get("topics", []))},
        "notes": notes,
    }
    _write(data / "manifest.json", manifest)
    return manifest
