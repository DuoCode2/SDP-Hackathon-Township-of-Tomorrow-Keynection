"""Sign-in for the pilot: every key comes with a digital key.

At handover the owner scans the one-time code from the welcome pack and their phone makes a passkey (fingerprint,
face or the phone's own PIN). After that the server knows who is asking: no password to forget or steal, no SMS to
pay for, and a phished or copied code is useless once used. A lost phone is handled at the estate office, which
issues a one-time re-entry code; using it retires every old key and session of that home. Staff sign in the same
way, starting from a one-time code made on the server (scripts/add_staff.py).

Only hashes of codes and session tokens are stored; a passkey's private key never leaves the phone.
In demo mode none of this is required: the demo's cast switcher stays as it is.
"""
from __future__ import annotations

import hashlib
import json
import secrets
import sqlite3
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any

from webauthn import (generate_authentication_options, generate_registration_options, options_to_json,
                      verify_authentication_response, verify_registration_response)
from webauthn.helpers import base64url_to_bytes, bytes_to_base64url
from webauthn.helpers.exceptions import WebAuthnException
from webauthn.helpers.structs import (AuthenticatorSelectionCriteria, PublicKeyCredentialDescriptor, ResidentKeyRequirement,
                                      UserVerificationRequirement)

SESSION_COOKIE = "keynection_session"
SESSION_DAYS = 30
CODE_DAYS = 7  # a staff code or a re-entry code works for a week, once
CHALLENGE_SECONDS = 300
RP_NAME = "Keynection"


class SignInError(Exception):
    """A sign-in step that can't go ahead; the message is safe to show. The reason lets the phone say it in the
    reader's language: code_used, too_slow, key_unknown or key_retry."""

    def __init__(self, message: str, reason: str):
        super().__init__(message)
        self.reason = reason


@dataclass(frozen=True)
class Actor:
    """Who is asking: a household ('unit:T-12') or a staff member ('staff:3')."""
    subject: str
    name: str = ""
    role: str | None = None  # staff only: 'estate' or 'sdp'

    @property
    def unit_id(self) -> str | None:
        return self.subject[5:] if self.subject.startswith("unit:") else None

    @property
    def is_staff(self) -> bool:
        return self.subject.startswith("staff:")


def unit_subject(unit_id: str) -> str:
    return f"unit:{unit_id}"


def _hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(when: datetime) -> str:
    return when.isoformat(timespec="seconds")


# ---------- sessions ----------

def new_session(conn: sqlite3.Connection, subject: str) -> str:
    """A fresh session for subject; the caller puts the returned token in the session cookie."""
    token = secrets.token_urlsafe(32)
    conn.execute("DELETE FROM sessions WHERE expires_at <= ?", (_iso(_now()),))
    conn.execute("INSERT INTO sessions (token_hash, subject, created_at, expires_at) VALUES (?, ?, ?, ?)",
                 (_hash(token), subject, _iso(_now()), _iso(_now() + timedelta(days=SESSION_DAYS))))
    conn.commit()
    return token


def actor_for(conn: sqlite3.Connection, token: str | None) -> Actor | None:
    """The signed-in household or staff member behind a session token, if it is still valid."""
    if not token:
        return None
    row = conn.execute("SELECT subject FROM sessions WHERE token_hash = ? AND expires_at > ?",
                       (_hash(token), _iso(_now()))).fetchone()
    if row is None:
        return None
    subject = row["subject"]
    if subject.startswith("staff:"):
        staff = conn.execute("SELECT * FROM staff WHERE id = ? AND revoked_at IS NULL", (int(subject[6:]),)).fetchone()
        return Actor(subject, staff["name"], staff["role"]) if staff else None
    unit = conn.execute("SELECT resident_name, joined_at FROM units WHERE id = ?", (subject[5:],)).fetchone()
    return Actor(subject, unit["resident_name"]) if unit and unit["joined_at"] else None


def end_session(conn: sqlite3.Connection, token: str | None) -> None:
    if token:
        conn.execute("DELETE FROM sessions WHERE token_hash = ?", (_hash(token),))
        conn.commit()


