import asyncio
import hashlib
import json
import logging
import os
import re
import secrets
import shutil
import sqlite3
import uuid
from collections.abc import Iterator
from contextlib import asynccontextmanager
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Literal

from fastapi import Depends, FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field, model_validator

from . import db, ledger, talk, vision
from .neighbours import Unit, impact_reason, impact_zone, inverse_relation, neighbour_circle, street_or_block
from .triage import triage_hint

log = logging.getLogger("jiran5")

DEFAULT_DB = Path(__file__).resolve().parent.parent / "data" / "app.db"
DEMO_PHOTO_DIR = Path(__file__).resolve().parent / "demo_photos"
MAX_REQUEST_BYTES = vision.MAX_UPLOAD_BYTES + 512 * 1024  # photo plus form fields
UNIT_ID = r"^[A-Z]-\d{1,3}(-\d{1,2})?$"
PHOTO_ID = re.compile(r"^[0-9a-f]{32}$")
DATE = r"^\d{4}-\d{2}-\d{2}$"
HHMM = r"^([01]\d|2[0-3]):[0-5]\d$"
MALAYSIA = timezone(timedelta(hours=8))
GATE_OPEN, GATE_CLOSE = "08:00", "18:00"  # contractor entry hours; Sundays closed
MAX_ACTIVE_PASSES = 3
HOUSE_RULES = [
    "Noisy work only within the hours in the renovation notice",
    "No work on Sundays and public holidays",
    "Debris goes into the booked skip, never the drains or open land",
    "Protect the lift and common areas before moving materials",
    "Workers must carry this pass and show it at the guardhouse",
]


def db_path() -> str:
    return os.environ.get("JIRAN_DB_PATH", str(DEFAULT_DB))


def data_dir(name: str) -> Path:
    d = Path(db_path()).parent / name
    d.mkdir(parents=True, exist_ok=True)
    return d


def demo_mode() -> bool:
    """Demo-only endpoints (reset, sample photos) are on for local runs and off when JIRAN_DEMO_MODE=0."""
    return os.environ.get("JIRAN_DEMO_MODE", "1") == "1"


@asynccontextmanager
async def lifespan(_: FastAPI):
    conn = db.connect(db_path())
    db.init_db(conn)
    _expire_voice(conn)
    conn.close()
    vision.warm_up()  # pay OpenCV's start-up cost now, not during the first demo comparison
    sweeper = asyncio.create_task(_voice_sweeper())
    yield
    sweeper.cancel()


def _sweep_once() -> int:
    conn = db.connect(db_path())
    try:
        return _expire_voice(conn)
    finally:
        conn.close()


async def _voice_sweeper() -> None:
    """Delete expired voice notes every hour while the server runs, not only at start-up or when a chat opens."""
    while True:
        await asyncio.sleep(VOICE_SWEEP_SECONDS)
        try:
            await asyncio.to_thread(_sweep_once)
        except Exception:  # never let a clean-up error stop the server
            log.exception("voice clean-up failed")


app = FastAPI(title="Jiran5 prototype API", version="0.2.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=os.environ.get("JIRAN_ALLOWED_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173").split(","),
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
)


@app.middleware("http")
async def guard(request: Request, call_next):
    length = request.headers.get("content-length")
    if length and length.isdigit() and int(length) > MAX_REQUEST_BYTES:
        return JSONResponse({"detail": "Request too large. Photos must be under 12 MB."}, status_code=413)
    response = await call_next(request)
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("X-Frame-Options", "DENY")
    response.headers.setdefault("Referrer-Policy", "no-referrer")
    return response


def get_conn() -> Iterator[sqlite3.Connection]:
    conn = db.connect(db_path())
    try:
        yield conn
    finally:
        conn.close()


# ---------- helpers ----------

def _unit_row(conn: sqlite3.Connection, unit_id: str) -> sqlite3.Row:
    row = conn.execute("SELECT * FROM units WHERE id = ?", (unit_id,)).fetchone()
    if row is None:
        raise HTTPException(404, f"unit {unit_id} not found")
    return row


def _to_unit(row: sqlite3.Row) -> Unit:
    return Unit(id=row["id"], kind=row["kind"], label=row["label"], row=row["terrace_row"],
                facing_row=row["facing_row"], block=row["block"], floor=row["floor"], pos=row["pos"])


def _unit_json(row: sqlite3.Row) -> dict[str, Any]:
    return {"id": row["id"], "phase_id": row["phase_id"], "kind": row["kind"], "label": row["label"],
            "resident_name": row["resident_name"], "row": row["terrace_row"], "facing_row": row["facing_row"],
            "block": row["block"], "floor": row["floor"], "pos": row["pos"], "lang": row["lang"],
            "handover_date": row["handover_date"]}


def _today() -> str:
    return datetime.now(MALAYSIA).strftime("%Y-%m-%d")


def _phase(conn: sqlite3.Connection, unit_id: str) -> tuple[sqlite3.Row, dict[str, sqlite3.Row], list[Unit]]:
    me = _unit_row(conn, unit_id)
    rows = {r["id"]: r for r in conn.execute("SELECT * FROM units WHERE phase_id = ?", (me["phase_id"],))}
    return me, rows, [_to_unit(r) for r in rows.values()]


def _circle(conn: sqlite3.Connection, unit_id: str) -> list[dict[str, Any]]:
    me, rows, phase_units = _phase(conn, unit_id)
    return [{**_unit_json(rows[n.unit_id]), "relation": n.relation} for n in neighbour_circle(_to_unit(me), phase_units)]


def _unit_public(row: sqlite3.Row) -> dict[str, Any]:
    """A home outside your circle: where it is, never who lives there."""
    return {k: v for k, v in _unit_json(row).items() if k not in ("resident_name", "lang", "handover_date")}


def _intro(conn: sqlite3.Connection, intro_id: int | None) -> dict[str, Any] | None:
    if intro_id is None:
        return None
    row = conn.execute(
        "SELECT i.*, u.label AS from_label, u.resident_name AS from_name FROM intros i"
        " JOIN units u ON u.id = i.from_unit_id WHERE i.id = ?",
        (intro_id,),
    ).fetchone()
    if row is None:
        return None
    return {"id": row["id"], "from_unit_id": row["from_unit_id"], "from_label": row["from_label"],
            "from_name": row["from_name"], "renovation": json.loads(row["renovation"]) if row["renovation"] else None}


def _photo_json(row: sqlite3.Row) -> dict[str, Any]:
    return {"id": row["id"], "unit_id": row["unit_id"], "kind": row["kind"], "subject": row["subject"],
            "renovation_intro_id": row["renovation_intro_id"], "sha256": row["sha256"], "width": row["width"],
            "height": row["height"], "quality": json.loads(row["quality"]), "created_at": row["created_at"],
            "url": f"/api/photos/{row['id']}", "thumb_url": f"/api/photos/{row['id']}?size=thumb"}


def _photo_row(conn: sqlite3.Connection, photo_id: str) -> sqlite3.Row:
    row = conn.execute("SELECT * FROM photos WHERE id = ?", (photo_id,)).fetchone() if PHOTO_ID.match(photo_id) else None
    if row is None:
        raise HTTPException(404, "photo not found")
    return row


PHOTO_ERRORS = {
    "too_large": (413, "Photo is larger than 12 MB."),
    "too_many_pixels": (413, "Photo resolution is too high."),
    "unsupported_format": (415, "Please use a JPEG, PNG or WebP photo."),
    "not_an_image": (400, "That file is not a readable photo."),
}


def _store_photo(conn: sqlite3.Connection, unit_id: str, raw: bytes, kind: str, subject: str,
                 renovation_intro_id: int | None) -> dict[str, Any]:
    _unit_row(conn, unit_id)
    if renovation_intro_id is not None and conn.execute(
        "SELECT 1 FROM intro_recipients WHERE intro_id = ? AND unit_id = ?", (renovation_intro_id, unit_id)
    ).fetchone() is None:
        raise HTTPException(403, "Only neighbours notified of this renovation can attach photos to it.")
    try:
        photo = vision.ingest(raw)
    except vision.PhotoError as exc:
        status, message = PHOTO_ERRORS.get(str(exc), (400, "That file is not a readable photo."))
        raise HTTPException(status, message) from exc

    photo_id = uuid.uuid4().hex
    folder = data_dir("photos")
    (folder / f"{photo_id}.jpg").write_bytes(photo.full_jpeg)
    (folder / f"{photo_id}_thumb.jpg").write_bytes(photo.thumb_jpeg)
    conn.execute(
        "INSERT INTO photos (id, unit_id, kind, subject, renovation_intro_id, sha256, width, height, quality, created_at)"
        " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (photo_id, unit_id, kind, subject, renovation_intro_id, photo.sha256, photo.width, photo.height,
         json.dumps(photo.quality), db.now()),
    )
    if kind == "baseline":
        intro = _intro(conn, renovation_intro_id)
        db.append_event(conn, unit_id, "photo_baseline", {
            "photo_id": photo_id, "sha256": photo.sha256, "subject": subject,
            "renovation_at": intro["from_label"] if intro else None,
        })
    conn.commit()
    return _photo_json(_photo_row(conn, photo_id))


def _incident_json(conn: sqlite3.Connection, row: sqlite3.Row) -> dict[str, Any]:
    comparison = json.loads(row["comparison"])
    images = None
    if comparison.get("aligned"):
        # The follow-up photo's unique id is part of the URL, so a cached image can never belong to another case
        # (case numbers restart after a demo reset).
        v = row["followup_photo_id"][:12]
        images = {k: f"/api/incidents/{row['id']}/image?kind={k}&v={v}" for k in ("before", "after", "overlay")}
    reporter = _unit_row(conn, row["reporter_unit_id"])
    return {
        "id": row["id"], "reporter_unit_id": row["reporter_unit_id"], "reporter_label": reporter["label"],
        "reporter_name": reporter["resident_name"], "renovation": _intro(conn, row["renovation_intro_id"]),
        "baseline": _photo_json(_photo_row(conn, row["baseline_photo_id"])),
        "followup": _photo_json(_photo_row(conn, row["followup_photo_id"])),
        "comparison": comparison, "hint": json.loads(row["hint"]), "images": images,
        "status": row["status"], "decision": row["decision"], "decision_note": row["decision_note"],
        "decided_at": row["decided_at"], "created_at": row["created_at"],
    }


SUBJECT_BY_RELATION = {
    "left": "Shared wall with {label}",
    "right": "Shared wall with {label}",
    "above": "Ceiling below {label}",
    "above-2": "Ceiling, two floors below {label}",
    "below": "Floor above {label}",
    "below-2": "Floor, two floors above {label}",
}


# ---------- schemas ----------

class Renovation(BaseModel):
    scope: str = Field(..., min_length=1, max_length=120, examples=["Extend kitchen (rear wall)"])
    start: str = Field(..., pattern=DATE, examples=["2026-10-15"])
    end: str = Field(..., pattern=DATE, examples=["2026-10-30"])
    noisy_hours: str = Field("weekdays 9am-5pm, no weekends", max_length=80)
    noisy_from: str = Field("09:00", pattern=HHMM)
    noisy_to: str = Field("17:00", pattern=HHMM)
    weekdays_only: bool = True
    contractor: str | None = Field(None, max_length=80)
    contractor_cidb_registered: bool | None = None
    # Decides who is notified: wet jobs reach two floors down, hacking two floors up and down.
    works_type: Literal["wet", "hacking", "structural", "light"] = "hacking"
    # Strata buildings: the JMB/MC approves renovations and holds the deposit.
    management_approval: Literal["approved", "pending"] | None = None
    # Local-authority (PBT) approval: extensions and structural work need one; re-tiling usually does not.
    council_permit: Literal["approved", "applied", "not_needed"] | None = None
    permit_ref: str | None = Field(None, max_length=40, pattern=r"^[A-Za-z0-9/ .-]*$")

    @model_validator(mode="after")
    def check_order(self) -> "Renovation":
        if self.end < self.start:
            raise ValueError("end date is before start date")
        if self.noisy_to <= self.noisy_from:
            raise ValueError("noisy hours end before they start")
        return self


class IntroIn(BaseModel):
    from_unit_id: str = Field(..., pattern=UNIT_ID)
    message: str = Field(..., min_length=1, max_length=1000)
    lang: Literal["en", "ms", "zh", "ta"] = "en"
    renovation: Renovation | None = None
    # A hello can go to part of the circle; a renovation notice always goes to the whole impact zone.
    to_unit_ids: list[str] | None = Field(None, max_length=8)
    delegate_id: int | None = None


class AckIn(BaseModel):
    unit_id: str = Field(..., pattern=UNIT_ID)


class EventIn(BaseModel):
    type: Literal["photo_baseline", "incident", "triage", "warranty_closed_by_owner", "note"]
    payload: dict[str, Any] = {}


class DemoPhotoIn(BaseModel):
    name: str = Field(..., pattern=r"^[a-z_]{1,40}$")
    kind: Literal["baseline", "followup"]
    subject: str = Field(..., min_length=1, max_length=120)
    renovation_intro_id: int | None = None


class IncidentIn(BaseModel):
    reporter_unit_id: str = Field(..., pattern=UNIT_ID)
    baseline_photo_id: str = Field(..., pattern=r"^[0-9a-f]{32}$")
    followup_photo_id: str = Field(..., pattern=r"^[0-9a-f]{32}$")


class DecisionIn(BaseModel):
    decision: Literal["renovation", "warranty", "inspect", "no_action"]
    decided_by: Literal["both_owners", "sdp_inspector"] = "both_owners"
    note: str = Field("", max_length=300)


class PassIn(BaseModel):
    unit_id: str = Field(..., pattern=UNIT_ID)
    contractor_name: str | None = Field(None, min_length=1, max_length=80)
    contractor_cidb: bool = False


class OwnerIn(BaseModel):
    unit_id: str = Field(..., pattern=UNIT_ID)


