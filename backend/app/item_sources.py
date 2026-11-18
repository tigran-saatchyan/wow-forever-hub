"""Where an item comes from, from the hub's own references (no request at view time):

- quest rewards: Blizzard's Forever quest data (data/quest_rewards.json, tools/build_quests.py), with "chain" when the
  original game's quest has a quest before or after it;
- drops: the CMaNGOS classic database (data/loot.json, tools/build_loot.py): which creatures drop it and how often,
  in which dungeon or zone, and whether it is a world drop — the original game's data, labelled so;
- vendors and recipes: ForeverDB (app/fdb_sources.py);
- Everloot only when none of these knows the item (app/routers/sources.py).
"""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path

DATA = Path(__file__).resolve().parent / "data"

# the instances of the original game, by map id: names in both languages
INSTANCES = {
    33: ("Shadowfang Keep", "Крепость Темного Клыка"), 34: ("The Stockade", "Тюрьма"), 36: ("The Deadmines", "Мертвые копи"),
    43: ("Wailing Caverns", "Пещеры Стенаний"), 47: ("Razorfen Kraul", "Лабиринты Иглошкурых"),
    48: ("Blackfathom Deeps", "Непроглядная Пучина"), 70: ("Uldaman", "Ульдаман"), 90: ("Gnomeregan", "Гномреган"),
    109: ("Sunken Temple", "Затонувший храм"), 129: ("Razorfen Downs", "Курганы Иглошкурых"),
    189: ("Scarlet Monastery", "Монастырь Алого ордена"), 209: ("Zul'Farrak", "Зул'Фаррак"),
    229: ("Blackrock Spire", "Вершина Черной горы"), 230: ("Blackrock Depths", "Глубины Черной горы"),
    249: ("Onyxia's Lair", "Логово Ониксии"), 289: ("Scholomance", "Некроситет"), 309: ("Zul'Gurub", "Зул'Гуруб"),
    329: ("Stratholme", "Стратхольм"), 349: ("Maraudon", "Мародон"), 389: ("Ragefire Chasm", "Огненная пропасть"),
    409: ("Molten Core", "Огненные Недра"), 429: ("Dire Maul", "Забытый город"), 469: ("Blackwing Lair", "Логово Крыла Тьмы"),
    509: ("Ruins of Ahn'Qiraj", "Руины Ан'Киража"), 531: ("Temple of Ahn'Qiraj", "Храм Ан'Киража"), 533: ("Naxxramas", "Наксрамас"),
}
RANKS = {1: "elite", 2: "rare_elite", 3: "boss", 4: "rare"}


@lru_cache(maxsize=1)
def _loot() -> dict:
    p = DATA / "loot.json"
    return json.loads(p.read_text("utf-8")) if p.is_file() else {"items": {}, "creatures": {}, "zones": {}, "chain": []}


@lru_cache(maxsize=1)
def _quests() -> dict:
    p = DATA / "quest_rewards.json"
    return json.loads(p.read_text("utf-8"))["items"] if p.is_file() else {}


@lru_cache(maxsize=1)
def _chain() -> frozenset:
    return frozenset(_loot().get("chain") or [])


def _creature(entry: int, chance: float, lang: str) -> dict:
    c = _loot()["creatures"].get(str(entry)) or {}
    inst = INSTANCES.get(c.get("map"))
    zone = (_loot()["zones"].get(str(c.get("zone"))) or [None, None]) if c.get("zone") else [None, None]
    return {
        "id": entry, "name": c.get("ru" if lang == "ru" else "en") or f"#{entry}", "rank": RANKS.get(c.get("rank") or 0),
        "level": c.get("lvl"), "instance": (inst[1] if lang == "ru" else inst[0]) if inst else None,
        "instanceId": c.get("map") if inst else None,
        "zone": zone[1] if lang == "ru" else zone[0], "zoneId": c.get("zone"), "x": c.get("x"), "y": c.get("y"),
        "chance": chance,
    }


def quests(item_id: int, lang: str) -> list[dict]:
    out = []
    for q in _quests().get(str(item_id)) or []:
        out.append({"id": q["id"], "name": (q.get("ru") if lang == "ru" else None) or q.get("en") or f"#{q['id']}",
                    "area": q.get("area") if lang == "ru" else q.get("areaEn"), "chain": q["id"] in _chain()})
    return out


def drops(item_id: int, lang: str) -> dict | None:
    """The creatures most likely to drop the item (the original game's data), how many kinds drop it, world drop."""
    x = _loot()["items"].get(str(item_id))
    if not x:
        return None
    return {"top": [_creature(e, c, lang) for e, c in x["d"]], "count": x["n"], "world": bool(x.get("world"))}


def brief(item_id: int, lang: str) -> dict | None:
    """One line of where the item comes from, from these references only: a quest, then a drop (a boss or a rare
    in its dungeon or zone, or a world drop with its likeliest creature and how many others drop it)."""
    qs = quests(item_id, lang)
    if qs:
        q = qs[0]
        return {"kind": "quest", "name": q["name"], "where": q["area"], "chain": q["chain"], "more": len(qs) - 1}
    d = drops(item_id, lang)
    if d and d["top"]:
        top = d["top"][0]
        where = top["instance"] or top["zone"]
        return {"kind": "world" if d["world"] else "drop", "name": top["name"], "where": where,
                "rate": (top["chance"] or 0) / 100, "more": d["count"] - 1, "classic": True}
    return None
