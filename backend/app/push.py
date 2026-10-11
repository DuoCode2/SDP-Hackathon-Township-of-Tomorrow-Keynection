"""Pilot: real notifications on the phone, by web push: the browser's own notifications, with no app store, no SMS
and no phone number.

A phone that turns notifications on gives Keynection its address at the phone maker's push service (Google, Apple,
Mozilla or Microsoft) and two keys. Each alert is then encrypted for that one phone (RFC 8291), so the push service
in between can't read it, and every request is signed with this server's own key (VAPID, RFC 8292), so nobody else
can send in Keynection's name. Only those four push services are accepted, so a request can't make this server post
anywhere else.
"""
from __future__ import annotations

import base64
import json
import sqlite3
import time
from typing import Any
from urllib.parse import urlparse

import http_ece
import httpx
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.asymmetric.utils import decode_dss_signature

PUSH_HOSTS = (".googleapis.com", ".push.apple.com", ".push.services.mozilla.com", ".notify.windows.com")
TTL = 24 * 3600  # a phone that stays off for a day misses the alert; it is still in the app
MAX_TEXT = 600  # an encrypted alert must fit in 4 KB


def b64u(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def unb64u(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


def _key(conn: sqlite3.Connection) -> ec.EllipticCurvePrivateKey:
    """This server's signing key, made once and kept in the database (a new key would silence every phone)."""
    row = conn.execute("SELECT value FROM settings WHERE key = 'vapid_key'").fetchone()
    if row is None:
        pem = ec.generate_private_key(ec.SECP256R1()).private_bytes(
            serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()).decode()
        conn.execute("INSERT OR IGNORE INTO settings (key, value) VALUES ('vapid_key', ?)", (pem,))
        conn.commit()
        row = conn.execute("SELECT value FROM settings WHERE key = 'vapid_key'").fetchone()
    key = serialization.load_pem_private_key(row[0].encode(), password=None)
    assert isinstance(key, ec.EllipticCurvePrivateKey)
    return key


def public_key(conn: sqlite3.Connection) -> str:
    """What a phone needs to accept alerts from this server only."""
    point = _key(conn).public_key().public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)
    return b64u(point)


def allowed(endpoint: str) -> bool:
    url = urlparse(endpoint)
    host = (url.hostname or "").lower()
    return url.scheme == "https" and any(host.endswith(h) for h in PUSH_HOSTS)


def valid_keys(p256dh: str, auth: str) -> bool:
    try:
        point, secret = unb64u(p256dh), unb64u(auth)
        ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(), point)
    except (ValueError, TypeError):
        return False
    return len(point) == 65 and len(secret) == 16


def _vapid(conn: sqlite3.Connection, endpoint: str, contact: str) -> str:
    """The signed note that says this request comes from Keynection's server (valid 12 hours, for that one service)."""
    url = urlparse(endpoint)
    compact = {"separators": (",", ":")}
    head = b64u(json.dumps({"typ": "JWT", "alg": "ES256"}, **compact).encode())
    claims = b64u(json.dumps({"aud": f"{url.scheme}://{url.netloc}", "exp": int(time.time()) + 12 * 3600, "sub": contact},
                             **compact).encode())
    r, s = decode_dss_signature(_key(conn).sign(f"{head}.{claims}".encode(), ec.ECDSA(hashes.SHA256())))
    return f"vapid t={head}.{claims}.{b64u(r.to_bytes(32, 'big') + s.to_bytes(32, 'big'))}, k={public_key(conn)}"


def post(url: str, body: bytes, headers: dict[str, str]) -> int:
    """Hand one encrypted alert to the phone's push service. Returns its status: 201 taken, 404 or 410 the phone is gone."""
    return httpx.post(url, content=body, headers=headers, timeout=10).status_code


def send(conn: sqlite3.Connection, phone: sqlite3.Row, alert: dict[str, Any], contact: str, urgency: str = "normal") -> int:
    """Encrypt the alert for this one phone and hand it to its push service."""
    alert = {**alert, "body": str(alert.get("body", ""))[:MAX_TEXT]}
    body = http_ece.encrypt(json.dumps(alert, ensure_ascii=False).encode(), private_key=ec.generate_private_key(ec.SECP256R1()),
                            dh=unb64u(phone["p256dh"]), auth_secret=unb64u(phone["auth"]), version="aes128gcm")
    headers = {"TTL": str(TTL), "Urgency": urgency, "Content-Encoding": "aes128gcm", "Content-Type": "application/octet-stream",
               "Authorization": _vapid(conn, phone["endpoint"], contact)}
    return post(phone["endpoint"], body, headers)
