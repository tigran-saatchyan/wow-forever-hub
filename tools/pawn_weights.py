"""The stat weights Pawn ships for WoW: Forever (scales curated by HawsJon), turned into the hub's units.

    python tools/pawn_weights.py <Pawn's ClassicHawsJon.lua>

Pawn (github.com/VgerMods/Pawn, by Vger, CC BY-NC-ND 3.0) is not copied: only the numbers of its Forever
scales are read and written to backend/app/pawn_weights.py, credited on the page. Pawn gives hit, crit and haste
per 1 % (its "rating per" multipliers); Forever's items carry rating points, 10 of hit and 14 of crit for 1 %
(haste taken as 10), so they are divided down. "Damage and healing" items count as both spell damage and
healing, as Pawn reads them. Defense, avoidance and expertise are left to the hub's own values.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "backend" / "app" / "pawn_weights.py"
PER = {"HitRatingPer": 9.37931, "SpellHitRatingPer": 8, "CritRatingPer": 8.5, "SpellCritRatingPer": 8,
       "HasteRatingPer": 8.03, "SpellHasteRatingPer": 8.03, "ExpertiseRatingPer": 2.34483, "ArmorPenetrationPer": 3.75,
       "SpellPenetrationPer": 1, "DefenseRatingPer": 1.5, "DodgeRatingPer": 9.44, "ParryRatingPer": 9.44,
       "BlockRatingPer": 6.9}
HIT, CRIT, HASTE = 10, 14, 10  # Forever rating points per 1 %
SPECS = {"Balance": "balance", "Feral (Damage)": "feral", "Feral (Tank)": "feral_bear", "Restoration": "restoration",
         "Beast Mastery": "beastmastery", "Marksmanship": "marksmanship", "Survival": "survival", "Arcane": "arcane",
         "Fire": "fire", "Frost": "frost", "Holy": "holy", "Protection": "protection", "Retribution": "retribution",
         "Discipline": "discipline", "Shadow": "shadow", "Assassination": "assassination", "Combat": "combat",
         "Subtlety": "subtlety", "Elemental": "elemental", "Enhancement": "enhancement", "Affliction": "affliction",
         "Demonology": "demonology", "Destruction": "destruction", "Arms": "arms", "Fury": "fury"}


def convert(d: dict[str, float]) -> dict[str, float]:
    caster = d.get("SpellDamage", 0) > 0 or d.get("Healing", 0) > 0
    g = lambda k: d.get(k, 0.0)  # noqa: E731
    w = {"STRENGTH": g("Strength"), "AGILITY": g("Agility"), "INTELLECT": g("Intellect"), "SPIRIT": g("Spirit"),
         "STAMINA": g("Stamina"), "ap": g("Ap"), "rap": g("Rap") or g("Ap") * (g("RangedDps") > 0), "mp5": g("Mp5"),
         "heal": g("Healing"), "sp": g("SpellDamage") + g("Healing"), "armor": g("Armor"), "dps": g("MeleeDps"),
         "dps_ranged": g("RangedDps"),
         "hit": max(g("SpellHitRating") if caster else 0, g("HitRating")) / HIT,
         "crit": max(g("SpellCritRating") if caster else 0, g("CritRating")) / CRIT,
         "haste": max(g("SpellHasteRating") if caster else 0, g("HasteRating")) / HASTE}
    for school in ("Shadow", "Fire", "Frost", "Arcane", "Nature", "Holy"):
        if g(f"{school}SpellDamage"):
            w[f"BONUS_STAT_{school.upper()}_DAMAGE_DONE"] = g(f"{school}SpellDamage")
    return {k: round(v, 3) for k, v in w.items() if v >= 0.01}


def main() -> None:
    lines = Path(sys.argv[1]).read_text("utf-8-sig").split("\n")
    start = next(i for i, x in enumerate(lines) if "elseif VgerCore.IsForever then" in x)
    end = next(i for i in range(start + 1, len(lines)) if "elseif VgerCore." in lines[i])
    sec = "\n".join(lines[start:end])
    out = {}
    for m in re.finditer(r"(\d+), -- \w+\s*\n\s*\d+, -- ([^\n]+)\n\s*\{(.*?)\}\s*\n\s*\)", sec, re.S):
        d = {}
        for k, v in re.findall(r"(\w+)=([^,}]+)", m.group(3)):
            mm = re.match(r"(\w+)\*([\d.]+)", v.strip())
            try:
                d[k] = PER[mm.group(1)] * float(mm.group(2)) if mm else float(v)
            except (ValueError, KeyError):
                pass
        spec = SPECS.get(m.group(2).strip())
        if spec:
            out[f"{m.group(1)}:{spec}"] = convert(d)
    OUT.write_text('"""Pawn\'s stat weights for WoW: Forever (scales curated by HawsJon; Pawn by Vger, CC BY-NC-ND 3.0),\n'
                   'in the hub\'s units. Written by tools/pawn_weights.py — do not edit by hand."""\n\n'
                   f"PAWN: dict[str, dict[str, float]] = {json.dumps(out, indent=4)}\n", "utf-8")
    print("wrote", OUT, len(out), "specs")


if __name__ == "__main__":
    main()
