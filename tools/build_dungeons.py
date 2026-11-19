"""Forever's dungeons and raids as a file the hub ships (backend/app/data/dungeons.json), so the characters'
dungeon tab never depends on a live answer:

- the list, level ranges ("13–18", as the game's group finder gives them), bosses and notable loot: ForeverDB
  (https://foreverdb.net, credited on the page) — the game files carry only a single minimum level;
- names in Russian and the dungeons Forever's files hold but ForeverDB doesn't list yet: the client's
  LFGDungeons table (wago.tools), with its minimum level from ContentTuning.

    python tools/build_dungeons.py [--build 1.60.1.70938]

ForeverDB's key goes in the X-API-Key header (FH_FOREVERDB_KEY). The server refreshes the ForeverDB half on its
own (app/instances.py); this file is the floor it stands on.
"""

from __future__ import annotations

import argparse
import csv
import io
import json
import os
import re
import time
from pathlib import Path

import sys

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "backend"))
from app.item_sources import INSTANCES  # noqa: E402  the hub's names of the original instances

OUT = Path(__file__).resolve().parent.parent / "backend" / "app" / "data" / "dungeons.json"
FDB = "https://foreverdb.net/api/v1"
# the client's names that differ from ForeverDB's
ALIAS = {"stormwind stockades": "stormwind stockade", "zulfarak": "zulfarrak", "hall of thanes": "the hall of thanes",
         "onyxia": "onyxias lair", "lower blackrock spire": "blackrock spire", "dire maul  east": "dire maul",
         # parts of one instance in ForeverDB's list
         "dire maul  west": "dire maul", "dire maul  north": "dire maul", "upper blackrock spire": "blackrock spire"}
SKIP_TYPES = {"4", "5"}  # zones and battlegrounds in the group finder's table


def norm(s: str) -> str:
    return re.sub(r"[^a-z0-9 ]", "", (s or "").lower()).strip()


def fdb(path: str, http: httpx.Client) -> dict:
    for attempt in range(5):
        r = http.get(f"{FDB}/{path}")
        if r.status_code == 429:
            time.sleep(10 * (attempt + 1))
            continue
        r.raise_for_status()
        time.sleep(2.5)  # well under the per-minute share
        return r.json()
    raise RuntimeError(path)


def wago(table: str, build: str, locale: str | None = None) -> list[dict]:
    q = f"https://wago.tools/db2/{table}/csv?build={build}" + (f"&locale={locale}" if locale else "")
    return list(csv.DictReader(io.StringIO(httpx.get(q, timeout=120).text)))


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--build", default="1.60.1.70938")
    a = ap.parse_args()
    http = httpx.Client(timeout=60, headers={"X-API-Key": os.environ.get("FH_FOREVERDB_KEY", "x"),
                                             "User-Agent": "ForeverHub/0.3 (+https://wow-forever-hub-production.up.railway.app)"})
    listed, offset = [], 0
    while True:
        page = fdb(f"dungeons?limit=100&offset={offset}", http)
        listed += page["data"]
        if not page["meta"].get("next"):
            break
        offset += 100
    ct = {r["ID"]: r for r in wago("ContentTuning", a.build)}
    en = [r for r in wago("LFGDungeons", a.build, "enUS") if r["TypeID"] not in SKIP_TYPES and r["Subtype"] not in SKIP_TYPES]
    ru = {r["ID"]: r["Name_lang"] for r in wago("LFGDungeons", a.build, "ruRU")}
    client = {}
    for r in en:
        k = norm(r["Name_lang"])
        k = ALIAS.get(k, k)
        if k in client:
            continue
        client[k] = {"en": r["Name_lang"], "ru": ru.get(r["ID"]) or r["Name_lang"],
                                   "min": int((ct.get(r["ContentTuningID"]) or {}).get("MinLevelSquish") or 0) or None}
    out, used = [], set()
    for x in listed:
        if x.get("status") == "other":  # maps from other games' files, never playable here
            continue
        d = fdb(f"dungeons/{x['id']}", http)["data"]
        c = client.get(norm(d["name"])) or {}
        used.add(norm(d["name"]))
        ru_name = INSTANCES[d["id"]][1] if d["id"] in INSTANCES else c.get("ru") or d["name"]
        out.append({"id": d["id"], "en": d["name"], "ru": ru_name, "kind": d["kind"],
                    "players": d.get("players"), "levels": d.get("levelRange") or ([c["min"], c["min"]] if c.get("min") else None),
                    "new": bool(d.get("newInForever")), "open": bool(d.get("announced")), "bosses": d.get("bosses") or [],
                    "notableLoot": d.get("notableLoot") or [], "url": d.get("url")})
    for k, c in client.items():  # in Forever's files but not in ForeverDB's list
        if k not in used:
            out.append({"id": None, "en": c["en"], "ru": c["ru"], "kind": "dungeon", "players": 5,
                        "levels": [c["min"], c["min"]] if c.get("min") else None, "new": True, "open": False,
                        "bosses": [], "notableLoot": [], "url": None})
    OUT.write_text(json.dumps({"source": "ForeverDB.net (https://foreverdb.net) and the game's files", "build": a.build,
                               "at": time.strftime("%Y-%m-%d"), "dungeons": out}, ensure_ascii=False, indent=1), "utf-8")
    print("wrote", OUT, len(out))


if __name__ == "__main__":
    main()
