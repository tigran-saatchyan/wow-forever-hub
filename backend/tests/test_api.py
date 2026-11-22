import os
import tempfile

import pytest

_tmp = tempfile.mkdtemp()
os.environ["FH_DATABASE_URL"] = f"sqlite+aiosqlite:///{_tmp}/test.db"
os.environ["FH_ADMIN_EMAIL"] = "boss@test"
os.environ["FH_ADMIN_PASSWORD"] = "s3cret"
os.environ["FH_EVERLOOT_PREFETCH"] = "0"
os.environ["FH_REFRESH_HOURS"] = "0"
os.environ["FH_COLLECTOR"] = "0"

from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        yield c


def login(c):
    r = c.post("/api/auth/login", json={"email": "boss@test", "password": "s3cret"})
    assert r.status_code == 200, r.text
    return r.json()


def test_health_and_data(client):
    assert client.get("/api/health").json() == {"ok": True}
    idx = client.get("/data/index.json").json()
    assert idx["latest"].startswith("1.60.")


def test_auth(client):
    assert client.get("/api/auth/me").status_code == 401
    assert client.post("/api/auth/login", json={"email": "boss@test", "password": "nope"}).status_code == 401
    # browsers and password managers may add case changes or stray spaces to the email
    assert client.post("/api/auth/login", json={"email": " Boss@Test ", "password": "s3cret"}).status_code == 200
    me = login(client)
    assert me["role"] == "superadmin"
    assert client.get("/api/auth/me").json()["email"] == "boss@test"


def test_builds_crud(client):
    login(client)
    body = {
        "name": "Shadow PvP",
        "cls": "PRIEST",
        "level": 60,
        "version": "1.60.1.70755",
        "order": [1, 2],
        "talents": {"1": {"r": 2, "fp": "abc"}},
    }
    a = client.put("/api/builds", json=body).json()
    # same name in another case overwrites the same build
    b = client.put("/api/builds", json={**body, "name": "shadow pvp", "level": 40}).json()
    assert a["id"] == b["id"] and b["level"] == 40
    assert len(client.get("/api/builds").json()) == 1
    # opened, changed and saved under a new name: a second build, the first one is untouched
    c = client.put("/api/builds", json={**body, "id": a["id"], "name": "Shadow PvE", "level": 50}).json()
    assert c["id"] != a["id"]
    rows = {r["name"]: r for r in client.get("/api/builds").json()}
    assert rows["shadow pvp"]["level"] == 40 and rows["Shadow PvE"]["level"] == 50
    # rename in place keeps the id; a taken name is refused
    r = client.patch(f"/api/builds/{a['id']}", json={"name": " Shadow Duel "})
    assert r.status_code == 200 and r.json()["id"] == a["id"] and r.json()["name"] == "Shadow Duel"
    assert client.patch(f"/api/builds/{a['id']}", json={"name": "shadow pve"}).status_code == 409
    assert client.patch(f"/api/builds/{a['id']}", json={"name": "SHADOW duel"}).status_code == 200
    assert client.patch("/api/builds/nope", json={"name": "x"}).status_code == 404
    assert client.delete(f"/api/builds/{a['id']}").status_code == 204
    assert client.delete(f"/api/builds/{c['id']}").status_code == 204
    assert client.get("/api/builds").json() == []


def test_production_guard():
    from app.config import Settings

    with pytest.raises(RuntimeError, match="FH_JWT_SECRET"):
        Settings(env="production").check_production()
    ok = Settings(
        env="production",
        jwt_secret="x" * 40,
        admin_email="me@example.com",
        admin_password="long-enough-pass",
        cookie_secure=True,
        database_url="sqlite+aiosqlite:////var/lib/foreverhub/hub.db",
    )
    ok.check_production()


def test_spa_fallback(tmp_path, monkeypatch):
    (tmp_path / "assets").mkdir()
    (tmp_path / "index.html").write_text("<div id=root></div>")
    (tmp_path / "favicon.svg").write_text("<svg/>")
    from app import main
    from app.config import get_settings

    monkeypatch.setattr(get_settings(), "static_dir", tmp_path)
    with TestClient(main.create_app()) as c:
        assert "root" in c.get("/talents").text
        assert c.get("/favicon.svg").text == "<svg/>"
        assert c.get("/api/nope").status_code == 404
        assert c.get("/api/health").json() == {"ok": True}