class ScanIn(BaseModel):
    token: str = Field(..., min_length=16, max_length=64, pattern=r"^[A-Za-z0-9_-]+$")
    at: str | None = Field(None, pattern=r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$", description="Simulated local time (demo only)")


class RepairDemoIn(BaseModel):
    name: str = Field(..., pattern=r"^[a-z_]{1,40}$")
    subcontractor: str = Field(..., min_length=1, max_length=80)


class OwnerResponseIn(BaseModel):
    unit_id: str = Field(..., pattern=UNIT_ID)
    decision: Literal["accept", "reject"]
    delegate_id: int | None = None
    note: str = Field("", max_length=300)


# ---------- layer 1: know ----------

@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/phases")
def phases(conn: sqlite3.Connection = Depends(get_conn)) -> list[dict[str, Any]]:
    return [dict(r) for r in conn.execute("SELECT * FROM phases")]


@app.get("/api/units")
def units(phase_id: str = "demo", conn: sqlite3.Connection = Depends(get_conn)) -> list[dict[str, Any]]:
    """The phase layout. Names are included only in demo mode (for the demo cast); a real deployment never
    exposes a resident directory. Who is renovating is not here either: see /directory."""
    rows = conn.execute("SELECT * FROM units WHERE phase_id = ? ORDER BY id", (phase_id,)).fetchall()
    return [_unit_json(r) if demo_mode() else _unit_public(r) for r in rows]


def _works_visible_to(conn: sqlite3.Connection, unit_id: str) -> set[str]:
    """Homes whose renovation this household may know about: its own, and those that notified it.
    The rest of the township cannot see who is renovating (an empty house is a burglary risk)."""
    today = _today()
    seen = set()
    for r in conn.execute(
        "SELECT i.from_unit_id, i.renovation FROM intros i LEFT JOIN intro_recipients r ON r.intro_id = i.id AND r.unit_id = ?"
        " WHERE i.renovation IS NOT NULL AND (i.from_unit_id = ? OR r.unit_id IS NOT NULL)",
        (unit_id, unit_id),
    ):
        if json.loads(r["renovation"])["end"] >= today:
            seen.add(r["from_unit_id"])
    return seen


def _request_between(conn: sqlite3.Connection, a: str, b: str) -> sqlite3.Row | None:
    return conn.execute(
        "SELECT * FROM contact_requests WHERE (from_unit_id = ? AND to_unit_id = ?) OR (from_unit_id = ? AND to_unit_id = ?)"
        " ORDER BY id DESC LIMIT 1", (a, b, b, a)).fetchone()


def _connected(conn: sqlite3.Connection, a: str, b: str) -> bool:
    r = _request_between(conn, a, b)
    return r is not None and r["status"] == "accepted"


@app.get("/api/units/{unit_id}/directory")
def directory(unit_id: str, conn: sqlite3.Connection = Depends(get_conn)) -> dict[str, Any]:
    """Everything one household may see about the homes around it, by ring."""
    me, rows, phase_units = _phase(conn, unit_id)
    card = neighbour_card(unit_id, conn)
    nearby = []
    for n in street_or_block(_to_unit(me), phase_units):
        row = rows[n.unit_id]
        req = _request_between(conn, unit_id, n.unit_id)
        if req is None:
            state = "none"
        elif req["status"] == "accepted":
            state = "connected"
        elif req["status"] == "pending":
            state = "requested" if req["from_unit_id"] == unit_id else "incoming"
        else:
            state = "declined"
        item = {**_unit_public(row), "hint": n.hint, "hint_key": n.key, "hint_n": n.n, "contact": state}
        if state == "connected":
            item["resident_name"] = row["resident_name"]
        nearby.append(item)
    return {"circle": card["neighbours"], "nearby": nearby, "works": sorted(_works_visible_to(conn, unit_id)),
            "ring2_label": "Jalan Demo 1" if me["kind"] == "terrace" else f"Block {me['block']}",
            "township_homes": len(rows)}


@app.get("/api/units/{unit_id}/impact")
def impact(unit_id: str, works_type: Literal["wet", "hacking", "structural", "light"] = "hacking",
           conn: sqlite3.Connection = Depends(get_conn)) -> list[dict[str, Any]]:
    """Who a renovation of this type would notify, and why. Homes outside the circle are shown by unit only."""
    me, rows, phase_units = _phase(conn, unit_id)
    circle = {n.unit_id for n in neighbour_circle(_to_unit(me), phase_units)}
    return [{**(_unit_json(rows[n.unit_id]) if n.unit_id in circle else _unit_public(rows[n.unit_id])),
             "relation": n.relation, "reason": impact_reason(n.relation, works_type),
             "reason_key": n.relation + ("_wet" if works_type == "wet" and n.relation.startswith("below") else "")}
            for n in impact_zone(_to_unit(me), phase_units, works_type)]


@app.get("/api/units/{unit_id}/neighbours")
def neighbours(unit_id: str, conn: sqlite3.Connection = Depends(get_conn)) -> list[dict[str, Any]]:
    return _circle(conn, unit_id)


@app.post("/api/intros", status_code=201)
def send_intro(body: IntroIn, conn: sqlite3.Connection = Depends(get_conn)) -> dict[str, Any]:
    me, _, phase_units = _phase(conn, body.from_unit_id)
    renovation = body.renovation.model_dump() if body.renovation else None
    if renovation:
        # The notice goes to everyone the work can affect; the sender cannot leave anyone out.
        circle = [{"id": n.unit_id, "relation": n.relation} for n in impact_zone(_to_unit(me), phase_units, renovation["works_type"])]
    else:
        circle = _circle(conn, body.from_unit_id)
        if body.to_unit_ids is not None:
            allowed = {n["id"] for n in circle}
            if not set(body.to_unit_ids) <= allowed:
                raise HTTPException(403, "An introduction can only go to the homes in your circle.")
            circle = [n for n in circle if n["id"] in body.to_unit_ids]
            if not circle:
                raise HTTPException(422, "Pick at least one neighbour.")
    sent_by = _delegate_name(conn, body.from_unit_id, body.delegate_id)
    cur = conn.execute(
        "INSERT INTO intros (from_unit_id, message, lang, renovation, sent_by, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        (body.from_unit_id, body.message, body.lang, json.dumps(renovation) if renovation else None, sent_by, db.now()),
    )
    intro_id = cur.lastrowid
    for n in circle:
        conn.execute("INSERT INTO intro_recipients (intro_id, unit_id, relation) VALUES (?, ?, ?)",
                     (intro_id, n["id"], n["relation"]))
    if renovation:
        db.append_event(conn, body.from_unit_id, "renovation_registered",
                        {**renovation, "neighbours_notified": [n["id"] for n in circle], **({"acted_by": sent_by} if sent_by else {})})
    conn.commit()
    return {"id": intro_id, "recipients": [n["id"] for n in circle]}


@app.get("/api/units/{unit_id}/inbox")
def inbox(unit_id: str, conn: sqlite3.Connection = Depends(get_conn)) -> list[dict[str, Any]]:
    _unit_row(conn, unit_id)
    rows = conn.execute(
        "SELECT i.*, r.relation, r.acked_at, u.label AS from_label, u.resident_name AS from_name"
        " FROM intro_recipients r JOIN intros i ON i.id = r.intro_id JOIN units u ON u.id = i.from_unit_id"
        " WHERE r.unit_id = ? ORDER BY i.id DESC",
        (unit_id,),
    ).fetchall()
    return [{**dict(r), "relation_to_me": inverse_relation(r["relation"]),
             "renovation": json.loads(r["renovation"]) if r["renovation"] else None} for r in rows]


@app.post("/api/intros/{intro_id}/ack")
def wave_back(intro_id: int, body: AckIn, conn: sqlite3.Connection = Depends(get_conn)) -> dict[str, Any]:
    cur = conn.execute(
        "UPDATE intro_recipients SET acked_at = COALESCE(acked_at, ?) WHERE intro_id = ? AND unit_id = ?",
        (db.now(), intro_id, body.unit_id),
    )
    if cur.rowcount == 0:
        raise HTTPException(404, "this unit did not receive that introduction")
    conn.commit()
    return {"intro_id": intro_id, "unit_id": body.unit_id, "acked": True}


@app.get("/api/units/{unit_id}/card")
def neighbour_card(unit_id: str, conn: sqlite3.Connection = Depends(get_conn)) -> dict[str, Any]:
    """The 5-household card: who in my circle I'm already 'known' with (either side waved back)."""
    circle = _circle(conn, unit_id)
    out = []
    for n in circle:
        they_replied = conn.execute(
            "SELECT 1 FROM intro_recipients r JOIN intros i ON i.id = r.intro_id"
            " WHERE i.from_unit_id = ? AND r.unit_id = ? AND r.acked_at IS NOT NULL",
            (unit_id, n["id"]),
        ).fetchone() is not None
        i_replied = conn.execute(
            "SELECT 1 FROM intro_recipients r JOIN intros i ON i.id = r.intro_id"
            " WHERE i.from_unit_id = ? AND r.unit_id = ? AND r.acked_at IS NOT NULL",
            (n["id"], unit_id),
        ).fetchone() is not None
        since = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat(timespec="seconds")
        waved = conn.execute("SELECT 1 FROM waves WHERE from_unit_id = ? AND to_unit_id = ? AND created_at > ?",
                             (unit_id, n["id"], since)).fetchone() is not None
        out.append({**n, "known": they_replied or i_replied or _mutual(conn, unit_id, n["id"]), "bio": _profile_row(conn, n["id"])["bio"],
                    "waved_today": waved, "allow_waves": bool(_profile_row(conn, n["id"])["allow_waves"])})
    return {"unit_id": unit_id, "neighbours": out, "known_count": sum(n["known"] for n in out)}


def _mutual(conn: sqlite3.Connection, a: str, b: str) -> bool:
    """Known once both sides have reached out: waves or messages in each direction."""
    def reached(x: str, y: str) -> bool:
        return conn.execute(
            "SELECT 1 FROM waves WHERE from_unit_id = ? AND to_unit_id = ? UNION ALL"
            " SELECT 1 FROM messages WHERE from_unit_id = ? AND to_unit_id = ? AND kind != 'system' LIMIT 1",
            (x, y, x, y)).fetchone() is not None
    return reached(a, b) and reached(b, a)


def _profile_row(conn: sqlite3.Connection, unit_id: str) -> sqlite3.Row:
    row = conn.execute("SELECT * FROM profiles WHERE unit_id = ?", (unit_id,)).fetchone()
    if row is None:
        conn.execute("INSERT OR IGNORE INTO profiles (unit_id) VALUES (?)", (unit_id,))
        row = conn.execute("SELECT * FROM profiles WHERE unit_id = ?", (unit_id,)).fetchone()
    return row


# ---------- layer 1b: talk (messages between neighbours, concerns, safety) ----------

MAX_MESSAGES_PER_DAY = 30
MAX_OPEN_CONCERNS = 5
ESCALATE_AFTER = timedelta(hours=24)
ESTATE = "SDP Estate Team"
PRIVATE_MESSAGE = ("Please don't put phone numbers, emails or links here. "
                   "Exchange numbers in a chat when you both agree.")
TONE_MESSAGE = ("This may come across as hostile. Try calmer words or a quick reply: messages stay on record "
                "and can be reported.")


class MessageIn(BaseModel):
    from_unit_id: str = Field(..., pattern=UNIT_ID)
    to_unit_id: str = Field(..., pattern=UNIT_ID)
    body: str | None = Field(None, max_length=500)
    quick_key: str | None = Field(None, pattern=r"^[a-z_]{1,30}$")
    delegate_id: int | None = None

    @model_validator(mode="after")
    def one_kind(self) -> "MessageIn":
        if bool(self.body and self.body.strip()) == bool(self.quick_key):
            raise ValueError("send either a message or a quick reply")
        return self


class ReportIn(BaseModel):
    unit_id: str = Field(..., pattern=UNIT_ID)
    reason: Literal["harassment", "threat", "spam", "privacy", "other"]


class BlockIn(BaseModel):
    other_unit_id: str = Field(..., pattern=UNIT_ID)
    blocked: bool


class ContactIn(BaseModel):
    other_unit_id: str = Field(..., pattern=UNIT_ID)


class ConcernIn(BaseModel):
    from_unit_id: str = Field(..., pattern=UNIT_ID)
    intro_id: int
    category: Literal["noise_hours", "debris", "access", "damage", "workers", "other"]
    note: str = Field("", max_length=300)
    delegate_id: int | None = None


class ConcernActionIn(BaseModel):
    unit_id: str = Field(..., pattern=UNIT_ID)
    note: str = Field("", max_length=300)


class EstateActionIn(BaseModel):
    action: Literal["remind", "resolve"]
    note: str = Field("", max_length=300)


class ReviewIn(BaseModel):
    outcome: Literal["warned", "dismissed"]


def _talk_partners(conn: sqlite3.Connection, unit_id: str) -> list[dict[str, Any]]:
    """Who this household may message: its circle, anyone a renovation notice connects it with, and
    accepted contact requests. Nobody else."""
    partners = {n["id"]: n for n in _circle(conn, unit_id)}
    for r in conn.execute(
        "SELECT i.from_unit_id, r.unit_id, r.relation FROM intro_recipients r JOIN intros i ON i.id = r.intro_id"
        " WHERE i.renovation IS NOT NULL AND (i.from_unit_id = ? OR r.unit_id = ?)", (unit_id, unit_id),
    ):
        other, rel = (r["unit_id"], r["relation"]) if r["from_unit_id"] == unit_id else (r["from_unit_id"], inverse_relation(r["relation"]))
        if other not in partners:
            partners[other] = {**_unit_json(_unit_row(conn, other)), "relation": rel}
    for r in conn.execute("SELECT * FROM contact_requests WHERE status = 'accepted' AND (from_unit_id = ? OR to_unit_id = ?)",
                          (unit_id, unit_id)):
        other = r["to_unit_id"] if r["from_unit_id"] == unit_id else r["from_unit_id"]
        if other not in partners:
            partners[other] = {**_unit_json(_unit_row(conn, other)), "relation": "contact"}
    return list(partners.values())


def _require_neighbours(conn: sqlite3.Connection, unit_id: str, other_id: str) -> dict[str, Any]:
    _unit_row(conn, unit_id)
    n = next((x for x in _talk_partners(conn, unit_id) if x["id"] == other_id), None)
    if n is None:
        raise HTTPException(403, "You can only talk with your circle, homes a renovation notice connects you with, "
                                 "or neighbours who accepted your contact request.")
    return n


def _blocked(conn: sqlite3.Connection, unit_id: str, other_id: str) -> bool:
    return conn.execute("SELECT 1 FROM blocks WHERE unit_id = ? AND blocked_unit_id = ?", (unit_id, other_id)).fetchone() is not None


def _contact_state(conn: sqlite3.Connection, me: str, other: str) -> str:
    q = "SELECT 1 FROM contact_consents WHERE unit_id = ? AND other_unit_id = ?"
    mine, theirs = conn.execute(q, (me, other)).fetchone(), conn.execute(q, (other, me)).fetchone()
    return "mutual" if mine and theirs else "requested_by_me" if mine else "requested_by_them" if theirs else "none"


def _system_message(conn: sqlite3.Connection, to_unit: str, thread_with: str, text: str, private: bool = False) -> None:
    conn.execute(
        "INSERT INTO messages (from_unit_id, to_unit_id, thread_with, kind, body, lang, author, private, created_at)"
        " VALUES (NULL, ?, ?, 'system', ?, 'en', ?, ?, ?)",
        (to_unit, thread_with, text, ESTATE, int(private), db.now()),
    )


def _message_json(row: sqlite3.Row, viewer_lang: str, reactions: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    out = {"type": "message", "id": row["id"], "kind": row["kind"], "from_unit_id": row["from_unit_id"],
           "to_unit_id": row["to_unit_id"], "author": row["author"], "text": row["body"], "lang": row["lang"],
           "translated": False, "original": None, "created_at": row["created_at"], "read_at": row["read_at"],
           "reactions": reactions or [], "duration": int(row["body"]) if row["kind"] == "voice" else None,
           "expired": row["kind"] == "voice" and not row["media_id"], "sent_by": row["sent_by"]}
    if row["kind"] == "voice":
        out["text"] = "Voice message"
    if row["kind"] == "quick" and row["quick_key"] in talk.QUICK_REPLIES:
        out["text"] = talk.quick_text(row["quick_key"], viewer_lang)
        out["translated"] = viewer_lang != row["lang"]
        out["original"] = row["body"] if out["translated"] else None
    return out


def _concern_row(conn: sqlite3.Connection, concern_id: int) -> sqlite3.Row:
    row = conn.execute("SELECT * FROM concerns WHERE id = ?", (concern_id,)).fetchone()
    if row is None:
        raise HTTPException(404, "concern not found")
    return row


def _concern_json(conn: sqlite3.Connection, row: sqlite3.Row) -> dict[str, Any]:
    raiser, owner = _unit_row(conn, row["from_unit_id"]), _unit_row(conn, row["to_unit_id"])
    reno = _intro(conn, row["intro_id"])["renovation"]
    return {"type": "concern", "id": row["id"], "intro_id": row["intro_id"], "scope": reno["scope"] if reno else None,
            "from_unit_id": row["from_unit_id"], "from_label": raiser["label"], "from_name": raiser["resident_name"],
            "to_unit_id": row["to_unit_id"], "to_label": owner["label"], "to_name": owner["resident_name"],
            "category": row["category"], "category_label": talk.CONCERN_CATEGORIES[row["category"]], "note": row["note"],
            "status": row["status"], "response_note": row["response_note"], "estate_note": row["estate_note"],
            "reminders": row["reminders"], "acted_by": row["acted_by"], "created_at": row["created_at"], "acknowledged_at": row["acknowledged_at"],
            "resolved_at": row["resolved_at"], "escalated_at": row["escalated_at"], "closed_at": row["closed_at"]}


def _thread_items(conn: sqlite3.Connection, me: str, other: str, viewer_lang: str) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    for r in conn.execute(
        "SELECT i.*, r.unit_id AS to_unit_id, r.acked_at FROM intros i JOIN intro_recipients r ON r.intro_id = i.id"
        " WHERE (i.from_unit_id = ? AND r.unit_id = ?) OR (i.from_unit_id = ? AND r.unit_id = ?)",
        (me, other, other, me),
    ):
        items.append({"type": "intro", "id": r["id"], "from_unit_id": r["from_unit_id"], "to_unit_id": r["to_unit_id"],
                      "text": r["message"], "lang": r["lang"], "acked_at": r["acked_at"], "created_at": r["created_at"], "sent_by": r["sent_by"],
                      "renovation": json.loads(r["renovation"]) if r["renovation"] else None})
    for r in conn.execute(
        "SELECT * FROM messages WHERE (from_unit_id = ? AND to_unit_id = ?) OR (from_unit_id = ? AND to_unit_id = ?)"
        " OR (kind = 'system' AND ((to_unit_id = ? AND thread_with = ?) OR (to_unit_id = ? AND thread_with = ?)))",
        (me, other, other, me, me, other, other, me),
    ):
        if r["to_unit_id"] == me and r["withheld"]:
            continue  # sent while I had them blocked
        if r["private"] and r["to_unit_id"] != me:
            continue
        items.append(_message_json(r, viewer_lang, _reactions(conn, r["id"])))
    for r in conn.execute("SELECT * FROM waves WHERE (from_unit_id = ? AND to_unit_id = ?) OR (from_unit_id = ? AND to_unit_id = ?)",
                          (me, other, other, me)):
        items.append({"type": "wave", "id": r["id"], "from_unit_id": r["from_unit_id"], "to_unit_id": r["to_unit_id"],
                      "created_at": r["created_at"], "seen_at": r["seen_at"]})
    for r in conn.execute(
        "SELECT * FROM concerns WHERE (from_unit_id = ? AND to_unit_id = ?) OR (from_unit_id = ? AND to_unit_id = ?)",
        (me, other, other, me),
    ):
        items.append(_concern_json(conn, r))
    items.sort(key=lambda x: (x["created_at"], x["type"] != "intro", x["id"]))
    return items


def _renovations_from(conn: sqlite3.Connection, owner: str, recipient: str) -> list[dict[str, Any]]:
    rows = conn.execute(
        "SELECT i.id, i.renovation FROM intros i JOIN intro_recipients r ON r.intro_id = i.id"
        " WHERE i.from_unit_id = ? AND r.unit_id = ? AND i.renovation IS NOT NULL ORDER BY i.id DESC",
        (owner, recipient),
    ).fetchall()
    return [{"intro_id": r["id"], **{k: json.loads(r["renovation"])[k] for k in ("scope", "start", "end")}} for r in rows]


def _preview(item: dict[str, Any] | None) -> str | None:
    if item is None:
        return None
    if item["type"] == "concern":
        return f"Concern: {item['category_label']}"
    if item["type"] == "intro":
        return "Renovation notice" if item["renovation"] else item["text"]
    if item["type"] == "wave":
        return "👋 Wave"
    if item.get("kind") == "voice":
        return f"🎤 Voice message ({item['duration']}s)"
    return item["text"]


@app.get("/api/units/{unit_id}/conversations")
def conversations(unit_id: str, conn: sqlite3.Connection = Depends(get_conn)) -> list[dict[str, Any]]:
    me = _unit_row(conn, unit_id)
    _expire_voice(conn)
    today = _today()
    out = []
    for n in _talk_partners(conn, unit_id):
        items = _thread_items(conn, unit_id, n["id"], me["lang"])
        last = items[-1] if items else None
        unread = conn.execute(
            "SELECT COUNT(*) FROM messages WHERE to_unit_id = ? AND read_at IS NULL AND withheld = 0"
            " AND (from_unit_id = ? OR (kind = 'system' AND thread_with = ?))",
            (unit_id, n["id"], n["id"]),
        ).fetchone()[0] + conn.execute(
            "SELECT COUNT(*) FROM waves WHERE to_unit_id = ? AND from_unit_id = ? AND seen_at IS NULL", (unit_id, n["id"])).fetchone()[0]
        out.append({**n, "last": _preview(last), "last_at": last["created_at"] if last else None, "unread": unread,
                    "blocked": _blocked(conn, unit_id, n["id"]), "contact": _contact_state(conn, unit_id, n["id"]),
                    "open_concerns": sum(1 for i in items if i["type"] == "concern" and i["status"] in ("open", "acknowledged", "escalated")),
                    "renovating": any(r["end"] >= today for r in _renovations_from(conn, n["id"], unit_id))})
    out.sort(key=lambda c: c["last_at"] or "", reverse=True)
    return out


@app.get("/api/units/{unit_id}/conversations/{other_id}")
def thread(unit_id: str, other_id: str, conn: sqlite3.Connection = Depends(get_conn)) -> dict[str, Any]:
    n = _require_neighbours(conn, unit_id, other_id)
    me = _unit_row(conn, unit_id)
    return {"neighbour": n, "my_lang": me["lang"], "items": _thread_items(conn, unit_id, other_id, me["lang"]),
            "contact": _contact_state(conn, unit_id, other_id), "blocked": _blocked(conn, unit_id, other_id),
            "their_renovations": _renovations_from(conn, other_id, unit_id),
            "quick_replies": [{"key": k, "text": talk.quick_text(k, me["lang"]), "arrives": talk.quick_text(k, n["lang"])}
                              for k in talk.QUICK_REPLIES],
            "concern_categories": talk.CONCERN_CATEGORIES}


@app.post("/api/units/{unit_id}/conversations/{other_id}/read")
def mark_read(unit_id: str, other_id: str, conn: sqlite3.Connection = Depends(get_conn)) -> dict[str, bool]:
    _require_neighbours(conn, unit_id, other_id)
    conn.execute(
        "UPDATE messages SET read_at = ? WHERE to_unit_id = ? AND read_at IS NULL"
        " AND (from_unit_id = ? OR (kind = 'system' AND thread_with = ?))",
        (db.now(), unit_id, other_id, other_id),
    )
    conn.execute("UPDATE waves SET seen_at = ? WHERE to_unit_id = ? AND from_unit_id = ? AND seen_at IS NULL",
                 (db.now(), unit_id, other_id))
    conn.commit()
    return {"ok": True}


@app.post("/api/messages", status_code=201)
def send_message(body: MessageIn, conn: sqlite3.Connection = Depends(get_conn)) -> dict[str, Any]:
    sender = _unit_row(conn, body.from_unit_id)
    _require_neighbours(conn, body.from_unit_id, body.to_unit_id)
    _check_can_reach(conn, body.from_unit_id, body.to_unit_id)
    since = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat(timespec="seconds")
    sent = conn.execute("SELECT COUNT(*) FROM messages WHERE from_unit_id = ? AND to_unit_id = ? AND created_at > ?",
                        (body.from_unit_id, body.to_unit_id, since)).fetchone()[0]
    if sent >= MAX_MESSAGES_PER_DAY:
        raise HTTPException(429, "Daily message limit for this neighbour reached. Try again tomorrow.")
    if body.quick_key:
        if body.quick_key not in talk.QUICK_REPLIES:
            raise HTTPException(404, "unknown quick reply")
        kind, text = "quick", talk.quick_text(body.quick_key, sender["lang"])
    else:
        kind, text = "text", (body.body or "").strip()
        if talk.tone_problem(text):
            raise HTTPException(422, {"code": "tone", "message": TONE_MESSAGE})
    # If the recipient has blocked the sender, the message is kept (for the record) but never shown to them.
    withheld = int(_blocked(conn, body.to_unit_id, body.from_unit_id))
    sent_by = _delegate_name(conn, body.from_unit_id, body.delegate_id)
    cur = conn.execute(
        "INSERT INTO messages (from_unit_id, to_unit_id, kind, body, quick_key, lang, withheld, sent_by, created_at)"
        " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (body.from_unit_id, body.to_unit_id, kind, text, body.quick_key, sender["lang"], withheld, sent_by, db.now()),
    )
    conn.commit()
    return _message_json(conn.execute("SELECT * FROM messages WHERE id = ?", (cur.lastrowid,)).fetchone(), sender["lang"])


@app.post("/api/messages/{message_id}/report", status_code=201)
def report_message(message_id: int, body: ReportIn, conn: sqlite3.Connection = Depends(get_conn)) -> dict[str, Any]:
    row = conn.execute("SELECT * FROM messages WHERE id = ?", (message_id,)).fetchone()
    if row is None:
        raise HTTPException(404, "message not found")
    if row["kind"] == "system" or row["to_unit_id"] != body.unit_id:
        raise HTTPException(403, "You can only report messages sent to you.")
    existing = conn.execute("SELECT id, status FROM reports WHERE message_id = ? AND reporter_unit_id = ?",
                            (message_id, body.unit_id)).fetchone()
    if existing:
        return {"id": existing["id"], "status": existing["status"]}
    cur = conn.execute("INSERT INTO reports (message_id, reporter_unit_id, reason, created_at) VALUES (?, ?, ?, ?)",
                       (message_id, body.unit_id, body.reason, db.now()))
    conn.commit()
    return {"id": cur.lastrowid, "status": "open"}


@app.post("/api/units/{unit_id}/blocks")
def set_block(unit_id: str, body: BlockIn, conn: sqlite3.Connection = Depends(get_conn)) -> dict[str, bool]:
    _require_neighbours(conn, unit_id, body.other_unit_id)
    if body.blocked:
        conn.execute("INSERT OR IGNORE INTO blocks (unit_id, blocked_unit_id, created_at) VALUES (?, ?, ?)",
                     (unit_id, body.other_unit_id, db.now()))
    else:
        conn.execute("DELETE FROM blocks WHERE unit_id = ? AND blocked_unit_id = ?", (unit_id, body.other_unit_id))
    conn.commit()
    return {"blocked": body.blocked}


@app.post("/api/units/{unit_id}/contact")
def share_contact(unit_id: str, body: ContactIn, conn: sqlite3.Connection = Depends(get_conn)) -> dict[str, str]:
    """Phone numbers are exchanged only when both households have agreed."""
    _require_neighbours(conn, unit_id, body.other_unit_id)
    if _blocked(conn, unit_id, body.other_unit_id) or _blocked(conn, body.other_unit_id, unit_id):
        raise HTTPException(409, "Contact sharing isn't available with this neighbour.")
    before = _contact_state(conn, unit_id, body.other_unit_id)
    conn.execute("INSERT OR IGNORE INTO contact_consents (unit_id, other_unit_id, created_at) VALUES (?, ?, ?)",
                 (unit_id, body.other_unit_id, db.now()))
    state = _contact_state(conn, unit_id, body.other_unit_id)
    if state == "mutual" and before != "mutual":
        _system_message(conn, unit_id, body.other_unit_id, "Both of you agreed: phone numbers are now shared.")
    conn.commit()
    return {"contact": state}


@app.post("/api/concerns", status_code=201)
def raise_concern(body: ConcernIn, conn: sqlite3.Connection = Depends(get_conn)) -> dict[str, Any]:
    """Step 1 of the ladder: tell the renovating neighbour first, privately and on record."""
    intro = conn.execute("SELECT * FROM intros WHERE id = ?", (body.intro_id,)).fetchone()
    if intro is None or intro["renovation"] is None:
        raise HTTPException(404, "renovation not found")
    if conn.execute("SELECT 1 FROM intro_recipients WHERE intro_id = ? AND unit_id = ?",
                    (body.intro_id, body.from_unit_id)).fetchone() is None:
        raise HTTPException(403, "Only neighbours notified of this renovation can raise a concern about it.")
    open_count = conn.execute(
        "SELECT COUNT(*) FROM concerns WHERE intro_id = ? AND from_unit_id = ? AND status IN ('open', 'acknowledged', 'escalated')",
        (body.intro_id, body.from_unit_id),
    ).fetchone()[0]
    if open_count >= MAX_OPEN_CONCERNS:
        raise HTTPException(429, f"You already have {MAX_OPEN_CONCERNS} open concerns about this renovation.")
    if talk.tone_problem(body.note):
        raise HTTPException(422, {"code": "tone", "message": TONE_MESSAGE})
    acted_by = _delegate_name(conn, body.from_unit_id, body.delegate_id)
    cur = conn.execute(
        "INSERT INTO concerns (intro_id, from_unit_id, to_unit_id, category, note, acted_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        (body.intro_id, body.from_unit_id, intro["from_unit_id"], body.category, body.note, acted_by, db.now()),
    )
    payload = {"concern_id": cur.lastrowid, "category": body.category, "raised_by": body.from_unit_id, "about": intro["from_unit_id"],
               **({"acted_by": acted_by} if acted_by else {})}
    db.append_event(conn, body.from_unit_id, "concern_raised", payload)
    db.append_event(conn, intro["from_unit_id"], "concern_raised", payload)
    conn.commit()
    return _concern_json(conn, _concern_row(conn, cur.lastrowid))


def _concern_step(conn: sqlite3.Connection, row: sqlite3.Row, status: str, stamp: str, event: str,
                  note_field: str | None, note: str) -> dict[str, Any]:
    sets = f"status = ?, {stamp} = ?" + (f", {note_field} = ?" if note_field else "")
    args = [status, db.now()] + ([note] if note_field else [])
    conn.execute(f"UPDATE concerns SET {sets} WHERE id = ?", (*args, row["id"]))
    payload = {"concern_id": row["id"], "category": row["category"], "note": note}
    db.append_event(conn, row["from_unit_id"], event, payload)
    db.append_event(conn, row["to_unit_id"], event, payload)
    conn.commit()
    return _concern_json(conn, _concern_row(conn, row["id"]))


@app.post("/api/concerns/{concern_id}/acknowledge")
def acknowledge_concern(concern_id: int, body: ConcernActionIn, conn: sqlite3.Connection = Depends(get_conn)) -> dict[str, Any]:
    row = _concern_row(conn, concern_id)
    if body.unit_id != row["to_unit_id"]:
        raise HTTPException(403, "Only the renovating household can respond to this concern.")
    if row["status"] != "open":
        raise HTTPException(409, "This concern has already been answered.")
    return _concern_step(conn, row, "acknowledged", "acknowledged_at", "concern_acknowledged", "response_note", body.note)


@app.post("/api/concerns/{concern_id}/resolve")
def resolve_concern(concern_id: int, body: ConcernActionIn, conn: sqlite3.Connection = Depends(get_conn)) -> dict[str, Any]:
    row = _concern_row(conn, concern_id)
    if body.unit_id != row["to_unit_id"]:
        raise HTTPException(403, "Only the renovating household can mark this concern as sorted.")
    if row["status"] not in ("open", "acknowledged"):
        raise HTTPException(409, "This concern can't be marked as sorted now.")
    return _concern_step(conn, row, "resolved", "resolved_at", "concern_resolved", "response_note", body.note or row["response_note"] or "")


@app.post("/api/concerns/{concern_id}/escalate")
def escalate_concern(concern_id: int, body: ConcernActionIn, conn: sqlite3.Connection = Depends(get_conn)) -> dict[str, Any]:
    """Step 3: the neighbour who raised it can hand it to SDP's estate team."""
    row = _concern_row(conn, concern_id)
    if body.unit_id != row["from_unit_id"]:
        raise HTTPException(403, "Only the household that raised the concern can escalate it.")
    if row["status"] not in ("open", "acknowledged", "resolved"):
        raise HTTPException(409, "This concern is already with the estate team or closed.")
    waited = datetime.now(timezone.utc) - datetime.fromisoformat(row["created_at"])
    if row["status"] == "open" and waited < ESCALATE_AFTER and not demo_mode():
        raise HTTPException(409, "Give your neighbour 24 hours to respond before escalating.")
    return _concern_step(conn, row, "escalated", "escalated_at", "concern_escalated", "estate_note", body.note)


@app.get("/api/estate/concerns")
def estate_concerns(phase_id: str = "demo", conn: sqlite3.Connection = Depends(get_conn)) -> list[dict[str, Any]]:
    """SDP estate team's view: escalated first, then everything still open between neighbours."""
    rows = conn.execute(
        "SELECT c.* FROM concerns c JOIN units u ON u.id = c.from_unit_id WHERE u.phase_id = ?"
        " ORDER BY CASE c.status WHEN 'escalated' THEN 0 WHEN 'open' THEN 1 WHEN 'acknowledged' THEN 2 ELSE 3 END, c.id DESC",
        (phase_id,),
    ).fetchall()
    per_reno: dict[int, int] = {}
    for r in rows:
        per_reno[r["intro_id"]] = per_reno.get(r["intro_id"], 0) + 1
    return [{**_concern_json(conn, r), "concerns_on_renovation": per_reno[r["intro_id"]]} for r in rows]


@app.post("/api/concerns/{concern_id}/estate")
def estate_action(concern_id: int, body: EstateActionIn, conn: sqlite3.Connection = Depends(get_conn)) -> dict[str, Any]:
    row = _concern_row(conn, concern_id)
    if row["status"] != "escalated":
        raise HTTPException(409, "Only escalated concerns are handled by the estate team.")
    label = talk.CONCERN_CATEGORIES[row["category"]].lower()
    if body.action == "remind":
        conn.execute("UPDATE concerns SET reminders = reminders + 1, estate_note = ? WHERE id = ?", (body.note, concern_id))
        _system_message(conn, row["to_unit_id"], row["from_unit_id"],
                        f"Reminder from the estate team about {label}: please keep to the house rules and the hours in your "
                        f"renovation notice, and reply here once it's sorted." + (f" Note: {body.note}" if body.note else ""))
        payload = {"concern_id": concern_id, "action": "reminder", "note": body.note}
        db.append_event(conn, row["from_unit_id"], "estate_reminder", payload)
        db.append_event(conn, row["to_unit_id"], "estate_reminder", payload)
        conn.commit()
        return _concern_json(conn, _concern_row(conn, concern_id))
    _system_message(conn, row["to_unit_id"], row["from_unit_id"],
                    f"The estate team closed the concern about {label}." + (f" {body.note}" if body.note else ""))
    return _concern_step(conn, row, "closed_by_estate", "closed_at", "concern_closed_by_estate", "estate_note", body.note)


@app.get("/api/moderation/reports")
def moderation_reports(conn: sqlite3.Connection = Depends(get_conn)) -> list[dict[str, Any]]:
    rows = conn.execute(
        "SELECT r.*, m.body, m.kind, m.media_id, m.from_unit_id, m.to_unit_id, m.created_at AS sent_at FROM reports r"
        " JOIN messages m ON m.id = r.message_id ORDER BY CASE r.status WHEN 'open' THEN 0 ELSE 1 END, r.id DESC"
    ).fetchall()
    out = []
    for r in rows:
        sender, reporter = _unit_row(conn, r["from_unit_id"]), _unit_row(conn, r["reporter_unit_id"])
        voice = r["kind"] == "voice"
        out.append({"id": r["id"], "reason": r["reason"], "status": r["status"], "created_at": r["created_at"],
                    "message": {"id": r["message_id"], "kind": r["kind"], "text": "Voice message" if voice else r["body"],
                                "duration": int(r["body"]) if voice else None, "sent_at": r["sent_at"],
                                "voice_url": f"/api/moderation/reports/{r['id']}/voice" if voice and r["media_id"] else None,
                                "from_label": sender["label"], "from_name": sender["resident_name"]},
                    "reporter_label": reporter["label"]})
    return out


@app.get("/api/moderation/reports/{report_id}/voice")
def reported_voice(report_id: int, conn: sqlite3.Connection = Depends(get_conn)) -> FileResponse:
    """The estate team can play a reported voice note. Off outside demo mode until moderators sign in."""
    _require_sign_in_or_demo()
    row = conn.execute("SELECT m.media_id FROM reports r JOIN messages m ON m.id = r.message_id WHERE r.id = ? AND m.kind = 'voice'",
                       (report_id,)).fetchone()
    if row is None or not row["media_id"]:
        raise HTTPException(404, "voice message not found")
    ext = row["media_id"].rsplit(".", 1)[-1]
    media = next((k for k, v in VOICE_TYPES.items() if v == ext), "application/octet-stream")
    return FileResponse(data_dir("voice") / row["media_id"], media_type=media, headers={"Cache-Control": "no-store"})


@app.post("/api/reports/{report_id}/review")
def review_report(report_id: int, body: ReviewIn, conn: sqlite3.Connection = Depends(get_conn)) -> dict[str, str]:
    row = conn.execute("SELECT r.*, m.from_unit_id, m.to_unit_id FROM reports r JOIN messages m ON m.id = r.message_id"
                       " WHERE r.id = ?", (report_id,)).fetchone()
    if row is None:
        raise HTTPException(404, "report not found")
    if row["status"] != "open":
        raise HTTPException(409, "This report has already been reviewed.")
    conn.execute("UPDATE reports SET status = ?, reviewed_at = ? WHERE id = ?", (body.outcome, db.now(), report_id))
    if body.outcome == "warned":
        # Only the sender sees the warning; the reporter's identity is never revealed.
        _system_message(conn, row["from_unit_id"], row["to_unit_id"],
                        "A message you sent was reviewed by the estate team. Please keep conversations respectful; "
                        "repeated reports can pause your messaging.", private=True)
    conn.commit()
    return {"status": body.outcome}



# ---------- ring 2: contact requests; ring 3: community notices ----------

MAX_REQUESTS_PER_DAY = 3
REQUEST_REASONS = {
    "parking": "Parking or access", "noise": "Noise", "leak": "Water leak or seepage",
    "delivery": "Parcel or delivery", "safety": "Safety concern", "other": "Something else",
}


class ContactRequestIn(BaseModel):
    from_unit_id: str = Field(..., pattern=UNIT_ID)
    to_unit_id: str = Field(..., pattern=UNIT_ID)
    reason: Literal["parking", "noise", "leak", "delivery", "safety", "other"]
    note: str = Field("", max_length=200)


class RespondIn(BaseModel):
    unit_id: str = Field(..., pattern=UNIT_ID)
    accept: bool


class NoticeIn(BaseModel):
    audience: Literal["phase", "terrace", "block:A"]
    title: str = Field(..., min_length=3, max_length=80)
    body: str = Field(..., min_length=3, max_length=400)


def _request_json(conn: sqlite3.Connection, row: sqlite3.Row, viewer: str) -> dict[str, Any]:
    sender, recipient = _unit_row(conn, row["from_unit_id"]), _unit_row(conn, row["to_unit_id"])
    accepted = row["status"] == "accepted"
    # Until accepted, each side sees the other only as a unit, never a name.
    def side(r: sqlite3.Row) -> dict[str, Any]:
        return _unit_json(r) if accepted else _unit_public(r)
    return {"id": row["id"], "from": side(sender), "to": side(recipient), "reason": row["reason"],
            "reason_label": REQUEST_REASONS[row["reason"]], "note": row["note"], "status": row["status"],
            "created_at": row["created_at"], "responded_at": row["responded_at"], "mine": row["from_unit_id"] == viewer}


@app.post("/api/contact-requests", status_code=201)
def request_contact(body: ContactRequestIn, conn: sqlite3.Connection = Depends(get_conn)) -> dict[str, Any]:
    me, rows, phase_units = _phase(conn, body.from_unit_id)
    ring2 = {n.unit_id for n in street_or_block(_to_unit(me), phase_units)}
    if body.to_unit_id in {n["id"] for n in _circle(conn, body.from_unit_id)}:
        raise HTTPException(409, "This home is already in your circle: message them directly.")
    if body.to_unit_id not in ring2:
        raise HTTPException(403, "Contact requests only reach your own lorong or block. For anything else, ask the estate office.")
    target = _profile_row(conn, body.to_unit_id)
    if _blocked(conn, body.to_unit_id, body.from_unit_id) or not target["accept_requests"] or target["quiet_mode"]:
        raise HTTPException(409, "This household isn't accepting requests.")
    last = _request_between(conn, body.from_unit_id, body.to_unit_id)
    if last is not None and last["status"] in ("pending", "accepted"):
        raise HTTPException(409, "There is already a request between you.")
    if last is not None and last["status"] == "declined" and last["from_unit_id"] == body.from_unit_id:
        raise HTTPException(409, "This household declined your earlier request.")
    since = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat(timespec="seconds")
    sent = conn.execute("SELECT COUNT(*) FROM contact_requests WHERE from_unit_id = ? AND created_at > ?",
                        (body.from_unit_id, since)).fetchone()[0]
    if sent >= MAX_REQUESTS_PER_DAY:
        raise HTTPException(429, f"At most {MAX_REQUESTS_PER_DAY} contact requests a day.")
    if talk.tone_problem(body.note):
        raise HTTPException(422, {"code": "tone", "message": TONE_MESSAGE})
    cur = conn.execute("INSERT INTO contact_requests (from_unit_id, to_unit_id, reason, note, created_at) VALUES (?, ?, ?, ?, ?)",
                       (body.from_unit_id, body.to_unit_id, body.reason, body.note.strip(), db.now()))
    conn.commit()
    return _request_json(conn, conn.execute("SELECT * FROM contact_requests WHERE id = ?", (cur.lastrowid,)).fetchone(), body.from_unit_id)


@app.get("/api/units/{unit_id}/contact-requests")
def contact_requests(unit_id: str, conn: sqlite3.Connection = Depends(get_conn)) -> dict[str, list[dict[str, Any]]]:
    _unit_row(conn, unit_id)
    rows = conn.execute("SELECT * FROM contact_requests WHERE from_unit_id = ? OR to_unit_id = ? ORDER BY id DESC",
                        (unit_id, unit_id)).fetchall()
    return {"incoming": [_request_json(conn, r, unit_id) for r in rows if r["to_unit_id"] == unit_id],
            "outgoing": [_request_json(conn, r, unit_id) for r in rows if r["from_unit_id"] == unit_id]}


@app.post("/api/contact-requests/{request_id}/respond")
def respond_contact(request_id: int, body: RespondIn, conn: sqlite3.Connection = Depends(get_conn)) -> dict[str, Any]:
    row = conn.execute("SELECT * FROM contact_requests WHERE id = ?", (request_id,)).fetchone()
    if row is None:
        raise HTTPException(404, "request not found")
    if row["to_unit_id"] != body.unit_id:
        raise HTTPException(403, "Only the household that received the request can answer it.")
    if row["status"] != "pending":
        raise HTTPException(409, "This request has already been answered.")
    conn.execute("UPDATE contact_requests SET status = ?, responded_at = ? WHERE id = ?",
                 ("accepted" if body.accept else "declined", db.now(), request_id))
    conn.commit()
    return _request_json(conn, conn.execute("SELECT * FROM contact_requests WHERE id = ?", (request_id,)).fetchone(), body.unit_id)


def _audiences(unit: sqlite3.Row) -> tuple[str, ...]:
    return ("phase", "terrace") if unit["kind"] == "terrace" else ("phase", f"block:{unit['block']}")


@app.get("/api/units/{unit_id}/notices")
def notices_for(unit_id: str, conn: sqlite3.Connection = Depends(get_conn)) -> list[dict[str, Any]]:
    me = _unit_row(conn, unit_id)
    a = _audiences(me)
    rows = conn.execute(f"SELECT * FROM notices WHERE phase_id = ? AND audience IN ({','.join('?' * len(a))}) ORDER BY id DESC",
                        (me["phase_id"], *a)).fetchall()
    return [dict(r) for r in rows]


@app.get("/api/notices")
def all_notices(phase_id: str = "demo", conn: sqlite3.Connection = Depends(get_conn)) -> list[dict[str, Any]]:
    return [dict(r) for r in conn.execute("SELECT * FROM notices WHERE phase_id = ? ORDER BY id DESC", (phase_id,))]


@app.post("/api/notices", status_code=201)
def post_notice(body: NoticeIn, phase_id: str = "demo", conn: sqlite3.Connection = Depends(get_conn)) -> dict[str, Any]:
    """Estate team only (no sign-in in the prototype). One-way: residents cannot reply to the whole township."""
    cur = conn.execute("INSERT INTO notices (phase_id, audience, title, body, author, created_at) VALUES (?, ?, ?, ?, ?, ?)",
                       (phase_id, body.audience, body.title.strip(), body.body.strip(), ESTATE, db.now()))
    conn.commit()
    return dict(conn.execute("SELECT * FROM notices WHERE id = ?", (cur.lastrowid,)).fetchone())



# ---------- social: waves, reactions, voice notes, profile & privacy, the estate office account ----------

MAX_WAVES_PER_DAY = 10
REACTIONS = ("👍", "❤️", "🙏", "😂", "😮")
VOICE_TYPES = {"audio/webm": "webm", "audio/ogg": "ogg", "audio/mp4": "m4a", "audio/mpeg": "mp3", "audio/wav": "wav", "audio/x-wav": "wav"}
MAX_VOICE_BYTES = 1_500_000
MAX_VOICE_SECONDS = 60


class WaveIn(BaseModel):
    from_unit_id: str = Field(..., pattern=UNIT_ID)
    to_unit_id: str = Field(..., pattern=UNIT_ID)


class ReactIn(BaseModel):
    unit_id: str = Field(..., pattern=UNIT_ID)
    emoji: str = Field(..., max_length=4)


class ProfileIn(BaseModel):
    bio: str | None = Field(None, max_length=80)
    accept_requests: bool | None = None
    allow_waves: bool | None = None
    quiet_mode: bool | None = None
    lang: Literal["en", "ms", "zh"] | None = None


def _check_can_reach(conn: sqlite3.Connection, sender: str, recipient: str) -> None:
    """Shared gate for messages, voice notes and waves."""
    if _blocked(conn, sender, recipient):
        raise HTTPException(409, "You blocked this neighbour. Unblock them to send a message.")
    if _profile_row(conn, recipient)["quiet_mode"]:
        raise HTTPException(409, "This neighbour has quiet mode on. Renovation notices and concerns still reach them.")


def _reactions(conn: sqlite3.Connection, message_id: int) -> list[dict[str, Any]]:
    return [{"emoji": r["emoji"], "unit_id": r["unit_id"]} for r in conn.execute(
        "SELECT emoji, unit_id FROM reactions WHERE message_id = ? ORDER BY created_at", (message_id,))]


@app.post("/api/waves", status_code=201)
def wave(body: WaveIn, conn: sqlite3.Connection = Depends(get_conn)) -> dict[str, Any]:
    """A one-tap hello. One per neighbour per day, so it can't become a nuisance."""
    _require_neighbours(conn, body.from_unit_id, body.to_unit_id)
    _check_can_reach(conn, body.from_unit_id, body.to_unit_id)
    if not _profile_row(conn, body.to_unit_id)["allow_waves"]:
        raise HTTPException(409, "This neighbour has turned waves off. You can still send a message.")
    since = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat(timespec="seconds")
    if conn.execute("SELECT 1 FROM waves WHERE from_unit_id = ? AND to_unit_id = ? AND created_at > ?",
                    (body.from_unit_id, body.to_unit_id, since)).fetchone():
        raise HTTPException(409, "You already waved today.")
    if conn.execute("SELECT COUNT(*) FROM waves WHERE from_unit_id = ? AND created_at > ?",
                    (body.from_unit_id, since)).fetchone()[0] >= MAX_WAVES_PER_DAY:
        raise HTTPException(429, f"At most {MAX_WAVES_PER_DAY} waves a day.")
    cur = conn.execute("INSERT INTO waves (from_unit_id, to_unit_id, created_at) VALUES (?, ?, ?)",
                       (body.from_unit_id, body.to_unit_id, db.now()))
    conn.commit()
    return {"type": "wave", "id": cur.lastrowid, "from_unit_id": body.from_unit_id, "to_unit_id": body.to_unit_id}


@app.post("/api/messages/{message_id}/react")
def react(message_id: int, body: ReactIn, conn: sqlite3.Connection = Depends(get_conn)) -> list[dict[str, Any]]:
    row = conn.execute("SELECT * FROM messages WHERE id = ?", (message_id,)).fetchone()
    if row is None:
        raise HTTPException(404, "message not found")
    if body.unit_id not in (row["from_unit_id"], row["to_unit_id"]) or row["kind"] == "system":
        raise HTTPException(403, "You can only react to messages in your own chats.")
    if body.emoji not in REACTIONS:
        raise HTTPException(422, "Unsupported reaction.")
    current = conn.execute("SELECT emoji FROM reactions WHERE message_id = ? AND unit_id = ?", (message_id, body.unit_id)).fetchone()
    conn.execute("DELETE FROM reactions WHERE message_id = ? AND unit_id = ?", (message_id, body.unit_id))
    if current is None or current["emoji"] != body.emoji:  # same emoji again removes it
        conn.execute("INSERT INTO reactions (message_id, unit_id, emoji, created_at) VALUES (?, ?, ?, ?)",
                     (message_id, body.unit_id, body.emoji, db.now()))
    conn.commit()
    return _reactions(conn, message_id)


@app.post("/api/messages/voice", status_code=201)
def send_voice(from_unit_id: str = Form(..., pattern=UNIT_ID), to_unit_id: str = Form(..., pattern=UNIT_ID),
               duration: int = Form(..., ge=1, le=MAX_VOICE_SECONDS), file: UploadFile = File(...),
               delegate_id: int | None = Form(None), conn: sqlite3.Connection = Depends(get_conn)) -> dict[str, Any]:
    """Voice notes: how many residents, older ones especially, already use WhatsApp."""
    sender = _unit_row(conn, from_unit_id)
    _require_neighbours(conn, from_unit_id, to_unit_id)
    _check_can_reach(conn, from_unit_id, to_unit_id)
    ext = VOICE_TYPES.get((file.content_type or "").split(";")[0].strip())
    if ext is None:
        raise HTTPException(415, "Please send an audio recording.")
    raw = file.file.read(MAX_VOICE_BYTES + 1)
    if len(raw) > MAX_VOICE_BYTES:
        raise HTTPException(413, "Voice messages can be up to one minute.")
    if len(raw) < 64:
        raise HTTPException(400, "That recording is empty.")
    media_id = f"{uuid.uuid4().hex}.{ext}"
    (data_dir("voice") / media_id).write_bytes(raw)
    withheld = int(_blocked(conn, to_unit_id, from_unit_id))
    sent_by = _delegate_name(conn, from_unit_id, delegate_id)
    cur = conn.execute(
        "INSERT INTO messages (from_unit_id, to_unit_id, kind, body, media_id, lang, withheld, sent_by, created_at)"
        " VALUES (?, ?, 'voice', ?, ?, ?, ?, ?, ?)",
        (from_unit_id, to_unit_id, str(duration), media_id, sender["lang"], withheld, sent_by, db.now()),
    )
    _expire_voice(conn)
    conn.commit()
    return _message_json(conn.execute("SELECT * FROM messages WHERE id = ?", (cur.lastrowid,)).fetchone(), sender["lang"])


@app.get("/api/messages/{message_id}/voice")
def voice_file(message_id: int, unit_id: str, conn: sqlite3.Connection = Depends(get_conn)) -> FileResponse:
    row = conn.execute("SELECT * FROM messages WHERE id = ? AND kind = 'voice'", (message_id,)).fetchone()
    if row is None or unit_id not in (row["from_unit_id"], row["to_unit_id"]) or (row["withheld"] and unit_id == row["to_unit_id"]):
        raise HTTPException(404, "voice message not found")
    if not row["media_id"]:
        raise HTTPException(410, f"Voice messages are deleted after {VOICE_RETENTION_DAYS} days.")
    ext = row["media_id"].rsplit(".", 1)[-1]
    media = next((k for k, v in VOICE_TYPES.items() if v == ext), "application/octet-stream")
    return FileResponse(data_dir("voice") / row["media_id"], media_type=media, headers={"Cache-Control": "private, max-age=86400"})


def _profile_json(conn: sqlite3.Connection, unit_id: str) -> dict[str, Any]:
    p, unit = _profile_row(conn, unit_id), _unit_row(conn, unit_id)
    blocked = [r["blocked_unit_id"] for r in conn.execute("SELECT blocked_unit_id FROM blocks WHERE unit_id = ?", (unit_id,))]
    return {"unit_id": unit_id, "bio": p["bio"], "accept_requests": bool(p["accept_requests"]), "allow_waves": bool(p["allow_waves"]),
            "quiet_mode": bool(p["quiet_mode"]), "lang": unit["lang"],
            "blocked": [{"id": b, "label": _unit_row(conn, b)["label"], "resident_name": _unit_row(conn, b)["resident_name"]} for b in blocked]}


@app.get("/api/units/{unit_id}/profile")
def get_profile(unit_id: str, conn: sqlite3.Connection = Depends(get_conn)) -> dict[str, Any]:
    _unit_row(conn, unit_id)
    out = _profile_json(conn, unit_id)
    conn.commit()
    return out


@app.put("/api/units/{unit_id}/profile")
def update_profile(unit_id: str, body: ProfileIn, conn: sqlite3.Connection = Depends(get_conn)) -> dict[str, Any]:
    _unit_row(conn, unit_id)
    _profile_row(conn, unit_id)
    if body.bio is not None:
        _check_shared_text(body.bio)
        conn.execute("UPDATE profiles SET bio = ? WHERE unit_id = ?", (body.bio.strip(), unit_id))
    for field in ("accept_requests", "allow_waves", "quiet_mode"):
        value = getattr(body, field)
        if value is not None:
            conn.execute(f"UPDATE profiles SET {field} = ? WHERE unit_id = ?", (int(value), unit_id))
    if body.lang is not None:
        conn.execute("UPDATE units SET lang = ? WHERE id = ?", (body.lang, unit_id))
    conn.commit()
    return _profile_json(conn, unit_id)


@app.get("/api/units/{unit_id}/official")
def official_account(unit_id: str, conn: sqlite3.Connection = Depends(get_conn)) -> dict[str, Any]:
    """The estate office as a read-only account in the chat list (like a WhatsApp channel)."""
    notices = notices_for(unit_id, conn)
    last_read = int(_profile_row(conn, unit_id)["notices_read_at"] or 0)  # id of the newest notice already seen
    conn.commit()
    return {"name": "Taman Demo Estate Office", "verified": True, "notices": notices,
            "unread": sum(1 for n in notices if n["id"] > last_read)}


@app.post("/api/units/{unit_id}/official/read")
def official_read(unit_id: str, conn: sqlite3.Connection = Depends(get_conn)) -> dict[str, bool]:
    _profile_row(conn, unit_id)
    newest = conn.execute("SELECT COALESCE(MAX(id), 0) FROM notices").fetchone()[0]
    conn.execute("UPDATE profiles SET notices_read_at = ? WHERE unit_id = ?", (str(newest), unit_id))
    conn.commit()
    return {"ok": True}



# ---------- care: family helpers, voice retention, "download my data" ----------

VOICE_RETENTION_DAYS = 30
REPORTED_VOICE_MAX_DAYS = 90  # an open report keeps the audio for review, up to this limit
VOICE_SWEEP_SECONDS = 3600
MAX_DELEGATES = 2
DELEGATE_RELATIONS = ("child", "spouse", "sibling", "caregiver", "other")


class DelegateIn(BaseModel):
    name: str = Field(..., min_length=2, max_length=40)
    relation: Literal["child", "spouse", "sibling", "caregiver", "other"]
    consent: bool


class RevokeIn(BaseModel):
    unit_id: str = Field(..., pattern=UNIT_ID)


def _expire_voice(conn: sqlite3.Connection) -> int:
    """Delete voice notes older than the retention period. A note with an open report is kept for the estate team,
    but never longer than REPORTED_VOICE_MAX_DAYS, so an unreviewed report can't keep audio forever."""
    now = datetime.now(timezone.utc)
    cutoff = (now - timedelta(days=VOICE_RETENTION_DAYS)).isoformat(timespec="seconds")
    hard_cutoff = (now - timedelta(days=REPORTED_VOICE_MAX_DAYS)).isoformat(timespec="seconds")
    rows = conn.execute(
        "SELECT id, media_id FROM messages WHERE kind = 'voice' AND media_id IS NOT NULL AND created_at < ?"
        " AND (created_at < ? OR id NOT IN (SELECT message_id FROM reports WHERE status = 'open'))",
        (cutoff, hard_cutoff)).fetchall()
    for r in rows:
        (data_dir("voice") / r["media_id"]).unlink(missing_ok=True)
        conn.execute("UPDATE messages SET media_id = NULL WHERE id = ?", (r["id"],))
    if rows:
        conn.commit()
    return len(rows)


def _require_sign_in_or_demo() -> None:
    if not demo_mode():
        raise HTTPException(403, "This needs sign-in, which comes with the pilot.")


def _check_shared_text(text: str) -> None:
    """Text other residents will see (bio, helper name): no insults, and no phone numbers, emails or links,
    which would side-step the rule that numbers are exchanged only when both households agree."""
    if talk.tone_problem(text):
        raise HTTPException(422, {"code": "tone", "message": TONE_MESSAGE})
    if talk.contact_details(text):
        raise HTTPException(422, {"code": "private", "message": PRIVATE_MESSAGE})


def _delegate_name(conn: sqlite3.Connection, unit_id: str, delegate_id: int | None) -> str | None:
    """A family helper acting for the household. Their name goes on the record of everything they do."""
    if delegate_id is None:
        return None
    row = conn.execute("SELECT * FROM delegates WHERE id = ? AND unit_id = ? AND revoked_at IS NULL", (delegate_id, unit_id)).fetchone()
    if row is None:
        raise HTTPException(403, "This helper isn't authorised for this household.")
    return f"{row['name']} ({row['relation']})"


def _delegate_json(row: sqlite3.Row) -> dict[str, Any]:
    return {"id": row["id"], "name": row["name"], "relation": row["relation"], "created_at": row["created_at"]}


@app.get("/api/units/{unit_id}/delegates")
def delegates(unit_id: str, conn: sqlite3.Connection = Depends(get_conn)) -> list[dict[str, Any]]:
    _unit_row(conn, unit_id)
    return [_delegate_json(r) for r in conn.execute(
        "SELECT * FROM delegates WHERE unit_id = ? AND revoked_at IS NULL ORDER BY id", (unit_id,))]


@app.post("/api/units/{unit_id}/delegates", status_code=201)
def add_delegate(unit_id: str, body: DelegateIn, conn: sqlite3.Connection = Depends(get_conn)) -> dict[str, Any]:
    """The owner authorises a family member to use Jiran5 for them (for residents who are not online)."""
    _unit_row(conn, unit_id)
    if not body.consent:
        raise HTTPException(422, "The owner must agree before a helper is added.")
    _check_shared_text(body.name)
    if talk.official_sounding(body.name):
        raise HTTPException(422, {"code": "official", "message": "A helper's name can't look like SDP, the estate office or an official account."})
    active = conn.execute("SELECT COUNT(*) FROM delegates WHERE unit_id = ? AND revoked_at IS NULL", (unit_id,)).fetchone()[0]
    if active >= MAX_DELEGATES:
        raise HTTPException(409, f"At most {MAX_DELEGATES} helpers per household.")
    cur = conn.execute("INSERT INTO delegates (unit_id, name, relation, created_at) VALUES (?, ?, ?, ?)",
                       (unit_id, body.name.strip(), body.relation, db.now()))
    db.append_event(conn, unit_id, "delegate_added", {"delegate_id": cur.lastrowid, "name": body.name.strip(), "relation": body.relation})
    conn.commit()
    return _delegate_json(conn.execute("SELECT * FROM delegates WHERE id = ?", (cur.lastrowid,)).fetchone())


@app.post("/api/delegates/{delegate_id}/revoke")
def revoke_delegate(delegate_id: int, body: RevokeIn, conn: sqlite3.Connection = Depends(get_conn)) -> dict[str, bool]:
    row = conn.execute("SELECT * FROM delegates WHERE id = ?", (delegate_id,)).fetchone()
    if row is None or row["unit_id"] != body.unit_id:
        raise HTTPException(404, "helper not found")
    if row["revoked_at"] is None:
        conn.execute("UPDATE delegates SET revoked_at = ? WHERE id = ?", (db.now(), delegate_id))
        db.append_event(conn, body.unit_id, "delegate_removed", {"delegate_id": delegate_id, "name": row["name"]})
        conn.commit()
    return {"ok": True}


@app.get("/api/units/{unit_id}/export")
def export_my_data(unit_id: str, conn: sqlite3.Connection = Depends(get_conn)) -> JSONResponse:
    """PDPA right of access: everything Jiran5 holds about this household, as one file.
    Other residents appear by unit only, never by name. It bundles a whole household's records, so outside demo mode
    it stays off until residents sign in (WhatsApp one-time code in the pilot)."""
    _require_sign_in_or_demo()
    me = _unit_row(conn, unit_id)
    label = lambda uid: _unit_row(conn, uid)["label"] if uid else "Estate team"  # noqa: E731
    p = _profile_row(conn, unit_id)
    sent = []
    for r in conn.execute("SELECT * FROM intros WHERE from_unit_id = ? ORDER BY id", (unit_id,)):
        recips = [label(x["unit_id"]) for x in conn.execute("SELECT unit_id FROM intro_recipients WHERE intro_id = ?", (r["id"],))]
        sent.append({"created_at": r["created_at"], "message": r["message"], "sent_by": r["sent_by"],
                     "renovation": json.loads(r["renovation"]) if r["renovation"] else None, "delivered_to": recips})
    received = [{"created_at": r["created_at"], "from": label(r["from_unit_id"]), "message": r["message"],
                 "renovation": json.loads(r["renovation"]) if r["renovation"] else None}
                for r in conn.execute("SELECT i.* FROM intros i JOIN intro_recipients x ON x.intro_id = i.id WHERE x.unit_id = ? ORDER BY i.id",
                                      (unit_id,))]
    messages = []
    for r in conn.execute("SELECT * FROM messages WHERE (from_unit_id = ? OR to_unit_id = ?) ORDER BY id", (unit_id, unit_id)):
        if r["to_unit_id"] == unit_id and r["withheld"]:
            continue
        if r["private"] and r["to_unit_id"] != unit_id:
            continue
        mine = r["from_unit_id"] == unit_id
        messages.append({"created_at": r["created_at"], "direction": "sent" if mine else "received",
                         "with": label(r["to_unit_id"] if mine else (r["from_unit_id"] or None)), "kind": r["kind"],
                         "text": f"Voice message ({r['body']}s)" if r["kind"] == "voice" else r["body"], "sent_by": r["sent_by"]})
    data = {
        "exported_at": db.now(),
        "about": "Your data held by Jiran5 (prototype). Other residents are listed by unit, not by name.",
        "household": {"unit": me["label"], "kind": me["kind"], "reading_language": me["lang"], "handover_date": me["handover_date"]},
        "profile": {"bio": p["bio"], "accept_requests": bool(p["accept_requests"]), "allow_waves": bool(p["allow_waves"]),
                    "quiet_mode": bool(p["quiet_mode"])},
        "family_helpers": delegates(unit_id, conn),
        "introductions_sent": sent,
        "introductions_received": received,
        "messages": messages,
        "waves": [{"created_at": r["created_at"], "direction": "sent" if r["from_unit_id"] == unit_id else "received",
                   "with": label(r["to_unit_id"] if r["from_unit_id"] == unit_id else r["from_unit_id"])}
                  for r in conn.execute("SELECT * FROM waves WHERE from_unit_id = ? OR to_unit_id = ? ORDER BY id", (unit_id, unit_id))],
        "concerns": [{"created_at": r["created_at"], "role": "raised" if r["from_unit_id"] == unit_id else "about my renovation",
                      "category": r["category"], "note": r["note"], "status": r["status"]}
                     for r in conn.execute("SELECT * FROM concerns WHERE from_unit_id = ? OR to_unit_id = ? ORDER BY id", (unit_id, unit_id))],
        "contact_requests": [{"created_at": r["created_at"], "direction": "sent" if r["from_unit_id"] == unit_id else "received",
                              "with": label(r["to_unit_id"] if r["from_unit_id"] == unit_id else r["from_unit_id"]),
                              "reason": r["reason"], "status": r["status"]}
                             for r in conn.execute("SELECT * FROM contact_requests WHERE from_unit_id = ? OR to_unit_id = ? ORDER BY id",
                                                   (unit_id, unit_id))],
        "photos": [{"kind": r["kind"], "subject": r["subject"], "sha256": r["sha256"], "created_at": r["created_at"]}
                   for r in conn.execute("SELECT * FROM photos WHERE unit_id = ? ORDER BY created_at", (unit_id,))],
        "warranty_tickets": [{"subject": r["subject"], "status": r["status"], "opened_at": r["opened_at"], "closed_at": r["closed_at"]}
                             for r in conn.execute("SELECT * FROM warranty_tickets WHERE unit_id = ? ORDER BY id", (unit_id,))],
        "home_log": db.unit_events(conn, unit_id),
    }
    conn.commit()
    return JSONResponse(data, headers={"Content-Disposition": f'attachment; filename="jiran5-{me["label"].replace(" ", "").replace(".", "")}-my-data.json"'})


# ---------- layer 3: prove ----------

@app.get("/api/units/{unit_id}/evidence")
def evidence(unit_id: str, conn: sqlite3.Connection = Depends(get_conn)) -> dict[str, Any]:
    """Everything the Evidence screen needs in one call: renovations next door, my photos, my cases."""
    photos = [_photo_json(r) for r in conn.execute(
        "SELECT * FROM photos WHERE unit_id = ? ORDER BY created_at DESC", (unit_id,))]
    renovations = []
    for item in inbox(unit_id, conn):
        if not item["renovation"]:
            continue
        rel = item["relation_to_me"]
        template = SUBJECT_BY_RELATION.get(rel)
        renovations.append({
            "intro_id": item["id"], "from_unit_id": item["from_unit_id"], "from_label": item["from_label"],
            "from_name": item["from_name"], "relation_to_me": rel, "renovation": item["renovation"],
            "needs_photo": template is not None,
            "suggested_subject": (template or "Front of your home facing {label}").format(label=item["from_label"]),
            "baseline": next((p for p in photos if p["kind"] == "baseline" and p["renovation_intro_id"] == item["id"]), None),
        })
    return {"renovations": renovations, "photos": photos, "incidents": incidents_for(unit_id, conn)}


@app.post("/api/units/{unit_id}/photos", status_code=201)
def upload_photo(
    unit_id: str,
    kind: Literal["baseline", "followup"] = Form(...),
    subject: str = Form(..., min_length=1, max_length=120),
    renovation_intro_id: int | None = Form(None),
    file: UploadFile = File(...),
    conn: sqlite3.Connection = Depends(get_conn),
) -> dict[str, Any]:
    raw = file.file.read(vision.MAX_UPLOAD_BYTES + 1)
    return _store_photo(conn, unit_id, raw, kind, subject, renovation_intro_id)


@app.get("/api/demo/photos")
def demo_photos() -> list[str]:
    if not demo_mode():
        raise HTTPException(403, "demo mode is off")
    return sorted(p.stem for p in DEMO_PHOTO_DIR.glob("*.jpg"))


@app.post("/api/units/{unit_id}/photos/demo", status_code=201)
def use_demo_photo(unit_id: str, body: DemoPhotoIn, conn: sqlite3.Connection = Depends(get_conn)) -> dict[str, Any]:
    """Same pipeline as a real upload, using one of the synthetic sample photos (keeps live demos stable)."""
    if not demo_mode():
        raise HTTPException(403, "demo mode is off")
    if body.name not in demo_photos():
        raise HTTPException(404, "no such demo photo")
    raw = (DEMO_PHOTO_DIR / f"{body.name}.jpg").read_bytes()
    return _store_photo(conn, unit_id, raw, body.kind, body.subject, body.renovation_intro_id)


@app.get("/api/photos/{photo_id}")
def photo_file(photo_id: str, size: Literal["full", "thumb"] = "full",
               conn: sqlite3.Connection = Depends(get_conn)) -> FileResponse:
    row = _photo_row(conn, photo_id)
    name = f"{row['id']}_thumb.jpg" if size == "thumb" else f"{row['id']}.jpg"
    return FileResponse(data_dir("photos") / name, media_type="image/jpeg",
                        headers={"Cache-Control": "private, max-age=31536000, immutable"})


@app.post("/api/incidents", status_code=201)
def report_incident(body: IncidentIn, conn: sqlite3.Connection = Depends(get_conn)) -> dict[str, Any]:
    baseline = _photo_row(conn, body.baseline_photo_id)
    followup = _photo_row(conn, body.followup_photo_id)
    if baseline["unit_id"] != body.reporter_unit_id or followup["unit_id"] != body.reporter_unit_id:
        raise HTTPException(403, "Both photos must belong to the household reporting the change.")
    if baseline["kind"] != "baseline" or followup["kind"] != "followup":
        raise HTTPException(400, "Compare a pre-work photo with a follow-up photo.")

    folder = data_dir("photos")
    comp = vision.compare((folder / f"{baseline['id']}.jpg").read_bytes(), (folder / f"{followup['id']}.jpg").read_bytes())
    intro = _intro(conn, baseline["renovation_intro_id"])
    hint = triage_hint(comp.result, baseline["created_at"],
                       intro["renovation"] if intro else None, intro["from_label"] if intro else None)
    cur = conn.execute(
        "INSERT INTO incidents (reporter_unit_id, renovation_intro_id, baseline_photo_id, followup_photo_id,"
        " comparison, hint, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        (body.reporter_unit_id, baseline["renovation_intro_id"], baseline["id"], followup["id"],
         json.dumps(comp.result), json.dumps(hint), db.now()),
    )
    incident_id = cur.lastrowid
    if comp.overlay_jpeg:
        out = data_dir("compare")
        (out / f"{incident_id}_overlay.jpg").write_bytes(comp.overlay_jpeg)
        (out / f"{incident_id}_after.jpg").write_bytes(comp.aligned_after_jpeg)
        (out / f"{incident_id}_before.jpg").write_bytes(comp.before_jpeg)
    db.append_event(conn, body.reporter_unit_id, "incident", {
        "incident_id": incident_id, "baseline_sha256": baseline["sha256"], "followup_sha256": followup["sha256"],
        "regions": len(comp.result["regions"]), "suggestion": hint["suggestion"],
    })
    conn.commit()
    return _incident_json(conn, conn.execute("SELECT * FROM incidents WHERE id = ?", (incident_id,)).fetchone())


@app.get("/api/incidents/{incident_id}/image")
def incident_image(incident_id: int, kind: Literal["before", "after", "overlay"],
                   conn: sqlite3.Connection = Depends(get_conn)) -> FileResponse:
    if conn.execute("SELECT 1 FROM incidents WHERE id = ?", (incident_id,)).fetchone() is None:
        raise HTTPException(404, "incident not found")
    path = data_dir("compare") / f"{incident_id}_{kind}.jpg"
    if not path.exists():
        raise HTTPException(404, "no comparison image (the photos could not be matched)")
    return FileResponse(path, media_type="image/jpeg", headers={"Cache-Control": "private, max-age=31536000, immutable"})


@app.get("/api/units/{unit_id}/incidents")
def incidents_for(unit_id: str, conn: sqlite3.Connection = Depends(get_conn)) -> list[dict[str, Any]]:
    """Cases I reported, plus cases reported against my renovation."""
    rows = conn.execute(
        "SELECT n.* FROM incidents n LEFT JOIN intros i ON i.id = n.renovation_intro_id"
        " WHERE n.reporter_unit_id = ? OR i.from_unit_id = ? ORDER BY n.id DESC",
        (unit_id, unit_id),
    ).fetchall()
    return [_incident_json(conn, r) for r in rows]


@app.post("/api/incidents/{incident_id}/decision")
def decide(incident_id: int, body: DecisionIn, conn: sqlite3.Connection = Depends(get_conn)) -> dict[str, Any]:
    row = conn.execute("SELECT * FROM incidents WHERE id = ?", (incident_id,)).fetchone()
    if row is None:
        raise HTTPException(404, "incident not found")
    if row["status"] == "decided":
        raise HTTPException(409, "This case has already been decided.")
    conn.execute(
        "UPDATE incidents SET status = 'decided', decision = ?, decision_note = ?, decided_at = ? WHERE id = ?",
        (body.decision, body.note, db.now(), incident_id),
    )
    payload = {"incident_id": incident_id, "decision": body.decision, "decided_by": body.decided_by, "note": body.note}
    db.append_event(conn, row["reporter_unit_id"], "triage", payload)
    intro = _intro(conn, row["renovation_intro_id"])
    if intro:
        db.append_event(conn, intro["from_unit_id"], "triage", payload)
    if body.decision == "warranty":
        _open_warranty(conn, row)
    conn.commit()
    return _incident_json(conn, conn.execute("SELECT * FROM incidents WHERE id = ?", (incident_id,)).fetchone())


# ---------- layer 2: agree (schedule, contractor passes, guardhouse) ----------

def _token_hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _pass_json(conn: sqlite3.Connection, row: sqlite3.Row) -> dict[str, Any]:
    entries = conn.execute(
        "SELECT allowed, reason, scanned_for, created_at FROM gate_logs WHERE pass_id = ? ORDER BY id DESC LIMIT 8",
        (row["id"],),
    ).fetchall()
    return {"id": row["id"], "intro_id": row["intro_id"], "unit_id": row["unit_id"], "contractor_name": row["contractor_name"],
            "contractor_cidb": bool(row["contractor_cidb"]), "valid_from": row["valid_from"], "valid_to": row["valid_to"],
            "entry_hours": f"{GATE_OPEN}-{GATE_CLOSE}, Mon-Sat", "status": row["status"],
            "created_at": row["created_at"], "revoked_at": row["revoked_at"],
            "gate_log": [{**dict(e), "allowed": bool(e["allowed"])} for e in entries]}


@app.get("/api/units/{unit_id}/works")
def works(unit_id: str, conn: sqlite3.Connection = Depends(get_conn)) -> dict[str, Any]:
    """Renovations that affect me (mine and those in my circle), with my contractor passes."""
    me = _unit_row(conn, unit_id)
    mine = []
    for r in conn.execute(
        "SELECT * FROM intros WHERE from_unit_id = ? AND renovation IS NOT NULL ORDER BY id DESC", (unit_id,)
    ):
        notified = conn.execute("SELECT COUNT(*) FROM intro_recipients WHERE intro_id = ?", (r["id"],)).fetchone()[0]
        photos = conn.execute(
            "SELECT COUNT(*) FROM photos WHERE renovation_intro_id = ? AND kind = 'baseline'", (r["id"],)
        ).fetchone()[0]
        passes = [_pass_json(conn, p) for p in conn.execute("SELECT * FROM passes WHERE intro_id = ? ORDER BY id DESC", (r["id"],))]
        mine.append({"intro_id": r["id"], "from_unit_id": unit_id, "from_label": me["label"], "from_name": me["resident_name"],
                     "relation_to_me": None, "renovation": json.loads(r["renovation"]), "neighbours_notified": notified,
                     "prework_photos": photos, "passes": passes})
    nearby = [
        {"intro_id": i["id"], "from_unit_id": i["from_unit_id"], "from_label": i["from_label"], "from_name": i["from_name"],
         "relation_to_me": i["relation_to_me"], "renovation": i["renovation"]}
        for i in inbox(unit_id, conn) if i["renovation"]
    ]
    return {"mine": mine, "nearby": nearby, "gate_hours": f"{GATE_OPEN}-{GATE_CLOSE}, Mon-Sat", "house_rules": HOUSE_RULES}


@app.post("/api/intros/{intro_id}/passes", status_code=201)
def issue_pass(intro_id: int, body: PassIn, conn: sqlite3.Connection = Depends(get_conn)) -> dict[str, Any]:
    """Issue a contractor pass. The QR holds a random token; only its SHA-256 is stored, so a database
    leak cannot be turned into working passes."""
    intro = conn.execute("SELECT * FROM intros WHERE id = ?", (intro_id,)).fetchone()
    if intro is None or intro["renovation"] is None:
        raise HTTPException(404, "renovation not found")
    if intro["from_unit_id"] != body.unit_id:
        raise HTTPException(403, "Only the renovating household can issue passes for it.")
    active = conn.execute("SELECT COUNT(*) FROM passes WHERE intro_id = ? AND status = 'active'", (intro_id,)).fetchone()[0]
    if active >= MAX_ACTIVE_PASSES:
        raise HTTPException(409, f"At most {MAX_ACTIVE_PASSES} active passes per renovation. Revoke one first.")
    reno = json.loads(intro["renovation"])
    token = secrets.token_urlsafe(24)
    name = body.contractor_name or reno.get("contractor") or "Contractor"
    cur = conn.execute(
        "INSERT INTO passes (intro_id, unit_id, contractor_name, contractor_cidb, token_hash, valid_from, valid_to, created_at)"
        " VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        (intro_id, body.unit_id, name, int(body.contractor_cidb or bool(reno.get("contractor_cidb_registered"))),
         _token_hash(token), reno["start"], reno["end"], db.now()),
    )
    db.append_event(conn, body.unit_id, "contractor_pass_issued",
                    {"pass_id": cur.lastrowid, "contractor": name, "valid_from": reno["start"], "valid_to": reno["end"]})
    conn.commit()
    row = conn.execute("SELECT * FROM passes WHERE id = ?", (cur.lastrowid,)).fetchone()
    # The token is returned exactly once; the server cannot show it again.
    return {**_pass_json(conn, row), "token": token, "qr_payload": f"J5PASS:{token}"}