def retire_all(conn: sqlite3.Connection, subject: str) -> None:
    """A lost phone: every key and session of this subject stops working."""
    conn.execute("DELETE FROM sessions WHERE subject = ?", (subject,))
    conn.execute("DELETE FROM passkeys WHERE subject = ?", (subject,))
    conn.commit()


# ---------- one-time codes (staff, re-entry) ----------

def issue_code(conn: sqlite3.Connection, purpose: str, subject: str) -> tuple[str, str]:
    """A one-time code for subject; any earlier unused code of the same kind stops working."""
    token = secrets.token_urlsafe(24)
    expires = _iso(_now() + timedelta(days=CODE_DAYS))
    conn.execute("UPDATE access_codes SET expires_at = ? WHERE subject = ? AND purpose = ? AND used_at IS NULL",
                 (_iso(_now()), subject, purpose))
    conn.execute("INSERT INTO access_codes (purpose, subject, token_hash, created_at, expires_at) VALUES (?, ?, ?, ?, ?)",
                 (purpose, subject, _hash(token), _iso(_now()), expires))
    conn.commit()
    return token, expires


def use_code(conn: sqlite3.Connection, token: str) -> tuple[str, str]:
    """(purpose, subject) of a valid one-time code, which is used up."""
    row = conn.execute("SELECT * FROM access_codes WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?",
                       (_hash(token), _iso(_now()))).fetchone()
    if row is None:
        raise SignInError("This code isn't valid any more. Ask the estate office for a new one.", "code_used")
    conn.execute("UPDATE access_codes SET used_at = ? WHERE id = ?", (_iso(_now()), row["id"]))
    conn.commit()
    return row["purpose"], row["subject"]


def add_staff(conn: sqlite3.Connection, name: str, role: str) -> tuple[int, str, str]:
    """A staff member and the one-time code for their first sign-in: (staff id, code, expiry)."""
    cur = conn.execute("INSERT INTO staff (name, role, created_at) VALUES (?, ?, ?)", (name, role, _iso(_now())))
    conn.commit()
    token, expires = issue_code(conn, "staff", f"staff:{cur.lastrowid}")
    return cur.lastrowid, token, expires


# ---------- passkeys ----------

def _handle(conn: sqlite3.Connection, subject: str) -> bytes:
    """The random user id a phone keeps with this subject's passkeys: it says nothing about the home."""
    row = conn.execute("SELECT handle FROM webauthn_handles WHERE subject = ?", (subject,)).fetchone()
    if row:
        return base64url_to_bytes(row["handle"])
    handle = secrets.token_bytes(16)
    conn.execute("INSERT INTO webauthn_handles (subject, handle) VALUES (?, ?)", (subject, bytes_to_base64url(handle)))
    return handle


def _challenge(conn: sqlite3.Connection, purpose: str, challenge: bytes, subject: str | None = None) -> str:
    conn.execute("DELETE FROM auth_challenges WHERE expires_at <= ?", (_iso(_now()),))
    challenge_id = secrets.token_urlsafe(18)
    conn.execute("INSERT INTO auth_challenges (id, challenge, purpose, subject, expires_at) VALUES (?, ?, ?, ?, ?)",
                 (challenge_id, bytes_to_base64url(challenge), purpose, subject,
                  _iso(_now() + timedelta(seconds=CHALLENGE_SECONDS))))
    conn.commit()
    return challenge_id


def _take_challenge(conn: sqlite3.Connection, challenge_id: str, purpose: str) -> sqlite3.Row:
    """A challenge works once, for its own purpose, for five minutes."""
    row = conn.execute("SELECT * FROM auth_challenges WHERE id = ? AND purpose = ? AND expires_at > ?",
                       (challenge_id, purpose, _iso(_now()))).fetchone()
    conn.execute("DELETE FROM auth_challenges WHERE id = ?", (challenge_id,))
    conn.commit()
    if row is None:
        raise SignInError("That took too long. Please try again.", "too_slow")
    return row