def test_market_lists(client):
    login(client)
    ls = client.get("/api/market/lists").json()
    assert len(ls) == 1 and ls[0]["items"] == []  # every user starts with one list
    herbs = client.post("/api/market/lists", json={"name": "Травы"}).json()
    it = client.post(f"/api/market/lists/{herbs['id']}/items", json={"item_id": 2447, "below": 500}).json()
    assert it["itemId"] == 2447 and it["below"] == 500
    assert client.patch(f"/api/market/lists/{herbs['id']}", json={"name": "Травы и поты"}).json()["name"] == "Травы и поты"
    client.put(f"/api/market/lists/{herbs['id']}/pin", json={"pinned": True})
    assert [x["pinned"] for x in client.get("/api/market/lists").json()] == [False, True]
    ls = client.get("/api/market/lists").json()
    assert [x["name"] for x in ls][1] == "Травы и поты" and ls[1]["items"][0]["itemId"] == 2447
    assert client.delete(f"/api/market/lists/{herbs['id']}/items/{it['id']}").status_code == 204
    assert client.delete(f"/api/market/lists/{herbs['id']}").status_code == 204
    assert len(client.get("/api/market/lists").json()) == 1
    assert client.post("/api/market/lists", json={"name": ""}).status_code == 422


def test_market_bis_on_sale(client):
    import asyncio

    from app.db import AhLatest, Character, SessionLocal, Setting, User
    from sqlalchemy import select

    login(client)
    me = client.get("/api/auth/me").json()

    async def seed():
        async with SessionLocal() as s:
            uid = (await s.execute(select(User.id).where(User.email == me["email"]))).scalar_one()
            c = Character(user_id=uid, region="eu", slug="x", name="Valthanis",
                          profile={"summary": {"en": {"classId": 5, "level": 34, "faction": "HORDE"}}})
            s.add(c)
            await s.merge(Setting(key="market", value={"region": "eu", "ruleset": 1, "house": 113}))
            await s.commit()
            return c.id
    cid = asyncio.run(seed())
    first = client.get(f"/api/market/bis/{cid}?spec=shadow").json()
    assert first["status"] == "ready" and first["spec"] == "shadow" and first["rows"] == [] and first["checked"] > 0
    sale = next(iter(client.get(f"/api/bis/{cid}?spec=shadow").json()["slots"]["HEAD"]["options"]))

    async def put_lot():
        async with SessionLocal() as s:
            s.add(AhLatest(ruleset=1, house=113, item_id=sale["id"], min_price=12345, median_price=15000, quantity=2, auctions=2))
            await s.commit()
    asyncio.run(put_lot())
    rows = client.get(f"/api/market/bis/{cid}?spec=shadow").json()["rows"]
    assert rows == [r for r in rows if r["slot"] == "HEAD"] and rows[0]["rank"] == 1 and rows[0]["latest"]["min"] == 12345
    assert rows[0]["full"]["stats"] is not None and "wornItem" in rows[0]

    async def clean():  # the other test files share this database
        async with SessionLocal() as s:
            await s.delete(await s.get(Character, cid))
            await s.execute(AhLatest.__table__.delete())
            await s.execute(Setting.__table__.delete().where(Setting.key.in_(["market", f"bis:{cid}"])))
            await s.commit()
    asyncio.run(clean())


def test_character_instances_without_sources(client):
    import asyncio

    from app.db import Character, SessionLocal, User
    from sqlalchemy import select

    login(client)
    me = client.get("/api/auth/me").json()

    async def seed():
        async with SessionLocal() as s:
            uid = (await s.execute(select(User.id).where(User.email == me["email"]))).scalar_one()
            c = Character(user_id=uid, region="eu", slug="y", name="Y",
                          profile={"summary": {"en": {"classId": 5, "level": 34, "faction": "HORDE"}}})
            s.add(c)
            await s.commit()
            return c.id
    cid = asyncio.run(seed())
    d = client.get(f"/api/characters/{cid}/instances").json()
    assert d["level"] == 34 and d["fdb"] is False and d["available"] is False
    rfc = next(r for r in d["rows"] if r["nameEn"] == "Ragefire Chasm")  # the shipped list stands in for ForeverDB
    assert rfc["levels"] == [13, 18] and rfc["name"] == "Огненная пропасть" and rfc["open"] and rfc["cleared"] == 0
    assert any(not r["open"] for r in d["rows"])  # what is in the files but not open yet is listed too

    async def clean():
        async with SessionLocal() as s:
            await s.delete(await s.get(Character, cid))
            await s.commit()
    asyncio.run(clean())


