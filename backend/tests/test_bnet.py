"""Blizzard features against a fake Blizzard API (the shapes community probes report for Forever)."""

import os
import tempfile

import httpx
import pytest

if "FH_DATABASE_URL" not in os.environ:  # run alone or after test_api (which sets the same values)
    _tmp = tempfile.mkdtemp()
    os.environ["FH_DATABASE_URL"] = f"sqlite+aiosqlite:///{_tmp}/test.db"
    os.environ["FH_ADMIN_EMAIL"] = "boss@test"
    os.environ["FH_ADMIN_PASSWORD"] = "s3cret"

from fastapi.testclient import TestClient  # noqa: E402

from app import bnet, wow  # noqa: E402
from app.config import get_settings  # noqa: E402
from app.main import app  # noqa: E402
from app.routers import market  # noqa: E402

CALLS: list[str] = []

PROFILE = {
    "name": "Joe Gun", "level": 42, "character_class": {"id": 5, "name": "Priest"}, "race": {"name": "Undead"},
    "faction": {"type": "HORDE"}, "guild": {"name": "Deathwish", "key": {"href": "https://eu.api.blizzard.com/data/wow/guild/deathwish?namespace=profile-forever-eu"}},
    "equipped_item_level": 38,
}
EQUIPMENT = {"equipped_items": [
    {"slot": {"type": "HEAD", "name": "Head"}, "item": {"id": 19019}, "name": "Thunderfury",
     "quality": {"type": "LEGENDARY"}, "level": {"value": 80},
     "stats": [{"display": {"display_string": "+5 Agility"}}], "enchantments": [{"display_string": "Crusader"}]},
]}
SPECS_RETAIL = {"specializations": [{"loadouts": [
    {"is_active": False, "selected_class_talents": [{"id": 1, "rank": 1, "tooltip": {"talent": {"id": 9}}}]},
    {"is_active": True, "selected_class_talents": [
        {"id": 105958, "rank": 3, "tooltip": {"talent": {"id": 77, "name": "Improved Heroic Strike"},
                                              "spell_tooltip": {"spell": {"id": 12282}}}},
    ]},
]}]}
SPECS_CLASSIC = {"specialization_groups": [{"is_active": True, "specializations": [{"talents": [
    {"talent": {"id": 5}, "talent_rank": 2, "spell_tooltip": {"spell": {"id": 14522, "name": "Unbreakable Will"}}},
]}]}]}
AUCTIONS = {"auctions": [
    {"id": 1, "item": {"id": 2589}, "buyout": 1000, "quantity": 20},  # 50 per unit
    {"id": 2, "item": {"id": 2589}, "buyout": 300, "quantity": 5},  # 60 per unit
    {"id": 3, "item": {"id": 2589}, "bid": 10, "quantity": 1},  # bid only
    {"id": 4, "item": {"id": 4306}, "unit_price": 120, "quantity": 7},
]}


