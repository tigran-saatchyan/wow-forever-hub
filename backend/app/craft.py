"""Crafting economics: what a recipe costs, what its result fetches, and how to level a profession cheaply.

Pure functions over the recipe reference (app/recipes.py) and a price table, so they are tested directly.
Prices are in copper. A price table maps item id -> {"ah": lowest buyout on the chosen auction house or
None, "qty": units on sale}; the reference brings the vendor prices.

How things are valued:
- a reagent costs the cheaper of the auction house and a vendor, but a vendor only for the goods vendors
  actually stock (vials, threads, dyes, spices, flux…): the client knows a "buy price" for almost every
  item, and most of them are never on a vendor;
- a crafted item sells on the auction house for its lowest buyout less the 5% the house keeps, or to a
  vendor for its sell price, whichever is more; the deposit comes back when the item sells, so it is left out;
- a reagent with no price anywhere makes the cost unknown rather than lower.
"""

from __future__ import annotations

import math
from collections.abc import Callable
from typing import Any

AH_CUT = 0.05  # the faction auction house keeps 5% of the sale

# Reagents vendors sell in Classic (trade goods, alchemy, cooking, tailoring, leatherworking, engineering,
# enchanting suppliers). Their price comes from the client (BuyPrice per VendorStackCount).
VENDOR_GOODS = {
    3371, 3372, 8925, 18256,  # Empty / Leaded / Crystal / Imbued Vial
    2320, 2321, 4291, 8343, 14341,  # Coarse / Fine / Silken / Heavy Silken / Rune Thread
    2324, 2325, 2604, 2605, 4340, 4341, 4342, 6260, 6261, 10290,  # Bleach and dyes
    4289, 8150,  # Salt, Deeprock Salt
    2880, 3466, 3857, 18567,  # Weak Flux, Strong Flux, Coal, Elemental Flux
    4399, 4400,  # Wooden Stock, Heavy Stock
    2678, 2692, 3713, 159, 1179, 2596, 4536,  # spices, water, milk, Skin of Dwarven Stout, Shiny Red Apple
    6217, 4470, 10940,  # Copper Rod, Simple Wood
    5140, 2928, 8924, 8923, 5173,  # Flash Powder and poison bases (rogues)
    10648, 6530,  # Common Parchment, Nightcrawlers
}


def need(r: dict) -> tuple[int, bool]:
    """The skill a recipe needs: exact when known, else ~30 below its first yellow (the trainers' usual gap)."""
    if r.get("skill"):
        return r["skill"], True
    return max(1, (r.get("yellow") or 1) - 30), False


def chance(r: dict, skill: int) -> float:
    """The chance to gain a point, as Classic works it: orange always, then falling to nothing at grey."""
    y, g = r.get("yellow"), r.get("gray")
    if not y or not g or skill < y:
        return 1.0
    if skill >= g:
        return 0.0
    return max(0.0, min(1.0, (g - skill) / (g - y)))


# Who sells what, and for how much, as ForeverDB's vendors say (app/fdb_sources.py vendor_price); set by the
# router when ForeverDB is configured. Without it, the hand-kept VENDOR_GOODS list and the client's buy price.
VENDOR_PRICE: Callable[[int], int | None] | None = None


def unit_cost(item: int, ref: dict, prices: dict) -> tuple[int | None, str | None]:
    """One reagent: the cheaper of the auction house and a vendor that sells it."""
    p = prices.get(item) or {}
    ah = p.get("ah")
    x = ref.get(str(item)) or {}
    vendor = VENDOR_PRICE(item) if VENDOR_PRICE else None
    if vendor is None and item in VENDOR_GOODS and x.get("buy"):
        vendor = math.ceil(x["buy"] / max(1, x.get("vstack") or 1))
    options = [(v, s) for v, s in ((ah, "ah"), (vendor, "vendor")) if v]
    if not options:
        return None, None
    return min(options)


def sale(item: int | None, ref: dict, prices: dict) -> dict:
    """What one crafted item fetches: on the auction house (after the cut) and from a vendor; the better one."""
    if not item:
        return {"ah": None, "vendor": None, "best": None, "where": None, "qty": 0}
    p = prices.get(item) or {}
    ah = math.floor(p["ah"] * (1 - AH_CUT)) if p.get("ah") else None
    vendor = (ref.get(str(item)) or {}).get("sell") or None
    best, where = max(((v, w) for v, w in ((ah, "ah"), (vendor, "vendor")) if v), default=(None, None))
    return {"ah": ah, "vendor": vendor, "best": best, "where": where, "qty": p.get("qty", 0)}


