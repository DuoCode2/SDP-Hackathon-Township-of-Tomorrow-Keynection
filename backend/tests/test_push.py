"""Pilot: real notifications on the phone (web push). A phone turns them on once; after that each alert goes out
once, in the household's language, encrypted for that phone and signed with this server's key. The same alerts the
WhatsApp preview shows: a chat alert never carries what was written, quiet mode holds chat alerts back, and nothing
rings at night. The demo is unchanged."""
import base64
import json
import os
from datetime import datetime, timedelta, timezone

import http_ece
import pytest
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.asymmetric.utils import encode_dss_signature
from fastapi.testclient import TestClient

RENO = {"scope": "Extend kitchen (rear wall)", "start": "2026-10-15", "end": "2026-10-30",
        "contractor": "ABC Renovation", "contractor_cidb_registered": True}


def b64u(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def unb64u(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


class Phone:
    """A browser that turned notifications on: its own keys, and everything the push service handed it."""

    def __init__(self, n: int = 1):
        self.key = ec.generate_private_key(ec.SECP256R1())
        self.auth = os.urandom(16)
        self.endpoint = f"https://fcm.googleapis.com/fcm/send/phone-{n}-{os.urandom(4).hex()}"
        self.inbox: list[dict] = []
        self.requests: list[dict] = []

    def subscription(self) -> dict:
        point = self.key.public_key().public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)
        return {"endpoint": self.endpoint, "keys": {"p256dh": b64u(point), "auth": b64u(self.auth)}}

    def receive(self, body: bytes, headers: dict) -> None:
        self.requests.append(headers)
        self.inbox.append(json.loads(http_ece.decrypt(body, private_key=self.key, auth_secret=self.auth, version="aes128gcm")))

    def texts(self) -> list[str]:
        return [m["body"] for m in self.inbox]


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("JIRAN_DB_PATH", str(tmp_path / "test.db"))
    monkeypatch.setenv("JIRAN_DEMO_MODE", "1")  # seed the fictional phase, then switch to pilot mode
    monkeypatch.delenv("JIRAN_SITE_PASSWORD", raising=False)
    from app.main import app

    with TestClient(app) as c:
        monkeypatch.setenv("JIRAN_DEMO_MODE", "0")
        yield c


@pytest.fixture()
def push_service(monkeypatch):
    """Stands in for Google's, Apple's or Mozilla's push service: hands each request to the phone it is for."""
    from app import push

    phones: dict[str, Phone] = {}
    gone: set[str] = set()

    def post(url: str, body: bytes, headers: dict) -> int:
        if url in gone:
            return 410
        phones[url].receive(body, headers)
        return 201

    monkeypatch.setattr(push, "post", post)

    class Service:
        def phone(self, n: int = 1) -> Phone:
            p = Phone(n)
            phones[p.endpoint] = p
            return p

        def forget(self, phone: Phone) -> None:
            gone.add(phone.endpoint)

    return Service()


def _turn_on(client, phone: Phone):
    r = client.post("/api/push/subscriptions", json=phone.subscription())
    assert r.status_code == 200, r.text
    return r.json()


def _dispatch(now: datetime | None = None) -> int:
    from app.main import dispatch_alerts

    return dispatch_alerts(now)


# ---------- turning notifications on ----------

def test_the_demo_has_no_real_notifications(client, monkeypatch, sign_in):
    monkeypatch.setenv("JIRAN_DEMO_MODE", "1")
    assert client.get("/api/push/key").status_code == 409


def test_a_phone_turns_on_notifications_and_a_test_arrives_signed_and_encrypted(client, sign_in, push_service):
    sign_in(client, "T-11")
    key = client.get("/api/push/key").json()["key"]
    assert len(unb64u(key)) == 65 and client.get("/api/push/key").json()["key"] == key  # the same key every time
    phone = push_service.phone()
    assert _turn_on(client, phone)["devices"] == 1
    assert client.post("/api/push/test").json() == {"sent": 1, "failed": 0}
    message = phone.inbox[0]
    assert message["title"] == "Keynection" and "telefon ini" in message["body"]  # Siti reads Malay
    headers = phone.requests[0]
    assert headers["Content-Encoding"] == "aes128gcm" and int(headers["TTL"]) > 0
    token, k = headers["Authorization"].removeprefix("vapid t=").split(", k=")
    assert k == key
    head, claims, signature = token.split(".")
    claims = json.loads(unb64u(claims))
    assert claims["aud"] == "https://fcm.googleapis.com" and claims["sub"]
    assert 0 < claims["exp"] - datetime.now(timezone.utc).timestamp() <= 24 * 3600
    raw = unb64u(signature)
    public = ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(), unb64u(key))
    public.verify(encode_dss_signature(int.from_bytes(raw[:32], "big"), int.from_bytes(raw[32:], "big")),
                  f"{head}.{token.split('.')[1]}".encode(), ec.ECDSA(hashes.SHA256()))  # raises if forged


