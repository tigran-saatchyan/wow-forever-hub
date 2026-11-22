"""Where to get a recipe, every way at once, for one side: the trainers who teach it (or, where the original game's
teaching can't be told, its profession's trainers, the capitals first), the vendors who sell its recipe item
(ForeverDB's, with the prices players saw, then the original game's), the creatures that drop it and the quests
that give it — each with its place (zone, map coordinates) so the player knows where to go and whether they can.

The original game's NPCs come from data/recipe_sources.json (tools/build_recipe_sources.py, CMaNGOS)."""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path

from . import fdb_sources, item_sources

DATA = Path(__file__).resolve().parent / "data" / "recipe_sources.json"


@lru_cache(maxsize=1)
def _ref() -> dict:
    return json.loads(DATA.read_text("utf-8")) if DATA.is_file() else {"trainers": {}, "vendors": {}, "profTrainers": {}, "npcs": {}, "zones": {}}


def _npc(e: str, lang: str, **extra) -> dict | None:
    d = _ref()
    n = d["npcs"].get(e)
    if not n:
        return None
    z = d["zones"].get(str(n["map"])) or {}
    return {"name": n[lang] if lang in n else n["en"], "title": n["sub"][lang], "zone": z.get(lang) or z.get("en"),
            "map": n["map"], "x": n["x"], "y": n["y"], "city": n.get("city"), "side": n["side"], **extra}


def _ok(side_of: str | None, side: str) -> bool:
    return side_of in (None, "both", side)


def how(spell: int, recipe_item: int | None, prof: int | None, source: str | None, side: str, lang: str) -> dict:
    d = _ref()
    out: dict = {"trainers": [], "vendors": [], "drops": [], "quests": [], "byProfession": False, "ways": []}
    learn = fdb_sources.learn(spell) or {}
    out["ways"] = learn.get("ways") or ([source] if source else [])
    # trainers: who teaches this very recipe; else, a recipe from a trainer: the profession's trainers
    exact = d["trainers"].get(str(spell)) or {}
    trainers = [_npc(e, lang, cost=c or None) for e, c in exact.items()]
    if not trainers and prof and (source == "trainer" or "trainer" in (learn.get("ways") or [])):
        trainers = [_npc(e, lang) for e in d["profTrainers"].get(str(prof), [])]
        out["byProfession"] = bool(trainers)
    trainers = [t for t in trainers if t and _ok(t["side"], side)]
    trainers.sort(key=lambda t: (not t["city"], t["zone"] or ""))
    out["trainers"] = trainers[:4]
    if recipe_item:
        # vendors: ForeverDB's first (Forever's own, prices players saw), then the original game's not already named
        seen = set()
        for v in fdb_sources.sold_by(recipe_item):
            s = (v.get("side") or "").lower()
            if s and s not in ("both", "neutral", side):
                continue
            seen.add(v.get("name"))
            out["vendors"].append({"name": v.get("name"), "title": v.get("title"), "zone": v.get("zone"), "map": v.get("map"),
                                   "x": v.get("x"), "y": v.get("y"), "price": v.get("price"), "seen": v.get("seen"), "src": "foreverdb"})
        # ForeverDB's vendors of the recipe itself (its profession page), when its item list has none
        for v in (learn.get("vendors") or {}).get(side, []):
            if v.get("name") in seen:
                continue
            seen.add(v.get("name"))
            out["vendors"].append({"name": v.get("name"), "title": None, "zone": v.get("zone"), "map": v.get("map"), "x": v.get("x"),
                                   "y": v.get("y"), "price": v.get("price"), "seen": v.get("seen"), "src": "foreverdb"})
        for e, limited in (d["vendors"].get(str(recipe_item)) or {}).items():
            n = _npc(e, lang, limited=bool(limited), src="classic")
            if n and _ok(n["side"], side) and n["name"] not in seen and d["npcs"][e]["en"] not in seen:
                out["vendors"].append(n)
        out["vendors"] = out["vendors"][:4]
        out["drops"] = ((item_sources.drops(recipe_item, lang) or {}).get("top") or [])[:4]
        out["quests"] = (item_sources.quests(recipe_item, lang, "H" if side == "horde" else "A") or [])[:3]
    return out
