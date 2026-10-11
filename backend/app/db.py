import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from . import ledger
from .seed import BIOS, CONSENT_VERSION, EASY_MODE, NOT_JOINED, PHASE, QUIET_TIMES, SEED_HELPERS, demo_notices, demo_units, handover_date

SCHEMA = """
CREATE TABLE IF NOT EXISTS phases (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    note TEXT,
    -- Pilot: who last imported SDP's handover list for this phase, and when.
    imported_by TEXT,
    imported_at TEXT
);
CREATE TABLE IF NOT EXISTS units (
    id TEXT PRIMARY KEY,
    phase_id TEXT NOT NULL REFERENCES phases(id),
    kind TEXT NOT NULL,
    label TEXT NOT NULL,
    resident_name TEXT,
    -- Terrace houses: the road the house is on (the second ring, and street notices).
    street TEXT,
    terrace_row TEXT,
    facing_row TEXT,
    block TEXT,
    floor INTEGER,
    pos INTEGER,
    lang TEXT NOT NULL DEFAULT 'en',
    handover_date TEXT NOT NULL,
    -- The name on SDP's sales record. Never shown to neighbours: it only pre-fills the join form for the owner.
    record_name TEXT,
    -- Set when the household joins and agrees to the privacy notice. Until then resident_name is the unit label.
    joined_at TEXT,
    consent_version TEXT
);
CREATE TABLE IF NOT EXISTS intros (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    from_unit_id TEXT NOT NULL REFERENCES units(id),
    message TEXT NOT NULL,
    lang TEXT NOT NULL,
    renovation TEXT,
    sent_by TEXT,
    translations TEXT,          -- JSON {lang: {message, scope}}: Claude's translation for each reader's language
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS intro_recipients (
    intro_id INTEGER NOT NULL REFERENCES intros(id),
    unit_id TEXT NOT NULL REFERENCES units(id),
    relation TEXT NOT NULL,
    acked_at TEXT,
    quiet TEXT,                 -- renovation notices: 'avoided' or 'overlap' for this home's quiet times when sent
    PRIMARY KEY (intro_id, unit_id)
);
CREATE TABLE IF NOT EXISTS photos (
    id TEXT PRIMARY KEY,
    unit_id TEXT NOT NULL REFERENCES units(id),
    kind TEXT NOT NULL CHECK (kind IN ('baseline', 'followup', 'repair')),
    subject TEXT NOT NULL,
    renovation_intro_id INTEGER REFERENCES intros(id),
    sha256 TEXT NOT NULL,
    width INTEGER NOT NULL,
    height INTEGER NOT NULL,
    quality TEXT NOT NULL,
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS incidents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    reporter_unit_id TEXT NOT NULL REFERENCES units(id),
    renovation_intro_id INTEGER REFERENCES intros(id),
    baseline_photo_id TEXT NOT NULL REFERENCES photos(id),
    followup_photo_id TEXT NOT NULL REFERENCES photos(id),
    comparison TEXT NOT NULL,
    hint TEXT NOT NULL,
    -- open -> decided, or open -> proposed (the neighbour blames the renovation) -> decided | disputed -> decided
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'proposed', 'disputed', 'decided')),
    decision TEXT,
    decision_note TEXT,   -- from the household that reported the change
    response_note TEXT,   -- from the renovating household
    proposed_at TEXT,
    decided_by TEXT CHECK (decided_by IN ('reporter', 'renovating_owner', 'both_owners')),
    decided_at TEXT,
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS passes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    intro_id INTEGER NOT NULL REFERENCES intros(id),
    unit_id TEXT NOT NULL REFERENCES units(id),
    contractor_name TEXT NOT NULL,
    contractor_cidb INTEGER NOT NULL DEFAULT 0,
    token_hash TEXT NOT NULL UNIQUE,
    valid_from TEXT NOT NULL,
    valid_to TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
    created_at TEXT NOT NULL,
    revoked_at TEXT
);
CREATE TABLE IF NOT EXISTS gate_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pass_id INTEGER REFERENCES passes(id),
    allowed INTEGER NOT NULL,
    reason TEXT NOT NULL,       -- English, for the record
    reason_code TEXT,           -- with reason_values (JSON): shown in the reader's language
    reason_values TEXT,
    scanned_for TEXT NOT NULL,
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS warranty_tickets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    unit_id TEXT NOT NULL REFERENCES units(id),
    incident_id INTEGER REFERENCES incidents(id),
    subject TEXT NOT NULL,
    defect_photo_id TEXT NOT NULL REFERENCES photos(id),
    baseline_photo_id TEXT REFERENCES photos(id),
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'repair_submitted', 'closed')),
    subcontractor TEXT,
    procore_ref TEXT,
    repair_photo_id TEXT REFERENCES photos(id),
    repair_check TEXT,
    owner_note TEXT,
    reopen_count INTEGER NOT NULL DEFAULT 0,
    exported_at TEXT,  -- pilot: when SDP's warranty team last took it into Procore
    opened_at TEXT NOT NULL,
    repaired_at TEXT,
    closed_at TEXT
);
CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    from_unit_id TEXT REFERENCES units(id),
    to_unit_id TEXT NOT NULL REFERENCES units(id),
    thread_with TEXT REFERENCES units(id),
    kind TEXT NOT NULL CHECK (kind IN ('text', 'quick', 'system', 'voice')),
    media_id TEXT,
    body TEXT NOT NULL,
    quick_key TEXT,
    lang TEXT NOT NULL,
    author TEXT,
    withheld INTEGER NOT NULL DEFAULT 0,
    private INTEGER NOT NULL DEFAULT 0,
    sent_by TEXT,
    sys_code TEXT,              -- automatic notices: code + values (JSON), so the app shows them in each reader's language
    sys_values TEXT,
    translations TEXT,          -- JSON {lang: text}: Claude's translation for the reader; body stays as written
    created_at TEXT NOT NULL,
    read_at TEXT
);
CREATE TABLE IF NOT EXISTS concerns (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    intro_id INTEGER NOT NULL REFERENCES intros(id),
    from_unit_id TEXT NOT NULL REFERENCES units(id),
    to_unit_id TEXT NOT NULL REFERENCES units(id),
    category TEXT NOT NULL,
    note TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'open'
        CHECK (status IN ('open', 'acknowledged', 'resolved', 'escalated', 'closed_by_estate')),
    response_note TEXT,
    estate_note TEXT,
    reminders INTEGER NOT NULL DEFAULT 0,
    acted_by TEXT,
    created_at TEXT NOT NULL,
    acknowledged_at TEXT,
    resolved_at TEXT,
    escalated_at TEXT,
    closed_at TEXT
);
CREATE TABLE IF NOT EXISTS blocks (
    unit_id TEXT NOT NULL REFERENCES units(id),
    blocked_unit_id TEXT NOT NULL REFERENCES units(id),
    created_at TEXT NOT NULL,
    PRIMARY KEY (unit_id, blocked_unit_id)
);
CREATE TABLE IF NOT EXISTS reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    message_id INTEGER NOT NULL REFERENCES messages(id),
    reporter_unit_id TEXT NOT NULL REFERENCES units(id),
    reason TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'warned', 'dismissed')),
    created_at TEXT NOT NULL,
    reviewed_at TEXT
);
CREATE TABLE IF NOT EXISTS contact_consents (
    unit_id TEXT NOT NULL REFERENCES units(id),
    other_unit_id TEXT NOT NULL REFERENCES units(id),
    created_at TEXT NOT NULL,
    PRIMARY KEY (unit_id, other_unit_id)
);
CREATE TABLE IF NOT EXISTS contact_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    from_unit_id TEXT NOT NULL REFERENCES units(id),
    to_unit_id TEXT NOT NULL REFERENCES units(id),
    reason TEXT NOT NULL,
    note TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined')),
    created_at TEXT NOT NULL,
    responded_at TEXT
);
CREATE TABLE IF NOT EXISTS delegates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    unit_id TEXT NOT NULL REFERENCES units(id),
    name TEXT NOT NULL,
    relation TEXT NOT NULL,
    created_at TEXT NOT NULL,
    revoked_at TEXT
);
CREATE TABLE IF NOT EXISTS waves (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    from_unit_id TEXT NOT NULL REFERENCES units(id),
    to_unit_id TEXT NOT NULL REFERENCES units(id),
    created_at TEXT NOT NULL,
    seen_at TEXT
);
CREATE TABLE IF NOT EXISTS reactions (
    message_id INTEGER NOT NULL REFERENCES messages(id),
    unit_id TEXT NOT NULL REFERENCES units(id),
    emoji TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (message_id, unit_id)
);
CREATE TABLE IF NOT EXISTS profiles (
    unit_id TEXT PRIMARY KEY REFERENCES units(id),
    bio TEXT NOT NULL DEFAULT '',
    accept_requests INTEGER NOT NULL DEFAULT 1,
    allow_waves INTEGER NOT NULL DEFAULT 1,
    quiet_mode INTEGER NOT NULL DEFAULT 0,
    notices_read_at TEXT,
    easy_mode INTEGER NOT NULL DEFAULT 0,
    whatsapp_alerts INTEGER NOT NULL DEFAULT 1,
    quiet_times TEXT NOT NULL DEFAULT '[]',  -- JSON [{start, end, why}]: private, used only to plan renovation hours
    quiet_times_at TEXT
);
CREATE TABLE IF NOT EXISTS join_codes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    unit_id TEXT NOT NULL REFERENCES units(id),
    token_hash TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    used_at TEXT
);
-- Sign-in (pilot mode). A subject is 'unit:<id>' (a household) or 'staff:<id>'. Codes and session tokens are stored
-- as hashes only; a passkey's private key never leaves the person's phone.
CREATE TABLE IF NOT EXISTS staff (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('estate', 'sdp')),
    created_at TEXT NOT NULL,
    revoked_at TEXT
);
CREATE TABLE IF NOT EXISTS access_codes (   -- one-time: a staff member's first sign-in, or a household's after a lost phone
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    purpose TEXT NOT NULL CHECK (purpose IN ('staff', 'reentry')),
    subject TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    used_at TEXT
);
CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    subject TEXT NOT NULL,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS passkeys (
    credential_id TEXT PRIMARY KEY,
    subject TEXT NOT NULL,
    public_key BLOB NOT NULL,
    sign_count INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    last_used_at TEXT
);
CREATE TABLE IF NOT EXISTS webauthn_handles (  -- the random user id a phone stores with its passkey
    subject TEXT PRIMARY KEY,
    handle TEXT NOT NULL UNIQUE
);
CREATE TABLE IF NOT EXISTS auth_challenges (
    id TEXT PRIMARY KEY,
    challenge TEXT NOT NULL,
    purpose TEXT NOT NULL CHECK (purpose IN ('register', 'signin')),
    subject TEXT,
    expires_at TEXT NOT NULL
);
-- Pilot: phones that turned notifications on (web push). The endpoint is the address of that phone at its push
-- service (Google, Apple, Mozilla or Microsoft); the two keys let this server encrypt alerts for that phone only.
CREATE TABLE IF NOT EXISTS push_subscriptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    subject TEXT NOT NULL,
    endpoint TEXT NOT NULL UNIQUE,
    p256dh TEXT NOT NULL,
    auth TEXT NOT NULL,
    created_at TEXT NOT NULL,
    last_sent_at TEXT,
    failures INTEGER NOT NULL DEFAULT 0
);
-- Each alert goes to a household (or the estate office) once per channel: sent, or skipped (a chat alert at night).
CREATE TABLE IF NOT EXISTS deliveries (
    subject TEXT NOT NULL,
    ref TEXT NOT NULL,
    channel TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('sent', 'skipped')),
    at TEXT NOT NULL,
    PRIMARY KEY (subject, ref, channel)
);
-- This server's own settings, e.g. its notification signing key (made once, kept with the data).
CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS paper_notices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    intro_id INTEGER NOT NULL REFERENCES intros(id),
    unit_id TEXT NOT NULL REFERENCES units(id),
    status TEXT NOT NULL DEFAULT 'to_print' CHECK (status IN ('to_print', 'printed', 'delivered', 'superseded')),
    created_at TEXT NOT NULL,
    printed_at TEXT,
    delivered_at TEXT,
    delivered_by TEXT
);
CREATE TABLE IF NOT EXISTS notices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    phase_id TEXT NOT NULL REFERENCES phases(id),
    audience TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    author TEXT NOT NULL,
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    unit_id TEXT NOT NULL REFERENCES units(id),
    type TEXT NOT NULL,
    payload TEXT NOT NULL,
    created_at TEXT NOT NULL,
    prev_hash TEXT NOT NULL,
    hash TEXT NOT NULL
);
-- Backstop for append_event's lock: a home's log can never have two records chained onto the same one.
CREATE UNIQUE INDEX IF NOT EXISTS events_one_chain ON events (unit_id, prev_hash);
"""