def test_only_real_push_services_can_be_used(client, sign_in):
    sign_in(client, "T-11")
    phone = Phone()
    for endpoint in ("https://evil.example.com/collect", "http://fcm.googleapis.com/fcm/send/x", "https://fcm.googleapis.com.evil.io/x"):
        assert client.post("/api/push/subscriptions", json={**phone.subscription(), "endpoint": endpoint}).status_code == 422
    bad_keys = {**phone.subscription(), "keys": {"p256dh": "short", "auth": b64u(os.urandom(16))}}
    assert client.post("/api/push/subscriptions", json=bad_keys).status_code == 422


def test_turning_off_removes_only_this_phone(client, sign_in, push_service):
    sign_in(client, "T-11")
    a, b = push_service.phone(1), push_service.phone(2)
    _turn_on(client, a)
    assert _turn_on(client, b)["devices"] == 2
    client.cookies.clear()
    sign_in(client, "T-12")
    assert client.post("/api/push/subscriptions/remove", json={"endpoint": a.endpoint}).json()["devices"] == 0  # not theirs
    client.cookies.clear()
    sign_in(client, "T-11")
    assert client.post("/api/push/subscriptions/remove", json={"endpoint": a.endpoint}).json()["devices"] == 1
    assert client.post("/api/push/test").json()["sent"] == 1 and not a.inbox


# ---------- alerts go out once, as they happen ----------

def test_a_neighbours_renovation_notice_reaches_the_phone_once_in_its_language(client, sign_in, push_service):
    sign_in(client, "T-11")
    phone = push_service.phone()
    _turn_on(client, phone)
    assert _dispatch() == 0  # what happened before the phone turned notifications on stays in the app
    client.cookies.clear()
    sign_in(client, "T-12")
    assert client.post("/api/intros", json={"from_unit_id": "T-12", "message": "Hi", "renovation": RENO}).status_code == 201
    assert _dispatch() == 1
    assert "Notis ubah suai" in phone.texts()[0] and phone.inbox[0]["url"].endswith("tab=chats")
    assert _dispatch() == 0 and len(phone.inbox) == 1  # once
    # Three days before the work starts, on its own: photograph your side.
    start = datetime(2026, 10, 12, 1, 5, tzinfo=timezone.utc)  # 09:05 in Malaysia, three days before the 15th
    assert _dispatch(start) == 1 and "foto" in phone.texts()[1].lower()


def test_chat_alerts_never_carry_the_words_and_quiet_mode_holds_them(client, sign_in, push_service):
    sign_in(client, "T-11")
    phone = push_service.phone()
    _turn_on(client, phone)
    client.cookies.clear()
    sign_in(client, "T-12")
    client.post("/api/messages", json={"from_unit_id": "T-12", "to_unit_id": "T-11", "body": "Our secret plan for Sunday"})
    assert _dispatch() == 1
    assert "secret" not in json.dumps(phone.inbox) and "Mesej baharu" in phone.texts()[0]
    client.cookies.clear()
    sign_in(client, "T-11")
    assert client.put("/api/units/T-11/profile", json={"quiet_mode": True}).status_code == 200
    client.cookies.clear()
    sign_in(client, "T-12")
    client.post("/api/messages", json={"from_unit_id": "T-12", "to_unit_id": "T-11", "body": "Another one"})
    assert _dispatch() == 0 and len(phone.inbox) == 1


