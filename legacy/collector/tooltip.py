"""Render WoW spell description templates into plain text.

Supported syntax (covers every token used by Forever talents as of 1.60.1):
  $s1 $m1 $S1 $M1        effect base points (absolute value)
  $12345s1               same, but from another spell
  $d $D                  duration          $o1   total over time
  $t1                    tick period (sec)  $a1/$A1 radius (yd)
  $h $n $u $x1 $e1 $b1   proc chance, charges, stacks, chain targets, amplitude, points/combo
  $r                     max range          $i    max targets
  $/10;s1  $/-1000;12345s1  $*2;s1          divide / multiply a reference
  ${ expr }[.N]          arithmetic with references inside, optional decimals
  $?s123[A][B]  $?a123[A]?s456[B][C]  $?!s123[..][..]   conditionals
  $lsingular:plural;  $Lsing:plur;  $gmale:female;
  $<var>                 SpellDescriptionVariables
  $@spelldesc123 $@spellname123 $@spelltooltip123 $@spellaura123
  $PL / $pl              player level (assumed 60)
  $proccooldown          internal proc cooldown
Conditionals have no "player state" in a calculator, so we show the default
(last) branch, or the first branch when the default is empty. A branch that
is shown "because it might apply" is wrapped in [[ ]] so the UI can dim it.
"""
from __future__ import annotations

import math
import re

from .db2 import SpellDB

PLAYER_LEVEL = 60

UNITS = {
    "en": {"sec": "sec", "min": "min", "hr": "hr", "yd": "yd", "inf": "until cancelled"},
    "ru": {"sec": "сек.", "min": "мин.", "hr": "ч.", "yd": "м", "inf": "до отмены"},
}


def fmt_num(v: float, decimals: int | None = None) -> str:
    if decimals is not None:
        s = f"{v:.{decimals}f}"
    elif abs(v - round(v)) < 1e-6:
        s = str(int(round(v)))
    else:
        s = f"{v:.1f}".rstrip("0").rstrip(".") if abs(v) >= 1 else f"{v:.2f}".rstrip("0").rstrip(".")
    return s


def fmt_duration(ms: float, lang: str) -> str:
    u = UNITS[lang]
    if ms <= 0:
        return u["inf"]
    sec = ms / 1000
    if sec < 60 or (sec < 120 and sec % 60):
        return f"{fmt_num(sec)} {u['sec']}"
    if sec < 3600:
        return f"{fmt_num(sec / 60)} {u['min']}"
    return f"{fmt_num(sec / 3600)} {u['hr']}"


