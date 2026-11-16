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
    os.environ["FH_EVERLOOT_PREFETCH"] = "0"
os.environ["FH_EVERLOOT_PREFETCH"] = "0"

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
            {"name": "Joe", "surname": "Gun", "level": 42},  # no link: the surname makes the lookup work
            {"name": "Valthanis", "key": {"href": href.format("valthanis-deadrunner")}},  # Forever: first name + link
            {"name": "Tiny", "level": 1, "playable_class": {"id": 4}, "playable_race": {"id": 5},
             "key": {"href": href.format("tiny")}},  # Blizzard keeps profiles under 10 to itself
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
        com = {"href": "https://x/ruleset/1/auctions/6/commodities"}
        return httpx.Response(200, json={**AUCTIONS, "commodities": com})
    if p == "/data/wow/ruleset/1/auctions/6/commodities":
        stack = {"id": 9, "item": {"id": 2589}, "quantity": 100, "unit_price": 40}
        return httpx.Response(200, json={"auctions": [stack]})
    if p.startswith("/data/wow/item/") or p.startswith("/data/wow/media/item/"):
        if ns == "static-forever-eu":
            return httpx.Response(403, text="forbidden")  # plain static refused: versioned one works
        assert ns == "static-1.60.1_70755-forever-eu", ns
        iid = int(p.rsplit("/", 1)[1])
        if iid == 777 and "media" not in p:
            return httpx.Response(404, json={"code": 404})  # item refused, icon still there
        if iid == 19019 and "media" not in p:  # asked without a locale: every text is a dict of translations
            loc = lambda en, ru: {"en_US": en, "ru_RU": ru}  # noqa: E731
            return httpx.Response(200, json={"id": iid, "name": loc("Thunderfury", "Громовая ярость"), "level": 80,
                "quality": {"type": "LEGENDARY"}, "preview_item": {
                    "stats": [{"display": {"display_string": loc("+5 Agility", "+5 к ловкости")}}],
                    "spells": [{"description": loc("Chance on hit", "Шанс при попадании")}],
                    "weapon": {"damage": {"display_string": loc("44 - 115 Damage", "Урон: 44 - 115")},
                               "attack_speed": {"display_string": loc("Speed 1.90", "Скорость 1.90")}},
                    "sell_price": {"value": 161025, "display_strings": {"header": loc("Sell Price:", "Цена:")}},
                    "binding": {"name": loc("Binds when picked up", "Персональный при поднятии")}}})
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
    if p == "/profile/wow/character/joe-gun/statistics":
        return httpx.Response(200, json={"health": 1200, "power": 900, "power_type": {"name": "Mana"},
                                         "intellect": {"base": 80, "effective": 95}, "spell_crit": {"value": 3.456}})
    if p == "/profile/wow/character/joe-gun/professions":
        return httpx.Response(200, json={
            "primaries": [{"profession": {"id": 197, "name": "Tailoring"},
                           "skill_points": 150, "max_skill_points": 225}],
            "secondaries": [{"profession": {"id": 185, "name": "Cooking"},
                             "tiers": [{"skill_points": 40, "max_skill_points": 75}]}]})
    if p == "/profile/wow/character/joe-gun/pvp-summary":
        return httpx.Response(200, json={"honorable_kills": 321, "pvp_map_statistics": [
            {"world_map": {"name": "Warsong Gulch"}, "match_statistics": {"played": 10, "won": 6, "lost": 4}}]})
    if p == "/profile/wow/character/joe-gun/reputations":
        return httpx.Response(200, json={"reputations": [
            {"faction": {"name": "Undercity"}, "standing": {"raw": 9000, "value": 3000, "max": 6000, "tier": 4,
                                                             "name": "Friendly"}}]})
    if req.url.host == "render.worldofwarcraft.com":
        return httpx.Response(200, content=b"\xff\xd8jpeg", headers={"content-type": "image/jpeg"})
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


