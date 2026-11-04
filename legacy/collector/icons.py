"""Download talent icons and pack them into one sprite sheet.

One JPEG + a JSON map keeps the site self-hostable (no hotlinking at runtime)
and makes the calculator load in two requests.
"""
from __future__ import annotations

import io
import json
import math
from pathlib import Path

from PIL import Image

from . import config, net


def collect_names(datasets: list[dict]) -> list[str]:
    names: set[str] = set()
    for ds in datasets:
        for c in ds["classes"]:
            names.add(c["icon"])
            for tb in c["tabs"]:
                names.add(tb["icon"])
                for t in tb["talents"]:
                    names.add(t["icon"])
        tl = (ds.get("legacy") or {}).get("talented")
        if tl:
            names.add(tl["icon"])
    names.add("inv_misc_questionmark")
    return sorted(names)


def build_sprite(names: list[str], out_dir: Path, size: int | None = None) -> dict:
    size = size or config.ICON_SIZE
    cols = max(1, math.ceil(math.sqrt(len(names))))
    rows = math.ceil(len(names) / cols)
    sheet = Image.new("RGB", (cols * size, rows * size), (12, 12, 14))
    mapping: dict[str, list[int]] = {}
    missing = []
    cache = config.CACHE / "icons"
    for i, name in enumerate(names):
        data = net.cached_bytes(config.ICON_URL.format(name=name), cache)
        if not data:
            data = net.cached_bytes(config.ICON_URL.format(name="inv_misc_questionmark"), cache)
            missing.append(name)
        try:
            img = Image.open(io.BytesIO(data)).convert("RGB")
        except Exception:  # noqa: BLE001
            missing.append(name)
            continue
        # Blizzard icons have a 1-2px dark border; crop 4px so our CSS frame looks clean.
        w, h = img.size
        img = img.crop((4, 4, w - 4, h - 4)).resize((size, size), Image.LANCZOS)
        x, y = (i % cols) * size, (i // cols) * size
        sheet.paste(img, (x, y))
        mapping[name] = [x, y]
    out_dir.mkdir(parents=True, exist_ok=True)
    sheet.save(out_dir / "icons.jpg", quality=86, optimize=True, progressive=True)
    meta = {"size": size, "width": sheet.width, "height": sheet.height, "icons": mapping}
    (out_dir / "icons.json").write_text(json.dumps(meta, separators=(",", ":")), encoding="utf-8")
    return {"count": len(mapping), "missing": missing}


def build_tree_art(datasets: list[dict], out_dir: Path) -> list[str]:
    """Download the in-game background of every talent tree that is not on disk yet.

    Returns the relative paths (under out_dir) of the files written, so the caller can publish them.
    """
    tabs = {tb["id"] for ds in datasets for c in ds["classes"] for tb in c["tabs"] if tb.get("id")}
    written = []
    for tab in sorted(tabs):
        dest = out_dir / "trees" / f"{tab}.jpg"
        if dest.exists():
            continue
        data = net.cached_bytes(config.TREE_BG_URL.format(tab=tab), config.CACHE / "trees")
        if not data:
            continue
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(data)
        written.append(f"trees/{tab}.jpg")
    return written
