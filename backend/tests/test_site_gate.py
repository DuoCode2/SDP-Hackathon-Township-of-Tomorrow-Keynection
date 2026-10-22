"""Online, the whole site sits behind one shared password (KEYNECTION_SITE_PASSWORD): the prototype has no sign-in,
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
    monkeypatch.setenv("KEYNECTION_DB_PATH", str(tmp_path / "test.db"))
    monkeypatch.setenv("KEYNECTION_DEMO_MODE", "1")
    monkeypatch.delenv("KEYNECTION_SITE_PASSWORD", raising=False)
    from app.main import app

    with TestClient(app) as c:
        yield c


@pytest.fixture()
def gated(client, monkeypatch):
    monkeypatch.setenv("KEYNECTION_SITE_PASSWORD", PASSWORD)
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
    assert "keynection_site=" in cookie and "httponly" in cookie and "samesite=lax" in cookie
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
    gated.cookies.set("keynection_site", "ended")
    assert gated.get("/").headers["cache-control"] == "no-store"  # the password page is never stored


def test_the_cookie_is_marked_secure_behind_https(gated):
    r = gated.post("/site-login", data={"password": PASSWORD}, headers={"X-Forwarded-Proto": "https"},
                   follow_redirects=False)
    assert "secure" in r.headers["set-cookie"].lower()


def test_a_forged_or_old_cookie_does_not_open_it(gated, monkeypatch):
    gated.cookies.set("keynection_site", "forged")
    assert gated.get("/api/units").status_code == 401
    old = hmac.new(b"the-old-password", b"keynection-site-v1", hashlib.sha256).hexdigest()
    gated.cookies.set("keynection_site", old)
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
    monkeypatch.setenv("KEYNECTION_SITE_PASSWORD", PASSWORD)
    assert client.get("/").headers["x-robots-tag"] == "noindex, nofollow"


# ---------- a link that carries the password ----------
# The submission form has a box for the prototype's link and none for a password, so the link carries it:
# …/?key=<password>. One click signs the browser in for the same 30 days as the page, and lands on a clean address.

def test_a_link_with_the_password_opens_the_site_and_drops_it_from_the_address(gated):
    r = gated.get(f"/?key={PASSWORD}", follow_redirects=False)
    assert r.status_code == 303 and r.headers["location"] == "/"
    assert r.headers["cache-control"] == "no-store"
    cookie = r.headers["set-cookie"].lower()
    assert "keynection_site=" in cookie and "httponly" in cookie and "samesite=lax" in cookie
    assert "max-age=2592000" in cookie  # 30 days, as after the page
    assert PASSWORD.lower() not in cookie
    assert gated.get("/api/units").status_code == 200


def test_the_link_keeps_the_rest_of_its_address(gated):
    r = gated.get(f"/?embed=1&key={PASSWORD}&me=T-12", follow_redirects=False)
    assert r.status_code == 303 and r.headers["location"] == "/?embed=1&me=T-12"


def test_the_link_always_lands_on_the_app_itself(gated):
    """Whatever path the link has, it lands on / here: no crafted address can turn it into a jump to another site."""
    for path in ("/site-login", "/assets/index.js", "/%2F%2Felsewhere.example/", "/%5Celsewhere.example"):
        r = gated.get(f"{path}?key={PASSWORD}", follow_redirects=False)
        assert r.status_code == 303 and r.headers["location"] == "/", path


def test_a_link_with_a_wrong_password_shows_the_page_and_says_why(gated):
    for query in ("key=wrong", "key=", f"key={PASSWORD}x"):
        r = gated.get(f"/?{query}", follow_redirects=False)
        assert r.status_code == 401 and "set-cookie" not in r.headers, query
        assert r.headers["cache-control"] == "no-store"
        assert '<form method="post" action="/site-login"' in r.text
        assert "password in this link" in r.text and "pautan ini" in r.text and "链接里的密码" in r.text
        assert "Wrong password" not in r.text
    assert gated.get("/api/units").status_code == 401


def test_a_signed_in_browser_just_gets_the_clean_address(gated):
    _sign_in(gated, PASSWORD)
    for key in (PASSWORD, "an-old-password"):  # the right one again, or a link from before a password change
        r = gated.get(f"/?key={key}&join=ABC", follow_redirects=False)
        assert r.status_code == 303 and r.headers["location"] == "/?join=ABC"
    assert gated.get("/api/units").status_code == 200


def test_the_key_opens_pages_only_never_the_api(gated):
    r = gated.get(f"/api/units?key={PASSWORD}", follow_redirects=False)
    assert r.status_code == 401 and "set-cookie" not in r.headers  # scripts send HTTP Basic instead
    assert gated.post(f"/api/demo/reset?key={PASSWORD}").status_code == 401
    r = gated.post(f"/?key={PASSWORD}", follow_redirects=False)
    assert r.status_code == 401 and "set-cookie" not in r.headers


def test_a_password_with_symbols_works_once_written_into_the_link(client, monkeypatch):
    from urllib.parse import quote

    odd = "kopi o+kosong&2026#ais/limau?"
    monkeypatch.setenv("KEYNECTION_SITE_PASSWORD", odd)
    r = client.get(f"/?key={quote(odd, safe='')}", follow_redirects=False)
    assert r.status_code == 303 and "keynection_site=" in r.headers["set-cookie"]
    assert client.get("/api/units").status_code == 200


def test_the_link_cookie_is_marked_secure_behind_https(gated):
    r = gated.get(f"/?key={PASSWORD}", headers={"X-Forwarded-Proto": "https"}, follow_redirects=False)
    assert "secure" in r.headers["set-cookie"].lower()


def test_without_a_site_password_a_key_changes_nothing(client):
    r = client.get("/?key=anything", follow_redirects=False)
    assert r.status_code != 303 and "keynection_site" not in r.headers.get("set-cookie", "")


def test_the_server_log_never_shows_the_password_from_a_link():
    """uvicorn's access log line for a key link would hold the password; it is written as key=*** instead."""
    import logging

    from app.main import _HideSiteKey

    assert any(isinstance(f, _HideSiteKey) for f in logging.getLogger("uvicorn.access").filters)
    record = logging.LogRecord("uvicorn.access", logging.INFO, __file__, 0, '%s - "%s %s HTTP/%s" %d',
                               ("203.0.113.9:50000", "GET", f"/?embed=1&key={PASSWORD}&me=T-12", "1.1", 303), None)
    assert _HideSiteKey().filter(record)
    line = record.getMessage()
    assert PASSWORD not in line and "/?embed=1&key=***&me=T-12" in line
    plain = logging.LogRecord("uvicorn.access", logging.INFO, __file__, 0, '%s - "%s %s HTTP/%s" %d',
                              ("203.0.113.9:50000", "GET", "/api/units?monkey=1", "1.1", 200), None)
    assert _HideSiteKey().filter(plain) and plain.getMessage().endswith('"GET /api/units?monkey=1 HTTP/1.1" 200')
