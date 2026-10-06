import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from . import ledger
from .seed import PHASE, demo_units

SCHEMA = """
CREATE TABLE IF NOT EXISTS phases (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    note TEXT
);
CREATE TABLE IF NOT EXISTS units (
    id TEXT PRIMARY KEY,
    phase_id TEXT NOT NULL REFERENCES phases(id),
    kind TEXT NOT NULL,
    label TEXT NOT NULL,
    resident_name TEXT,
    terrace_row TEXT,
    facing_row TEXT,
    block TEXT,
    floor INTEGER,
    pos INTEGER,
    lang TEXT NOT NULL DEFAULT 'en',
    handover_date TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS intros (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    from_unit_id TEXT NOT NULL REFERENCES units(id),
    message TEXT NOT NULL,
    lang TEXT NOT NULL,
    renovation TEXT,
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS intro_recipients (
    intro_id INTEGER NOT NULL REFERENCES intros(id),
    unit_id TEXT NOT NULL REFERENCES units(id),
    relation TEXT NOT NULL,
    acked_at TEXT,
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
    status TEXT NOT NULL DEFAULT 'open',
    decision TEXT,
    decision_note TEXT,
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
    reason TEXT NOT NULL,
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
    opened_at TEXT NOT NULL,
    repaired_at TEXT,
    closed_at TEXT
);
CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    from_unit_id TEXT REFERENCES units(id),
    to_unit_id TEXT NOT NULL REFERENCES units(id),
    thread_with TEXT REFERENCES units(id),
    kind TEXT NOT NULL CHECK (kind IN ('text', 'quick', 'system')),
    body TEXT NOT NULL,
    quick_key TEXT,
    lang TEXT NOT NULL,
    author TEXT,
    withheld INTEGER NOT NULL DEFAULT 0,
    private INTEGER NOT NULL DEFAULT 0,
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
CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    unit_id TEXT NOT NULL REFERENCES units(id),
    type TEXT NOT NULL,
    payload TEXT NOT NULL,
    created_at TEXT NOT NULL,
    prev_hash TEXT NOT NULL,
    hash TEXT NOT NULL
);
"""


def now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def connect(path: str) -> sqlite3.Connection:
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(path, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


SCHEMA_VERSION = 3
TABLES = ("contact_consents", "reports", "blocks", "concerns", "messages",
          "warranty_tickets", "gate_logs", "passes", "incidents", "photos",
          "intro_recipients", "intros", "events", "units", "phases")


def drop_all(conn: sqlite3.Connection) -> None:
    for table in TABLES:
        conn.execute(f"DROP TABLE IF EXISTS {table}")


def init_db(conn: sqlite3.Connection) -> None:
    # The prototype only holds fictional demo data, so an older database layout is simply rebuilt.
    if conn.execute("PRAGMA user_version").fetchone()[0] != SCHEMA_VERSION:
        drop_all(conn)
        conn.execute(f"PRAGMA user_version = {SCHEMA_VERSION}")
    conn.executescript(SCHEMA)
    if conn.execute("SELECT COUNT(*) FROM phases").fetchone()[0] == 0:
        _seed(conn)
    conn.commit()


def _seed(conn: sqlite3.Connection) -> None:
    conn.execute("INSERT INTO phases (id, name, note) VALUES (?, ?, ?)", (PHASE["id"], PHASE["name"], PHASE["note"]))
    for u in demo_units():
        conn.execute(
            "INSERT INTO units (id, phase_id, kind, label, resident_name, terrace_row, facing_row, block, floor, pos,"
            " lang, handover_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (u["id"], u["phase_id"], u["kind"], u["label"], u["resident_name"],
             u.get("row"), u.get("facing_row"), u.get("block"), u.get("floor"), u["pos"], u["lang"], PHASE["handover_date"]),
        )
        # Every home history starts with SDP's handover record.
        append_event(conn, u["id"], "handover", {"note": "Vacant possession; SDP handover inspection recorded",
                                                 "vacant_possession": PHASE["handover_date"]})


def append_event(conn: sqlite3.Connection, unit_id: str, event_type: str, payload: dict[str, Any]) -> dict[str, Any]:
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
