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