def test_raw_answer(client):
    r = client.get("/api/bnet/raw?kind=dynamic&path=/data/wow/ruleset/1/auctions/")
    assert r.status_code == 200 and r.json()["auctions"][0]["name"] == "Horde"
    assert client.get("/api/bnet/raw?kind=dynamic&path=https://evil/").status_code == 422
    assert client.get("/api/bnet/raw?kind=dynamic&path=/data/wow/nope").status_code == 502


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
    assert c["stats"]["en"] == {"health": 1200, "power": 900, "intellect": 95, "spell_crit": 3.46, "powerName": "Mana"}
    tail, cook = c["professions"]["en"]
    assert tail | {"known": [], "knownNames": [], "hasKnown": False} == tail
    assert (tail["name"], tail["kind"], tail["skill"], tail["max"]) == ("Tailoring", "primary", 150, 225)
    assert (cook["name"], cook["kind"], cook["skill"], cook["max"]) == ("Cooking", "secondary", 40, 75)
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
    assert set(chars) == {"joe-gun", "ann-bell", "joe", "tiny", "valthanis-deadrunner"}
    assert chars["joe-gun"]["source"] == "bnet"
    tiny = chars["tiny"]
    assert tiny["error"] == "low_level" and tiny["summary"]["en"]["level"] == 1
    assert tiny["summary"]["en"]["classId"] == 4
    assert chars["joe"]["summary"]["en"]["level"] == 42 and chars["joe"]["error"] is None
    bad = client.get(f"/api/characters/{chars['ann-bell']['id']}").json()
    assert bad["account"]["name"] == "Ann Bell" and bad["tried"] == ["/profile/wow/character/ann-bell"]
    assert chars["joe-gun"]["summary"]["en"]["level"] == 42 and chars["ann-bell"]["error"] == "not_found"
    assert client.get("/api/bnet/account").json()["battletag"] == "Joe#1234"
    for c in chars.values():
        client.delete(f"/api/characters/{c['id']}")


def test_media_proxy(client):
    r = client.get("/api/media?u=https://render.worldofwarcraft.com/eu/icons/56/inv_misc.jpg")
    assert r.status_code == 200 and r.headers["content-type"] == "image/jpeg"
    assert client.get("/api/media?u=https://evil.example/x.jpg").status_code == 422


def test_character_order_and_favorites(client):
    a = client.post("/api/characters", json={"name": "Joe Gun"}).json()["id"]
    b = client.post("/api/characters", json={"name": "Nobody Here"}).json()["id"]
    assert [c["id"] for c in client.get("/api/characters").json()][-2:] == [a, b]
    r = client.put("/api/characters/layout", json={"order": [b, a, 99999], "favorites": [a, 99999]}).json()
    assert r == {"order": [b, a], "favorites": [a]}
    rows = client.get("/api/characters").json()
    assert [c["id"] for c in rows][:2] == [b, a] and [c["favorite"] for c in rows][:2] == [False, True]
    for cid in (a, b):
        client.delete(f"/api/characters/{cid}")


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


def test_item_texts_are_strings(client):
    it = client.get("/api/items/19019?lang=ru").json()
    assert it["name"] == "Громовая ярость" and it["stats"] == ["+5 к ловкости"]
    assert it["spells"] == ["Шанс при попадании"] and it["damage"] == "Урон: 44 - 115"
    assert it["speed"] == "Скорость 1.90" and it["sell"] == 161025 and it["binding"] == "Персональный при поднятии"
    part = client.get("/api/items/777?lang=ru").json()
    assert part["partial"] and part["icon"] == "https://render/777.jpg"
    assert wow._lines([{"display_string": {"en_US": "Crusader", "ru_RU": "Рыцарь"}}], "ru") == ["Рыцарь"]


def test_market_poll_and_watch(client):
    cfg = client.get("/api/market/config").json()
    assert cfg["houses"] == [{"id": 6, "name": "Horde"}, {"id": 2, "name": "Alliance"}]
    assert client.put("/api/market/config", json={"region": "eu", "ruleset": 1, "house": 6}).status_code == 200
    w = client.post("/api/market/watch", json={"item_id": 2589, "below": 55}).json()
    st = client.post("/api/market/refresh").json()
    assert st["ok"] and st["items"] == 2 and st["auctions"] == 5  # 4 lots + 1 stack of goods
    cards = client.get("/api/market/watch?lang=en").json()
    assert cards[0]["latest"]["min"] == 40 and cards[0]["latest"]["quantity"] == 126 and cards[0]["alert"]
    assert len(cards[0]["history"]) == 1 and cards[0]["item"]["name"] == "Linen Cloth"
    assert client.get("/api/market/price/4306").json()["min"] == 120
    assert client.delete(f"/api/market/watch/{w['id']}").status_code == 204
    cmp = {h["id"]: h for h in client.get("/api/market/compare?ruleset=1&item=2589").json()}
    assert cmp[6]["lots"] == 5 and cmp[6]["itemMin"] == 40 and cmp[6]["itemQty"] == 126
    assert cmp[2]["error"] and cmp[2]["lots"] == 0


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


