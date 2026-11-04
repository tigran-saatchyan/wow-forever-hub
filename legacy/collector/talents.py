"""Build the talent-calculator dataset for one build + locale.

WoW: Forever keeps the classic 3-tab look but the client defines talents with
the modern Trait system (TraitTree/TraitNode/TraitNodeEntry/TraitDefinition):
  * one TraitTree per class, paid with currency 3820 (max 51 points);
  * nodes laid out on a grid: 3 blocks of 4 columns x 7 rows;
  * row gates are TraitCond "spent >= N in node group G" (G = rows above);
  * arrows are TraitEdge type 2/3 (type 0 is purely visual);
  * per-rank values come from TraitDefinitionEffectPoints -> CurvePoint,
    otherwise the effect's base points scale with rank.
The legacy `Talent` table still exists in the client but holds vanilla leftovers;
it is used only to name/order the three tabs.
"""
from __future__ import annotations

import hashlib
import json
import logging
import re
from collections import Counter, defaultdict
from pathlib import Path

from . import config, db2, net
from .tooltip import Renderer, fmt_duration, fmt_num

log = logging.getLogger(__name__)

POWER = {
    "en": {0: "Mana", 1: "Rage", 2: "Focus", 3: "Energy"},
    "ru": {0: "ед. маны", 1: "ед. ярости", 2: "ед. концентрации", 3: "ед. энергии"},
}
LABELS = {
    "en": {"cd": "cooldown", "instant": "Instant", "cast": "cast", "range": "yd range", "basemana": "of base mana"},
    "ru": {"cd": "восстановление", "instant": "Мгновенное действие", "cast": "применение",
           "range": "м", "basemana": "базовой маны"},
}
CLASS_ORDER = ["WARRIOR", "PALADIN", "HUNTER", "ROGUE", "PRIEST", "SHAMAN", "MAGE", "WARLOCK", "DRUID"]
ATTR0_PASSIVE = 0x40
CLASS_CURRENCY = 3820  # 51-point class talent currency
LEGACY_CURRENCY = 4225  # account-wide Legacy points (16 max)
# Legacy "Talented": a 5-tier choice node; each tier moves the first talent
# point from level 10 down to level 9..5 (51 points max still applies).
TALENTED_SPELL = 1225474

# Grid geometry of Forever class trees (client units).
BLOCK_X0 = (1020, 5020, 9080)
COL_W = 600
ROW_Y0 = 2130
ROW_H = 600
ROWS, COLS = 7, 4


def icon_names() -> dict[int, str]:
    """FileDataID -> icon basename (lowercase, no extension)."""
    cache = config.CACHE / "icons_listfile.csv"
    if not cache.exists():
        cache.parent.mkdir(parents=True, exist_ok=True)
        r = net.session().get(config.LISTFILE_URL, stream=True, timeout=300)
        r.raise_for_status()
        with cache.open("w", encoding="utf-8") as f:
            for raw in r.iter_lines():
                line = raw.decode("utf-8", "replace") if isinstance(raw, bytes) else raw
                if line and ";interface/icons/" in line.lower():
                    f.write(line + "\n")
    out = {}
    for line in cache.read_text(encoding="utf-8").splitlines():
        fid, path = line.split(";", 1)
        out[int(fid)] = Path(path).stem.lower()
    return out


def _grid(x: int, y: int) -> tuple[int, int, int] | None:
    """Client position -> (block, row, col); None if outside the visible grid."""
    block = min(range(3), key=lambda b: abs(x - (BLOCK_X0[b] + 1.5 * COL_W)))
    col = round((x - BLOCK_X0[block]) / COL_W)
    row = round((y - ROW_Y0) / ROW_H)
    if 0 <= col < COLS and 0 <= row < ROWS and abs(x - BLOCK_X0[block] - col * COL_W) <= 60 \
            and abs(y - ROW_Y0 - row * ROW_H) <= 60:
        return block, row, col
    return None