def test_bis_compare_any_items(client):
    import asyncio

    from app.db import Character, SessionLocal, User
    from app.routers.bis import gear
    from sqlalchemy import select

    login(client)
    me = client.get("/api/auth/me").json()

    async def seed():
        async with SessionLocal() as s:
            uid = (await s.execute(select(User.id).where(User.email == me["email"]))).scalar_one()
            c = Character(user_id=uid, region="eu", slug="z", name="Z",
                          profile={"summary": {"en": {"classId": 5, "level": 34, "faction": "HORDE"}}})
            s.add(c)
            await s.commit()
            return c.id
    cid = asyncio.run(seed())
    cloth = next(int(k) for k, v in gear().items() if v["slot"] == 1 and v["cls"] == 4 and v["sub"] == 1)
    got = client.get(f"/api/bis/{cid}/compare?ids={cloth},999999999").json()
    assert got[0]["gear"] and got[0]["slot"] == "HEAD" and got[0]["full"]["id"] == cloth and got[1] == {"id": 999999999, "gear": False}

    async def clean():
        async with SessionLocal() as s:
            await s.delete(await s.get(Character, cid))
            await s.commit()
    asyncio.run(clean())


def test_prebis_for_a_shadow_priest_only(client):
    import asyncio

    from app.db import Character, SessionLocal, User
    from sqlalchemy import select

    login(client)
    me = client.get("/api/auth/me").json()

    async def seed():
        async with SessionLocal() as s:
            uid = (await s.execute(select(User.id).where(User.email == me["email"]))).scalar_one()
            c = Character(user_id=uid, region="eu", slug="p", name="P", profile={
                "summary": {"en": {"classId": 5, "level": 60, "faction": "HORDE"}},
                "talents": [{"name": "Shadow Focus", "rank": 3}, {"name": "Shadowform", "rank": 1}, {"name": "Mind Flay", "rank": 1}],
                "equipment": {"ru": [{"slot": "HEAD", "id": 22267, "statv": {"HIT_RATING": 10, "SPELL_POWER": 33}}]}})
            s.add(c)
            await s.commit()
            return c.id
    cid = asyncio.run(seed())
    d = client.get(f"/api/prebis/{cid}").json()
    assert d["available"] and d["spec"] == "shadow" and d["total"] == 17
    assert d["hit"]["talent"] == 3 and d["hit"]["gear"] == 1 and d["hit"]["talentList"][0]["rank"] == 3
    head = d["slots"][0]["center"][0]
    assert head["id"] == 22267 and head["worn"] and head["owned"] and not head["focus"]
    assert client.put(f"/api/prebis/{cid}/owned", json={"item_id": 12103, "owned": True}).json() == {"owned": [12103]}
    d = client.get(f"/api/prebis/{cid}").json()
    neck = d["slots"][1]
    assert any(x["marked"] for x in neck["hit"]) and not any(x["focus"] for k in ("center", "damage", "hit") for x in neck[k])
    assert d["hit"]["planned"] == round(3 + 1 + 1.3, 2)
    client.put(f"/api/bis/{cid}/spec", json={"spec": "holy"})
    assert client.get(f"/api/prebis/{cid}").json()["available"] is False  # not for another specialization

    async def clean():
        async with SessionLocal() as s:
            await s.delete(await s.get(Character, cid))
            await s.commit()
    asyncio.run(clean())


def test_fishing_gear(client):
    import asyncio

    from app.db import Character, SessionLocal, User
    from sqlalchemy import select

    login(client)
    me = client.get("/api/auth/me").json()

    async def seed():
        async with SessionLocal() as s:
            uid = (await s.execute(select(User.id).where(User.email == me["email"]))).scalar_one()
            c = Character(user_id=uid, region="eu", slug="f", name="F", profile={
                "summary": {"en": {"classId": 5, "level": 30, "faction": "HORDE"}},
                "professions": {"ru": [{"id": 356, "name": "Рыбная ловля", "skill": 125, "max": 150}]},
                "equipment": {"ru": [{"slot": "MAIN_HAND", "id": 6365}]}})
            s.add(c)
            await s.commit()
            return c.id
    cid = asyncio.run(seed())
    d = client.get(f"/api/profgear/{cid}/fishing").json()
    assert d["skill"] == 125 and d["max"] == 150
    by = {x["id"]: x for x in d["items"]}
    assert by[6365]["worn"] and by[6365]["owned"] and by[6365]["kind"] == "pole"
    assert by[6533]["bonus"] == 100 and by[6533]["minutes"] == 5 and by[6533]["skill"] == 100  # the lure, from the client
    assert client.put(f"/api/profgear/{cid}/owned", json={"item_id": 6530, "owned": True}).json() == {"owned": [6530]}
    assert {x["id"] for x in client.get(f"/api/profgear/{cid}/fishing").json()["items"] if x["owned"]} == {6365, 6530}
    assert client.get(f"/api/profgear/{cid}/juggling").status_code == 404
    mining = client.get(f"/api/profgear/{cid}/mining").json()["items"]
    assert any(x["id"] == 2901 and x["kind"] == "tool" for x in mining)  # the Mining Pick, from the client

    async def clean():
        async with SessionLocal() as s:
            await s.delete(await s.get(Character, cid))
            await s.commit()
    asyncio.run(clean())