TABLES = {
    "SkillLine": [{"ID": "197", "DisplayName_lang": "Tailoring", "CategoryID": "11", "ParentSkillLineID": "0"},
                  {"ID": "6", "DisplayName_lang": "Frost", "CategoryID": "7", "ParentSkillLineID": "0"}],
    "SkillLine@ru": [{"ID": "197", "DisplayName_lang": "Портняжное дело"}],
    "SkillLineAbility": [
        {"ID": "1", "SkillLine": "197", "Spell": "3908", "MinSkillLineRank": "1", "AcquireMethod": "0",
         "TrivialSkillLineRankLow": "0", "TrivialSkillLineRankHigh": "0", "ClassMask": "0"},  # the profession
        {"ID": "2", "SkillLine": "197", "Spell": "2387", "MinSkillLineRank": "1", "AcquireMethod": "1",
         "TrivialSkillLineRankLow": "35", "TrivialSkillLineRankHigh": "60", "ClassMask": "0"},
        {"ID": "3", "SkillLine": "197", "Spell": "3914", "MinSkillLineRank": "30", "AcquireMethod": "0",
         "TrivialSkillLineRankLow": "55", "TrivialSkillLineRankHigh": "75", "ClassMask": "0"},
        {"ID": "4", "SkillLine": "197", "Spell": "3866", "MinSkillLineRank": "110", "AcquireMethod": "0",
         "TrivialSkillLineRankLow": "135", "TrivialSkillLineRankHigh": "155", "ClassMask": "0"},
        {"ID": "5", "SkillLine": "6", "Spell": "116", "MinSkillLineRank": "1", "ClassMask": "128"},  # a class spell
        {"ID": "6", "SkillLine": "197", "Spell": "9999", "MinSkillLineRank": "1", "AcquireMethod": "0",
         "TrivialSkillLineRankLow": "40", "TrivialSkillLineRankHigh": "60", "ClassMask": "0"},  # nameless helper
    ],
    "SpellName": [{"ID": "2387", "Name_lang": "Linen Cloak"}, {"ID": "3914", "Name_lang": "Brown Linen Pants"},
                  {"ID": "3866", "Name_lang": "Stylish Red Shirt"}],
    "SpellName@ru": [{"ID": "2387", "Name_lang": "Льняной плащ"}],
    "SpellEffect": [
        {"SpellID": "2387", "Effect": "24", "EffectItemType": "2570", "DifficultyID": "0"},
        {"SpellID": "3914", "Effect": "24", "EffectItemType": "4343", "DifficultyID": "0"},
        {"SpellID": "3866", "Effect": "24", "EffectItemType": "6833", "DifficultyID": "0"},
        {"SpellID": "3871", "Effect": "36", "EffectTriggerSpell": "3866", "DifficultyID": "0"},
    ],
    "SpellReagents": [{"SpellID": "2387", "Reagent_0": "2996", "ReagentCount_0": "1",
                       "Reagent_1": "2320", "ReagentCount_1": "1"}],
    "ItemSparse": [{"ID": "2570", "Display_lang": "Linen Cloak", "OverallQualityID": "1"},
                   {"ID": "2996", "Display_lang": "Bolt of Linen Cloth", "OverallQualityID": "1"},
                   {"ID": "6833", "Display_lang": "White Tuxedo Shirt", "OverallQualityID": "1"},
                   {"ID": "6272", "Display_lang": "Pattern: Stylish Red Shirt", "OverallQualityID": "2"}],
    "ItemSparse@ru": [{"ID": "2570", "Display_lang": "Льняной плащ"}],
    "ItemEffect": [{"ID": "50", "SpellID": "3871", "ParentItemID": "0"}],
    "ItemXItemEffect": [{"ItemID": "6272", "ItemEffectID": "50"}],
}