def _spell_meta(db: db2.SpellDB, sid: int, lang: str) -> dict:
    misc = db.misc.get(sid)
    if not misc:
        return {}
    if int(misc["Attributes_0"]) & ATTR0_PASSIVE:
        return {"passive": True}
    L = LABELS[lang]
    meta: dict = {"passive": False}
    pw = db.power.get(sid)
    if pw:
        ptype = int(pw["PowerType"])
        cost = float(pw["ManaCost"] or 0)
        pct = float(pw["PowerCostPct"] or 0)
        if ptype == 1:
            cost /= 10  # rage is stored x10
        if pct:
            meta["cost"] = f"{fmt_num(pct)}% {L['basemana']}"
        elif cost:
            meta["cost"] = f"{fmt_num(cost)} {POWER[lang].get(ptype, '')}".strip()
    ct = db.casttime.get(int(misc["CastingTimeIndex"]))
    base = float(ct["Base"]) if ct else 0
    meta["cast"] = L["instant"] if base <= 0 else f"{fmt_num(base / 1000)} {'сек.' if lang == 'ru' else 'sec'} {L['cast']}"
    rg = db.range.get(int(misc["RangeIndex"]))
    if rg and float(rg["RangeMax_0"]) > 5:
        meta["range"] = f"{fmt_num(float(rg['RangeMax_0']))} {L['range']}"
    cd = db.cooldowns.get(sid)
    if cd:
        ms = max(float(cd["RecoveryTime"] or 0), float(cd["CategoryRecoveryTime"] or 0))
        if ms > 1500:
            meta["cd"] = f"{fmt_duration(ms, lang)} {L['cd']}"
    return meta


class TraitData:
    """All trait tables for a build, indexed."""

    def __init__(self, build: str):
        t = lambda name: db2.table(name, build)  # noqa: E731
        self.nodes = db2.by_id(t("TraitNode"))
        self.entries = db2.by_id(t("TraitNodeEntry"))
        self.defs = db2.by_id(t("TraitDefinition"))
        self.node_entries: dict[int, list[int]] = defaultdict(list)
        for r in sorted(t("TraitNodeXTraitNodeEntry"), key=lambda r: int(r["_Index"])):
            self.node_entries[int(r["TraitNodeID"])].append(int(r["TraitNodeEntryID"]))
        self.group_nodes: dict[int, set[int]] = defaultdict(set)
        self.node_groups: dict[int, set[int]] = defaultdict(set)
        for r in t("TraitNodeGroupXTraitNode"):
            g, n = int(r["TraitNodeGroupID"]), int(r["TraitNodeID"])
            self.group_nodes[g].add(n)
            self.node_groups[n].add(g)
        conds = db2.by_id(t("TraitCond"))
        self.group_conds: dict[int, list[dict]] = defaultdict(list)
        for r in t("TraitNodeGroupXTraitCond"):
            self.group_conds[int(r["TraitNodeGroupID"])].append(conds[int(r["TraitCondID"])])
        self.node_conds: dict[int, list[dict]] = defaultdict(list)
        for r in t("TraitNodeXTraitCond"):
            self.node_conds[int(r["TraitNodeID"])].append(conds[int(r["TraitCondID"])])
        self.edges = t("TraitEdge")
        self.effect_points: dict[int, dict[int, int]] = defaultdict(dict)  # def -> {effidx0: curve}
        for r in t("TraitDefinitionEffectPoints"):
            self.effect_points[int(r["TraitDefinitionID"])][int(r["EffectIndex"])] = int(r["CurveID"])
        self.curves: dict[int, list[tuple[float, float]]] = defaultdict(list)
        for r in t("CurvePoint"):
            self.curves[int(r["CurveID"])].append((float(r["Pos_0"]), float(r["Pos_1"])))
        for pts in self.curves.values():
            pts.sort()
        self.tree_currency = {int(r["TraitTreeID"]): int(r["TraitCurrencyID"]) for r in t("TraitTreeXTraitCurrency")}

    def curve_at(self, curve: int, x: float) -> float | None:
        pts = self.curves.get(curve)
        if not pts:
            return None
        if x <= pts[0][0]:
            return pts[0][1]
        for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
            if x0 <= x <= x1:
                return y0 if x1 == x0 else y0 + (y1 - y0) * (x - x0) / (x1 - x0)
        return pts[-1][1]