@app.post("/api/passes/{pass_id}/revoke")
def revoke_pass(pass_id: int, body: OwnerIn, conn: sqlite3.Connection = Depends(get_conn)) -> dict[str, Any]:
    row = conn.execute("SELECT * FROM passes WHERE id = ?", (pass_id,)).fetchone()
    if row is None:
        raise HTTPException(404, "pass not found")
    if row["unit_id"] != body.unit_id:
        raise HTTPException(403, "Only the household that issued this pass can revoke it.")
    if row["status"] == "active":
        conn.execute("UPDATE passes SET status = 'revoked', revoked_at = ? WHERE id = ?", (db.now(), pass_id))
        db.append_event(conn, body.unit_id, "contractor_pass_revoked", {"pass_id": pass_id, "contractor": row["contractor_name"]})
        conn.commit()
    return _pass_json(conn, conn.execute("SELECT * FROM passes WHERE id = ?", (pass_id,)).fetchone())


def _gate_decision(row: sqlite3.Row | None, at: datetime) -> tuple[bool, str]:
    if row is None:
        return False, "Unknown pass"
    if row["status"] != "active":
        return False, "Pass revoked by the homeowner"
    day = at.strftime("%Y-%m-%d")
    if day < row["valid_from"]:
        return False, f"Renovation has not started (starts {row['valid_from']})"
    if day > row["valid_to"]:
        return False, f"Renovation ended on {row['valid_to']}"
    if at.weekday() == 6:
        return False, "No renovation entry on Sundays"
    if not GATE_OPEN <= at.strftime("%H:%M") < GATE_CLOSE:
        return False, f"Outside entry hours ({GATE_OPEN}-{GATE_CLOSE})"
    return True, "Entry allowed"


