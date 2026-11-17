"""Build the seamless world map (the /map page's "world" view) as Leaflet tiles.

The picture is drawn by OpenMap's offline renderer (github.com/openmap-world/openmap, MIT;
tools/map-preview/render.py), which stitches every continent and zone of Azeroth's map from the client
files the way the OpenMap addon draws it in game. It is rendered in 12 chunks at zoom 4 (8192×5461 px for the
whole world), stitched, and cut into 256 px tiles for zoom levels 0..4:

    frontend/public/omap/{z}/{x}_{y}.webp

    python tools/build_omap.py --openmap ../openmap-world/openmap --db2 <db2 dir> --cache <texture cache> \
        --work /tmp/omap

Run by hand when the maps change; the tiles are committed. The DB2 dir holds the client tables render.py
reads (UiMap, UiMapArt, UiMapAssignment...) and the cache holds the textures it fetches.
"""

from __future__ import annotations

import argparse
import os
import subprocess
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "frontend" / "public" / "omap"
CHUNK, COLS, ROWS, ZOOM = 2048, 4, 3, 4
PX = min(CHUNK / 1002, CHUNK / 668) * ZOOM  # pixels per map unit at zoom 4 (Azeroth's map is 1002×668 units)
W, H = round(1002 * PX), round(668 * PX)  # 8192 × 5461
TILE, LEVELS = 256, 5


def render(a: argparse.Namespace, work: Path) -> None:
    for i in range(COLS):
        for j in range(ROWS):
            out = work / f"c{i}_{j}.png"
            if out.is_file():
                continue
            u = (i * CHUNK + CHUNK / 2) / PX / 1002
            v = (j * CHUNK + CHUNK / 2) / PX / 668
            tmp = work / "tmp"
            tmp.mkdir(exist_ok=True)
            subprocess.run(["python3", "-P", str(Path(a.openmap) / "tools/map-preview/render.py"), a.db2, a.cache,
                            str(tmp), f"c{i}_{j}={u:.6f},{v:.6f},{ZOOM}"], check=True,
                           env={**os.environ, "OPENMAP_SIZE": f"{CHUNK}x{CHUNK}"})
            (tmp / f"c{i}_{j}.png").rename(out)
            print("rendered", out.name)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--openmap", required=True)
    ap.add_argument("--db2", required=True)
    ap.add_argument("--cache", required=True)
    ap.add_argument("--work", default="/tmp/omap")
    a = ap.parse_args()
    work = Path(a.work)
    work.mkdir(parents=True, exist_ok=True)
    render(a, work)
    world = Image.new("RGB", (COLS * CHUNK, ROWS * CHUNK))
    for i in range(COLS):
        for j in range(ROWS):
            world.paste(Image.open(work / f"c{i}_{j}.png").convert("RGB"), (i * CHUNK, j * CHUNK))
    world = world.crop((0, 0, W, H))
    for z in range(LEVELS):
        f = 2 ** (LEVELS - 1 - z)
        im = world if f == 1 else world.resize((round(W / f), round(H / f)), Image.LANCZOS)
        d = OUT / str(z)
        d.mkdir(parents=True, exist_ok=True)
        for x in range((im.width + TILE - 1) // TILE):
            for y in range((im.height + TILE - 1) // TILE):
                t = im.crop((x * TILE, y * TILE, min(im.width, (x + 1) * TILE), min(im.height, (y + 1) * TILE)))
                if t.size != (TILE, TILE):  # an edge tile: keep it 256 px, transparent past the world's edge
                    pad = Image.new("RGBA", (TILE, TILE))
                    pad.paste(t, (0, 0))
                    t = pad
                t.save(d / f"{x}_{y}.webp", quality=78, method=6)
        print("level", z, im.size)


if __name__ == "__main__":
    main()