def now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def connect(path: str) -> sqlite3.Connection:
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(path, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


SCHEMA_VERSION = 15
TABLES = ("settings", "deliveries", "push_subscriptions", "auth_challenges", "webauthn_handles", "passkeys", "sessions", "access_codes", "staff", "paper_notices", "join_codes", "delegates", "profiles", "reactions", "waves", "notices", "contact_requests", "contact_consents", "reports", "blocks", "concerns", "messages",
          "warranty_tickets", "gate_logs", "passes", "incidents", "photos",
          "intro_recipients", "intros", "events", "units", "phases")


def drop_all(conn: sqlite3.Connection) -> None:
    for table in TABLES:
        conn.execute(f"DROP TABLE IF EXISTS {table}")


class SchemaChangeError(RuntimeError):
    """A newer Keynection needs a change to a pilot database that could lose records: stop instead."""


def init_db(conn: sqlite3.Connection, keep_data: bool = False) -> None:
    """Demo: the fictional phase, and an older database layout is simply rebuilt from it. Pilot (keep_data): real
    households' records are never dropped and nothing fictional is added; a newer layout only adds tables and
    columns, and anything else stops the server before a single record changes."""
    if keep_data:
        _upgrade_in_place(conn)
        conn.executescript(SCHEMA)
        conn.execute(f"PRAGMA user_version = {SCHEMA_VERSION}")
        conn.commit()
        return
    if conn.execute("PRAGMA user_version").fetchone()[0] != SCHEMA_VERSION:
        drop_all(conn)
        conn.execute(f"PRAGMA user_version = {SCHEMA_VERSION}")
    conn.executescript(SCHEMA)
    if conn.execute("SELECT COUNT(*) FROM phases").fetchone()[0] == 0:
        _seed(conn)
    conn.commit()


def _upgrade_in_place(conn: sqlite3.Connection) -> None:
    """Bring a pilot database up to this layout by adding what is missing. Checks everything first and changes
    nothing if any part can't be done by adding (a renamed or removed column, a new required column...)."""
    if conn.execute("PRAGMA user_version").fetchone()[0] == SCHEMA_VERSION:
        return
    ref = sqlite3.connect(":memory:")
    ref.row_factory = sqlite3.Row
    ref.executescript(SCHEMA)
    have = {r["name"] for r in conn.execute("SELECT name FROM sqlite_master WHERE type = 'table'")}
    adds, problems = [], []
    for table in [r["name"] for r in ref.execute("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")]:
        if table not in have:
            continue  # a new table: created by the schema script
        want = {c["name"]: c for c in ref.execute(f"PRAGMA table_info({table})")}
        cols = {c["name"]: c for c in conn.execute(f"PRAGMA table_info({table})")}
        problems += [f"{table}.{n} is not in this version" for n in cols if n not in want]
        problems += [f"{table}.{n} changed type" for n, c in cols.items() if n in want and c["type"] != want[n]["type"]]
        unique = {c["name"] for i in ref.execute(f"PRAGMA index_list({table})") if i["unique"]
                  for c in ref.execute(f"PRAGMA index_info({i['name']})")}
        for name, col in want.items():
            if name in cols:
                continue
            if col["pk"] or name in unique or (col["notnull"] and col["dflt_value"] is None):
                problems.append(f"{table}.{name} can't be added to existing records")
                continue
            sql = f"{name} {col['type']}" + (" NOT NULL" if col["notnull"] else "")
            sql += f" DEFAULT {col['dflt_value']}" if col["dflt_value"] is not None else ""
            sql += "".join(f" REFERENCES {fk['table']}({fk['to']})" for fk in ref.execute(f"PRAGMA foreign_key_list({table})")
                           if fk["from"] == name)
            adds.append(f"ALTER TABLE {table} ADD COLUMN {sql}")
    ref.close()
    if problems:
        raise SchemaChangeError("This version of Keynection can't upgrade the pilot database without risking records ("
                                + "; ".join(problems) + "). Nothing was changed. Back up the database and ask the team "
                                "for a written migration.")
    for sql in adds:
        conn.execute(sql)


def _seed(conn: sqlite3.Connection) -> None:
    conn.execute("INSERT INTO phases (id, name, note) VALUES (?, ?, ?)", (PHASE["id"], PHASE["name"], PHASE["note"]))
    handover = handover_date()
    for u in demo_units():
        joined = u["id"] not in NOT_JOINED
        conn.execute(
            "INSERT INTO units (id, phase_id, kind, label, resident_name, street, terrace_row, facing_row, block, floor, pos,"
            " lang, handover_date, record_name, joined_at, consent_version) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (u["id"], u["phase_id"], u["kind"], u["label"], u["resident_name"] if joined else u["label"], u.get("street"),
             u.get("row"), u.get("facing_row"), u.get("block"), u.get("floor"), u["pos"], u["lang"], handover,
             u["resident_name"], handover if joined else None, CONSENT_VERSION if joined else None),
        )
        # Every home history starts with SDP's handover record.
        append_event(conn, u["id"], "handover", {"note": "Vacant possession; SDP handover inspection recorded",
                                                 "vacant_possession": handover})
        conn.execute("INSERT INTO profiles (unit_id, bio, easy_mode, quiet_times) VALUES (?, ?, ?, ?)",
                     (u["id"], BIOS.get(u["resident_name"], "") if joined else "", int(u["id"] in EASY_MODE),
                      json.dumps(QUIET_TIMES.get(u["resident_name"], []) if joined else [])))
    for unit_id, name, relation in SEED_HELPERS:
        cur = conn.execute("INSERT INTO delegates (unit_id, name, relation, created_at) VALUES (?, ?, ?, ?)", (unit_id, name, relation, now()))
        append_event(conn, unit_id, "delegate_added", {"delegate_id": cur.lastrowid, "name": name, "relation": relation})
    for audience, title, body in demo_notices():
        conn.execute("INSERT INTO notices (phase_id, audience, title, body, author, created_at) VALUES (?, ?, ?, ?, ?, ?)",
                     (PHASE["id"], audience, title, body, "SDP Estate Team", now()))


