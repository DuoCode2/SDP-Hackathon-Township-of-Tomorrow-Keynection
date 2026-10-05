import hashlib
import json
import os
import re
import secrets
import shutil
import sqlite3
import uuid
from collections.abc import Iterator
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Literal

from fastapi import Depends, FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field, model_validator

from . import db, ledger, vision
from .neighbours import Unit, inverse_relation, neighbour_circle
from .triage import triage_hint

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
    conn.close()
    vision.warm_up()  # pay OpenCV's start-up cost now, not during the first demo comparison
    yield


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
            "block": row["block"], "floor": row["floor"], "pos": row["pos"]}


def _circle(conn: sqlite3.Connection, unit_id: str) -> list[dict[str, Any]]:
    me = _unit_row(conn, unit_id)
    rows = {r["id"]: r for r in conn.execute("SELECT * FROM units WHERE phase_id = ?", (me["phase_id"],))}
    phase_units = [_to_unit(r) for r in rows.values()]
    return [{**_unit_json(rows[n.unit_id]), "relation": n.relation} for n in neighbour_circle(_to_unit(me), phase_units)]


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
    "below": "Floor above {label}",
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
    return [_unit_json(r) for r in conn.execute("SELECT * FROM units WHERE phase_id = ? ORDER BY id", (phase_id,))]


@app.get("/api/units/{unit_id}/neighbours")
def neighbours(unit_id: str, conn: sqlite3.Connection = Depends(get_conn)) -> list[dict[str, Any]]:
    return _circle(conn, unit_id)


@app.post("/api/intros", status_code=201)
def send_intro(body: IntroIn, conn: sqlite3.Connection = Depends(get_conn)) -> dict[str, Any]:
    _unit_row(conn, body.from_unit_id)
    circle = _circle(conn, body.from_unit_id)
    renovation = body.renovation.model_dump() if body.renovation else None
    cur = conn.execute(
        "INSERT INTO intros (from_unit_id, message, lang, renovation, created_at) VALUES (?, ?, ?, ?, ?)",
        (body.from_unit_id, body.message, body.lang, json.dumps(renovation) if renovation else None, db.now()),
    )
    intro_id = cur.lastrowid
    for n in circle:
        conn.execute("INSERT INTO intro_recipients (intro_id, unit_id, relation) VALUES (?, ?, ?)",
                     (intro_id, n["id"], n["relation"]))
    if renovation:
        db.append_event(conn, body.from_unit_id, "renovation_registered",
                        {**renovation, "neighbours_notified": [n["id"] for n in circle]})
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
        out.append({**n, "known": they_replied or i_replied})
    return {"unit_id": unit_id, "neighbours": out, "known_count": sum(n["known"] for n in out)}


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
            "repaired_at": row["repaired_at"], "closed_at": row["closed_at"]}


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
    if body.decision == "accept":
        conn.execute("UPDATE warranty_tickets SET status = 'closed', owner_note = ?, closed_at = ? WHERE id = ?",
                     (body.note, db.now(), ticket_id))
        db.append_event(conn, body.unit_id, "warranty_closed_by_owner",
                        {"ticket_id": ticket_id, "repair_photo_id": ticket["repair_photo_id"], "note": body.note})
    else:
        conn.execute("UPDATE warranty_tickets SET status = 'open', owner_note = ?, reopen_count = reopen_count + 1 WHERE id = ?",
                     (body.note, ticket_id))
        db.append_event(conn, body.unit_id, "repair_rejected_by_owner",
                        {"ticket_id": ticket_id, "repair_photo_id": ticket["repair_photo_id"], "note": body.note})
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
    for folder in ("photos", "compare"):
        shutil.rmtree(data_dir(folder))
    db.init_db(conn)
    return {"status": "reset"}


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
    }


# ---------- built web app (demo mode: one process, one port) ----------
# Mounted last so every /api route above takes precedence. Present only after `npm run build`.
STATIC_DIR = Path(os.environ.get("JIRAN_STATIC_DIR", Path(__file__).resolve().parents[2] / "frontend" / "dist"))
if STATIC_DIR.is_dir():
    app.mount("/", StaticFiles(directory=STATIC_DIR, html=True), name="web")