def test_recipes_dataset():
    from app import recipes

    ds = recipes.build_dataset(TABLES, "1.60.1.70755")
    assert list(ds["professions"]) == ["197"]
    p = ds["professions"]["197"]
    assert p["name"] == {"en": "Tailoring", "ru": "Портняжное дело"}
    by = {r["spell"]: r for r in p["recipes"]}
    assert set(by) == {2387, 3914, 3866}  # the profession spell itself and class spells are not recipes
    assert by[2387]["source"] == "auto" and by[2387]["reagents"] == [[2996, 1], [2320, 1]]
    assert by[2387]["name"]["ru"] == "Льняной плащ" and by[2387]["yellow"] == 35 and by[2387]["gray"] == 60
    assert by[3914]["source"] == "trainer" and by[3914]["skill"] == 30
    assert by[3866]["source"] == "item" and by[3866]["recipeItem"] == 6272 and by[3866]["skill"] == 110
    assert by[2387]["skill"] is None  # MinSkillLineRank 1 on a trainer recipe: the real need is unknown
    assert ds["items"]["2570"]["ru"] == "Льняной плащ" and ds["items"]["6272"]["q"] == 2


def test_professions_api(client, monkeypatch):
    from app import recipes

    async def fake_fetch(build, http=None):
        return TABLES

    monkeypatch.setattr(recipes, "fetch_tables", fake_fetch)
    import time as _t

    st = client.get("/api/professions").json()
    for _ in range(50):
        if st["status"] == "ready":
            break
        _t.sleep(0.05)
        st = client.get("/api/professions").json()
    assert st["status"] == "ready" and st["professions"][0]["recipes"] == 3
    p = client.get("/api/professions/197?lang=ru").json()
    cloak = next(r for r in p["recipes"] if r["spell"] == 2387)
    assert p["name"] == "Портняжное дело" and cloak["item"]["name"] == "Льняной плащ"
    assert cloak["reagents"][0] == {"id": 2996, "name": "Bolt of Linen Cloth", "q": 1, "count": 1}
    assert cloak["reagents"][1]["name"] == "#2320"  # not in the item table: shown by id


def test_known_recipes(client):
    c = client.post("/api/characters", json={"name": "Joe Gun"}).json()
    url = f"/api/characters/{c['id']}/known"
    assert client.get(url).json() == {}
    assert client.put(url, json={"line": 197, "ids": [3, 2], "known": True}).json() == {"197": [2, 3]}
    assert client.put(url, json={"line": 197, "ids": [3], "known": False}).json() == {"197": [2]}
    assert client.get(url).json() == {"197": [2]}
    client.delete(f"/api/characters/{c['id']}")


def test_armory_tabs(client):
    c = client.post("/api/characters", json={"name": "Joe Gun"}).json()
    pvp = client.get(f"/api/characters/{c['id']}/tab/pvp?lang=en").json()
    assert pvp["available"] and pvp["data"]["honorable_kills"] == 321
    assert pvp["data"]["maps"] == [{"name": "Warsong Gulch", "played": 10, "won": 6, "lost": 4}]
    rep = client.get(f"/api/characters/{c['id']}/tab/reputations?lang=en").json()["data"]
    assert rep == [{"name": "Undercity", "standing": "Friendly", "tier": 4, "value": 3000, "max": 6000, "raw": 9000}]
    off = client.get(f"/api/characters/{c['id']}/tab/mounts?lang=en").json()
    assert off == {"available": False, "status": 404, "data": None, "at": None}
    assert client.get(f"/api/characters/{c['id']}/tab/nope").status_code == 404
    client.delete(f"/api/characters/{c['id']}")