@app.post("/api/gate/scan")
def gate_scan(body: ScanIn, conn: sqlite3.Connection = Depends(get_conn)) -> dict[str, Any]:
    """What the guardhouse tablet does when it scans a contractor QR."""
    if body.at and not demo_mode():
        raise HTTPException(403, "simulated time is only available in demo mode")
    at = datetime.strptime(body.at, "%Y-%m-%dT%H:%M") if body.at else datetime.now(MALAYSIA).replace(tzinfo=None)
    row = conn.execute("SELECT * FROM passes WHERE token_hash = ?", (_token_hash(body.token),)).fetchone()
    allowed, reason = _gate_decision(row, at)
    conn.execute("INSERT INTO gate_logs (pass_id, allowed, reason, scanned_for, created_at) VALUES (?, ?, ?, ?, ?)",
                 (row["id"] if row else None, int(allowed), reason, at.strftime("%Y-%m-%dT%H:%M"), db.now()))
    conn.commit()
    if row is None:
        return {"allowed": False, "reason": reason, "pass": None}
    unit = _unit_row(conn, row["unit_id"])
    reno = json.loads(conn.execute("SELECT renovation FROM intros WHERE id = ?", (row["intro_id"],)).fetchone()[0])
    return {"allowed": allowed, "reason": reason, "scanned_for": at.strftime("%Y-%m-%dT%H:%M"),
            "pass": {"contractor_name": row["contractor_name"], "contractor_cidb": bool(row["contractor_cidb"]),
                     "unit_label": unit["label"], "scope": reno["scope"], "valid_from": row["valid_from"], "valid_to": row["valid_to"]}}


