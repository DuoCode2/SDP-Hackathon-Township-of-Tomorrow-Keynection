"""Pilot mode: every key comes with a digital key. The server decides who is asking, and nobody can act for, or
read, another home by changing a unit number. Demo mode (the judges' route) is unchanged."""
import io
import re

import pytest
from fastapi.routing import APIRoute
from fastapi.testclient import TestClient
from PIL import Image

from softkey import SoftKey

RENO = {"scope": "Extend kitchen", "start": "2026-10-15", "end": "2026-10-30", "works_type": "structural",
        "council_permit": "approved"}


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("KEYNECTION_DB_PATH", str(tmp_path / "test.db"))
    monkeypatch.setenv("KEYNECTION_DEMO_MODE", "1")  # seed the fictional phase, then switch to pilot mode
    monkeypatch.delenv("KEYNECTION_SITE_PASSWORD", raising=False)
    from app.main import app

    with TestClient(app) as c:
        monkeypatch.setenv("KEYNECTION_DEMO_MODE", "0")
        yield c


def _jpeg() -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (1200, 900), (210, 210, 210)).save(buf, "JPEG")
    return buf.getvalue()


def _add_key(client) -> SoftKey:
    """Make a digital key on this 'phone' for whoever is signed in."""
    key = SoftKey()
    start = client.post("/api/auth/passkeys/options").json()
    done = client.post("/api/auth/passkeys", json={"challenge_id": start["challenge_id"], "credential": key.create(start["options"])})
    assert done.status_code == 200, done.text
    return key


def _sign_in_with(client, key: SoftKey, origin: str | None = None):
    start = client.post("/api/auth/signin/options").json()
    return client.post("/api/auth/signin", json={"challenge_id": start["challenge_id"], "credential": key.get(start["options"], origin)})


def _staff(client, name="Farah") -> None:
    from app import auth, db

    import os
    conn = db.connect(os.environ["KEYNECTION_DB_PATH"])
    try:
        _, token, _ = auth.add_staff(conn, name, "estate")  # what scripts/add_staff.py does
    finally:
        conn.close()
    assert client.post("/api/auth/code", json={"token": token}).json()["kind"] == "staff"


# ---------- demo mode is unchanged ----------

def test_demo_mode_needs_no_sign_in(client, monkeypatch):
    monkeypatch.setenv("KEYNECTION_DEMO_MODE", "1")
    assert client.get("/api/auth/me").json() == {"mode": "demo", "signed_in": False}
    assert client.get("/api/units/T-12/conversations").status_code == 200


# ---------- pilot mode asks who you are ----------

def test_pilot_mode_asks_for_sign_in(client):
    assert client.get("/api/health").status_code == 200
    assert client.get("/api/auth/me").json() == {"mode": "pilot", "signed_in": False}
    r = client.get("/api/units/T-12/conversations")
    assert r.status_code == 401 and r.json()["detail"]["code"] == "signin"
    assert client.get("/api/units").status_code == 401


def test_a_household_joins_makes_its_digital_key_and_signs_in_again(client):
    _staff(client)
    token = client.post("/api/units/T-23/join-code").json()["token"]  # the welcome-pack QR, made at the estate office
    client.cookies.clear()
    joined = client.post("/api/join", json={"token": token, "display_name": "Mei Ling", "lang": "zh", "consent": True})
    assert joined.status_code == 200
    me = client.get("/api/auth/me").json()
    assert me["signed_in"] and me["unit_id"] == "T-23" and me["passkeys"] == 0  # signed in by the one-time code
    key = _add_key(client)
    assert client.get("/api/auth/me").json()["passkeys"] == 1
    client.post("/api/auth/signout")
    assert client.get("/api/units/T-23/conversations").status_code == 401
    signed = _sign_in_with(client, key)
    assert signed.status_code == 200 and signed.json()["unit_id"] == "T-23"
    assert client.get("/api/units/T-23/conversations").status_code == 200
    events = [e["type"] for e in client.get("/api/units/T-23/history").json()["events"]]
    assert "digital_key_added" in events


def test_a_key_works_only_from_keynection_and_each_challenge_once(client, sign_in):
    sign_in(client, "T-12")
    key = _add_key(client)
    client.post("/api/auth/signout")
    assert _sign_in_with(client, key, origin="https://keynection-login.example.com").status_code == 401  # a look-alike site
    start = client.post("/api/auth/signin/options").json()
    answer = key.get(start["options"])
    assert client.post("/api/auth/signin", json={"challenge_id": start["challenge_id"], "credential": answer}).status_code == 200
    client.post("/api/auth/signout")
    assert client.post("/api/auth/signin", json={"challenge_id": start["challenge_id"], "credential": answer}).status_code == 401
    assert _sign_in_with(client, SoftKey()).status_code == 401  # a key Keynection never saw