def handler(req: httpx.Request) -> httpx.Response:
    CALLS.append(f"{req.method} {req.url}")
    p, ns = req.url.path, req.url.params.get("namespace", "")
    if p == "/token":
        if b"authorization_code" in req.content:
            assert b"code=good" in req.content
            return httpx.Response(200, json={"access_token": "user-token", "expires_in": 86399})
        return httpx.Response(200, json={"access_token": "app-token", "expires_in": 86399})
    if p == "/userinfo":
        return httpx.Response(200, json={"battletag": "Joe#1234"})
    if p == "/profile/user/wow":
        assert req.headers["authorization"] == "Bearer user-token" and ns == "profile-forever-eu"
        href = "https://eu.api.blizzard.com/profile/wow/character/{}?namespace=profile-forever-eu"
        return httpx.Response(200, json={"wow_accounts": [{"characters": [
            {"name": "Joe Gun", "key": {"href": href.format("joe-gun")}},
            {"name": "Ann Bell", "key": {"href": href.format("ann-bell")}},
        ]}]})
    if p == "/data/wow/guild/deathwish/roster":
        return httpx.Response(200, json={"guild": {"name": "Deathwish"}, "members": [
            {"character": {"name": "Zed Low", "level": 20, "playable_class": {"id": 4}}, "rank": 3},
            {"character": {"name": "Joe Gun", "level": 42, "playable_class": {"id": 5}}, "rank": 0},
        ]})
    if p == "/data/wow/ruleset/index":
        return httpx.Response(200, json={"rulesets": [{"id": 1, "name": "PvP"}, {"id": 2, "name": "Normal"}]})
    if p == "/data/wow/ruleset/1/auctions/":
        return httpx.Response(200, json={"auctions": [{"id": 6, "name": "Horde"}, {"id": 2, "name": "Alliance"}]})
    if p == "/data/wow/ruleset/1/auctions/6":
        return httpx.Response(200, json=AUCTIONS)
    if p.startswith("/data/wow/item/") or p.startswith("/data/wow/media/item/"):
        if ns == "static-forever-eu":
            return httpx.Response(403, text="forbidden")  # plain static refused: versioned one works
        assert ns == "static-1.60.1_70755-forever-eu", ns
        iid = int(p.rsplit("/", 1)[1])
        if "media" in p:
            return httpx.Response(200, json={"assets": [{"key": "icon", "value": f"https://render/{iid}.jpg"}]})
        return httpx.Response(200, json={"id": iid, "name": {"en_US": "Linen Cloth", "ru_RU": "Льняная ткань"},
                                         "quality": {"type": "COMMON"}, "level": 5})
    if p == "/profile/wow/character/joe-gun":
        return httpx.Response(200, json=PROFILE)
    if p == "/profile/wow/character/joe-gun/equipment":
        return httpx.Response(200, json=EQUIPMENT)
    if p == "/profile/wow/character/joe-gun/specializations":
        return httpx.Response(200, json=SPECS_RETAIL)
    if p == "/profile/wow/character/joe-gun/character-media":
        return httpx.Response(404, json={"code": 404})
    return httpx.Response(404, json={"code": 404, "path": p})


@pytest.fixture(scope="module")
def client():
    s = get_settings().model_copy(update={"bnet_client_id": "id", "bnet_client_secret": "secret"})
    with TestClient(app) as c:
        bnet.set_client(bnet.Bnet(s, transport=httpx.MockTransport(handler)))
        r = c.post("/api/auth/login", json={"email": "boss@test", "password": "s3cret"})
        assert r.status_code == 200
        yield c


def test_status_lists_rulesets(client):
    st = client.get("/api/bnet/status?region=eu&lang=en").json()
    assert st["configured"] and st["ok"] and [r["name"] for r in st["rulesets"]] == ["PvP", "Normal"]


def test_probe_reports_codes(client):
    rows = {p["name"]: p for p in client.get("/api/bnet/probe?character=Joe Gun").json()}
    assert rows["rulesets"]["status"] == 200 and rows["realms"]["status"] == 404
    assert rows["item"]["status"] == 403 and rows["item (versioned)"]["status"] == 200
    assert rows["character"]["status"] == 200 and rows["character/character-media"]["status"] == 404
    assert rows["auction houses"]["status"] == 200


def test_character_card(client):
    c = client.post("/api/characters", json={"name": "Joe Gun", "region": "eu"}).json()
    assert c["slug"] == "joe-gun" and c["error"] is None
    assert c["summary"]["en"]["level"] == 42 and c["summary"]["en"]["guild"]["name"] == "Deathwish"
    eq = c["equipment"]["ru"][0]
    assert eq["name"] == "Thunderfury" and eq["stats"] == ["+5 Agility"] and eq["icon"] == "https://render/19019.jpg"
    assert c["talents"] == [{"node": 105958, "talent": 77, "spell": 12282, "name": "Improved Heroic Strike", "rank": 3}]
    assert c["missing"] == ["media"]
    assert len(client.get("/api/characters").json()) == 1
    assert client.delete(f"/api/characters/{c['id']}").status_code == 204