def test_nothing_rings_at_night(client, sign_in, push_service, monkeypatch):
    from app import db

    night = datetime(2026, 10, 11, 15, 30, tzinfo=timezone.utc)  # 23:30 in Malaysia
    monkeypatch.setattr(db, "now", lambda: night.isoformat(timespec="seconds"))
    sign_in(client, "T-11")
    phone = push_service.phone()
    _turn_on(client, phone)
    client.cookies.clear()
    sign_in(client, "T-12")
    client.post("/api/messages", json={"from_unit_id": "T-12", "to_unit_id": "T-11", "body": "Still awake?"})
    client.cookies.clear()
    sign_in(client, "staff:Farah")
    client.post("/api/notices", json={"audience": "phase", "title": "Water cut", "body": "Tomorrow 9am to noon."})
    assert _dispatch(night + timedelta(minutes=1)) == 0
    morning = datetime(2026, 10, 11, 23, 5, tzinfo=timezone.utc)  # 07:05 the next day
    assert _dispatch(morning) == 1
    assert "Water cut" in phone.texts()[0] and len(phone.inbox) == 1  # the notice waited; the chat alert stays in the app


# ---------- phones that should stop ----------

def test_a_lost_phone_stops_getting_notifications(client, sign_in, push_service):
    sign_in(client, "T-11")
    lost = push_service.phone()
    _turn_on(client, lost)
    client.cookies.clear()
    sign_in(client, "staff:Farah")
    token = client.post("/api/units/T-11/reentry-code").json()["token"]
    client.cookies.clear()
    assert client.post("/api/auth/code", json={"token": token}).status_code == 200  # the new phone
    assert client.get("/api/push/status").json()["devices"] == 0
    client.cookies.clear()
    sign_in(client, "T-12")
    client.post("/api/messages", json={"from_unit_id": "T-12", "to_unit_id": "T-11", "body": "Hello"})
    assert _dispatch() == 0 and lost.inbox == []


def test_a_phone_the_push_service_forgot_is_dropped(client, sign_in, push_service):
    sign_in(client, "T-11")
    phone = push_service.phone()
    _turn_on(client, phone)
    push_service.forget(phone)  # the app was uninstalled, or the browser's data cleared
    assert client.post("/api/push/test").json() == {"sent": 0, "failed": 1}
    assert client.get("/api/push/status").json()["devices"] == 0


# ---------- the estate office hears about what needs it ----------

def test_staff_hear_about_reports_and_new_warranty_tickets(client, sign_in, push_service, monkeypatch):
    sign_in(client, "staff:Farah")
    desk = push_service.phone()
    _turn_on(client, desk)
    client.cookies.clear()
    sign_in(client, "T-12")
    message = client.post("/api/messages", json={"from_unit_id": "T-12", "to_unit_id": "T-11", "body": "You will regret this"}).json()
    client.cookies.clear()
    sign_in(client, "T-11")
    assert client.post(f"/api/messages/{message['id']}/report", json={"unit_id": "T-11", "reason": "threat"}).status_code == 201
    assert _dispatch() == 1 and "report" in desk.texts()[0].lower() and desk.inbox[0]["url"].endswith("tab=sdp")
    from test_layers_2_4 import _warranty_ticket

    monkeypatch.setenv("JIRAN_DEMO_MODE", "1")
    _warranty_ticket(client)
    monkeypatch.setenv("JIRAN_DEMO_MODE", "0")
    assert _dispatch() == 1 and "warranty" in desk.texts()[1].lower()
    assert "You will regret this" not in json.dumps(desk.inbox)  # staff read reports in the app, not on a lock screen