@app.get("/api/passes/view")
def contractor_view(token: str, conn: sqlite3.Connection = Depends(get_conn)) -> dict[str, Any]:
    """Everything a contractor holding the pass may see, and nothing else: no owner phone, no neighbour
    names, no photos, no other homes (the 'limited access' homeowners ask for in SDP App reviews)."""
    if not re.fullmatch(r"[A-Za-z0-9_-]{16,64}", token):
        raise HTTPException(404, "pass not found")
    row = conn.execute("SELECT * FROM passes WHERE token_hash = ?", (_token_hash(token),)).fetchone()
    if row is None:
        raise HTTPException(404, "pass not found")
    unit = _unit_row(conn, row["unit_id"])
    reno = json.loads(conn.execute("SELECT renovation FROM intros WHERE id = ?", (row["intro_id"],)).fetchone()[0])
    photos = conn.execute("SELECT COUNT(*) FROM photos WHERE renovation_intro_id = ? AND kind = 'baseline'",
                          (row["intro_id"],)).fetchone()[0]
    notified = conn.execute("SELECT COUNT(*) FROM intro_recipients WHERE intro_id = ?", (row["intro_id"],)).fetchone()[0]
    return {"status": row["status"], "contractor_name": row["contractor_name"], "unit_label": unit["label"],
            "scope": reno["scope"], "start": reno["start"], "end": reno["end"], "noisy_hours": reno.get("noisy_hours"),
            "entry_hours": f"{GATE_OPEN}-{GATE_CLOSE}, Mon-Sat", "house_rules": HOUSE_RULES,
            "neighbours_notified": notified, "prework_photos_on_record": photos}