def test_guild_roster(client):
    c = client.post("/api/characters", json={"name": "Joe Gun", "region": "eu"}).json()
    g = client.get(f"/api/characters/{c['id']}/guild?lang=en").json()
    assert g["name"] == "Deathwish" and [m["name"] for m in g["members"]] == ["Joe Gun", "Zed Low"]
    client.delete(f"/api/characters/{c['id']}")


def test_battlenet_sign_in_imports_characters(client):
    r = client.get("/api/bnet/login?region=eu", follow_redirects=False)
    assert r.status_code == 307 and r.headers["location"].startswith("https://oauth.battle.net/authorize?")
    loc = httpx.URL(r.headers["location"])
    assert loc.params["redirect_uri"].endswith("/api/bnet/callback") and "wow.profile" in loc.params["scope"]
    assert client.get("/api/bnet/callback?code=good&state=wrong", follow_redirects=False).headers["location"].endswith(
        "bnet=bad_state")
    r = client.get(f"/api/bnet/callback?code=good&state={loc.params['state']}", follow_redirects=False)
    assert r.headers["location"] == "/characters?bnet=ok"
    chars = {c["slug"]: c for c in client.get("/api/characters").json()}
    assert set(chars) == {"joe-gun", "ann-bell"} and chars["joe-gun"]["source"] == "bnet"
    assert chars["joe-gun"]["summary"]["en"]["level"] == 42 and chars["ann-bell"]["error"] == "not_found"
    assert client.get("/api/bnet/account").json()["battletag"] == "Joe#1234"
    for c in chars.values():
        client.delete(f"/api/characters/{c['id']}")


def test_unknown_character(client):
    c = client.post("/api/characters", json={"name": "Nobody Here", "region": "eu"}).json()
    assert c["error"] == "not_found"


def test_item_cache_and_versioned_static(client):
    n = len(CALLS)
    it = client.get("/api/items/2589?lang=ru").json()
    assert it["name"] == "Льняная ткань" and it["icon"] == "https://render/2589.jpg"
    assert client.get("/api/items/2589?lang=en").json()["name"] == "Linen Cloth"
    # the second language came from the cache; the client now goes straight to the versioned namespace
    assert len(CALLS) - n <= 4


def test_market_poll_and_watch(client):
    cfg = client.get("/api/market/config").json()
    assert cfg["houses"] == [{"id": 6, "name": "Horde"}, {"id": 2, "name": "Alliance"}]
    assert client.put("/api/market/config", json={"region": "eu", "ruleset": 1, "house": 6}).status_code == 200
    w = client.post("/api/market/watch", json={"item_id": 2589, "below": 55}).json()
    st = client.post("/api/market/refresh").json()
    assert st["ok"] and st["items"] == 2 and st["auctions"] == 4
    cards = client.get("/api/market/watch?lang=en").json()
    assert cards[0]["latest"]["min"] == 50 and cards[0]["latest"]["quantity"] == 26 and cards[0]["alert"]
    assert len(cards[0]["history"]) == 1 and cards[0]["item"]["name"] == "Linen Cloth"
    assert client.get("/api/market/price/4306").json()["min"] == 120
    assert client.delete(f"/api/market/watch/{w['id']}").status_code == 204


def test_talents_classic_shape():
    assert wow.talents(SPECS_CLASSIC) == [
        {"node": None, "talent": 5, "spell": 14522, "name": "Unbreakable Will", "rank": 2}]


def test_summarize_median_by_quantity():
    s = wow.summarize_auctions(AUCTIONS["auctions"])
    assert s[2589] == {"min": 50, "median": 50, "quantity": 26, "auctions": 3}
    assert s[4306]["min"] == 120


def test_not_configured_is_reported(client):
    off = bnet.Bnet(get_settings().model_copy(update={"bnet_client_id": ""}))
    old, bnet._client = bnet._client, off
    try:
        assert client.get("/api/bnet/status").json()["configured"] is False
        assert client.post("/api/characters", json={"name": "Joe Gun"}).json()["error"] == "not_configured"
    finally:
        bnet._client = old


def test_slug():
    assert bnet.slug("  Joe   Gun ") == "joe-gun"
    assert market.HISTORY_DAYS == 30
