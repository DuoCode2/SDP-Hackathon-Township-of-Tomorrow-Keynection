"""Pilot deployment: a server that tells its operator what is still missing, makes its first staff member on a host
with no command line, and shows staff whether the pilot is healthy (backups, sign-ups). The demo is unchanged."""
import os
import re

import pytest
from fastapi.testclient import TestClient


@pytest.fixture()
def pilot(tmp_path, monkeypatch):
    """A fresh pilot server, as on its first day; returns a function that (re)starts it."""
    monkeypatch.setenv("KEYNECTION_DB_PATH", str(tmp_path / "data" / "app.db"))
    monkeypatch.setenv("KEYNECTION_DEMO_MODE", "0")
    for name in ("KEYNECTION_SITE_PASSWORD", "KEYNECTION_FIRST_STAFF", "KEYNECTION_FIRST_STAFF_ROLE"):
        monkeypatch.delenv(name, raising=False)
    from app.main import app

    def start() -> TestClient:
        return TestClient(app)

    return start


def _conn():
    from app import db

    return db.connect(os.environ["KEYNECTION_DB_PATH"])


def test_the_first_staff_member_comes_from_a_setting_and_signs_in_with_the_logged_link(pilot, monkeypatch):
    monkeypatch.setenv("KEYNECTION_ORIGIN", "https://pilot.example.com")
    monkeypatch.setenv("KEYNECTION_FIRST_STAFF", "Farah Aziz")
    from app import main

    with pilot() as client:
        conn = _conn()
        message = main._first_staff(conn)  # what start-up wrote to the log
        assert "Farah Aziz" in message and "https://pilot.example.com/?code=" in message
        token = re.search(r"\?code=([A-Za-z0-9_-]+)", message).group(1)
        assert client.post("/api/auth/code", json={"token": token}).json()["name"] == "Farah Aziz"
        # Signed in once: no more codes, and still only one staff member however often the server restarts.
        assert main._first_staff(conn) is None
        assert conn.execute("SELECT COUNT(*) FROM staff").fetchone()[0] == 1
        conn.close()


def test_an_unused_first_link_is_replaced_at_the_next_start(pilot, monkeypatch):
    monkeypatch.setenv("KEYNECTION_FIRST_STAFF", "Farah Aziz")
    from app import main

    with pilot() as client:
        conn = _conn()
        first = re.search(r"\?code=([A-Za-z0-9_-]+)", main._first_staff(conn)).group(1)
        second = re.search(r"\?code=([A-Za-z0-9_-]+)", main._first_staff(conn)).group(1)  # e.g. a week later, expired
        assert client.post("/api/auth/code", json={"token": first}).status_code == 404  # only the newest works
        assert client.post("/api/auth/code", json={"token": second}).status_code == 200
        assert conn.execute("SELECT COUNT(*) FROM staff").fetchone()[0] == 1
        conn.close()


def test_the_demo_ignores_the_first_staff_setting(tmp_path, monkeypatch):
    monkeypatch.setenv("KEYNECTION_DB_PATH", str(tmp_path / "demo.db"))
    monkeypatch.setenv("KEYNECTION_DEMO_MODE", "1")
    monkeypatch.setenv("KEYNECTION_FIRST_STAFF", "Farah Aziz")
    from app import main

    with TestClient(main.app):
        conn = _conn()
        assert main._first_staff(conn) is None and conn.execute("SELECT COUNT(*) FROM staff").fetchone()[0] == 0
        conn.close()


def test_start_up_says_what_is_still_missing(pilot, monkeypatch):
    from app import main

    monkeypatch.delenv("KEYNECTION_ORIGIN", raising=False)
    monkeypatch.setenv("KEYNECTION_SITE_PASSWORD", "shared-secret")
    with pilot():
        conn = _conn()
        checks = " | ".join(main._pilot_checks(conn))
        conn.close()
    for words in ("KEYNECTION_ORIGIN", "KEYNECTION_SITE_PASSWORD", "KEYNECTION_FIRST_STAFF", "handover list"):
        assert words in checks
    monkeypatch.setenv("KEYNECTION_ORIGIN", "http://pilot.example.com")
    monkeypatch.delenv("KEYNECTION_SITE_PASSWORD")
    monkeypatch.setenv("KEYNECTION_FIRST_STAFF", "Farah Aziz")
    with pilot():
        conn = _conn()
        checks = " | ".join(main._pilot_checks(conn))
        conn.close()
    assert "https://" in checks and "KEYNECTION_SITE_PASSWORD" not in checks and "KEYNECTION_FIRST_STAFF" not in checks


def test_a_pilot_never_uses_geminis_free_tier(pilot, monkeypatch):
    from app import ai, main

    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.setenv("GEMINI_API_KEY", "test-not-a-real-key")
    with pilot():
        assert ai.status() == {"on": False, "model": None, "provider": None}
        conn = _conn()
        checks = " | ".join(main._pilot_checks(conn))
        conn.close()
    assert "GEMINI_API_KEY is not used in a pilot" in checks


def test_staff_see_whether_the_pilot_is_healthy(pilot, monkeypatch, sign_in):
    monkeypatch.setenv("KEYNECTION_ORIGIN", "https://pilot.example.com")
    with pilot() as client:
        sign_in(client, "staff:Farah")
        status = client.get("/api/pilot/status").json()
        assert status["last_backup"] and status["backups"] == 1  # made at start-up
        assert status["homes"] == 0 and status["staff"] == 1 and status["phones"] == 0
        assert any("handover list" in c for c in status["checks"])
        assert status["origin"] == "https://pilot.example.com"


def test_health_says_which_version_is_running(tmp_path, monkeypatch):
    """On Render, the health check names the branch and commit it runs, so anyone can see which version is live."""
    monkeypatch.setenv("KEYNECTION_DB_PATH", str(tmp_path / "health.db"))
    monkeypatch.setenv("KEYNECTION_DEMO_MODE", "1")
    from app.main import app

    with TestClient(app) as client:
        monkeypatch.delenv("RENDER_GIT_COMMIT", raising=False)
        monkeypatch.delenv("RENDER_GIT_BRANCH", raising=False)
        assert client.get("/api/health").json() == {"status": "ok"}
        monkeypatch.setenv("RENDER_GIT_COMMIT", "ed647b8628cfc9d4573f4efcbcac7c82d91b99cf")
        monkeypatch.setenv("RENDER_GIT_BRANCH", "main")
        assert client.get("/api/health").json() == {"status": "ok", "version": "ed647b8", "branch": "main"}