# ---------- layer 4: close (owner-confirmed warranty repairs) ----------

def _open_warranty(conn: sqlite3.Connection, incident: sqlite3.Row) -> int:
    baseline = _photo_row(conn, incident["baseline_photo_id"])
    cur = conn.execute(
        "INSERT INTO warranty_tickets (unit_id, incident_id, subject, defect_photo_id, baseline_photo_id, opened_at)"
        " VALUES (?, ?, ?, ?, ?, ?)",
        (incident["reporter_unit_id"], incident["id"], baseline["subject"], incident["followup_photo_id"],
         incident["baseline_photo_id"], db.now()),
    )
    db.append_event(conn, incident["reporter_unit_id"], "warranty_opened",
                    {"ticket_id": cur.lastrowid, "incident_id": incident["id"], "subject": baseline["subject"]})
    return cur.lastrowid


HDA_DLP_MONTHS = 24  # Housing Development Act, Schedules G/H: defect liability period after vacant possession
HDA_REPAIR_DAYS = 30  # ...and the developer repairs within 30 days of the owner's written notice


def _add_months(d: date, months: int) -> date:
    y, m = divmod(d.month - 1 + months, 12)
    year, month = d.year + y, m + 1
    for day in (d.day, 30, 29, 28):
        try:
            return date(year, month, day)
        except ValueError:
            continue
    raise ValueError("bad date")


