"""Online, the whole site sits behind one shared password (JIRAN_SITE_PASSWORD): the prototype has no sign-in,
so without it anyone with the link could reset the demo or upload files. Locally (no password set) nothing changes.

People get our own three-language password page, not the browser's built-in box: that box asks for a user name,
and some in-app browsers never show it (the visitor just sees an error)."""
import base64
import hashlib
import hmac

import pytest
from fastapi.testclient import TestClient

PASSWORD = "kopi-o-kosong-2026"


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("JIRAN_DB_PATH", str(tmp_path / "test.db"))
    monkeypatch.setenv("JIRAN_DEMO_MODE", "1")
    monkeypatch.delenv("JIRAN_SITE_PASSWORD", raising=False)
    from app.main import app

    with TestClient(app) as c:
        yield c


@pytest.fixture()
def gated(client, monkeypatch):
    monkeypatch.setenv("JIRAN_SITE_PASSWORD", PASSWORD)
    return client


def _basic(user: str, password: str) -> dict[str, str]:
    return {"Authorization": "Basic " + base64.b64encode(f"{user}:{password}".encode()).decode()}


def _sign_in(client, password: str):
    return client.post("/site-login", data={"password": password}, follow_redirects=False)


def test_without_a_site_password_nothing_changes(client):
    assert client.get("/api/units").status_code == 200
    assert client.post("/site-login", data={"password": "x"}).status_code in (404, 405)  # no password page locally


def test_a_page_visit_gets_the_three_language_password_page(gated):
    r = gated.get("/", headers={"Accept": "text/html"})
    assert r.status_code == 401 and r.headers["content-type"].startswith("text/html")
    assert "www-authenticate" not in r.headers  # never the browser's built-in box
    assert r.headers["cache-control"] == "no-store"
    page = r.text
    assert '<form method="post" action="/site-login"' in page and 'type="password"' in page
    assert "Kata laluan" in page and "密码" in page and "Password" in page
    assert "Wrong password" not in page


def test_everything_else_stays_locked_without_it(gated):
    r = gated.get("/api/units")
    assert r.status_code == 401 and r.json()["detail"].startswith("This demo needs the password")
    assert "www-authenticate" not in r.headers
    assert gated.post("/api/demo/reset").status_code == 401
    assert gated.get("/assets/index.js").status_code == 401


def test_a_wrong_password_shows_the_page_again_with_a_message(gated):
    r = _sign_in(gated, "wrong")
    assert r.status_code == 401 and "set-cookie" not in r.headers
    assert "Wrong password" in r.text and "Kata laluan salah" in r.text and "密码不对" in r.text
    assert _sign_in(gated, "").status_code == 401


def test_the_right_password_opens_the_site_for_this_browser(gated):
    r = _sign_in(gated, PASSWORD)
    assert r.status_code == 303 and r.headers["location"] == "/"
    cookie = r.headers["set-cookie"].lower()
    assert "jiran5_site=" in cookie and "httponly" in cookie and "samesite=lax" in cookie
    assert "max-age=2592000" in cookie  # 30 days
    assert PASSWORD.lower() not in cookie  # the browser keeps a keyed hash, never the password
    assert gated.get("/api/units").status_code == 200  # the test client sends the cookie back


def test_reloading_the_password_address_after_signing_in_goes_to_the_app(gated):
    assert gated.get("/site-login", follow_redirects=False).status_code == 401  # not signed in: the page
    _sign_in(gated, PASSWORD)
    r = gated.get("/site-login", follow_redirects=False)
    assert r.status_code == 303 and r.headers["location"] == "/"


def test_pages_are_checked_with_the_server_every_time(gated):
    """Otherwise a browser reuses its old copy of the app without asking, the password check never sees it, and a
    visitor whose sign-in has ended (new password, 30 days) gets an empty app instead of the password page."""
    from app.main import STATIC_DIR

    if not (STATIC_DIR / "index.html").is_file():
        pytest.skip("web app not built")
    _sign_in(gated, PASSWORD)
    r = gated.get("/")
    assert r.status_code == 200 and r.headers["content-type"].startswith("text/html")
    assert r.headers["cache-control"] == "no-cache"
    gated.cookies.clear()
    gated.cookies.set("jiran5_site", "ended")
    assert gated.get("/").headers["cache-control"] == "no-store"  # the password page is never stored


def test_the_cookie_is_marked_secure_behind_https(gated):
    r = gated.post("/site-login", data={"password": PASSWORD}, headers={"X-Forwarded-Proto": "https"},
                   follow_redirects=False)
    assert "secure" in r.headers["set-cookie"].lower()


def test_a_forged_or_old_cookie_does_not_open_it(gated, monkeypatch):
    gated.cookies.set("jiran5_site", "forged")
    assert gated.get("/api/units").status_code == 401
    old = hmac.new(b"the-old-password", b"jiran5-site-v1", hashlib.sha256).hexdigest()
    gated.cookies.set("jiran5_site", old)
    assert gated.get("/api/units").status_code == 401  # changing the password signs everyone out


def test_scripts_can_still_send_the_password_directly(gated):
    assert gated.get("/api/units", headers=_basic("judge", PASSWORD)).status_code == 200
    assert gated.get("/api/units", headers=_basic("judge", "wrong")).status_code == 401
    assert gated.get("/api/units", headers={"Authorization": "Basic not-base64!"}).status_code == 401


def test_an_oversized_password_form_is_refused(gated):
    r = gated.post("/site-login", content=b"password=" + b"a" * 10_000,
                   headers={"Content-Type": "application/x-www-form-urlencoded"}, follow_redirects=False)
    assert r.status_code in (401, 413) and "set-cookie" not in r.headers


def test_the_health_check_stays_open_for_the_host(gated):
    assert gated.get("/api/health").status_code == 200


def test_search_engines_are_asked_not_to_index_it(client, monkeypatch):
    assert client.get("/api/units").headers["x-robots-tag"] == "noindex, nofollow"
    monkeypatch.setenv("JIRAN_SITE_PASSWORD", PASSWORD)
    assert client.get("/").headers["x-robots-tag"] == "noindex, nofollow"
