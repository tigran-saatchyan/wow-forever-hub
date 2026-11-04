"""DB2 table access via wago.tools CSV exports, cached per build/locale."""
from __future__ import annotations

import csv
import io
from collections import defaultdict

from . import config, net

# Tables whose text differs per locale; everything else is fetched once (enUS).
LOCALIZED = {"SpellName", "Spell", "TalentTab", "ChrClasses", "SpellRange"}


def table(name: str, build: str, locale: str = "enUS") -> list[dict]:
    loc = locale if name in LOCALIZED else "enUS"
    url = config.WAGO_DB2.format(table=name, build=build, locale=loc)
    text = net.cached_text(url, config.CACHE / "db2" / build / loc / f"{name}.csv")
    if text.lstrip().startswith("{"):
        raise RuntimeError(f"wago.tools returned an error for {name}@{build}: {text[:200]}")
    return list(csv.DictReader(io.StringIO(text)))


def by_id(rows: list[dict], key: str = "ID") -> dict[int, dict]:
    return {int(r[key]): r for r in rows}


def group(rows: list[dict], key: str) -> dict[int, list[dict]]:
    out: dict[int, list[dict]] = defaultdict(list)
    for r in rows:
        out[int(r[key])].append(r)
    return out


class SpellDB:
    """Joined view of the spell tables needed to render tooltips."""

    def __init__(self, build: str, locale: str):
        self.build, self.locale = build, locale
        self.names = {int(r["ID"]): r["Name_lang"] for r in table("SpellName", build, locale)}
        self.text = by_id(table("Spell", build, locale))
        effects = group(table("SpellEffect", build), "SpellID")
        # Keep the base-difficulty row per effect index.
        self.effects: dict[int, dict[int, dict]] = {}
        for sid, rows in effects.items():
            d: dict[int, dict] = {}
            for r in sorted(rows, key=lambda r: int(r["DifficultyID"])):
                d.setdefault(int(r["EffectIndex"]), r)
            self.effects[sid] = d
        self.misc = _first_by_spell(table("SpellMisc", build))
        self.aura = _first_by_spell(table("SpellAuraOptions", build))
        self.cooldowns = _first_by_spell(table("SpellCooldowns", build))
        self.power = _first_by_spell(table("SpellPower", build))
        self.duration = by_id(table("SpellDuration", build))
        self.radius = by_id(table("SpellRadius", build))
        self.range = by_id(table("SpellRange", build, locale))
        self.casttime = by_id(table("SpellCastTimes", build))
        dv = by_id(table("SpellDescriptionVariables", build))
        self.desc_vars: dict[int, str] = {}
        for r in table("SpellXDescriptionVariables", build):
            v = dv.get(int(r["SpellDescriptionVariablesID"]))
            if v:
                self.desc_vars[int(r["SpellID"])] = v["Variables"]

    def name(self, sid: int) -> str:
        return self.names.get(sid, f"Spell #{sid}")


def _first_by_spell(rows: list[dict]) -> dict[int, dict]:
    out: dict[int, dict] = {}
    for r in sorted(rows, key=lambda r: int(r.get("DifficultyID", 0) or 0)):
        out.setdefault(int(r["SpellID"]), r)
    return out