class Renderer:
    def __init__(self, db: SpellDB, lang: str):
        self.db, self.lang = db, lang
        self._depth = 0
        # Ranked trait: per-rank effect values. Effects with a curve get the
        # curve value, the rest scale base points by rank (client behaviour).
        self.scale_sid: int | None = None
        self.scale: float = 1.0
        self.overrides: dict[int, float] = {}

    # ------------------------------------------------------------- values
    def _effect(self, sid: int, idx: int) -> dict | None:
        effs = self.db.effects.get(sid) or {}
        return effs.get(idx - 1) if idx else (effs.get(0) or (next(iter(effs.values())) if effs else None))

    def _duration_ms(self, sid: int) -> float:
        misc = self.db.misc.get(sid)
        if not misc:
            return 0
        d = self.db.duration.get(int(misc["DurationIndex"]))
        return float(d["Duration"]) if d else 0

    def value(self, sid: int, code: str, idx: int) -> float | str | None:
        """Numeric value of a reference like s1 / d / a1. Returns str for durations."""
        e = self._effect(sid, idx or 1)
        c = code
        own = sid == self.scale_sid
        k = self.scale if own else 1.0
        if c in "smSM":
            if own and (idx or 1) in self.overrides:
                return self.overrides[idx or 1]
            return float(e["EffectBasePointsF"]) * k if e else None
        if c == "o":
            if not e:
                return None
            per = float(e["EffectAuraPeriod"] or 0)
            dur = self._duration_ms(sid)
            ticks = dur / per if per else 1
            base = self.overrides.get(idx or 1) if own and (idx or 1) in self.overrides else float(e["EffectBasePointsF"]) * k
            return base * ticks
        if c == "t":
            return float(e["EffectAuraPeriod"]) / 1000 if e else None
        if c in "aA":
            if not e:
                return None
            for key in ("EffectRadiusIndex_0", "EffectRadiusIndex_1"):
                r = self.db.radius.get(int(e[key]))
                if r and float(r["Radius"] or r["RadiusMax"] or 0):
                    return float(r["Radius"] or r["RadiusMax"])
            return 0.0
        if c == "x":
            return float(e["EffectChainTargets"]) if e else None
        if c == "e":
            return float(e["EffectAmplitude"]) if e else None
        if c == "f":
            return float(e["EffectChainAmplitude"]) if e else None
        if c == "b":
            return float(e["EffectPointsPerResource"]) if e else None
        if c == "q":
            return float(e["EffectMiscValue_0"]) if e else None
        if c in "hnu":
            ao = self.db.aura.get(sid)
            if not ao:
                return 0.0
            return float({"h": ao["ProcChance"], "n": ao["ProcCharges"], "u": ao["CumulativeAura"]}[c])
        if c in "rR":
            misc = self.db.misc.get(sid)
            rg = self.db.range.get(int(misc["RangeIndex"])) if misc else None
            return float(rg["RangeMax_0"]) if rg else 0.0
        if c == "i":
            return 0.0
        if c in "dD":
            return self._duration_ms(sid)
        if c == "c":
            pw = self.db.power.get(sid)
            if not pw:
                return 0.0
            v = float(pw["ManaCost"] or 0) or float(pw["PowerCostPct"] or 0)
            return v / 10 if int(pw["PowerType"]) == 1 else v
        return None

    # ------------------------------------------------------------ render
    def render_rank(self, base_sid: int, rank: int, overrides: dict[int, float] | None = None) -> str:
        """Render a trait's spell at `rank` (1-based); overrides: {effect_index(1-based): value}."""
        self.scale_sid, self.scale, self.overrides = base_sid, float(rank), overrides or {}
        try:
            return self.render(base_sid)
        finally:
            self.scale_sid, self.scale, self.overrides = None, 1.0, {}

    def render(self, sid: int, text: str | None = None) -> str:
        if text is None:
            row = self.db.text.get(sid)
            text = row["Description_lang"] if row else ""
        self._depth += 1
        try:
            if self._depth > 4:
                return ""
            out = self._render(sid, text or "")
        finally:
            self._depth -= 1
        return self._cleanup(out) if self._depth == 0 else out

    def _vars(self, sid: int) -> dict[str, str]:
        raw = self.db.desc_vars.get(sid, "")
        out = {}
        for line in raw.replace("\r", "").split("\n"):
            m = re.match(r"\s*\$(\w+)\s*=\s*(.+)", line)
            if m:
                out[m.group(1)] = m.group(2).strip()
        return out

    REF = re.compile(r"(\d*)([smSMdDotaAhnuxefbqrRic])(\d?)")

    def _render(self, sid: int, s: str) -> str:
        out: list[str] = []
        i, n = 0, len(s)
        last_num: float | None = None
        dvars = self._vars(sid)
        while i < n:
            ch = s[i]
            if ch != "$":
                out.append(ch)
                i += 1
                continue
            j = i + 1
            if j >= n:
                break
            c = s[j]
            # ${expr}[.N]
            if c == "{":
                end = _match(s, j, "{", "}")
                expr = s[j + 1:end]
                k = end + 1
                dec = None
                m = re.match(r"\.(\d)", s[k:])
                if m:
                    dec = int(m.group(1))
                    k += 2
                v = self._eval(sid, expr, dvars)
                if v is None:
                    out.append("?")
                else:
                    last_num = v
                    out.append(fmt_num(v, dec))
                i = k
                continue
            # $?cond[A][B]
            if c == "?":
                text, i = self._conditional(sid, s, j)
                out.append(text)
                continue
            # $/N;ref  $*N;ref
            if c in "/*":
                m = re.match(r"([\-\d.]+);\$?(\d*)([smSMdDotaAhnuxefbqrRic])(\d?)", s[j + 1:])
                if m:
                    k = float(m.group(1))
                    ref_sid = int(m.group(2)) if m.group(2) else sid
                    v = self.value(ref_sid, m.group(3), int(m.group(4) or 0))
                    if isinstance(v, (int, float)):
                        v = v / k if c == "/" else v * k
                        last_num = abs(v)
                        out.append(fmt_num(abs(v)))
                    else:
                        out.append("?")
                    i = j + 1 + m.end()
                    continue
            # $lsing:plur;  $gmale:female;
            m = re.match(r"([lLgG])([^:;]*):([^;]*);", s[j:])
            if m:
                forms = [m.group(2)] + m.group(3).split(":")
                if m.group(1) in "gG":
                    out.append(forms[0])
                else:
                    out.append(plural(last_num, forms, self.lang))
                i = j + m.end()
                continue
            # $@spelldesc123
            m = re.match(r"@(spelldesc|spelltooltip|spellname|spellaura|spellicon)(\d+)", s[j:])
            if m:
                kind, ref = m.group(1), int(m.group(2))
                if kind == "spellname":
                    out.append(self.db.name(ref))
                elif kind == "spellaura":
                    row = self.db.text.get(ref)
                    out.append(self._render(ref, row["AuraDescription_lang"]) if row else "")
                elif kind != "spellicon":
                    out.append(self.render(ref))
                i = j + m.end()
                continue
            # $<var>
            if c == "<":
                end = s.find(">", j)
                name = s[j + 1:end]
                v = _to_float(self._var(sid, name, dvars)) if name in dvars else None
                out.append(fmt_num(v) if v is not None else "X")
                if v is not None:
                    last_num = v
                i = end + 1
                continue
            # player stats have no meaning without gear -> skip silently
            m = STAT_KW.match(s, j)
            if m:
                out.append("0")
                i = m.end()
                continue
            # keywords
            m = re.match(r"(proccooldown|PL|pl|ctrmax\d*|maxcast|pctD)", s[j:])
            if m:
                kw = m.group(1)
                if kw in ("PL", "pl"):
                    out.append(str(PLAYER_LEVEL))
                elif kw == "proccooldown":
                    ao = self.db.aura.get(sid)
                    ms = float(ao["ProcCategoryRecovery"]) if ao else 0
                    out.append(fmt_duration(ms, self.lang))
                i = j + m.end()
                continue
            # plain reference $12345s1 / $d / $m1
            m = self.REF.match(s, j)
            if m:
                ref_sid = int(m.group(1)) if m.group(1) else sid
                code, idx = m.group(2), int(m.group(3) or 0)
                v = self.value(ref_sid, code, idx)
                if code in "dD":
                    out.append(fmt_duration(v or 0, self.lang))
                    last_num = (v or 0) / 1000
                elif code in "aArR" and v is not None:
                    last_num = abs(v)
                    out.append(fmt_num(abs(v)))
                elif v is None:
                    out.append("?")
                else:
                    last_num = abs(v)
                    out.append(fmt_num(abs(v)))
                i = m.end()
                continue
            out.append("$")
            i += 1
        return "".join(out)

    def _conditional(self, sid: int, s: str, j: int) -> tuple[str, int]:
        """Parse `?cond[A]?cond[B][C]` starting at s[j]=='?'. Return (text, next_index)."""
        branches: list[str] = []
        k = j
        while k < len(s) and s[k] == "?":
            lb = s.find("[", k)
            if lb < 0:
                return "", len(s)
            rb = _match(s, lb, "[", "]")
            branches.append(s[lb + 1:rb])
            k = rb + 1
        default = ""
        if k < len(s) and s[k] == "[":
            rb = _match(s, k, "[", "]")
            default = s[k + 1:rb]
            k = rb + 1
        if default.strip():
            return self._render(sid, default), k
        if branches:
            return "[[" + self._render(sid, branches[0]) + "]]", k
        return "", k

    def _var(self, sid: int, name: str, dvars: dict[str, str]) -> str:
        """Resolve a description variable to a number string (definitions may hold ${} / $? syntax)."""
        if name not in dvars:
            return _undef(name)
        if self._depth > 6:
            return _undef(name)
        self._depth += 1
        try:
            raw = dvars[name].strip()
            text = self._render(sid, raw) if "$" in raw else raw
        finally:
            self._depth -= 1
        text = text.replace("[[", "").replace("]]", "").strip()
        return text if _to_float(text) is not None else _undef(name)

    def _eval(self, sid: int, expr: str, dvars: dict[str, str]) -> float | None:
        def ref(m: re.Match) -> str:
            ref_sid = int(m.group(1)) if m.group(1) else sid
            v = self.value(ref_sid, m.group(2), int(m.group(3) or 0))
            if m.group(2) in "dD" and isinstance(v, (int, float)):
                v = v / 1000
            return f"({v})" if isinstance(v, (int, float)) else "0"

        e = expr
        e = re.sub(r"\$<(\w+)>", lambda m: f"({self._var(sid, m.group(1), dvars)})", e)
        e = re.sub(r"\$(PL|pl)\b", str(PLAYER_LEVEL), e)
        e = STAT_KW_SUB.sub("0", e)
        e = re.sub(r"\$(max|min|floor|ceil|abs|cond|gt|gte|lt|lte|clamp)\(", r"_\1(", e)
        e = re.sub(r"\$(\d*)([smSMdDotaAhnuxefbqrRic])(\d?)", ref, e)
        e = re.sub(r"\$\w+", "0", e)  # unknown keyword
        if not re.fullmatch(r"[\d\s.+\-*/(),_a-z<>=]*", e):
            return None
        try:
            v = eval(e, {"__builtins__": {}}, _SAFE)  # noqa: S307 - whitelisted charset
            return float(v)
        except Exception:  # noqa: BLE001
            return None

    @staticmethod
    def _cleanup(s: str) -> str:
        s = re.sub(r"\|c[0-9a-fA-F]{8}(.*?)\|r", r"\1", s)
        s = s.replace("|n", "\n").replace("\r\n", "\n").replace("\r", "\n")
        s = re.sub(r"\|T[^|]*\|t", "", s)
        s = re.sub(r"(сек|мин|ч|м)\.\.(?!\.)", r"\1.", s)  # "10 сек.." -> "10 сек."
        s = re.sub(r"[ \t]+\n", "\n", s)
        s = re.sub(r"\n{3,}", "\n\n", s)
        return s.strip()


