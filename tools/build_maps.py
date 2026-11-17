"""Build the hub's world maps from the WoW: Forever client files (via wago.tools).

Every map is drawn as the game draws it with the whole zone explored: the base art (UiMapArtTile) and
every explored-area overlay (WorldMapOverlay + WorldMapOverlayTile) on top. Out come
frontend/public/maps/<uiMapId>.webp and frontend/src/lib/maps.json with each map's names, parent, and
where it sits on its continent (so a point given in zone coordinates can be shown on the continent).

    python tools/build_maps.py [--build 1.60.1.70938] [--jobs 6]

Run by hand when Blizzard changes the maps; the result is committed. Downloads are cached in
$FH_MAP_CACHE (default /tmp/fh-maps), so a second run only redraws.
"""

from __future__ import annotations

import argparse
import csv
import io
import json
import os
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import requests
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
OUT_IMG = ROOT / "frontend" / "public" / "maps"
OUT_JSON = ROOT / "frontend" / "src" / "lib" / "maps.json"
CACHE = Path(os.environ.get("FH_MAP_CACHE", "/tmp/fh-maps"))
DB2 = "https://wago.tools/db2/{t}/csv?build={b}&locale={l}"
CASC = "https://wago.tools/api/casc/{f}?version={b}"
TABLES = ["UiMap", "UiMapArt", "UiMapXMapArt", "UiMapArtTile", "UiMapArtStyleLayer", "WorldMapOverlay",
          "WorldMapOverlayTile", "UiMapAssignment"]
TILE = 256
s = requests.Session()


def get(url: str, path: Path) -> bytes:
    if path.is_file() and path.stat().st_size > 0:
        return path.read_bytes()
    for attempt in range(4):
        r = s.get(url, timeout=120)
        if r.status_code == 200 and r.content:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(r.content)
            return r.content
        time.sleep(2 * (attempt + 1))
    raise RuntimeError(f"{url}: HTTP {r.status_code}")


def table(name: str, build: str, locale: str = "enUS") -> list[dict]:
    text = get(DB2.format(t=name, b=build, l=locale), CACHE / build / "db2" / f"{name}.{locale}.csv").decode("utf-8")
    return list(csv.DictReader(io.StringIO(text)))


def blp(fdid: str, build: str) -> Image.Image:
    data = get(CASC.format(f=fdid, b=build), CACHE / build / "blp" / f"{fdid}.blp")
    return Image.open(io.BytesIO(data)).convert("RGBA")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--build", default="1.60.1.70938")
    ap.add_argument("--jobs", type=int, default=6)
    a = ap.parse_args()
    b = a.build
    t = {n: table(n, b) for n in TABLES}
    ru = {r["ID"]: r["Name_lang"] for r in table("UiMap", b, "ruRU")}
    maps = {r["ID"]: r for r in t["UiMap"]}
    art_of = {r["UiMapID"]: r["UiMapArtID"] for r in t["UiMapXMapArt"] if r["PhaseID"] == "0"}
    style_of = {r["ID"]: r["UiMapArtStyleID"] for r in t["UiMapArt"]}
    layer = {r["UiMapArtStyleID"]: r for r in t["UiMapArtStyleLayer"] if r["LayerIndex"] == "0"}
    base_tiles: dict[str, list[dict]] = {}
    for r in t["UiMapArtTile"]:
        if r["LayerIndex"] == "0":
            base_tiles.setdefault(r["UiMapArtID"], []).append(r)
    overlays: dict[str, list[dict]] = {}
    for r in t["WorldMapOverlay"]:
        overlays.setdefault(r["UiMapArtID"], []).append(r)
    ov_tiles: dict[str, list[dict]] = {}
    for r in t["WorldMapOverlayTile"]:
        if r["LayerIndex"] == "0":
            ov_tiles.setdefault(r["WorldMapOverlayID"], []).append(r)
    region = {r["UiMapID"]: r for r in t["UiMapAssignment"] if r["OrderIndex"] == "0" and r["UiMin_0"] == "0"
              and r["UiMax_0"] == "1"}

    # the maps worth drawing: the world, continents, zones, cities, battlegrounds; one art style (1002×668)
    wanted = [m for m, r in maps.items() if r["Type"] in ("1", "2", "3", "6") and m in art_of
              and style_of.get(art_of[m]) == "1"]
    files = set()
    for m in wanted:
        art = art_of[m]
        files.update(x["FileDataID"] for x in base_tiles.get(art, []))
        for o in overlays.get(art, []):
            files.update(x["FileDataID"] for x in ov_tiles.get(o["ID"], []))
    print(f"{len(wanted)} maps, {len(files)} textures")
    with ThreadPoolExecutor(a.jobs) as ex:
        list(ex.map(lambda f: get(CASC.format(f=f, b=b), CACHE / b / "blp" / f"{f}.blp"), sorted(files)))

    OUT_IMG.mkdir(parents=True, exist_ok=True)
    meta = []
    for m in sorted(wanted, key=int):
        art = art_of[m]
        ly = layer[style_of[art]]
        w, h = int(ly["LayerWidth"]), int(ly["LayerHeight"])
        canvas = Image.new("RGBA", (((w + TILE - 1) // TILE) * TILE, ((h + TILE - 1) // TILE) * TILE))
        for x in base_tiles.get(art, []):
            canvas.alpha_composite(blp(x["FileDataID"], b), (int(x["ColIndex"]) * TILE, int(x["RowIndex"]) * TILE))
        for o in overlays.get(art, []):
            ox, oy = int(o["OffsetX"]), int(o["OffsetY"])
            for x in ov_tiles.get(o["ID"], []):
                im = blp(x["FileDataID"], b)
                canvas.alpha_composite(im, (ox + int(x["ColIndex"]) * TILE, oy + int(x["RowIndex"]) * TILE))
        canvas.crop((0, 0, w, h)).convert("RGB").save(OUT_IMG / f"{m}.webp", quality=82, method=6)
        r = maps[m]
        entry = {"id": int(m), "name": {"en": r["Name_lang"], "ru": ru.get(m) or r["Name_lang"]},
                 "parent": int(r["ParentUiMapID"]), "type": int(r["Type"]), "w": w, "h": h}
        # where the zone lies on its continent: continent = offset + zone × scale, per axis (0..1)
        z, c = region.get(m), region.get(r["ParentUiMapID"])
        if z and c and z["MapID"] == c["MapID"] and r["Type"] in ("3", "6"):
            zx0, zy0, zx1, zy1 = (float(z[k]) for k in ("Region_0", "Region_1", "Region_3", "Region_4"))
            cx0, cy0, cx1, cy1 = (float(c[k]) for k in ("Region_0", "Region_1", "Region_3", "Region_4"))
            # ui x runs east (world y falls), ui y runs south (world x falls)
            entry["onParent"] = {
                "x": round((cy1 - zy1) / (cy1 - cy0), 5), "y": round((cx1 - zx1) / (cx1 - cx0), 5),
                "sx": round((zy1 - zy0) / (cy1 - cy0), 5), "sy": round((zx1 - zx0) / (cx1 - cx0), 5),
            }
        meta.append(entry)
        print("drew", m, r["Name_lang"])
    OUT_JSON.write_text(json.dumps({"build": b, "maps": meta}, ensure_ascii=False, indent=1), "utf-8")
    print("wrote", OUT_JSON)


if __name__ == "__main__":
    main()
