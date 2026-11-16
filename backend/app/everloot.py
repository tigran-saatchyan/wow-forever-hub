"""Everloot's public MCP server (https://everloot.app/mcp/public), called over plain JSON-RPC.

Everloot gathers what players' addons saw in WoW: Forever: who drops an item and how often, who sells it
and for how much, which quest gives it. A fact is public once 3 installs agree, so rare items often have
nothing yet; for those it still returns the Warcraft Wiki's classic entry (marked as such).
Licence: player-built facts are CC BY-SA 4.0; the page credits Everloot with a link.
"""

from __future__ import annotations

import itertools
import json
from typing import Any

import httpx

URL = "https://everloot.app/mcp/public"
_ids = itertools.count(1)


class EverlootError(Exception):
    pass


async def call(http: httpx.AsyncClient, tool: str, args: dict[str, Any]) -> dict:
    """One tool call; returns {"text": …, "data": structuredContent}."""
    r = await http.post(
        URL,
        json={"jsonrpc": "2.0", "id": next(_ids), "method": "tools/call", "params": {"name": tool, "arguments": args}},
        headers={"Accept": "application/json, text/event-stream", "MCP-Protocol-Version": "2025-03-26"},
        timeout=40,
    )
    if r.status_code != 200:
        raise EverlootError(f"{tool}: HTTP {r.status_code}")
    body = r.text
    if body.lstrip().startswith("event:") or "\ndata:" in body:  # streamed answer: take the JSON line
        body = next((ln[5:].strip() for ln in body.splitlines() if ln.startswith("data:")), "{}")
    d = json.loads(body)
    if "error" in d:
        raise EverlootError(f"{tool}: {d['error'].get('message')}")
    res = d.get("result") or {}
    text = "".join(c.get("text", "") for c in res.get("content") or [] if c.get("type") == "text")
    return {"text": text, "data": res.get("structuredContent") or {}}


def relations(data: dict) -> dict[str, list[dict]]:
    """entity_relations edges grouped by relation, observed ones only (not "found in game files")."""
    out: dict[str, list[dict]] = {}
    for e in (data.get("page") or {}).get("edges") or []:
        if e.get("evidence") == "client":
            continue
        out.setdefault(e.get("rel", ""), []).append(e)
    return out


def drops(data: dict, limit: int = 12) -> list[dict]:
    """item_page drops, the surest first: more kills seen and a higher rate."""
    xs = [d for d in (data.get("page") or {}).get("drops") or [] if d.get("sourceNpcId")]
    xs.sort(key=lambda d: (-(d.get("rate") or 0) * min(1.0, (d.get("kills") or 0) / 20), -(d.get("kills") or 0)))
    return xs[:limit]


def wiki(data: dict, name: str) -> list[dict]:
    """answer_sources lore claims about exactly this item (its own Warcraft Wiki page)."""
    out = []
    for ev in data.get("evidence") or []:
        title = ((ev.get("source") or {}).get("title") or "").strip().lower()
        if ev.get("kind") == "lore" and title == name.strip().lower():
            src = ev.get("source") or {}
            out.append({"text": ev.get("claim", ""), "url": src.get("url"), "asOf": ev.get("asOf")})
    return out
