import os
import tempfile

import pytest

_tmp = tempfile.mkdtemp()
os.environ["FH_DATABASE_URL"] = f"sqlite+aiosqlite:///{_tmp}/test.db"
os.environ["FH_ADMIN_EMAIL"] = "boss@test"
os.environ["FH_ADMIN_PASSWORD"] = "s3cret"

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
    assert client.delete(f"/api/builds/{a['id']}").status_code == 204
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
