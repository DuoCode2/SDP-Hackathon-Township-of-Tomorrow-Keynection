"""Online, the whole site sits behind one shared password (JIRAN_SITE_PASSWORD): the prototype has no sign-in,
so without it anyone with the link could reset the demo or upload files. Locally (no password set) nothing changes."""
import base64

import pytest
from fastapi.testclient import TestClient


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("JIRAN_DB_PATH", str(tmp_path / "test.db"))
    monkeypatch.setenv("JIRAN_DEMO_MODE", "1")
    monkeypatch.delenv("JIRAN_SITE_PASSWORD", raising=False)
    from app.main import app

    with TestClient(app) as c:
        yield c


def _basic(user: str, password: str) -> dict[str, str]:
    return {"Authorization": "Basic " + base64.b64encode(f"{user}:{password}".encode()).decode()}


def test_without_a_site_password_nothing_changes(client):
    assert client.get("/api/units").status_code == 200


def test_with_a_site_password_everything_needs_it(client, monkeypatch):
    monkeypatch.setenv("JIRAN_SITE_PASSWORD", "kopi-o-kosong-2026")
    r = client.get("/api/units")
    assert r.status_code == 401 and r.headers["www-authenticate"].startswith("Basic")
    assert client.post("/api/demo/reset").status_code == 401
    assert client.get("/api/units", headers=_basic("judge", "wrong")).status_code == 401
    assert client.get("/api/units", headers=_basic("judge", "kopi-o-kosong-2026")).status_code == 200
    assert client.get("/api/units", headers={"Authorization": "Basic not-base64!"}).status_code == 401


def test_the_health_check_stays_open_for_the_host(client, monkeypatch):
    monkeypatch.setenv("JIRAN_SITE_PASSWORD", "kopi-o-kosong-2026")
    assert client.get("/api/health").status_code == 200


def test_search_engines_are_asked_not_to_index_it(client):
    assert client.get("/api/units").headers["x-robots-tag"] == "noindex, nofollow"