def _months_between(a: date, b: date) -> int:
    return max(0, (b.year - a.year) * 12 + b.month - a.month - (1 if b.day < a.day else 0))


def _local_date(iso: str) -> date:
    return datetime.fromisoformat(iso).astimezone(MALAYSIA).date()


def _warranty_clock(unit: sqlite3.Row, row: sqlite3.Row) -> dict[str, Any]:
    today = datetime.now(MALAYSIA).date()
    handover = date.fromisoformat(unit["handover_date"])
    dlp_end = _add_months(handover, HDA_DLP_MONTHS)
    notice = _local_date(row["opened_at"])
    due = notice + timedelta(days=HDA_REPAIR_DAYS)
    closed = _local_date(row["closed_at"]) if row["closed_at"] else None
    return {"handover_date": handover.isoformat(), "dlp_ends": dlp_end.isoformat(), "within_dlp": notice <= dlp_end,
            "dlp_months_left": _months_between(today, dlp_end), "notice_date": notice.isoformat(), "repair_due": due.isoformat(),
            "repair_days": HDA_REPAIR_DAYS, "days_elapsed": ((closed or today) - notice).days, "days_left": (due - today).days,
            "overdue": closed is None and today > due, "closed_on_time": closed is not None and closed <= due}


def _ticket_json(conn: sqlite3.Connection, row: sqlite3.Row) -> dict[str, Any]:
    unit = _unit_row(conn, row["unit_id"])
    check = json.loads(row["repair_check"]) if row["repair_check"] else None
    images = None
    if check and check.get("aligned"):
        v = row["repair_photo_id"][:12]
        images = {k: f"/api/warranty/{row['id']}/image?kind={k}&v={v}" for k in ("before", "after", "overlay")}
    photo = lambda pid: _photo_json(_photo_row(conn, pid)) if pid else None  # noqa: E731
    return {"id": row["id"], "unit_id": row["unit_id"], "unit_label": unit["label"], "resident_name": unit["resident_name"],
            "incident_id": row["incident_id"], "subject": row["subject"], "status": row["status"],
            "subcontractor": row["subcontractor"], "procore_ref": row["procore_ref"],
            "defect_photo": photo(row["defect_photo_id"]), "baseline_photo": photo(row["baseline_photo_id"]),
            "repair_photo": photo(row["repair_photo_id"]), "repair_check": check, "images": images,
            "owner_note": row["owner_note"], "reopen_count": row["reopen_count"], "opened_at": row["opened_at"],
            "repaired_at": row["repaired_at"], "closed_at": row["closed_at"], "clock": _warranty_clock(unit, row)}


def _ticket_row(conn: sqlite3.Connection, ticket_id: int) -> sqlite3.Row:
    row = conn.execute("SELECT * FROM warranty_tickets WHERE id = ?", (ticket_id,)).fetchone()
    if row is None:
        raise HTTPException(404, "warranty ticket not found")
    return row


