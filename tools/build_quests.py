"""Which quests reward which items, from Blizzard's own Forever data: every quest of the client (QuestV2) asked
once from the quest API (static-forever namespace), and its item rewards (given and to choose from) kept.

    FH_BNET_CLIENT_ID=… FH_BNET_CLIENT_SECRET=… python tools/build_quests.py [--build 1.60.1.70938] [--rate 6]

Out comes backend/app/data/quest_rewards.json: item id -> quests (id, title in English and Russian, level, area).
Answers are cached in $FH_QUEST_CACHE (default /tmp/fh-quests), so an interrupted run picks up where it stopped.
Who gives the quest, where, and the chain around it come from ForeverDB at run time (app/routers/fdb.py).
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
OUT = ROOT / "backend" / "app" / "data" / "quest_rewards.json"
CACHE = Path(os.environ.get("FH_QUEST_CACHE", "/tmp/fh-quests"))
API = "https://eu.api.blizzard.com/data/wow/quest/{i}?namespace=static-forever-eu"


def quest_ids(build: str) -> list[int]:
    p = CACHE / f"QuestV2.{build}.csv"
    if not p.is_file():
        r = httpx.get(f"https://wago.tools/db2/QuestV2/csv?build={build}", timeout=120)
        r.raise_for_status()
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(r.text)
    return sorted(int(r["ID"]) for r in csv.DictReader(io.StringIO(p.read_text())))


def reward_items(rw: dict) -> list[int]:
    """Every item id under a quest's rewards (given items, items to choose from), whatever the nesting."""
    out = []

    def walk(x):
        if isinstance(x, dict):
            it = x.get("item")
            if isinstance(it, dict) and isinstance(it.get("id"), int):
                out.append(it["id"])
            for v in x.values():
                walk(v)
        elif isinstance(x, list):
            for v in x:
                walk(v)
    walk(rw or {})
    return list(dict.fromkeys(out))


async def main_async(ids: list[int], rate: float) -> dict:
    (CACHE / "api").mkdir(parents=True, exist_ok=True)
    got = {}
    async with httpx.AsyncClient(timeout=30) as http:
        r = await http.post("https://oauth.battle.net/token", data={"grant_type": "client_credentials"},
                            auth=(os.environ.get("FH_BNET_CLIENT_ID", "x"), os.environ.get("FH_BNET_CLIENT_SECRET", "y")))
        tok = r.json()["access_token"]
        for n, i in enumerate(ids):
            p = CACHE / "api" / f"{i}.json"
            if p.is_file():
                got[i] = json.loads(p.read_text())
                continue
            t0 = time.monotonic()
            d = None
            for attempt in range(4):
                try:
                    r = await http.get(API.format(i=i), headers={"Authorization": f"Bearer {tok}"})
                except httpx.HTTPError:
                    await asyncio.sleep(3 * (attempt + 1))
                    continue
                if r.status_code in (429, 500, 502, 503, 504):
                    await asyncio.sleep(2 * (attempt + 1))
                    continue
                if r.status_code == 200:
                    x = r.json()
                    d = {"title": x.get("title"), "level": (x.get("requirements") or {}).get("min_character_level"),
                         "area": (x.get("area") or {}).get("name"), "items": reward_items(x.get("rewards"))}
                if r.status_code in (200, 404):
                    p.write_text(json.dumps(d))
                break
            got[i] = d
            if n % 300 == 0:
                print(f"{n}/{len(ids)}", flush=True)
            await asyncio.sleep(max(0.0, 1 / rate - (time.monotonic() - t0)))
    return got


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--build", default="1.60.1.70938")
    ap.add_argument("--rate", type=float, default=6)
    a = ap.parse_args()
    got = asyncio.run(main_async(quest_ids(a.build), a.rate))
    by_item: dict[str, list] = {}
    for qid, d in got.items():
        if not d:
            continue
        title = d.get("title") or {}
        area = d.get("area") or {}
        for it in d["items"]:
            by_item.setdefault(str(it), []).append({
                "id": qid, "en": title.get("en_US") if isinstance(title, dict) else title,
                "ru": title.get("ru_RU") if isinstance(title, dict) else None,
                "area": area.get("ru_RU") if isinstance(area, dict) else area,
                "areaEn": area.get("en_US") if isinstance(area, dict) else area, "level": d.get("level"),
            })
    OUT.write_text(json.dumps({"build": a.build, "items": by_item}, ensure_ascii=False, separators=(",", ":")), "utf-8")
    print("wrote", OUT, len(by_item), "items")


if __name__ == "__main__":
    main()