# ---------- a household can only act for itself ----------

def _resident_routes():
    from app import main

    skip = main.PUBLIC_ENDPOINTS | main.DEMO_ENDPOINTS | main.SIGNED_IN_ENDPOINTS | main.STAFF_ENDPOINTS
    return [r for r in main.app.routes if isinstance(r, APIRoute) and r.endpoint.__name__ not in skip]


def test_every_household_endpoint_refuses_to_act_for_another_home(client, sign_in):
    """Signed in as No. 12, try to act as No. 11 on every endpoint that acts for a household."""
    sign_in(client, "T-12")
    routes = _resident_routes()
    assert len(routes) > 40
    for route in routes:
        method = sorted(route.methods)[0].lower()
        url = re.sub(r"\{unit_id\}", "T-11", route.path)
        url = re.sub(r"\{[a-z_]+\}", "1", url)
        if any(p.name == "unit_id" for p in route.dependant.query_params):
            url += "?unit_id=T-11"
        kwargs = {}
        if route.endpoint.__name__ == "send_voice":
            kwargs = {"data": {"from_unit_id": "T-11", "to_unit_id": "T-12", "duration": "3"},
                      "files": {"file": ("v.wav", b"RIFF" + b"\0" * 4 + b"WAVE" + b"\0" * 200, "audio/wav")}}
        elif method in ("post", "put"):
            kwargs = {"json": {"unit_id": "T-11", "from_unit_id": "T-11", "reporter_unit_id": "T-11"}}
        r = getattr(client, method)(url, **kwargs)
        assert r.status_code == 403, f"{method.upper()} {route.path} answered {r.status_code} acting for another home"


def test_a_household_still_does_everything_for_itself(client, sign_in):
    sign_in(client, "T-12")
    assert client.post("/api/intros", json={"from_unit_id": "T-12", "message": "Works soon", "renovation": RENO}).status_code == 201
    assert client.post("/api/messages", json={"from_unit_id": "T-12", "to_unit_id": "T-11", "body": "Hello!"}).status_code == 201
    assert client.get("/api/units/T-12/export").status_code == 200
    assert client.post("/api/messages", json={"from_unit_id": "T-11", "to_unit_id": "T-12", "body": "Hi"}).status_code == 403


# ---------- staff ----------

def test_staff_tools_need_a_staff_sign_in(client, sign_in):
    from app import main

    staff_routes = [r for r in main.app.routes if isinstance(r, APIRoute) and r.endpoint.__name__ in main.STAFF_ENDPOINTS]
    sign_in(client, "T-12")
    for route in staff_routes:
        url = re.sub(r"\{unit_id\}", "T-11", route.path)
        url = re.sub(r"\{[a-z_]+\}", "1", url)
        r = getattr(client, sorted(route.methods)[0].lower())(url)
        assert r.status_code == 403, f"{route.path} let a household in ({r.status_code})"
    client.cookies.clear()
    _staff(client)
    assert client.get("/api/dashboard").status_code == 200
    assert client.get("/api/estate/frontdesk").status_code == 200
    # Staff never act as a household, and sign records with their own name.
    assert client.post("/api/messages", json={"from_unit_id": "T-12", "to_unit_id": "T-11", "body": "Hi"}).status_code == 403
    body = {"unit_id": "T-20", "owner_signed": True, "message": "Renovation by No. 20", "renovation": {**RENO, "works_type": "light"}}
    assert client.post("/api/estate/renovations", json={**body, "staff_name": "Someone Else"}).status_code == 403
    assert client.post("/api/estate/renovations", json={**body, "staff_name": "Farah"}).status_code == 201


def test_staff_add_colleagues_with_a_one_time_code(client):
    _staff(client)
    made = client.post("/api/staff", json={"name": "Hakim", "role": "estate"}).json()
    client.cookies.clear()
    assert client.post("/api/auth/code", json={"token": made["token"]}).json()["name"] == "Hakim"
    client.cookies.clear()
    assert client.post("/api/auth/code", json={"token": made["token"]}).status_code == 404  # once only


# ---------- a lost phone ----------

def test_a_lost_phone_is_replaced_at_the_estate_office(client, sign_in):
    sign_in(client, "T-12")
    old_key = _add_key(client)
    stolen_cookie = dict(client.cookies)
    client.cookies.clear()
    _staff(client)
    token = client.post("/api/units/T-12/reentry-code").json()["token"]
    client.cookies.clear()
    assert client.post("/api/auth/code", json={"token": token}).json()["unit_id"] == "T-12"
    assert _add_key(client)  # the new phone's key
    client.cookies.clear()
    assert _sign_in_with(client, old_key).status_code == 401  # the lost phone's key no longer opens anything
    for name, value in stolen_cookie.items():
        client.cookies.set(name, value)
    assert client.get("/api/units/T-12/conversations").status_code == 401
    assert client.post("/api/units/T-11/reentry-code").status_code == 401


