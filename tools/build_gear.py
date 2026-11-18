"""Build the gear reference behind the BiS mode: every wearable item of WoW: Forever with its real stats.

Candidates come from the client's item tables (wago.tools: ItemSparse, Item): everything wearable of
uncommon quality or better. Their stats are then read from Blizzard's own item API (Forever's static
namespace), which gives the numbers the game shows: Forever recomputes items from stat shares, and the API
answers with the result. An item the API does not know is not in the game and is left out.

    FH_BNET_CLIENT_ID=… FH_BNET_CLIENT_SECRET=… python tools/build_gear.py [--build 1.60.1.70938] [--rate 5]

Out comes backend/app/data/gear.json. Run by hand when Forever changes items; the file is committed. Answers
are cached in $FH_GEAR_CACHE (default /tmp/fh-gear), so an interrupted run picks up where it stopped. Be
gentle: a few requests a second (Blizzard allows far more, but nothing here is urgent).
"""

from __future__ import annotations

import argparse
import asyncio
import csv
import io
import json
import os
import time
from pathlib import Path

import httpx

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "backend" / "app" / "data" / "gear.json"
CACHE = Path(os.environ.get("FH_GEAR_CACHE", "/tmp/fh-gear"))
DB2 = "https://wago.tools/db2/{t}/csv?build={b}&locale={l}"
API = "https://eu.api.blizzard.com/data/wow/item/{i}?namespace=static-forever-eu&locale=en_US"
SKIP_TYPES = {0, 18, 24, 27, 28}  # not worn: nothing, bags, ammo, quivers, profession tools
JUNK = ("Test", "TEST", "Deprecated", "Monster -", "[PH]", "OLD", "QA ", "zz")


def table(http: httpx.Client, name: str, build: str, locale: str = "enUS") -> list[dict]:
    p = CACHE / build / f"{name}.{locale}.csv"
    if not p.is_file():
        r = http.get(DB2.format(t=name, b=build, l=locale), timeout=180)
        r.raise_for_status()
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(r.text, "utf-8")
    return list(csv.DictReader(io.StringIO(p.read_text("utf-8"))))


def candidates(http: httpx.Client, build: str) -> dict[int, dict]:
    ru = {r["ID"]: r["Display_lang"] for r in table(http, "ItemSparse", build, "ruRU")}
    kind = {r["ID"]: (int(r["ClassID"]), int(r["SubclassID"])) for r in table(http, "Item", build)}
    out = {}
    for r in table(http, "ItemSparse", build):
        it, q = int(r["InventoryType"]), int(r["OverallQualityID"])
        if it in SKIP_TYPES or not 2 <= q <= 5 or any(w in r["Display_lang"] for w in JUNK):
            continue
        cls, sub = kind.get(r["ID"], (0, 0))
        out[int(r["ID"])] = {
            "en": r["Display_lang"], "ru": ru.get(r["ID"]) or r["Display_lang"], "q": q, "ilvl": int(r["ItemLevel"]),
            "req": int(r["RequiredLevel"]), "slot": it, "cls": cls, "sub": sub,
            "classes": int(r["AllowableClass"]), "set": int(r["ItemSet"]), "bind": int(r["Bonding"]),
            "races": int(r["AllowableRace_0"]), "pvp": int(r["RequiredPVPRank"]), "rep": int(r["MinFactionID"]),
            "skill": int(r["RequiredSkill"]), "flags": int(r["Flags_0"]),
        }
    return out


async def token(http: httpx.AsyncClient) -> str:
    r = await http.post("https://oauth.battle.net/token", data={"grant_type": "client_credentials"},
                        auth=(os.environ.get("FH_BNET_CLIENT_ID", "x"), os.environ.get("FH_BNET_CLIENT_SECRET", "y")))
    r.raise_for_status()
    return r.json()["access_token"]


def reduce(d: dict) -> dict:
    """The parts of an API answer the BiS mode uses."""
    p = d.get("preview_item") or {}
    w = p.get("weapon") or {}
    return {
        "stats": {s["type"]["type"]: s["value"] for s in p.get("stats") or [] if s.get("type") and not s.get("is_negated")},
        "armor": (p.get("armor") or {}).get("value"),
        "dps": (w.get("dps") or {}).get("value"),
        "speed": (w.get("attack_speed") or {}).get("value"),
        "spells": [s.get("description") for s in p.get("spells") or [] if s.get("description")],
        "unique": bool(p.get("unique_equipped")),
    }


async def fetch(ids: list[int], rate: float) -> dict[int, dict | None]:
    (CACHE / "api").mkdir(parents=True, exist_ok=True)
    got: dict[int, dict | None] = {}
    todo = []
    for i in ids:
        p = CACHE / "api" / f"{i}.json"
        if p.is_file():
            got[i] = json.loads(p.read_text())
        else:
            todo.append(i)
    print(f"{len(got)} cached, {len(todo)} to ask", flush=True)
    async with httpx.AsyncClient(timeout=30) as http:
        tok = await token(http)
        for n, i in enumerate(todo):
            t0 = time.monotonic()
            for attempt in range(4):
                try:
                    r = await http.get(API.format(i=i), headers={"Authorization": f"Bearer {tok}"})
                except httpx.HTTPError:  # a dropped connection: wait and ask again
                    await asyncio.sleep(3 * (attempt + 1))
                    continue
                if r.status_code == 401:
                    tok = await token(http)
                    continue
                if r.status_code in (429, 500, 502, 503, 504):
                    await asyncio.sleep(2 * (attempt + 1))
                    continue
                break
            else:
                continue  # never answered: left for the next run
            val = reduce(r.json()) if r.status_code == 200 else None
            if r.status_code in (200, 404):  # a 404 is an answer too: not in Forever
                (CACHE / "api" / f"{i}.json").write_text(json.dumps(val))
            got[i] = val
            if n % 200 == 0:
                print(f"{n}/{len(todo)}", flush=True)
            await asyncio.sleep(max(0.0, 1 / rate - (time.monotonic() - t0)))
    return got


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--build", default="1.60.1.70938")
    ap.add_argument("--rate", type=float, default=5)
    a = ap.parse_args()
    with httpx.Client() as http:
        cand = candidates(http, a.build)
    print(len(cand), "candidates", flush=True)
    api = asyncio.run(fetch(sorted(cand), a.rate))
    items = {}
    for i, c in cand.items():
        x = api.get(i)
        if x is None:
            continue
        items[str(i)] = {**c, **x}
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps({"build": a.build, "items": items}, ensure_ascii=False, separators=(",", ":")), "utf-8")
    print("wrote", OUT, len(items), "items")


if __name__ == "__main__":
    main()
