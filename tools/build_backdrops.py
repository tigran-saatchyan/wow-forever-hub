"""Backdrops of the throne room, from the WoW: Forever client (wago.tools): one per race, class and specialization,
and the BiS mode's own.

- race: a loading screen of the race's home (the Undead keep the hall's Ruins of Lordaeron);
- class: the class's order hall loading screen (they are all in Forever's client);
- specialization: the art behind its talent tree (four tiles, as the game puts them together);
- BiS: Naxxramas, the Scourge's necropolis.

Loading screens carry a game logo and a frame: only the picture below the logo is kept.

    python tools/build_backdrops.py [--build 1.60.1.70938]

Out come frontend/public/throne/{race,class,spec}/*.webp and bis.webp; run by hand, the result is committed.
"""

from __future__ import annotations

import argparse
import io
import json
import os
import time
from pathlib import Path

import requests
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "frontend" / "public" / "throne"
CACHE = Path(os.environ.get("FH_BG_CACHE", "/tmp/fh-bg"))
CASC = "https://wago.tools/api/casc/{f}?version={b}"
FILES = "https://wago.tools/api/files?search={q}&version={b}"

# loading screens: file id, and the part of the picture to keep (top, bottom as shares of the height)
# (square ones are 4:3 pictures stored square: framed at 17%–83% of the height, the logo reaching down to ~27%)
FRAMED = (0.27, 0.815)
RACES = {1: (1035010, 0.25, 1.0), 2: (236064, *FRAMED), 3: (131824, *FRAMED), 4: (131847, *FRAMED),
         6: (131848, 0.27, 0.9), 7: (131841, *FRAMED), 8: (131886, *FRAMED)}
WIDE = (0.31, 0.82)  # Legion's wide screens: the art band under the logo, above the lower frame
CLASSES = {"WARRIOR": 1454826, "PALADIN": 1454533, "HUNTER": 1379024, "ROGUE": (236059, *FRAMED), "PRIEST": 1412500,
           "SHAMAN": 1405662, "MAGE": 1445353, "WARLOCK": 1394926, "DRUID": 1417745}
BIS = (131854, *FRAMED)
s = requests.Session()


def get(fid: int, build: str) -> Image.Image:
    p = CACHE / build / f"{fid}.blp"
    if not p.is_file():
        for attempt in range(4):
            r = s.get(CASC.format(f=fid, b=build), timeout=120)
            if r.status_code == 200 and r.content[:4] == b"BLP2":
                p.parent.mkdir(parents=True, exist_ok=True)
                p.write_bytes(r.content)
                break
            time.sleep(2 * (attempt + 1))
        else:
            raise RuntimeError(f"file {fid}: not in build {build}")
    return Image.open(io.BytesIO(p.read_bytes())).convert("RGB")


def screen(spec, build: str) -> Image.Image:
    fid, top, bottom = spec if isinstance(spec, tuple) else (spec, *WIDE)
    im = get(fid, build)
    square = im.width == im.height
    im = im.crop((0, int(im.height * top), im.width, int(im.height * bottom)))
    if square:  # a 4:3 picture stored square: give it its height back
        im = im.resize((im.width, round(im.height * 0.75)), Image.LANCZOS)
    if im.width > 1600:
        im = im.resize((1600, round(im.height * 1600 / im.width)), Image.LANCZOS)
    return im


def talent_art(name: str, build: str) -> Image.Image:
    """The four tiles of a talent tree's background (TopLeft 256×256, TopRight 64×256, BottomLeft 256×128,
    BottomRight 64×128): 320×384 together."""
    for attempt in range(5):
        try:
            r = s.get(FILES.format(q=f"interface/talentframe/{name.lower()}-", b=build), timeout=60)
            break
        except requests.RequestException:
            time.sleep(3 * (attempt + 1))
    found = {v.rsplit("-", 1)[-1].removesuffix(".blp"): int(k) for k, v in r.json().items()}
    out = Image.new("RGB", (320, 384))
    for part, xy in (("topleft", (0, 0)), ("topright", (256, 0)), ("bottomleft", (0, 256)), ("bottomright", (256, 256))):
        if part in found:
            tile = get(found[part], build)
            out.paste(tile, xy)
    return out.crop((0, 0, 298, 362))  # the tiles carry padding at the right and bottom


def save(im: Image.Image, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    im.save(path, quality=72, method=6)
    print("wrote", path.relative_to(ROOT), im.size)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--build", default="1.60.1.70938")
    b = ap.parse_args().build
    for race, spec in RACES.items():
        save(screen(spec, b), OUT / "race" / f"{race}.webp")
    for cls, spec in CLASSES.items():
        save(screen(spec, b), OUT / "class" / f"{cls.lower()}.webp")
    save(screen(BIS, b), OUT / "bis.webp")
    talents = sorted(ROOT.glob("data/talents/*/en.json"))[-1]
    for c in json.loads(talents.read_text("utf-8"))["classes"]:
        for tab in c["tabs"]:
            save(talent_art(tab["background"], b), OUT / "spec" / f"{tab['background']}.webp")


if __name__ == "__main__":
    main()