# ---------- photos inside homes ----------

def test_photos_are_seen_only_by_the_home_and_staff(client, sign_in):
    sign_in(client, "T-11")
    photo = client.post("/api/units/T-11/photos", data={"kind": "baseline", "subject": "Kitchen wall"},
                        files={"file": ("wall.jpg", _jpeg(), "image/jpeg")}).json()
    assert client.get(photo["url"]).status_code == 200
    client.cookies.clear()
    sign_in(client, "T-12")
    assert client.get(photo["url"]).status_code == 404  # the renovating neighbour can't browse it
    client.cookies.clear()
    _staff(client)
    assert client.get(photo["url"]).status_code == 200


# ---------- the phase layout ----------

def test_the_layout_names_only_your_own_home_but_the_estate_office_sees_all(client, sign_in):
    sign_in(client, "T-12")
    homes = {u["id"]: u for u in client.get("/api/units").json()}
    assert homes["T-12"]["resident_name"] and homes["T-12"]["lang"]  # the app greets you by name, in your language
    assert all("resident_name" not in u for k, u in homes.items() if k != "T-12")  # no resident directory
    client.cookies.clear()
    _staff(client)
    homes = client.get("/api/units").json()
    assert all(u["resident_name"] for u in homes)  # the estate office already holds the handover list


def test_every_refusal_says_why_so_the_phone_can_say_it_in_the_readers_language(client, sign_in):
    sign_in(client, "T-12")
    key = _add_key(client)
    client.post("/api/auth/signout")
    reason = lambda r: r.json()["detail"]["code"]  # noqa: E731
    assert reason(_sign_in_with(client, SoftKey())) == "key_unknown"
    assert reason(_sign_in_with(client, key, origin="https://keynection-login.example.com")) == "key_retry"
    stale = client.post("/api/auth/signin/options").json()
    client.post("/api/auth/signin", json={"challenge_id": stale["challenge_id"], "credential": key.get(stale["options"])})
    client.post("/api/auth/signout")
    again = client.post("/api/auth/signin", json={"challenge_id": stale["challenge_id"], "credential": key.get(stale["options"])})
    assert reason(again) == "too_slow"
    assert reason(client.post("/api/auth/code", json={"token": "x" * 32})) == "code_used"


# ---------- a warranty repair, start to finish ----------

def test_staff_upload_the_repair_photo_and_only_the_owner_closes_it(client, monkeypatch, sign_in):
    from test_layers_2_4 import _warranty_ticket

    monkeypatch.setenv("KEYNECTION_DEMO_MODE", "1")
    ticket = _warranty_ticket(client)  # the defect and its photos, the quick way
    monkeypatch.setenv("KEYNECTION_DEMO_MODE", "0")
    _staff(client)
    assert [t["id"] for t in client.get("/api/warranty").json()] == [ticket["id"]]
    from app.main import DEMO_PHOTO_DIR

    photo = (DEMO_PHOTO_DIR / "wall_repair_good.jpg").read_bytes()  # as if taken on the subcontractor's phone
    done = client.post(f"/api/warranty/{ticket['id']}/repair", data={"subcontractor": "Jaya Plaster Sdn Bhd"},
                       files={"file": ("repair.jpg", photo, "image/jpeg")})
    assert done.status_code == 200 and done.json()["status"] == "repair_submitted"
    assert done.json()["repair_check"]["verdict"] == "restored"  # checked against the pre-work photo
    assert client.get(f"/api/warranty/{ticket['id']}/image", params={"kind": "after"}).status_code == 200
    assert client.post(f"/api/warranty/{ticket['id']}/owner", json={"unit_id": "T-11", "decision": "accept"}).status_code == 403
    client.cookies.clear()
    sign_in(client, "T-12")  # the neighbour neither sees the repair photo nor closes the ticket
    assert client.get(f"/api/warranty/{ticket['id']}/image", params={"kind": "after"}).status_code == 404
    assert client.post(f"/api/warranty/{ticket['id']}/owner", json={"unit_id": "T-11", "decision": "accept"}).status_code == 403
    client.cookies.clear()
    sign_in(client, "T-11")
    closed = client.post(f"/api/warranty/{ticket['id']}/owner", json={"unit_id": "T-11", "decision": "accept", "note": "Looks good"})
    assert closed.status_code == 200 and closed.json()["status"] == "closed"
