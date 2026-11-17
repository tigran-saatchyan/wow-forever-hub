"""Build the seamless world map (the /map page) as Leaflet tiles.

The picture is drawn by OpenMap's offline renderer (github.com/openmap-world/openmap, MIT;
tools/map-preview/render.py), which stitches every continent and zone of Azeroth's map from the client
files the way the OpenMap addon draws it in game. What it draws depends on the zoom, as in the game: the
zones' own detail (names, roads, camps) fades in as you come closer. So every level is rendered at the zoom
the game would show at that scale in a ~1000 px window, in 1024 px chunks, not shrunk from one picture:

    level L (1..5): the world is 1024·2^(L-1) px wide, rendered at OpenMap zoom 2^(L-1);
    level 0: level 1 halved.

At levels 4 and 5 the chunks with no zone in them (open sea) are not rendered: they are the level above
enlarged. Out come frontend/public/omap/{z}/{x}_{y}.webp (256 px tiles).

    python tools/build_omap.py --openmap ../openmap-world/openmap --db2 <db2 dir> --cache <texture cache> \
        --work /tmp/omap [--jobs 3]

Run by hand when the maps change; the tiles are committed. The DB2 dir holds the client tables render.py
reads (UiMap, UiMapArt, UiMapAssignment...) and the cache holds the textures it fetches. Chunks already in
--work are kept, so an interrupted run picks up where it stopped.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import subprocess
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "frontend" / "public" / "omap"
MAPS = ROOT / "frontend" / "src" / "lib" / "maps.json"
CHUNK, TILE, TOP = 1024, 256, 5
PX1 = min(CHUNK / 1002, CHUNK / 668)  # px per map unit at OpenMap zoom 1 (Azeroth's map is 1002×668 units)


def size(level: int) -> tuple[int, int]:
    k = 2 ** (level - 1)
    return round(1002 * PX1 * k), round(668 * PX1 * k)


def zones() -> list[tuple[float, float, float, float]]:
    """Where there is land: every zone's rect on the world (0..1), from maps.json."""
    ms = json.loads(MAPS.read_text("utf-8"))["maps"]
    return [tuple(m["onWorld"]) for m in ms if m.get("type") == 3 and m.get("onWorld")]


def chunks(level: int, land: list) -> list[tuple[int, int, bool]]:
    w, h = size(level)
    out = []
    for i in range(math.ceil(w / CHUNK)):
        for j in range(math.ceil(h / CHUNK)):
            u0, u1, v0, v1 = i * CHUNK / w, (i + 1) * CHUNK / w, j * CHUNK / h, (j + 1) * CHUNK / h
            wet = level >= 4 and not any(l < u1 and r > u0 and t < v1 and b > v0 for l, r, t, b in land)
            out.append((i, j, not wet))
    return out


def render(a: argparse.Namespace, work: Path, level: int, i: int, j: int) -> Path:
    out = work / f"L{level}" / f"c{i}_{j}.png"
    if out.is_file():
        return out
    w, h = size(level)
    u, v = (i * CHUNK + CHUNK / 2) / w, (j * CHUNK + CHUNK / 2) / h
    tmp = work / "tmp" / f"L{level}_{i}_{j}"
    tmp.mkdir(parents=True, exist_ok=True)
    subprocess.run(["python3", "-P", str(Path(a.openmap) / "tools/map-preview/render.py"), a.db2, a.cache, str(tmp),
                    f"c={u:.7f},{v:.7f},{2 ** (level - 1)}"], check=True, capture_output=True,
                   env={**os.environ, "OPENMAP_SIZE": f"{CHUNK}x{CHUNK}"})
    out.parent.mkdir(parents=True, exist_ok=True)
    (tmp / "c.png").rename(out)
    print("rendered", out.relative_to(work), flush=True)
    return out


def cut(im: Image.Image, level: int) -> None:
    d = OUT / str(level)
    d.mkdir(parents=True, exist_ok=True)
    for x in range(math.ceil(im.width / TILE)):
        for y in range(math.ceil(im.height / TILE)):
            t = im.crop((x * TILE, y * TILE, min(im.width, (x + 1) * TILE), min(im.height, (y + 1) * TILE)))
            if t.size != (TILE, TILE):  # an edge tile: keep it 256 px, transparent past the world's edge
                pad = Image.new("RGBA", (TILE, TILE))
                pad.paste(t, (0, 0))
                t = pad
            t.save(d / f"{x}_{y}.webp", quality=90, method=6)
    print("level", level, im.size, flush=True)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--openmap", required=True)
    ap.add_argument("--db2", required=True)
    ap.add_argument("--cache", required=True)
    ap.add_argument("--work", default="/tmp/omap")
    ap.add_argument("--jobs", type=int, default=3)
    a = ap.parse_args()
    work = Path(a.work)
    land = zones()
    prev = None
    for level in range(1, TOP + 1):
        todo = chunks(level, land)
        with ThreadPoolExecutor(a.jobs) as ex:
            list(ex.map(lambda c: render(a, work, level, c[0], c[1]), [c for c in todo if c[2]]))
        w, h = size(level)
        im = prev.resize((w, h), Image.LANCZOS) if prev else Image.new("RGB", (w, h))
        for i, j, drawn in todo:
            if drawn:
                im.paste(Image.open(work / f"L{level}" / f"c{i}_{j}.png").convert("RGB"), (i * CHUNK, j * CHUNK))
        if level == 1:
            cut(im.resize((w // 2, h // 2), Image.LANCZOS), 0)
        cut(im, level)
        prev = im


if __name__ == "__main__":
    main()