def append_event(conn: sqlite3.Connection, unit_id: str, event_type: str, payload: dict[str, Any]) -> dict[str, Any]:
    # Take the write lock before reading the last hash. Otherwise two requests can both read the same last record
    # and both chain onto it, forking the log. If this request already wrote something, it holds the lock already.
    if not conn.in_transaction:
        conn.execute("BEGIN IMMEDIATE")
    last = conn.execute("SELECT hash FROM events WHERE unit_id = ? ORDER BY id DESC LIMIT 1", (unit_id,)).fetchone()
    prev_hash = last["hash"] if last else ledger.GENESIS_HASH
    created_at = now()
    h = ledger.compute_hash(prev_hash, unit_id, event_type, payload, created_at)
    cur = conn.execute(
        "INSERT INTO events (unit_id, type, payload, created_at, prev_hash, hash) VALUES (?, ?, ?, ?, ?, ?)",
        (unit_id, event_type, json.dumps(payload, ensure_ascii=False), created_at, prev_hash, h),
    )
    return {"id": cur.lastrowid, "unit_id": unit_id, "type": event_type, "payload": payload,
            "created_at": created_at, "prev_hash": prev_hash, "hash": h}


def unit_events(conn: sqlite3.Connection, unit_id: str) -> list[dict[str, Any]]:
    rows = conn.execute("SELECT * FROM events WHERE unit_id = ? ORDER BY id", (unit_id,)).fetchall()
    return [{**dict(r), "payload": json.loads(r["payload"])} for r in rows]