STAT_WORDS = (r"(?:rap|RAP|ap|AP|sp|SP|sph|spfi|spfr|spn|sps|spa|bh|bc|mws|MWS|mw|MW|pbh|pbhd|"
              r"spi|sta|str|agi|int|hp|HP|mhp|MHP|versadmg|mastery|haste|crit)")
STAT_KW = re.compile(r"\$" + STAT_WORDS + r"(?![A-Za-z0-9])")
STAT_KW_SUB = re.compile(r"\$" + STAT_WORDS + r"(?![A-Za-z0-9])")


def plural(n: float | None, forms: list[str], lang: str) -> str:
    """Pick the plural form. ruRU uses three: 1 удар / 2 удара / 5 ударов."""
    if n is None:
        return forms[-1]
    whole = abs(n - round(n)) < 1e-9
    k = int(round(abs(n)))
    if lang == "ru" and len(forms) >= 3:
        if not whole:
            return forms[1]  # 1,5 удара
        if k % 10 == 1 and k % 100 != 11:
            return forms[0]
        if 2 <= k % 10 <= 4 and not 12 <= k % 100 <= 14:
            return forms[1]
        return forms[2]
    return forms[0] if whole and k == 1 else forms[1]


def _to_float(s: str) -> float | None:
    try:
        return float(s)
    except (TypeError, ValueError):
        return None


def _undef(name: str) -> str:
    """Value for a description variable the client defines elsewhere (e.g. per-spec)."""
    return "1" if re.search(r"mult|mod|pct", name, re.I) else "0"


_SAFE = {
    "_max": max, "_min": min, "_floor": math.floor, "_ceil": math.ceil, "_abs": abs,
    "_cond": lambda c, a, b=0: a if c else b,
    "_gt": lambda a, b: a > b, "_gte": lambda a, b: a >= b,
    "_lt": lambda a, b: a < b, "_lte": lambda a, b: a <= b,
    "_clamp": lambda v, lo, hi: max(lo, min(hi, v)),
}


def _match(s: str, start: int, open_ch: str, close_ch: str) -> int:
    depth = 0
    for k in range(start, len(s)):
        if s[k] == open_ch:
            depth += 1
        elif s[k] == close_ch:
            depth -= 1
            if depth == 0:
                return k
    return len(s) - 1