def _submit_repair(conn: sqlite3.Connection, ticket: sqlite3.Row, raw: bytes, subcontractor: str) -> dict[str, Any]:
    if ticket["status"] != "open":
        raise HTTPException(409, "This ticket is not waiting for a repair.")
    photo = _store_photo(conn, ticket["unit_id"], raw, "repair", ticket["subject"], None)
    reference = ticket["baseline_photo_id"] or ticket["defect_photo_id"]
    folder = data_dir("photos")
    comp = vision.compare((folder / f"{reference}.jpg").read_bytes(), (folder / f"{photo['id']}.jpg").read_bytes())
    if not ticket["baseline_photo_id"]:
        verdict = "unverified"
    elif not comp.result["aligned"]:
        verdict = "unverified"
    else:
        verdict = "still_changed" if comp.result["changed"] else "restored"
    check = {**comp.result, "verdict": verdict, "compared_with": "pre-work photo" if ticket["baseline_photo_id"] else "defect photo"}
    if comp.overlay_jpeg:
        out = data_dir("compare")
        (out / f"w{ticket['id']}_{photo['id'][:12]}_overlay.jpg").write_bytes(comp.overlay_jpeg)
        (out / f"w{ticket['id']}_{photo['id'][:12]}_after.jpg").write_bytes(comp.aligned_after_jpeg)
        (out / f"w{ticket['id']}_{photo['id'][:12]}_before.jpg").write_bytes(comp.before_jpeg)
    procore_ref = ticket["procore_ref"] or f"PC-{2000 + ticket['id']}"  # simulated link to the Procore defect item
    conn.execute(
        "UPDATE warranty_tickets SET status = 'repair_submitted', subcontractor = ?, procore_ref = ?, repair_photo_id = ?,"
        " repair_check = ?, repaired_at = ? WHERE id = ?",
        (subcontractor, procore_ref, photo["id"], json.dumps(check), db.now(), ticket["id"]),
    )
    db.append_event(conn, ticket["unit_id"], "repair_submitted", {
        "ticket_id": ticket["id"], "subcontractor": subcontractor, "procore_ref": procore_ref,
        "repair_photo_sha256": photo["sha256"], "check": verdict,
    })
    conn.commit()
    return _ticket_json(conn, _ticket_row(conn, ticket["id"]))


@app.get("/api/warranty")
def warranty_queue(phase_id: str = "demo", conn: sqlite3.Connection = Depends(get_conn)) -> list[dict[str, Any]]:
    """SDP warranty team's queue."""
    rows = conn.execute(
        "SELECT w.* FROM warranty_tickets w JOIN units u ON u.id = w.unit_id WHERE u.phase_id = ? ORDER BY w.id DESC",
        (phase_id,),
    ).fetchall()
    return [_ticket_json(conn, r) for r in rows]


@app.get("/api/units/{unit_id}/warranty")
def my_warranty(unit_id: str, conn: sqlite3.Connection = Depends(get_conn)) -> list[dict[str, Any]]:
    _unit_row(conn, unit_id)
    rows = conn.execute("SELECT * FROM warranty_tickets WHERE unit_id = ? ORDER BY id DESC", (unit_id,)).fetchall()
    return [_ticket_json(conn, r) for r in rows]


@app.post("/api/warranty/{ticket_id}/repair")
def submit_repair(ticket_id: int, subcontractor: str = Form(..., min_length=1, max_length=80),
                  file: UploadFile = File(...), conn: sqlite3.Connection = Depends(get_conn)) -> dict[str, Any]:
    return _submit_repair(conn, _ticket_row(conn, ticket_id), file.file.read(vision.MAX_UPLOAD_BYTES + 1), subcontractor)


@app.post("/api/warranty/{ticket_id}/repair/demo")
def submit_demo_repair(ticket_id: int, body: RepairDemoIn, conn: sqlite3.Connection = Depends(get_conn)) -> dict[str, Any]:
    if not demo_mode():
        raise HTTPException(403, "demo mode is off")
    if body.name not in demo_photos():
        raise HTTPException(404, "no such demo photo")
    return _submit_repair(conn, _ticket_row(conn, ticket_id), (DEMO_PHOTO_DIR / f"{body.name}.jpg").read_bytes(), body.subcontractor)


@app.post("/api/warranty/{ticket_id}/owner")
def owner_response(ticket_id: int, body: OwnerResponseIn, conn: sqlite3.Connection = Depends(get_conn)) -> dict[str, Any]:
    """Only the homeowner can close a warranty repair. Rejecting sends it back to SDP."""
    ticket = _ticket_row(conn, ticket_id)
    if ticket["unit_id"] != body.unit_id:
        raise HTTPException(403, "Only the homeowner can confirm or reject this repair.")
    if ticket["status"] != "repair_submitted":
        raise HTTPException(409, "There is no repair waiting for confirmation.")
    acted = _delegate_name(conn, body.unit_id, body.delegate_id)
    extra = {"acted_by": acted} if acted else {}
    if body.decision == "accept":
        conn.execute("UPDATE warranty_tickets SET status = 'closed', owner_note = ?, closed_at = ? WHERE id = ?",
                     (body.note, db.now(), ticket_id))
        db.append_event(conn, body.unit_id, "warranty_closed_by_owner",
                        {"ticket_id": ticket_id, "repair_photo_id": ticket["repair_photo_id"], "note": body.note, **extra})
    else:
        conn.execute("UPDATE warranty_tickets SET status = 'open', owner_note = ?, reopen_count = reopen_count + 1 WHERE id = ?",
                     (body.note, ticket_id))
        db.append_event(conn, body.unit_id, "repair_rejected_by_owner",
                        {"ticket_id": ticket_id, "repair_photo_id": ticket["repair_photo_id"], "note": body.note, **extra})
    conn.commit()
    return _ticket_json(conn, _ticket_row(conn, ticket_id))


@app.get("/api/warranty/{ticket_id}/image")
def warranty_image(ticket_id: int, kind: Literal["before", "after", "overlay"],
                   conn: sqlite3.Connection = Depends(get_conn)) -> FileResponse:
    ticket = _ticket_row(conn, ticket_id)
    if not ticket["repair_photo_id"]:
        raise HTTPException(404, "no repair photo yet")
    path = data_dir("compare") / f"w{ticket_id}_{ticket['repair_photo_id'][:12]}_{kind}.jpg"
    if not path.exists():
        raise HTTPException(404, "no comparison image")
    return FileResponse(path, media_type="image/jpeg", headers={"Cache-Control": "private, max-age=31536000, immutable"})


# ---------- home history, dashboard, demo ----------

@app.get("/api/units/{unit_id}/history")
def home_history(unit_id: str, conn: sqlite3.Connection = Depends(get_conn)) -> dict[str, Any]:
    _unit_row(conn, unit_id)
    events = db.unit_events(conn, unit_id)
    ok, bad_index = ledger.verify_chain(events)
    return {"unit_id": unit_id, "events": events, "chain_ok": ok, "first_bad_index": bad_index}


@app.post("/api/units/{unit_id}/events", status_code=201)
def add_event(unit_id: str, body: EventIn, conn: sqlite3.Connection = Depends(get_conn)) -> dict[str, Any]:
    """Generic append for later layers (e.g. owner-confirmed warranty closure)."""
    _unit_row(conn, unit_id)
    event = db.append_event(conn, unit_id, body.type, body.payload)
    conn.commit()
    return event


@app.post("/api/demo/reset")
def reset_demo(conn: sqlite3.Connection = Depends(get_conn)) -> dict[str, str]:
    """Wipe and re-seed the fictional demo data (for rehearsals). Disabled when JIRAN_DEMO_MODE=0."""
    if not demo_mode():
        raise HTTPException(403, "demo mode is off")
    db.drop_all(conn)
    for folder in ("photos", "compare", "voice"):
        shutil.rmtree(data_dir(folder))
    db.init_db(conn)
    return {"status": "reset"}



def _community_health(conn: sqlite3.Connection, unit_ids: list[str]) -> dict[str, Any]:
    """How connected the phase is: pairs of next-door homes who know each other, how soon people say hello after
    handover, and how many circles were active in the last 30 days."""
    pairs, known = set(), set()
    for u in unit_ids:
        for n in neighbour_card(u, conn)["neighbours"]:
            key = tuple(sorted((u, n["id"])))
            pairs.add(key)
            if n["known"]:
                known.add(key)
    days, active = [], 0
    since = (datetime.now(timezone.utc) - timedelta(days=30)).isoformat(timespec="seconds")
    q = ("SELECT created_at FROM intros WHERE from_unit_id = ? UNION ALL SELECT created_at FROM waves WHERE from_unit_id = ?"
         " UNION ALL SELECT created_at FROM messages WHERE from_unit_id = ? AND kind != 'system'")
    for u in unit_ids:
        stamps = [r[0] for r in conn.execute(q, (u, u, u))]
        if not stamps:
            continue
        handover = date.fromisoformat(_unit_row(conn, u)["handover_date"])
        days.append(max(0, (_local_date(min(stamps)) - handover).days))
        active += any(t > since for t in stamps)
    return {"circle_pairs": len(pairs), "known_pairs": len(known),
            "days_to_first_hello": round(sum(days) / len(days), 1) if days else None,
            "households_reached_out": len(days), "active_circles_30d": active}

@app.get("/api/dashboard")
def dashboard(phase_id: str = "demo", conn: sqlite3.Connection = Depends(get_conn)) -> dict[str, Any]:
    unit_ids = [r["id"] for r in conn.execute("SELECT id FROM units WHERE phase_id = ?", (phase_id,))]
    marks = ",".join("?" * len(unit_ids))

    def count(sql: str) -> int:
        return conn.execute(sql.format(marks=marks), unit_ids).fetchone()[0]

    delivered, acked = conn.execute(
        f"SELECT COUNT(*), COUNT(r.acked_at) FROM intro_recipients r JOIN intros i ON i.id = r.intro_id"
        f" WHERE i.from_unit_id IN ({marks})", unit_ids,
    ).fetchone()
    renovations = count("SELECT COUNT(*) FROM intros WHERE renovation IS NOT NULL AND from_unit_id IN ({marks})")
    with_photos = count(
        "SELECT COUNT(DISTINCT p.renovation_intro_id) FROM photos p JOIN intros i ON i.id = p.renovation_intro_id"
        " WHERE p.kind = 'baseline' AND i.from_unit_id IN ({marks})"
    )
    decisions = dict(conn.execute(
        f"SELECT decision, COUNT(*) FROM incidents WHERE status = 'decided' AND reporter_unit_id IN ({marks})"
        f" GROUP BY decision", unit_ids,
    ).fetchall())
    return {
        "households": len(unit_ids),
        "intros_sent": count("SELECT COUNT(*) FROM intros WHERE from_unit_id IN ({marks})"),
        "reply_rate": round(acked / delivered, 3) if delivered else None,
        "households_with_a_known_neighbour": sum(neighbour_card(u, conn)["known_count"] > 0 for u in unit_ids),
        "renovations_registered": renovations,
        "renovations_with_prework_photos": with_photos,
        "baseline_photos": count("SELECT COUNT(*) FROM photos WHERE kind = 'baseline' AND unit_id IN ({marks})"),
        "incidents": count("SELECT COUNT(*) FROM incidents WHERE reporter_unit_id IN ({marks})"),
        "incidents_decided": sum(decisions.values()),
        "decisions": decisions,
        "passes_issued": count("SELECT COUNT(*) FROM passes WHERE unit_id IN ({marks})"),
        "gate_allowed": count("SELECT COUNT(*) FROM gate_logs g JOIN passes p ON p.id = g.pass_id"
                              " WHERE g.allowed = 1 AND p.unit_id IN ({marks})"),
        "gate_denied": count("SELECT COUNT(*) FROM gate_logs g LEFT JOIN passes p ON p.id = g.pass_id"
                             " WHERE g.allowed = 0 AND (p.unit_id IN ({marks}) OR g.pass_id IS NULL)"),
        "warranty_open": count("SELECT COUNT(*) FROM warranty_tickets WHERE status != 'closed' AND unit_id IN ({marks})"),
        "warranty_closed": count("SELECT COUNT(*) FROM warranty_tickets WHERE status = 'closed' AND unit_id IN ({marks})"),
        "repairs_rejected": count("SELECT COALESCE(SUM(reopen_count), 0) FROM warranty_tickets WHERE unit_id IN ({marks})"),
        "home_histories_verified": sum(ledger.verify_chain(db.unit_events(conn, u))[0] for u in unit_ids),
        "messages_sent": count("SELECT COUNT(*) FROM messages WHERE kind != 'system' AND from_unit_id IN ({marks})"),
        "contacts_shared": count("SELECT COUNT(*) FROM contact_consents a JOIN contact_consents b"
                                 " ON a.unit_id = b.other_unit_id AND a.other_unit_id = b.unit_id WHERE a.unit_id IN ({marks})") // 2,
        "concerns_raised": count("SELECT COUNT(*) FROM concerns WHERE from_unit_id IN ({marks})"),
        "concerns_settled_by_neighbours": count("SELECT COUNT(*) FROM concerns WHERE status = 'resolved' AND from_unit_id IN ({marks})"),
        "concerns_escalated": count("SELECT COUNT(*) FROM concerns WHERE escalated_at IS NOT NULL AND from_unit_id IN ({marks})"),
        "concerns_with_estate": count("SELECT COUNT(*) FROM concerns WHERE status = 'escalated' AND from_unit_id IN ({marks})"),
        "reports_open": conn.execute("SELECT COUNT(*) FROM reports WHERE status = 'open'").fetchone()[0],
        **_community_health(conn, unit_ids),
        "contact_requests": count("SELECT COUNT(*) FROM contact_requests WHERE from_unit_id IN ({marks})"),
        "waves": count("SELECT COUNT(*) FROM waves WHERE from_unit_id IN ({marks})"),
        "contact_requests_accepted": count("SELECT COUNT(*) FROM contact_requests WHERE status = 'accepted' AND from_unit_id IN ({marks})"),
        "warranty_overdue": sum(_ticket_json(conn, r)["clock"]["overdue"] for r in conn.execute(
            f"SELECT * FROM warranty_tickets WHERE unit_id IN ({marks})", unit_ids).fetchall()),
    }


# ---------- built web app (demo mode: one process, one port) ----------
# Mounted last so every /api route above takes precedence. Present only after `npm run build`.
STATIC_DIR = Path(os.environ.get("JIRAN_STATIC_DIR", Path(__file__).resolve().parents[2] / "frontend" / "dist"))
if STATIC_DIR.is_dir():
    app.mount("/", StaticFiles(directory=STATIC_DIR, html=True), name="web")