def test_item_sources(client, monkeypatch):
    from app import everloot
    from app.routers import sources

    async def fake_call(http, tool, args):
        if tool == "entity_relations":
            return {"text": "", "data": {"url": "https://everloot.app/database/items/2589", "page": {"edges": [
                {"rel": "sold_by", "toKind": "npc", "toId": 5783, "evidence": "observed", "installs": 3,
                 "lastSeen": "2026-11-09T23:17:59.000Z"},
                {"rel": "reagent_for", "toKind": "spell", "toId": 2162, "evidence": "client"},
                {"rel": "reward_from", "toKind": "quest", "toId": 7, "evidence": "observed", "installs": 4},
            ]}}}
        if tool == "item_page":
            return {"text": "", "data": {"dataAsOf": "2026-11-16T09:00:00Z", "page": {"drops": [
                {"sourceNpcId": 3101, "kills": 61, "drops": 19, "rate": 0.311, "reporters": 3},
                {"sourceNpcId": 3258, "kills": 2, "drops": 1, "rate": 0.5, "reporters": 3}]}}}
        if tool == "vendor_page":
            return {"text": "", "data": {"page": {"offers": [{"itemId": 2589, "priceCopper": 120, "unlimited": True}]}}}
        if tool == "quest_page":
            return {"text": "", "data": {"page": {"title": "Kobold Camp Cleanup"}}}
        if tool == "answer_sources":
            return {"text": "", "data": {"evidence": [
                {"kind": "lore", "claim": "Linen Cloth is cheap.", "source": {"title": "Linen Cloth", "url": "w"}},
                {"kind": "lore", "claim": "Patch notes", "source": {"title": "Patch 2.3.0", "url": "p"}}]}}
        raise AssertionError(tool)

    monkeypatch.setattr(everloot, "call", fake_call)
    sources._cache.clear()
    r = client.get("/api/sources/item/2589?lang=en").json()
    assert r["sold"] == [{"npc": 5783, "name": None, "installs": 3, "lastSeen": "2026-11-09T23:17:59.000Z",
                          "copper": 120, "limited": None, "unlimited": True}]
    assert [d["npc"] for d in r["drops"]] == [3101, 3258]  # 61 kills at 31% before 2 kills at 50%
    assert r["quests"] == [{"quest": 7, "title": "Kobold Camp Cleanup", "installs": 4}]
    assert r["wiki"] == [{"text": "Linen Cloth is cheap.", "url": "w", "asOf": None}]
    assert r["item"]["name"] == "Linen Cloth"


def test_surname():
    # profile: its own field (real answer for asavar-kul, November 2026)
    assert wow.character_summary({"name": "Asavar", "surname": "Kul", "name_search": "Asavar Kul"})["surname"] == "Kul"
    assert wow.surname({"name": "Asavar", "name_search": "Asavar Kul"}) == "Kul"
    # guild roster: no field, only the link /character/name-surname
    r = wow.roster({"members": [{"rank": 2, "character": {
        "name": "Valthanis", "level": 32,
        "key": {"href": "https://eu.api.blizzard.com/profile/wow/character/valthanis-deadrunner?namespace=x"}}}]})
    assert r[0]["surname"] == "Deadrunner"
    assert wow.surname({"name": "Solo"}) is None



def test_reimport_keeps_first_name_card(client):
    old = client.post("/api/characters", json={"name": "Valthanis"}).json()  # an early import: first name only
    r = client.get("/api/bnet/login?region=eu", follow_redirects=False)
    state = httpx.URL(r.headers["location"]).params["state"]
    client.get(f"/api/bnet/callback?code=good&state={state}", follow_redirects=False)
    chars = client.get("/api/characters").json()
    vals = [c for c in chars if c["slug"].startswith("valthanis")]
    assert [(c["id"], c["slug"]) for c in vals] == [(old["id"], "valthanis-deadrunner")]
    for c in chars:
        client.delete(f"/api/characters/{c['id']}")



def test_sources_prefetch_and_stale(client, monkeypatch):
    import asyncio as aio

    from app.routers import sources

    calls = []

    async def fake_refresh(item_id, lang):
        calls.append(item_id)
        return {"sold": [], "drops": [], "quests": [], "wiki": [{"text": "fresh"}]}

    async def fake_items():
        return [11, 12]

    monkeypatch.setattr(sources, "refresh", fake_refresh)
    monkeypatch.setattr(sources, "_recipe_items", fake_items)
    monkeypatch.setattr(sources, "PREFETCH_DELAY", 0)

    async def one_pass():
        task = aio.create_task(sources.prefetcher())
        await aio.sleep(0.3)
        task.cancel()

    aio.run(one_pass())
    assert calls[:2] == [11, 12]
