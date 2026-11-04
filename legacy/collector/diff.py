"""Diff two talent datasets -> list of human-readable datamined changes."""
from __future__ import annotations

import re

from .talents import talent_index

_NUM = re.compile(r"\d+(?:[.,]\d+)?")


def numbers_changed(a: str, b: str) -> bool:
    return _NUM.findall(a) != _NUM.findall(b)


def _short(s: str, n: int = 400) -> str:
    return s if len(s) <= n else s[: n - 1] + "…"


def diff_talents(old: dict, new: dict) -> list[dict]:
    """Return changes keyed so the UI can render and filter them.

    kind: added | removed | ranks | text | moved | gate | requires | meta | renamed
    """
    a, b = talent_index(old), talent_index(new)
    cls_name = {c["token"]: c["name"] for c in new["classes"]}
    cls_name.update({c["token"]: c["name"] for c in old["classes"] if c["token"] not in cls_name})
    out: list[dict] = []

    def ch(kind: str, key, t: dict, **extra):
        out.append({
            "kind": kind, "class": key[0], "className": cls_name.get(key[0], key[0]),
            "tab": t.get("tab"), "talent": t["name"], "icon": t.get("icon"), "node": key[1], **extra,
        })

    for key in sorted(b.keys() - a.keys()):
        t = b[key]
        ch("added", key, t, after=_short(t["ranks"][-1]), max=t["max"])
    for key in sorted(a.keys() - b.keys()):
        t = a[key]
        ch("removed", key, t, before=_short(t["ranks"][-1]))
    for key in sorted(a.keys() & b.keys()):
        x, y = a[key], b[key]
        if x["name"] != y["name"]:
            ch("renamed", key, y, before=x["name"], after=y["name"])
        if x["max"] != y["max"]:
            ch("ranks", key, y, before=x["max"], after=y["max"])
        # compare max-rank text (what players read when fully invested)
        if x["ranks"][-1] != y["ranks"][-1]:
            ch("text", key, y, before=_short(x["ranks"][-1]), after=_short(y["ranks"][-1]),
               numbers=numbers_changed(x["ranks"][-1], y["ranks"][-1]))
        if (x["row"], x["col"], x["tab"]) != (y["row"], y["col"], y["tab"]):
            ch("moved", key, y, before=f"{x['tab']} {x['row'] + 1}:{x['col'] + 1}",
               after=f"{y['tab']} {y['row'] + 1}:{y['col'] + 1}")
        gx, gy = (x.get("gate") or {}).get("points", 0), (y.get("gate") or {}).get("points", 0)
        if gx != gy:
            ch("gate", key, y, before=gx, after=gy)
        if sorted(x.get("requires", [])) != sorted(y.get("requires", [])):
            names = lambda t, ids: [b.get((key[0], i), a.get((key[0], i), {"name": str(i)}))["name"] for i in ids]  # noqa: E731
            ch("requires", key, y, before=", ".join(names(x, x.get("requires", []))) or "—",
               after=", ".join(names(y, y.get("requires", []))) or "—")
        mx, my = {k: v for k, v in x["meta"].items() if k != "passive"}, {k: v for k, v in y["meta"].items() if k != "passive"}
        if mx != my:
            fmt = lambda m: ", ".join(f"{v}" for v in m.values()) or "—"  # noqa: E731
            ch("meta", key, y, before=fmt(mx), after=fmt(my))
    order = {"added": 0, "removed": 1, "ranks": 2, "text": 3, "meta": 4, "gate": 5, "requires": 6, "moved": 7, "renamed": 8}
    out.sort(key=lambda c: (c["class"], order[c["kind"]], c["talent"]))
    return out
