"""Keynection, everywhere: settings are named KEYNECTION_..., and a server set up under the project's first name
(JIRAN_..., cookie jiran5_site) keeps working, so the rename breaks nothing. An old address can send everyone to
the new one."""
import hashlib
import hmac

import pytest
from fastapi.testclient import TestClient

PASSWORD = "kopi-o-kosong-2026"


@pytest.fixture()
def start(tmp_path, monkeypatch):
    """Start the server with exactly these settings (old or new names)."""
    from app.main import app

    def _start(**settings: str) -> TestClient:
        for name, value in settings.items():
            monkeypatch.setenv(name, value)
        return TestClient(app)

    return _start, tmp_path


def test_settings_under_the_old_names_still_work(start):
    run, tmp = start
    with run(JIRAN_DB_PATH=str(tmp / "old.db"), JIRAN_DEMO_MODE="0") as client:
        assert client.get("/api/auth/me").json()["mode"] == "pilot"
    assert (tmp / "old.db").exists()


def test_the_new_name_wins_when_both_are_set(start):
    run, tmp = start
    with run(KEYNECTION_DB_PATH=str(tmp / "new.db"), JIRAN_DB_PATH=str(tmp / "old.db"),
             KEYNECTION_DEMO_MODE="1", JIRAN_DEMO_MODE="0") as client:
        assert client.get("/api/auth/me").json()["mode"] == "demo"
    assert (tmp / "new.db").exists() and not (tmp / "old.db").exists()


def test_the_old_site_password_name_still_guards_the_demo(start):
    run, tmp = start
    with run(KEYNECTION_DB_PATH=str(tmp / "d.db"), JIRAN_SITE_PASSWORD=PASSWORD) as client:
        assert client.get("/api/units").status_code == 401
        signed = client.post("/site-login", data={"password": PASSWORD}, follow_redirects=False)
        assert "keynection_site=" in signed.headers["set-cookie"]
        assert client.get("/api/units").status_code == 200


def test_a_browser_signed_in_before_the_rename_stays_in_and_gets_the_new_cookie(start):
    run, tmp = start
    with run(KEYNECTION_DB_PATH=str(tmp / "d.db"), KEYNECTION_SITE_PASSWORD=PASSWORD) as client:
        old = hmac.new(PASSWORD.encode(), b"jiran5-site-v1", hashlib.sha256).hexdigest()
        client.cookies.set("jiran5_site", old)
        r = client.get("/api/units")
        assert r.status_code == 200
        cookies = r.headers.get_list("set-cookie")
        assert any(c.startswith("keynection_site=") for c in cookies)
        assert any(c.startswith("jiran5_site=") and "max-age=0" in c.lower() for c in cookies)  # the old one is cleared


def test_a_forged_old_cookie_never_becomes_a_new_one(start):
    run, tmp = start
    with run(KEYNECTION_DB_PATH=str(tmp / "d.db"), KEYNECTION_SITE_PASSWORD=PASSWORD) as client:
        client.cookies.set("jiran5_site", "forged")
        assert client.get("/api/units").status_code == 401
        health = client.get("/api/health")  # open for the host, but it must not hand out a cookie
        assert health.status_code == 200 and "set-cookie" not in health.headers


def test_an_old_address_sends_everyone_to_the_new_one(start):
    run, tmp = start
    with run(KEYNECTION_DB_PATH=str(tmp / "d.db"), KEYNECTION_MOVED_TO="https://keynection.onrender.com/") as client:
        r = client.get("/?join=abc", follow_redirects=False)
        assert r.status_code == 307 and r.headers["location"] == "https://keynection.onrender.com/?join=abc"
        r = client.post("/api/auth/signin/options", follow_redirects=False)
        assert r.status_code == 307 and r.headers["location"] == "https://keynection.onrender.com/api/auth/signin/options"
        assert client.get("/api/health").status_code == 200  # the host still sees the old service as healthy