def registration_options(conn: sqlite3.Connection, actor: Actor, rp_id: str, label: str) -> dict[str, Any]:
    """What the phone needs to make a new passkey for this household or staff member."""
    existing = [PublicKeyCredentialDescriptor(id=base64url_to_bytes(r["credential_id"]))
                for r in conn.execute("SELECT credential_id FROM passkeys WHERE subject = ?", (actor.subject,))]
    options = generate_registration_options(
        rp_id=rp_id, rp_name=RP_NAME, user_id=_handle(conn, actor.subject), user_name=label, user_display_name=label,
        authenticator_selection=AuthenticatorSelectionCriteria(resident_key=ResidentKeyRequirement.REQUIRED,
                                                               user_verification=UserVerificationRequirement.REQUIRED),
        exclude_credentials=existing)
    challenge_id = _challenge(conn, "register", options.challenge, actor.subject)
    return {"challenge_id": challenge_id, "options": json.loads(options_to_json(options))}


def finish_registration(conn: sqlite3.Connection, actor: Actor, challenge_id: str, credential: dict[str, Any],
                        rp_id: str, origins: list[str]) -> int:
    """Keep the new passkey; returns how many this subject now has."""
    row = _take_challenge(conn, challenge_id, "register")
    if row["subject"] != actor.subject:
        raise SignInError("This key could not be checked. Please try again.", "key_retry")
    try:
        verified = verify_registration_response(credential=credential, expected_challenge=base64url_to_bytes(row["challenge"]),
                                                expected_rp_id=rp_id, expected_origin=origins, require_user_verification=True)
    except (WebAuthnException, ValueError, KeyError, TypeError) as e:
        raise SignInError("This key could not be checked. Please try again.", "key_retry") from e
    conn.execute("INSERT OR REPLACE INTO passkeys (credential_id, subject, public_key, sign_count, created_at) VALUES (?, ?, ?, ?, ?)",
                 (bytes_to_base64url(verified.credential_id), actor.subject, verified.credential_public_key,
                  verified.sign_count, _iso(_now())))
    conn.commit()
    return passkey_count(conn, actor.subject)


def signin_options(conn: sqlite3.Connection, rp_id: str) -> dict[str, Any]:
    """Sign-in with any key this phone holds for Keynection: no user name to type."""
    options = generate_authentication_options(rp_id=rp_id, user_verification=UserVerificationRequirement.REQUIRED)
    return {"challenge_id": _challenge(conn, "signin", options.challenge), "options": json.loads(options_to_json(options))}


def finish_signin(conn: sqlite3.Connection, challenge_id: str, credential: dict[str, Any], rp_id: str, origins: list[str]) -> str:
    """The subject whose passkey just signed the challenge."""
    row = _take_challenge(conn, challenge_id, "signin")
    key = conn.execute("SELECT * FROM passkeys WHERE credential_id = ?", (str(credential.get("id", "")),)).fetchone()
    if key is None:
        raise SignInError("This key isn't known here. If you changed phones, ask the estate office for a re-entry code.", "key_unknown")
    try:
        verified = verify_authentication_response(credential=credential, expected_challenge=base64url_to_bytes(row["challenge"]),
                                                  expected_rp_id=rp_id, expected_origin=origins,
                                                  credential_public_key=key["public_key"],
                                                  credential_current_sign_count=key["sign_count"], require_user_verification=True)
    except (WebAuthnException, ValueError, KeyError, TypeError) as e:
        raise SignInError("This key could not be checked. Please try again.", "key_retry") from e
    conn.execute("UPDATE passkeys SET sign_count = ?, last_used_at = ? WHERE credential_id = ?",
                 (verified.new_sign_count, _iso(_now()), key["credential_id"]))
    conn.commit()
    return key["subject"]


def passkey_count(conn: sqlite3.Connection, subject: str) -> int:
    return conn.execute("SELECT COUNT(*) FROM passkeys WHERE subject = ?", (subject,)).fetchone()[0]