def test_tier05(client):
    import asyncio

    from app.db import Character, SessionLocal, User
    from sqlalchemy import select

    login(client)
    me = client.get("/api/auth/me").json()

    async def seed():
        async with SessionLocal() as s:
            uid = (await s.execute(select(User.id).where(User.email == me["email"]))).scalar_one()
            c = Character(user_id=uid, region="eu", slug="t", name="T", profile={
                "summary": {"en": {"classId": 5, "level": 58, "faction": "HORDE"}},
                "equipment": {"ru": [{"slot": "WRIST", "id": 16697}]}})
            s.add(c)
            await s.commit()
            return c.id
    cid = asyncio.run(seed())
    d = client.get(f"/api/t05/{cid}").json()
    assert d["available"] and d["key"] == "5:HORDE" and len(d["slots"]) == 8
    wrist = next(x for x in d["slots"] if x["slot"] == "WRIST")
    assert wrist["t0"]["id"] == 16697 and wrist["t0"]["worn"] and wrist["t05"]["id"] == 22079 and wrist["quest"] == 8916
    mats = {m["id"]: m for m in d["materials"]}
    assert mats[13423]["count"] == 10 and 22338 not in mats  # Stonescale Oil to collect; Volcanic Ash drops on the quest
    assert any(m["id"] == 22338 for m in d["questItems"]) and d["gold"] == 600000  # copper: 20 + 40 gold
    client.put(f"/api/t05/{cid}/mark", json={"item_id": 13423, "on": True, "kind": "have"})
    client.put(f"/api/t05/{cid}/mark", json={"item_id": 16696, "on": True})
    d = client.get(f"/api/t05/{cid}").json()
    assert next(m for m in d["materials"] if m["id"] == 13423)["have"]
    assert next(x for x in d["slots"] if x["slot"] == "WAIST")["t0"]["owned"]

    async def clean():
        async with SessionLocal() as s:
            await s.delete(await s.get(Character, cid))
            await s.commit()
    asyncio.run(clean())


def test_raid_consumables_list():
    from app.routers.craft import _raid_items

    xs = {x["item"]: x for x in _raid_items()}
    assert xs[13512]["kind"] == "flask" and xs[13512]["eff"] == {"sp": 150} and "caster" in xs[13512]["roles"]
    assert xs[13931]["kind"] == "food" and xs[13931]["prof"] == "cooking"  # Nightfin Soup: the food's own value
    assert any(x["kind"] == "protection" and x["eff"].get("absorb", {}).get("fire") for x in xs.values())  # Onyxia's fire


def test_hidden_item_tooltip_from_reference():
    """An item Blizzard does not know (hidden in Forever) gets its tooltip from ForeverDB's item in the reference."""
    from app import fdb_gear
    from app.routers import bis as bis_routes
    from app.routers.items import from_reference

    fdb_gear._extra["99990016693"] = fdb_gear.convert({
        "name": "Devout Crown", "qualityId": 3, "itemLevel": 60, "requiredLevel": 57, "inventoryTypeId": 1, "classId": 4,
        "subclassId": 1, "bonding": "Binds when picked up", "stats": [{"statId": 5, "value": 24}],
        "effects": [{"text": "Equip: Increases damage and healing done by magical spells and effects by up to 15."}], "icon": "inv_helmet_27"})
    bis_routes._merged = (None, {})
    try:
        t = from_reference(99990016693, "ru")
        assert t["name"] == "Devout Crown" and t["quality"] == "RARE" and t["slot"] == "Голова" and t["subclass"] == "Ткань"
        assert t["stats"] == ["+24 к интеллекту"] and "up to 15" in t["spells"][0] and t["icon"].endswith("inv_helmet_27.jpg")
        assert t["binding"].startswith("Становится персональным при получении")
    finally:
        fdb_gear._extra.pop("99990016693", None)
        bis_routes._merged = (None, {})


def test_raid_consumables_only_the_best():
    from app.routers.craft import _raid_items, top_ids

    xs = {x["item"]: x for x in _raid_items()}
    top = top_ids(list(xs.values()))
    assert 13454 in top and 9155 not in top  # Greater Arcane Elixir kept, the Arcane Elixir (+20) beaten
    assert 13444 in top and 13443 not in top  # Major Mana Potion kept, the Superior one beaten
