"""Assemble status.json: builds per region, maintenance windows, optional realm API."""
from __future__ import annotations

import logging

from . import config, crowd, net, ribbit

log = logging.getLogger(__name__)


def realm_api_status() -> dict | None:
    """Blizzard Game Data API realm status. Needs BNET_CLIENT_ID/SECRET + namespace.

    As of 2026-10-08 Blizzard has not published a Forever namespace; once it does,
    set BNET_NAMESPACE (e.g. dynamic-forever-us) and this becomes authoritative.
    """
    if not (config.BNET_CLIENT_ID and config.BNET_CLIENT_SECRET and config.BNET_NAMESPACE):
        return None
    try:
        tok = net.session().post(
            "https://oauth.battle.net/token",
            data={"grant_type": "client_credentials"},
            auth=(config.BNET_CLIENT_ID, config.BNET_CLIENT_SECRET),
            timeout=20,
        ).json()["access_token"]
        region = config.BNET_NAMESPACE.rsplit("-", 1)[-1]
        url = f"https://{region}.api.blizzard.com/data/wow/connected-realm/index"
        idx = net.get(url, params={"namespace": config.BNET_NAMESPACE, "locale": "en_US"},
                      headers={"Authorization": f"Bearer {tok}"}).json()
        realms = []
        for link in idx.get("connected_realms", [])[:20]:
            cr = net.get(link["href"], headers={"Authorization": f"Bearer {tok}"}).json()
            realms.append({
                "status": cr.get("status", {}).get("type"),
                "population": cr.get("population", {}).get("type"),
                "queue": cr.get("has_queue"),
                "names": [r.get("name", {}).get("en_US") if isinstance(r.get("name"), dict) else r.get("name")
                          for r in cr.get("realms", [])],
            })
        return {"namespace": config.BNET_NAMESPACE, "realms": realms}
    except Exception as e:  # noqa: BLE001
        log.warning("realm API failed: %s", e)
        return {"error": str(e)}


def build_status(builds: list[dict], maintenance: list[dict]) -> dict:
    products = ribbit.forever_products()
    phase = config.phase()
    # During the beta follow the product with the newest build (Blizzard moved it
    # between codes); afterwards only the live client counts.
    pool = products if phase == "beta" else {p: r for p, r in products.items() if p in config.LIVE_PRODUCTS}
    product, regions = max(pool.items(), key=lambda kv: max(v["build"] for v in kv[1].values()),
                           default=(config.LIVE_PRODUCTS[0] if phase != "beta" else config.PRODUCTS["beta"], {}))
    latest = builds[-1] if builds else None
    return {
        "generated": ribbit.now_iso(),
        "phase": phase,
        "product": product,
        "products": {p: max(v["build"] for v in r.values()) for p, r in products.items()},
        "regions": regions,
        "latestBuild": latest,
        "builds": builds[-12:],
        "maintenance": maintenance[:10],
        "realmApi": realm_api_status(),
        "crowd": crowd.fetch(),
        "levelCap": int(__import__("os").environ.get("FH_LEVEL_CAP", "30" if phase == "beta" else "60")),
        "dates": config.KEY_DATES,
    }
