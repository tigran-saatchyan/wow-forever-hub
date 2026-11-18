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