def build_dataset(build: str, lang: str, icons: dict[int, str] | None = None) -> dict:
    locale = config.LOCALES[lang]
    db = db2.SpellDB(build, locale)
    rnd = Renderer(db, lang)
    td = TraitData(build)
    icons = icons if icons is not None else icon_names()

    classes_raw = {int(c["ID"]): c for c in db2.table("ChrClasses", build, locale)}
    tabs_raw = db2.table("TalentTab", build, locale)
    legacy_spell_tab = {int(t["SpellRank_0"]): int(t["TabID"]) for t in db2.table("Talent", build)}
    tab_by_id = {int(t["ID"]): t for t in tabs_raw}

    def tab_class(tab: dict) -> int:
        return int(tab["ClassMask"]).bit_length()

    # ---- find class trees: currency 3820, map class via legacy tab overlap
    trees: dict[int, list[int]] = defaultdict(list)
    for nid, n in td.nodes.items():
        tree = int(n["TraitTreeID"])
        if td.tree_currency.get(tree) == CLASS_CURRENCY:
            trees[tree].append(nid)

    def node_spell(nid: int) -> tuple[int, dict, dict] | None:
        ents = td.node_entries.get(nid) or []
        if not ents:
            return None
        e = td.entries.get(ents[0])
        d = td.defs.get(int(e["TraitDefinitionID"])) if e else None
        if not d:
            return None
        return int(d["SpellID"]), e, d

    classes: dict[str, dict] = {}
    for tree, nids in trees.items():
        votes = Counter()
        for nid in nids:
            ns = node_spell(nid)
            if ns and ns[0] in legacy_spell_tab:
                votes[tab_class(tab_by_id[legacy_spell_tab[ns[0]]])] += 1
        if not votes:
            log.warning("tree %s: cannot determine class", tree)
            continue
        class_id = votes.most_common(1)[0][0]
        cls = classes_raw[class_id]
        token = cls["Filename"]
        ctabs = sorted([t for t in tabs_raw if tab_class(t) == class_id], key=lambda t: int(t["OrderIndex"]))

        # ---- place nodes
        cells: dict[tuple[int, int, int], int] = {}
        for nid in sorted(nids):
            n = td.nodes[nid]
            pos = _grid(int(n["PosX"]), int(n["PosY"]))
            if pos is None or node_spell(nid) is None:
                continue
            if pos in cells:
                # Two nodes on one cell: keep the newer / flagged one.
                keep = max(cells[pos], nid, key=lambda k: (int(td.nodes[k]["Flags"]) & 8, k))
                log.info("%s: cell %s overlap %s/%s -> keep %s", token, pos, cells[pos], nid, keep)
                cells[pos] = keep
            else:
                cells[pos] = nid
        placed = {nid: pos for pos, nid in cells.items()}

        # ---- edges -> prerequisites (left must be maxed to unlock right)
        need: dict[int, list[int]] = defaultdict(list)
        for e in td.edges:
            a, b, typ = int(e["LeftTraitNodeID"]), int(e["RightTraitNodeID"]), int(e["Type"])
            if typ in (2, 3) and a in placed and b in placed:
                need[b].append(a)

        def gate(nid: int) -> dict | None:
            best = None
            conds = [c for g in td.node_groups[nid] for c in td.group_conds[g]] + td.node_conds[nid]
            for c in conds:
                amt, grp = int(c["SpentAmountRequired"]), int(c["TraitNodeGroupID"])
                if amt and grp and (best is None or amt > best[0]):
                    best = (amt, grp)
            if not best:
                return None
            members = sorted(n for n in td.group_nodes[best[1]] if n in placed)
            return {"points": best[0], "from": members}

        tabs_out = []
        for b in range(3):
            meta = ctabs[b] if b < len(ctabs) else None
            tab_out = {
                "id": int(meta["ID"]) if meta else b,
                "name": meta["Name_lang"] if meta else f"Tab {b + 1}",
                "icon": icons.get(int(meta["SpellIconID"]), "inv_misc_questionmark") if meta else "inv_misc_questionmark",
                "background": meta["BackgroundFile"] if meta else "",
                "talents": [],
            }
            for nid, (blk, row, col) in sorted(placed.items(), key=lambda kv: (kv[1][1], kv[1][2])):
                if blk != b:
                    continue
                sid, entry, definition = node_spell(nid)
                max_ranks = max(1, int(entry["MaxRanks"]))
                misc = db.misc.get(sid)
                icon_fid = int(definition["OverrideIcon"]) or (int(misc["SpellIconFileDataID"]) if misc else 0)
                name = definition["OverrideName_lang"] or db.name(sid)
                curves = td.effect_points.get(int(definition["ID"]), {})
                ranks = []
                for rk in range(1, max_ranks + 1):
                    ov = {}
                    for eff_idx0, curve in curves.items():
                        v = td.curve_at(curve, rk)
                        if v is not None:
                            ov[eff_idx0 + 1] = v
                    if definition["OverrideDescription_lang"]:
                        rnd.scale_sid, rnd.scale, rnd.overrides = sid, float(rk), ov
                        try:
                            desc = rnd.render(sid, definition["OverrideDescription_lang"])
                        finally:
                            rnd.scale_sid, rnd.scale, rnd.overrides = None, 1.0, {}
                    else:
                        desc = rnd.render_rank(sid, rk, ov)
                    ranks.append(desc)
                talent = {
                    "id": nid,
                    "spell": sid,
                    "row": row,
                    "col": col,
                    "name": name,
                    "icon": icons.get(icon_fid, "inv_misc_questionmark"),
                    "max": max_ranks,
                    "ranks": ranks,
                    "meta": _spell_meta(db, sid, lang),
                }
                g = gate(nid)
                if g:
                    talent["gate"] = g
                if need.get(nid):
                    talent["requires"] = sorted(need[nid])
                if int(td.nodes[nid]["Flags"]) & 8:
                    talent["flag8"] = True
                if len(td.node_entries[nid]) > 1:
                    talent["choice"] = True  # not used by class trees as of 1.60.1
                tab_out["talents"].append(talent)
            tabs_out.append(tab_out)

        classes[token] = {
            "id": class_id,
            "token": token,
            "tree": tree,
            "name": cls["Name_lang"] or cls["Name_male_lang"],
            "color": "#%02x%02x%02x" % (int(cls["ClassColorR"]), int(cls["ClassColorG"]), int(cls["ClassColorB"])),
            "icon": f"classicon_{token.lower()}",
            "tabs": tabs_out,
        }

    ordered = [classes[k] for k in CLASS_ORDER if k in classes]
    out = {
        "build": build,
        "lang": lang,
        "rules": {"firstLevel": 10, "maxLevel": 60, "maxPoints": 51, "rows": ROWS, "cols": COLS},
        "classes": ordered,
    }
    talented = legacy_talented(td, db, rnd, icons)
    if talented:
        out["legacy"] = {"talented": talented}
    else:
        log.warning("Legacy 'Talented' node not found in %s", build)
    return out


