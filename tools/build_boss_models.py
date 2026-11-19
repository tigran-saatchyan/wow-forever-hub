"""Which model each dungeon creature wears, for the bosses' portraits on the dungeon tab: name -> display id, from
the CMaNGOS classic database (creature_template.ModelId1, for creatures placed in an instance). The picture
itself is Wowhead's still of the model (wow.zamimg.com/modelviewer/classic/webthumbs/npc/<id % 256>/<id>.webp),
fetched through the hub. Forever's own new bosses are not in this database and get no portrait.

    python tools/build_boss_models.py <ClassicDB_*.sql.gz> <locales_creature.sql>

Out comes name -> {"m": display id, "ru": the name in Russian} (the Russian names from the database's locales).
"""

from __future__ import annotations

import gzip
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "backend"))
from build_loot import tables  # noqa: E402

from app.item_sources import INSTANCES  # noqa: E402

OUT = Path(__file__).resolve().parent.parent / "backend" / "app" / "data" / "boss_models.json"


def norm(s: str) -> str:
    return re.sub(r"^the\s+", "", re.sub(r"[^a-z0-9' ]", "", (s or "").lower())).strip()


def main() -> None:
    sql = gzip.open(sys.argv[1], "rt", encoding="utf-8", errors="replace").read()
    t = tables(sql, {"creature_template", "creature"})
    ru = {int(m.group(1)): m.group(2).replace("\\'", "'") for m in re.finditer(r"VALUES \((\d+), '((?:[^'\\]|\\.)*)'",
                                                                       open(sys.argv[2], encoding="utf-8").read())}
    where = {}
    for r in t["creature"]:
        where.setdefault(r["id"], r["map"])
    out: dict[str, dict] = {}
    for ct in t["creature_template"]:
        if where.get(ct["Entry"]) in INSTANCES and ct.get("ModelId1"):
            k = norm(ct["Name"])
            if k not in out or ct.get("Rank", 0) >= 3:  # a boss's own model over a namesake's
                out[k] = {"m": ct["ModelId1"], "ru": ru.get(ct["Entry"]) or ct["Name"]}
    for ct in t["creature_template"]:  # bosses summoned by a script are never placed: their template is enough
        k = norm(ct["Name"])
        if k not in out and ct.get("ModelId1") and ct.get("Rank", 0) >= 1:
            out[k] = {"m": ct["ModelId1"], "ru": ru.get(ct["Entry"]) or ct["Name"]}
    OUT.write_text(json.dumps(out, ensure_ascii=False, sort_keys=True, separators=(",", ":")), "utf-8")
    print("wrote", OUT, len(out))


if __name__ == "__main__":
    main()