def economics(r: dict, ref: dict, prices: dict) -> dict:
    """A recipe's cost, its result's worth and the profit of one craft (a craft may make several)."""
    parts, cost, known = [], 0, bool(r.get("reagents"))  # no reagents in the reference: the cost is not known
    for item, n in r.get("reagents") or []:
        u, src = unit_cost(item, ref, prices)
        parts.append({"id": item, "count": n, "unit": u, "src": src})
        if u is None:
            known = False
        else:
            cost += u * n
    made = r.get("count") or 1
    s = sale(r.get("item"), ref, prices)
    value = s["best"] * made if s["best"] else None
    profit = value - cost if known and value is not None else None
    return {
        "cost": cost if known else None, "parts": parts, "made": made, "sale": s,
        "value": value, "profit": profit,
        "margin": round(profit / cost * 100, 1) if profit is not None and cost > 0 else None,
    }


def plan(recipes: list[dict], known: set[int], skill: int, target: int, ref: dict, prices: dict,
         resale: bool = True) -> dict:
    """The cheapest way from `skill` to `target`: at every point, the recipe with the lowest expected cost of
    one skill-up (cost of a craft / chance of a point, less what the result sells for when `resale`).

    Recipes not learned yet take part too and come back marked; a recipe item's own price is counted once.
    """
    steps: dict[int, dict] = {}
    total, gaps = 0.0, []
    econ = {r["id"]: economics(r, ref, prices) for r in recipes}
    for s in range(skill, target):
        best = None
        for r in recipes:
            n, _ = need(r)
            c = chance(r, s)
            e = econ[r["id"]]
            if n > s or c <= 0 or e["cost"] is None:
                continue
            per = e["cost"] - ((e["value"] or 0) if resale else 0)
            score = per / c  # expected cost of one point; below zero, the profit of one
            if best is None or score < best[0]:
                best = (score, r, c)
        if best is None:
            gaps.append(s)
            continue
        _, r, c = best
        st = steps.setdefault(r["id"], {"recipe": r, "crafts": 0.0, "from": s, "to": s + 1})
        st["crafts"] += 1 / c
        st["to"] = s + 1
    out, reagents = [], {}
    for st in sorted(steps.values(), key=lambda x: x["from"]):
        r, crafts = st["recipe"], math.ceil(st["crafts"] - 1e-9)
        e = econ[r["id"]]
        spent = e["cost"] * crafts
        back = (e["value"] or 0) * crafts if resale else 0
        learn = None
        if r["id"] not in known:
            learn = {"source": r.get("source"), "item": r.get("recipeItem")}
            if r.get("recipeItem"):
                u, _ = unit_cost(r["recipeItem"], ref, prices)
                learn["price"] = u
                spent += u or 0
        total += spent - back
        for p in e["parts"]:
            q = reagents.setdefault(p["id"], {"id": p["id"], "count": 0, "unit": p["unit"], "src": p["src"]})
            q["count"] += p["count"] * crafts
        out.append({"id": r["id"], "from": st["from"], "to": st["to"], "crafts": crafts, "cost": spent,
                    "back": back, "learn": learn})
    return {"steps": out, "reagents": sorted(reagents.values(), key=lambda x: -(x["unit"] or 0) * x["count"]),
            "total": round(total), "gaps": gaps}


def advice(ref: dict, prices: dict, items: set[int]) -> list[dict]:
    """For materials and goods: sell them on the auction house or to a vendor? (vendor wins when it pays more
    than the lowest buyout after the house's cut: then buying such an item on the auction house is profit too)."""
    out = []
    for i in items:
        s = sale(i, ref, prices)
        if not s["ah"] and not s["vendor"]:
            continue
        low = (prices.get(i) or {}).get("ah")
        # a vendor paying more than the cheapest buyout: buy it on the auction house, sell it to a vendor
        flip = s["vendor"] - low if s["vendor"] and low and s["vendor"] > low else None
        out.append({"id": i, "ah": s["ah"], "vendor": s["vendor"], "where": s["where"], "qty": s["qty"], "flip": flip})
    return sorted(out, key=lambda x: (x["where"] != "vendor", -(x["flip"] or 0), -(x["ah"] or x["vendor"] or 0)))


def flips(sell: dict[str, int], prices: dict, min_profit: int = 1) -> list[dict]:
    """Items a vendor buys for more than their cheapest buyout: buy on the auction house, sell to a vendor.
    No cut is taken when buying, so the profit is the vendor's price less the buyout, per item."""
    out = []
    for i, p in prices.items():
        low = p.get("ah")
        v = sell.get(str(i))
        if low and v and v - low >= min_profit:
            out.append({"id": i, "buy": low, "sell": v, "profit": v - low, "qty": p.get("qty", 0)})
    return sorted(out, key=lambda x: -x["profit"])


Prices = dict[int, dict[str, Any]]


def disenchant_value(results: list[dict], prices: dict) -> int | None:
    """What disenchanting an item is worth on the auction house: each result's chance × its average count × its
    lowest buyout less the cut; None when no result has a price."""
    total, known = 0.0, False
    for r in results:
        p = (prices.get(r.get("itemId")) or {}).get("ah")
        if not p:
            continue
        known = True
        total += (r.get("chancePercent") or 0) / 100 * ((r.get("min") or 1) + (r.get("max") or 1)) / 2 * p * (1 - AH_CUT)
    return round(total) if known else None