def legacy_talented(td: "TraitData", db: db2.SpellDB, rnd: Renderer, icons: dict[int, str]) -> dict | None:
    """The Legacy node that lowers the level of the first talent point."""
    for nid, n in td.nodes.items():
        if td.tree_currency.get(int(n["TraitTreeID"])) != LEGACY_CURRENCY:
            continue
        ents = [td.entries[e] for e in td.node_entries.get(nid, []) if e in td.entries]
        defs = [td.defs.get(int(e["TraitDefinitionID"])) for e in ents]
        if not defs or any(d is None or int(d["SpellID"]) != TALENTED_SPELL for d in defs):
            continue
        tiers = []
        for d in defs:
            curve = td.effect_points.get(int(d["ID"]), {}).get(0)
            start = td.curve_at(curve, 1) if curve else None
            if start is None:  # no curve: the spell's own base value
                eff = (db.effects.get(TALENTED_SPELL) or {}).get(0)
                start = float(eff["EffectBasePointsF"]) if eff else None
            if start is None:
                continue
            tiers.append({"start": int(start), "desc": rnd.render_rank(TALENTED_SPELL, 1, {1: start})})
        tiers.sort(key=lambda t: -t["start"])  # tier 1 = smallest improvement
        misc = db.misc.get(TALENTED_SPELL)
        # unlock conditions: points spent in the Legacy tree + a maxed prerequisite
        gate = 0
        for g in td.node_groups.get(nid, ()):
            for c in td.group_conds.get(g, []):
                if int(c["TraitCurrencyID"] or 0) == LEGACY_CURRENCY:
                    gate = max(gate, int(c["SpentAmountRequired"] or 0))
        req = None
        for e in td.edges:
            if int(e["RightTraitNodeID"]) == nid and int(e["Type"]) in (2, 3):
                pn = int(e["LeftTraitNodeID"])
                pe = [td.entries[x] for x in td.node_entries.get(pn, []) if x in td.entries]
                if pe:
                    pd = td.defs.get(int(pe[0]["TraitDefinitionID"]))
                    if pd:
                        req = {"name": pd["OverrideName_lang"] or db.name(int(pd["SpellID"])), "max": int(pe[0]["MaxRanks"])}
        return {
            "node": nid,
            "spell": TALENTED_SPELL,
            "name": db.name(TALENTED_SPELL),
            "icon": icons.get(int(misc["SpellIconFileDataID"]), "inv_misc_questionmark") if misc else "inv_misc_questionmark",
            "tiers": tiers,
            "baseStart": 10,
            "gatePoints": gate,
            "requires": req,
        }
    return None


def talent_index(ds: dict) -> dict[tuple[str, int], dict]:
    """(class token, node id) -> talent, with tab name attached."""
    out = {}
    for c in ds["classes"]:
        for tb in c["tabs"]:
            for t in tb["talents"]:
                out[(c["token"], t["id"])] = {**t, "tab": tb["name"]}
    return out


_NUM = re.compile(r"\d+(?:[.,]\d+)?")


def fingerprint(t: dict, tab_index: int) -> str:
    """Language-independent hash of everything that changes how a talent plays.

    Covers ranks, position, row gate, arrows, every number in every rank's text
    and the spell stats (cost, cast, range, cooldown). Wording-only edits and
    renames do not change it, so saved builds are not flagged for them.
    """
    key = [
        t["max"], tab_index, t["row"], t["col"],
        (t.get("gate") or {}).get("points", 0), sorted(t.get("requires", [])),
        [_NUM.findall(r) for r in t["ranks"]],
        [_NUM.findall(str(v)) for k, v in sorted(t["meta"].items()) if k != "passive"],
        bool(t["meta"].get("passive")),
    ]
    return hashlib.sha1(json.dumps(key).encode()).hexdigest()[:10]


def add_fingerprints(ds_by_lang: dict[str, dict], source: str = "en") -> bool:
    """Compute fp on the `source` language and copy it to every language by node id.

    Returns True if any dataset changed (so the caller can rewrite the files)."""
    src = ds_by_lang[source]
    fps = {}
    for c in src["classes"]:
        for ti, tb in enumerate(c["tabs"]):
            for t in tb["talents"]:
                fps[(c["token"], t["id"])] = fingerprint(t, ti)
    changed = False
    for ds in ds_by_lang.values():
        for c in ds["classes"]:
            for tb in c["tabs"]:
                for t in tb["talents"]:
                    fp = fps.get((c["token"], t["id"]))
                    if fp and t.get("fp") != fp:
                        t["fp"] = fp
                        changed = True
    return changed
