import asyncio
import base64
import contextvars
import csv
import hashlib
import hmac
import io
import json
import logging
import os
import re
import secrets
import shutil
import sqlite3
import threading
import time
import uuid
import zipfile
from collections.abc import Iterator
from contextlib import asynccontextmanager
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Literal
from urllib.parse import parse_qs, urlparse

import httpx
from fastapi import Depends, FastAPI, File, Form, HTTPException, Query, Request, Response, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field, model_validator

from . import ai, auth, db, ledger, quiet, talk, vision
from .neighbours import Unit, impact_reason, impact_zone, inverse_relation, neighbour_circle, street_or_block
from . import backup, phase_import, privacy, push
from .planner import MAX_HOMES, home_count, plan_phase
from .seed import CONSENT_VERSION, CONSENT_VERSION_AI, CONSENT_VERSION_AI_GEMINI
from .settings import demo_mode, setting
from .triage import triage_hint

log = logging.getLogger("keynection")
if not log.handlers:  # uvicorn sets up its own loggers only: without this, Keynection's own lines never show
    _handler = logging.StreamHandler()
    _handler.setFormatter(logging.Formatter("%(levelname)s:     %(message)s"))
    log.addHandler(_handler)
    log.setLevel(logging.INFO)
    log.propagate = False

DEFAULT_DB = Path(__file__).resolve().parent.parent / "data" / "app.db"
DEMO_PHOTO_DIR = Path(__file__).resolve().parent / "demo_photos"
MAX_REQUEST_BYTES = vision.MAX_UPLOAD_BYTES + 512 * 1024  # photo plus form fields
UNIT_ID = r"^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$"
PHOTO_ID = re.compile(r"^[0-9a-f]{32}$")
DATE = r"^\d{4}-\d{2}-\d{2}$"
HHMM = r"^([01]\d|2[0-3]):[0-5]\d$"
# Languages a household can read its messages in (talk.LANGS). The screens themselves stay in en, ms and zh.
ReadLang = Literal["en", "ms", "zh", "ta"]
MALAYSIA = timezone(timedelta(hours=8))
GATE_OPEN, GATE_CLOSE = "08:00", "18:00"  # contractor entry hours; Sundays closed
MAX_ACTIVE_PASSES = 3
MAX_RENOVATION_DAYS = 365
RENOVATION_TALK_DAYS = 30  # homes a renovation notice connects can keep talking this long after the work ends
MAX_HELLOS_PER_DAY = 3
MAX_RENOVATION_NOTICES_PER_DAY = 3
# (code, English text): the text is the record; the code lets the app show the rule in the reader's language.
HOUSE_RULE_LIST = [
    ("noisy_hours_only", "Noisy work only within the hours in the renovation notice"),
    ("no_sundays", "No work on Sundays and public holidays"),
    ("debris", "Debris goes into the booked skip, never the drains or open land"),
    ("protect_lift", "Protect the lift and common areas before moving materials"),
    ("carry_pass", "Workers must carry this pass and show it at the guardhouse"),
]
HOUSE_RULES = [text for _, text in HOUSE_RULE_LIST]
HOUSE_RULE_CODES = [code for code, _ in HOUSE_RULE_LIST]
APARTMENT_ONLY_RULES = {"protect_lift"}  # a terrace has no lift or shared corridor to protect


def house_rules_for(kind: str) -> tuple[list[str], list[str]]:
    """The estate's rules for this kind of home: the texts (the record) and their codes (the reader's language)."""
    rules = [(code, text) for code, text in HOUSE_RULE_LIST if kind == "apartment" or code not in APARTMENT_ONLY_RULES]
    return [text for _, text in rules], [code for code, _ in rules]


def db_path() -> str:
    return setting("DB_PATH") or str(DEFAULT_DB)


def data_dir(name: str) -> Path:
    d = Path(db_path()).parent / name
    d.mkdir(parents=True, exist_ok=True)
    return d


# Who is asking, once the sign-in guard below has checked the session (pilot mode). None in demo mode.
_current_actor: contextvars.ContextVar["auth.Actor | None"] = contextvars.ContextVar("actor", default=None)


def staff_only() -> None:
    """SDP back-office actions (estate, moderation, notices, warranty, dashboards). In demo mode anyone can try
    them; in pilot mode only a signed-in staff member (the guard checks the session before the request body)."""
    actor = _current_actor.get()
    if not demo_mode() and not (actor and actor.is_staff):
        raise HTTPException(403, "This is for the estate office and SDP staff.")


@asynccontextmanager
async def lifespan(_: FastAPI):
    global _last_request
    _last_request = None  # a fresh start never counts as a quiet spell
    conn = db.connect(db_path())
    db.init_db(conn, keep_data=not demo_mode())  # a pilot's records are never rebuilt
    _expire_voice(conn)
    conn.close()
    try:
        _daily_care()
    except Exception:  # a failed backup or clean-up must not stop the server from starting
        log.exception("daily clean-up and backup failed")
    if not demo_mode():
        conn = db.connect(db_path())
        try:
            first = _first_staff(conn)
            if first:
                log.warning("%s", first)
            for check in _pilot_checks(conn):
                log.warning("Pilot setup: %s", check)
        finally:
            conn.close()
    vision.warm_up()  # pay OpenCV's start-up cost now, not during the first demo comparison
    if ai.enabled():
        log.info("AI translation and notice writing on (%s)", ai.model_name())
    else:
        log.info("AI off: set ANTHROPIC_API_KEY (or, for the demo, GEMINI_API_KEY) to turn on translation and notice "
                 "writing; everything else works as before")
    sweeper = asyncio.create_task(_voice_sweeper())
    sender = None if demo_mode() else asyncio.create_task(_alert_sender())  # the demo only previews alerts
    yield
    sweeper.cancel()
    if sender:
        sender.cancel()


def _sweep_once() -> int:
    conn = db.connect(db_path())
    try:
        removed = _expire_voice(conn)
    finally:
        conn.close()
    _daily_care()
    return removed


def _folders() -> dict[str, Path]:
    return {name: data_dir(name) for name in ("photos", "compare", "voice")}


def sweep_records(now: datetime | None = None) -> dict[str, int]:
    """Delete the messages, photos and records whose time is up (see privacy.py). Returns what went, by kind."""
    conn = db.connect(db_path())
    try:
        gone = privacy.sweep(conn, now or datetime.now(timezone.utc), _folders())
    finally:
        conn.close()
    if gone:
        log.info("records whose time was up deleted: %s", gone)
    return gone


def _origin() -> str:
    return os.environ.get("KEYNECTION_ORIGIN", "").split(",")[0].strip().rstrip("/")


def _first_staff(conn: sqlite3.Connection) -> str | None:
    """A pilot on a host with no command line (Render, Railway): KEYNECTION_FIRST_STAFF="Farah Aziz" makes the first
    staff member at start-up, and the one-time sign-in link goes to the server log, which only whoever runs the
    server can read. Until someone has signed in, every start makes a fresh link (the old one stops working), so an
    expired link is fixed by a restart. After the first sign-in this does nothing."""
    name = os.environ.get("KEYNECTION_FIRST_STAFF", "").strip()
    if demo_mode() or len(name) < 2:
        return None
    staff = conn.execute("SELECT * FROM staff WHERE revoked_at IS NULL ORDER BY id").fetchall()
    subjects = [f"staff:{r['id']}" for r in staff]
    marks = ",".join("?" * len(subjects))
    if subjects and (conn.execute(f"SELECT 1 FROM sessions WHERE subject IN ({marks})", subjects).fetchone()
                     or conn.execute(f"SELECT 1 FROM passkeys WHERE subject IN ({marks})", subjects).fetchone()
                     or conn.execute(f"SELECT 1 FROM access_codes WHERE subject IN ({marks}) AND used_at IS NOT NULL", subjects).fetchone()):
        return None  # someone has signed in: staff add colleagues in the app from now on
    role = os.environ.get("KEYNECTION_FIRST_STAFF_ROLE", "estate").strip()
    role = role if role in ("estate", "sdp") else "estate"
    mine = next((r for r in staff if r["name"].casefold() == name.casefold()), None)
    if mine is None and staff:
        return None  # another staff member was added some other way: leave it to them
    if mine is None:
        _, token, expires = auth.add_staff(conn, name, role)
    else:
        token, expires = auth.issue_code(conn, "staff", f"staff:{mine['id']}")
    return (f"First staff member {name}: open {_origin()}/?code={token} on your own phone to sign in and make your "
            f"digital key (works once, until {expires}; a restart makes a new link until someone has signed in).")


def _pilot_checks(conn: sqlite3.Connection) -> list[str]:
    """What still stands between this server and a working pilot, in plain words: logged at start-up, shown to staff."""
    if demo_mode():
        return []
    out = []
    origin = _origin()
    if not origin:
        out.append("Set KEYNECTION_ORIGIN to this server's address (https://...): digital keys are made for that address.")
    elif urlparse(origin).scheme != "https" and urlparse(origin).hostname != "localhost":
        out.append("KEYNECTION_ORIGIN should start with https://: phones make digital keys only on a secure address.")
    if setting("SITE_PASSWORD"):
        out.append("Remove KEYNECTION_SITE_PASSWORD (or JIRAN_SITE_PASSWORD): in a pilot everyone signs in with a digital key,"
                   " and residents need no shared password.")
    if os.environ.get("GEMINI_API_KEY"):
        out.append("GEMINI_API_KEY is not used in a pilot: Google's free tier uses what is sent to improve its products."
                   " Remove it; for AI with real households, set ANTHROPIC_API_KEY.")
    if not conn.execute("SELECT COUNT(*) FROM staff WHERE revoked_at IS NULL").fetchone()[0]:
        out.append("No staff member yet: set KEYNECTION_FIRST_STAFF to their name and restart (or run scripts/add_staff.py).")
    if conn.execute("SELECT 1 FROM phases WHERE id = 'demo'").fetchone():
        out.append("This database holds the fictional Taman Demo phase: give the pilot a new, empty database (KEYNECTION_DB_PATH).")
    elif not conn.execute("SELECT COUNT(*) FROM phases").fetchone()[0]:
        out.append("No phase yet: sign in as staff and import SDP's handover list in Phase setup.")
    last = backup.newest(backup_dir())
    if last is None or datetime.now(timezone.utc) - last > timedelta(hours=26):
        out.append("No backup in the last day: check the server can write to its backups folder.")
    return out


def backup_dir() -> Path:
    return Path(os.environ.get("KEYNECTION_BACKUP_DIR", "").strip() or data_dir("backups"))


def _daily_care() -> None:
    """Once a day: delete what the privacy notice says goes, then (pilot) back everything up, kept 14 days."""
    now = datetime.now(timezone.utc)
    conn = db.connect(db_path())
    try:
        row = conn.execute("SELECT value FROM settings WHERE key = 'records_swept_at'").fetchone()
        if row and now - datetime.fromisoformat(row[0]) < timedelta(hours=23):
            return
        conn.execute("INSERT OR REPLACE INTO settings (key, value) VALUES ('records_swept_at', ?)", (now.isoformat(timespec="seconds"),))
        conn.commit()
    finally:
        conn.close()
    sweep_records(now)
    if not demo_mode():
        made = backup.backup_now(db_path(), backup_dir(), {name: data_dir(name) for name in ("photos", "compare")}, now)
        log.info("backup written: %s", made.name)


async def _voice_sweeper() -> None:
    """Delete expired voice notes every hour while the server runs, not only at start-up or when a chat opens."""
    while True:
        await asyncio.sleep(VOICE_SWEEP_SECONDS)
        try:
            await asyncio.to_thread(_sweep_once)
        except Exception:  # never let a clean-up error stop the server
            log.exception("voice clean-up failed")


class BodyLimit:
    """Counts request bytes as they arrive, so a body sent without Content-Length (a chunked upload) is cut off at
    the cap too; the guard below only sees the header. It must be the innermost middleware: the 413 is raised from
    receive() straight into FastAPI's body parsing, which passes HTTPExceptions on. Wrapped by the guard's task
    group instead, it would turn into a generic 400."""

    def __init__(self, app: Any, limit: int) -> None:
        self.app, self.limit = app, limit

    async def __call__(self, scope: dict[str, Any], receive: Any, send: Any) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        seen = 0

        async def counted() -> dict[str, Any]:
            nonlocal seen
            message = await receive()
            if message["type"] == "http.request":
                seen += len(message.get("body", b""))
                if seen > self.limit:
                    raise HTTPException(413, "Request too large. Photos must be under 12 MB.")
            return message

        await self.app(scope, counted, send)


app = FastAPI(title="Keynection prototype API", version="0.2.0", lifespan=lifespan)


async def _sign_in_guard(request: Request) -> None:
    await _check_access(request)  # defined with the sign-in endpoints below


app.router.dependencies.append(Depends(_sign_in_guard))  # every route declared after this line is guarded
app.add_middleware(BodyLimit, limit=MAX_REQUEST_BYTES)  # added first = innermost (see the class)
app.add_middleware(
    CORSMiddleware,
    allow_origins=(setting("ALLOWED_ORIGINS") or "http://localhost:5173,http://127.0.0.1:5173").split(","),
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
)


SITE_COOKIE = "keynection_site"
# Browsers that passed the password page before the rename hold the old cookie: it still works, and is swapped for
# the new one on their next visit, so nobody has to type the password again.
OLD_SITE_COOKIE = "jiran5_site"
SITE_COOKIE_SECONDS = 30 * 24 * 3600
SITE_LOGIN_PATH = "/site-login"
SITE_LOGIN_MAX_BYTES = 4096  # a one-field form; anything bigger is not a person typing a password


def _site_password() -> str | None:
    """Online the prototype sits behind one shared password: it has no sign-in, so without this anyone with the
    link could reset the demo or upload files. Not set (local runs): the site is open, as before."""
    return setting("SITE_PASSWORD") or None


def _site_token(password: str, context: bytes = b"keynection-site-v1") -> str:
    """What the browser keeps after the password page: a keyed hash, never the password. A new password signs
    everyone out."""
    return hmac.new(password.encode(), context, hashlib.sha256).hexdigest()


def _site_password_ok(request: Request) -> bool:
    password = _site_password()
    if not password or request.url.path == "/api/health":  # the host's health check needs no password
        return True
    cookie = request.cookies.get(SITE_COOKIE, "")
    if cookie and hmac.compare_digest(cookie.encode(), _site_token(password).encode()):
        return True
    old = request.cookies.get(OLD_SITE_COOKIE, "")
    if old and hmac.compare_digest(old.encode(), _site_token(password, b"jiran5-site-v1").encode()):
        request.state.old_site_cookie = True  # valid: swap it for the new one on the way out
        return True
    # Scripts may send the password as HTTP Basic (any user name). Responses never ask for it, so browsers do not
    # pop their own login box, which some in-app browsers cannot show at all.
    scheme, _, encoded = request.headers.get("authorization", "").partition(" ")
    if scheme.lower() != "basic":
        return False
    try:
        _, _, given = base64.b64decode(encoded, validate=True).decode("utf-8").partition(":")
    except (ValueError, UnicodeDecodeError):
        return False
    return secrets.compare_digest(given.encode(), password.encode())


SITE_LOGIN_PAGE = """<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Keynection · password</title>
<style>
  :root { --brand: #e0603e; --brand-strong: #c94c2a; --ink: #0d2240; --muted: #66758a; --bg: #f2f4f7;
          --surface: #fff; --line: rgba(13, 34, 64, 0.15); --bad: #b42318; --bad-bg: #fef3f2; }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 16px; background: var(--bg);
         color: var(--ink); font: 16px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, "Noto Sans SC",
         "Microsoft YaHei", sans-serif; }
  main { width: 100%; max-width: 400px; background: var(--surface); border: 1px solid var(--line);
         border-radius: 16px; padding: 28px 24px; box-shadow: 0 12px 32px -20px rgba(13, 34, 64, 0.4); }
  .logo { font-weight: 800; font-size: 26px; letter-spacing: -0.02em; margin: 0 0 14px; }
  .logo span { color: var(--brand); }
  p { margin: 0 0 4px; }
  .other { color: var(--muted); font-size: 15px; }
  label { display: block; font-weight: 600; margin: 20px 0 6px; }
  input { width: 100%; font: inherit; padding: 12px 14px; border: 1px solid var(--line); border-radius: 10px; }
  input:focus { outline: 3px solid rgba(224, 96, 62, 0.3); border-color: var(--brand); }
  button { width: 100%; margin-top: 14px; font: inherit; font-weight: 700; color: #fff; background: var(--brand-strong);
           border: 0; border-radius: 10px; padding: 12px; cursor: pointer; }
  .error { margin-top: 16px; padding: 10px 12px; border-radius: 10px; background: var(--bad-bg); color: var(--bad); }
  .note { margin-top: 18px; font-size: 13px; color: var(--muted); }
</style></head>
<body><main>
  <div class="logo"><span>Key</span>nection</div>
  <p>This is a private demo. Enter the password from the Keynection team.</p>
  <p class="other" lang="ms">Ini demo peribadi. Masukkan kata laluan daripada pasukan Keynection.</p>
  <p class="other" lang="zh">这是内部演示，请输入 Keynection 团队给你的密码。</p>
  {error}
  <form method="post" action="/site-login">
    <label for="password">Password · Kata laluan · 密码</label>
    <input id="password" name="password" type="password" autocomplete="current-password" required autofocus>
    <button type="submit">Enter · Masuk · 进入</button>
  </form>
  <p class="note">This browser stays signed in for 30 days. · Pelayar ini kekal log masuk selama 30 hari. ·
    这个浏览器会记住 30 天。</p>
</main></body></html>
"""

SITE_LOGIN_ERROR = ('<p class="error" role="alert">Wrong password. Please try again. · '
                    "Kata laluan salah. Cuba lagi. · 密码不对，请再试一次。</p>")


def _site_login_page(wrong: bool = False) -> HTMLResponse:
    return HTMLResponse(SITE_LOGIN_PAGE.replace("{error}", SITE_LOGIN_ERROR if wrong else ""), status_code=401,
                        headers={"Cache-Control": "no-store"})


async def _site_login(request: Request) -> HTMLResponse | RedirectResponse:
    """The password page's form. Right: remember this browser and go to the app. Wrong: the page again."""
    password = _site_password() or ""
    body = b""
    async for chunk in request.stream():
        body += chunk
        if len(body) > SITE_LOGIN_MAX_BYTES:
            return _site_login_page(wrong=True)
    given = parse_qs(body.decode("utf-8", "replace")).get("password", [""])[0]
    if not given or not secrets.compare_digest(given.encode(), password.encode()):
        await asyncio.sleep(0.5)  # slows guessing a little; the password itself is long
        return _site_login_page(wrong=True)
    response = RedirectResponse("/", status_code=303)
    secure = request.headers.get("x-forwarded-proto", request.url.scheme) == "https"  # the host ends HTTPS
    response.set_cookie(SITE_COOKIE, _site_token(password), max_age=SITE_COOKIE_SECONDS, httponly=True,
                        samesite="lax", secure=secure, path="/")
    return response


def _moved_to(request: Request) -> RedirectResponse | None:
    """KEYNECTION_MOVED_TO on a server that changed address: every visit goes to the same page at the new one
    (links already shared keep working). The host's health check still answers here."""
    target = (setting("MOVED_TO") or "").strip().rstrip("/")
    if not target or request.url.path == "/api/health":
        return None
    query = f"?{request.url.query}" if request.url.query else ""
    return RedirectResponse(f"{target}{request.url.path}{query}", status_code=307)


@app.middleware("http")
async def guard(request: Request, call_next):
    moved = _moved_to(request)
    if moved is not None:
        return moved
    if _site_password() and request.url.path == SITE_LOGIN_PATH and request.method == "POST":
        response = await _site_login(request)
    elif not _site_password_ok(request):
        if request.url.path.startswith("/api/"):
            response = JSONResponse({"detail": "This demo needs the password from the Keynection team."}, status_code=401)
        else:  # a page visit: our own password page, in all three languages
            response = _site_login_page()
    elif _site_password() and request.url.path == SITE_LOGIN_PATH:  # already signed in, e.g. a reload
        response = RedirectResponse("/", status_code=303)
    else:
        length = request.headers.get("content-length")
        if length and length.isdigit() and int(length) > MAX_REQUEST_BYTES:
            return JSONResponse({"detail": "Request too large. Photos must be under 12 MB."}, status_code=413)
        response = await call_next(request)
    if getattr(request.state, "old_site_cookie", False):
        secure = request.headers.get("x-forwarded-proto", request.url.scheme) == "https"
        response.set_cookie(SITE_COOKIE, _site_token(_site_password() or ""), max_age=SITE_COOKIE_SECONDS, httponly=True,
                            samesite="lax", secure=secure, path="/")
        response.delete_cookie(OLD_SITE_COOKIE, path="/")
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("X-Frame-Options", "DENY")
    response.headers.setdefault("Referrer-Policy", "no-referrer")
    response.headers.setdefault("X-Robots-Tag", "noindex, nofollow")  # a prototype: keep it out of search results
    if response.headers.get("content-type", "").startswith("text/html"):
        # Ask the server every time, so a stored copy of the app never skips the password check above.
        response.headers.setdefault("Cache-Control", "no-cache")
    return response


# ---------- the shared demo ----------
# The online demo is one database for everyone who opens it. After a quiet spell it starts over by itself, so the
# next visitor begins from the fictional phase as seeded, not from the last visitor's clicks; and the per-day limits
# that keep a real neighbour from becoming a nuisance are loosened, so one visitor's wave or notice doesn't block
# the next. A pilot never resets and keeps every limit as it is.
DEMO_IDLE_MINUTES = 20  # KEYNECTION_DEMO_IDLE_MINUTES overrides it
DEMO_WAVE_WINDOW = timedelta(minutes=5)  # a pilot: one wave per neighbour per day
DEMO_CAP_FACTOR = 10  # hellos, notices and waves a day
_last_request: float | None = None  # time.monotonic() of the last API request; None since start-up
_idle_lock = threading.Lock()


def demo_idle_seconds() -> float:
    return float(setting("DEMO_IDLE_MINUTES", str(DEMO_IDLE_MINUTES))) * 60


def daily_cap(per_day: int) -> int:
    return per_day * DEMO_CAP_FACTOR if demo_mode() else per_day


def wave_window() -> timedelta:
    return DEMO_WAVE_WINDOW if demo_mode() else timedelta(days=1)


def _reset_demo_data(conn: sqlite3.Connection) -> None:
    db.drop_all(conn)
    for folder in ("photos", "compare", "voice"):
        shutil.rmtree(data_dir(folder))
    db.init_db(conn)
    ai.reset()  # the daily AI allowance starts over with the households


def start_over_if_idle(conn: sqlite3.Connection) -> bool:
    """Demo mode only: when the last request was a quiet spell ago, rebuild the fictional data before this one."""
    global _last_request
    if not demo_mode():
        return False
    now = time.monotonic()
    with _idle_lock:
        quiet = _last_request is not None and now - _last_request > demo_idle_seconds()
        _last_request = now
        if quiet:
            _reset_demo_data(conn)
            log.info("demo data started over after a quiet spell")
        return quiet


def get_conn() -> Iterator[sqlite3.Connection]:
    conn = db.connect(db_path())
    try:
        start_over_if_idle(conn)
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
    return {"id": row["id"], "phase_id": row["phase_id"], "kind": row["kind"], "label": row["label"], "street": row["street"],
            "resident_name": row["resident_name"], "row": row["terrace_row"], "facing_row": row["facing_row"],
            "block": row["block"], "floor": row["floor"], "pos": row["pos"], "lang": row["lang"],
            "handover_date": row["handover_date"], "joined": row["joined_at"] is not None}


def _require_joined(conn: sqlite3.Connection, unit_id: str, message: str | None = None) -> sqlite3.Row:
    """A household takes part only after it joins and agrees to the privacy notice. Until then nobody can
    message it, and it can't act in Keynection (the estate office delivers formal notices to it on paper)."""
    row = _unit_row(conn, unit_id)
    if row["joined_at"] is None:
        raise HTTPException(409, {"code": "not_joined", "message": message or
                                  f"{row['label']} isn't on Keynection yet. The estate office delivers formal notices to them on paper."})
    return row


def _consent_version() -> str:
    """The privacy notice shown at joining: with AI on it says what is translated, by whom, and where."""
    return {"anthropic": CONSENT_VERSION_AI, "gemini": CONSENT_VERSION_AI_GEMINI}.get(ai.provider(), CONSENT_VERSION)


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


def _intro_in(row: sqlite3.Row, lang: str) -> dict[str, str | None] | None:
    """Claude's translation of a hello or notice for a reader of lang, if there is one: {"message", "scope"}."""
    return json.loads(row["translations"] or "{}").get(lang)


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
        "response_note": row["response_note"], "proposed_at": row["proposed_at"],
        "proposed_by": row["reporter_unit_id"] if row["proposed_at"] else None,
        "decided_by": row["decided_by"], "decided_at": row["decided_at"], "created_at": row["created_at"],
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

class TimeWindow(BaseModel):
    start: str = Field(..., pattern=HHMM)
    end: str = Field(..., pattern=HHMM)


class QuietTime(TimeWindow):
    # Kept private: the reason helps the household remember, nobody else ever sees it.
    why: Literal["baby", "night_shift", "work_from_home", "elderly", "other"] | None = None


class QuietTimesIn(BaseModel):
    windows: list[QuietTime] = Field(default_factory=list, max_length=quiet.MAX_QUIET_WINDOWS + 3)

    @model_validator(mode="after")
    def fair(self) -> "QuietTimesIn":
        problem = quiet.check_windows([w.model_dump() for w in self.windows])
        if problem:
            raise ValueError(problem)
        return self


class Renovation(BaseModel):
    scope: str = Field(..., min_length=1, max_length=120, examples=["Extend kitchen (rear wall)"])
    start: str = Field(..., pattern=DATE, examples=["2026-10-15"])
    end: str = Field(..., pattern=DATE, examples=["2026-10-30"])
    noisy_hours: str = Field("weekdays 9am-5pm, no weekends", max_length=160)  # the English record, quiet breaks included
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
    # Times inside the noisy hours kept quiet for neighbours (planned from their quiet times, see quiet.py).
    quiet_breaks: list[TimeWindow] = Field(default_factory=list, max_length=4)

    @model_validator(mode="after")
    def check_order(self) -> "Renovation":
        try:
            start, end = date.fromisoformat(self.start), date.fromisoformat(self.end)
        except ValueError:
            raise ValueError("start and end must be real calendar dates") from None
        if end < start:
            raise ValueError("end date is before start date")
        if (end - start).days > MAX_RENOVATION_DAYS:
            raise ValueError(f"a renovation notice can cover at most {MAX_RENOVATION_DAYS} days; send a new one after that")
        if self.noisy_to <= self.noisy_from:
            raise ValueError("noisy hours end before they start")
        # The estate's house rule: noisy work only inside the hours it allows. Which days is the owner's own choice
        # (weekdays_only). HH:MM strings compare in time order because HHMM keeps them zero-padded, 24-hour.
        if self.noisy_from < quiet.LEGAL_FROM or self.noisy_to > quiet.LEGAL_TO:
            raise ValueError(quiet.HOUSE_RULE_HOURS)
        breaks = sorted((b.start, b.end) for b in self.quiet_breaks)
        if any(not self.noisy_from < a < b < self.noisy_to for a, b in breaks):
            raise ValueError("a quiet break must sit inside the noisy hours")
        if any(breaks[i][1] > breaks[i + 1][0] for i in range(len(breaks) - 1)):
            raise ValueError("quiet breaks overlap")
        return self


class IntroIn(BaseModel):
    from_unit_id: str = Field(..., pattern=UNIT_ID)
    message: str = Field(..., min_length=1, max_length=1000)
    lang: ReadLang = "en"
    renovation: Renovation | None = None
    # A hello can go to part of the circle; a renovation notice always goes to the whole impact zone.
    to_unit_ids: list[str] | None = Field(None, max_length=8)
    delegate_id: int | None = None


class AckIn(BaseModel):
    unit_id: str = Field(..., pattern=UNIT_ID)


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
    unit_id: str = Field(..., pattern=UNIT_ID)
    # "dispute" is the renovating owner's answer when the neighbour says their works caused the change.
    decision: Literal["renovation", "warranty", "inspect", "no_action", "dispute"]
    # Accepted only so it can be refused: an inspector's finding comes from SDP, never from a resident.
    decided_by: Literal["both_owners", "sdp_inspector"] | None = None
    delegate_id: int | None = None
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
    """For the host's health checks. On Render it also names the branch and commit it runs (Render sets both), so
    anyone can see which version is live after a deploy."""
    running = {"version": os.environ.get("RENDER_GIT_COMMIT", "")[:7], "branch": os.environ.get("RENDER_GIT_BRANCH", "")}
    return {"status": "ok", **{k: v for k, v in running.items() if v}}


def _phase_json(conn: sqlite3.Connection, row: sqlite3.Row) -> dict[str, Any]:
    homes = conn.execute("SELECT * FROM units WHERE phase_id = ?", (row["id"],)).fetchall()
    return {"id": row["id"], "name": row["name"], "note": row["note"], "imported_by": row["imported_by"],
            "imported_at": row["imported_at"], "homes": len(homes), "joined": sum(h["joined_at"] is not None for h in homes),
            "streets": sorted({h["street"] for h in homes if h["kind"] == "terrace" and h["street"]}),
            "blocks": sorted({h["block"] for h in homes if h["kind"] == "apartment" and h["block"]})}


def _phase_id(conn: sqlite3.Connection, phase_id: str | None) -> str:
    """The phase a listing or an SDP screen is about: the one asked for; otherwise the fictional phase in demo mode,
    or in a pilot the household's own phase, or the only phase there is."""
    if phase_id:
        if conn.execute("SELECT 1 FROM phases WHERE id = ?", (phase_id,)).fetchone() is None:
            raise HTTPException(404, "phase not found")
        return phase_id
    if demo_mode():
        return "demo"
    actor = _current_actor.get()
    if actor is not None and actor.unit_id:
        return _unit_row(conn, actor.unit_id)["phase_id"]
    ids = [r["id"] for r in conn.execute("SELECT id FROM phases ORDER BY id")]
    if not ids:
        raise HTTPException(409, {"code": "no_phase", "message": "No phase yet: import SDP's handover list in Phase setup."})
    if len(ids) > 1:
        raise HTTPException(422, {"code": "phase", "message": "Choose a phase."})
    return ids[0]


def _place_name(conn: sqlite3.Connection, phase_id: str) -> str:
    row = conn.execute("SELECT name FROM phases WHERE id = ?", (phase_id,)).fetchone()
    return row["name"] if row else "Keynection"


@app.get("/api/phases")
def phases(conn: sqlite3.Connection = Depends(get_conn)) -> list[dict[str, Any]]:
    """The phases, with their streets and blocks (for notices). A household in a pilot sees its own phase only."""
    actor = _current_actor.get()
    rows = conn.execute("SELECT * FROM phases ORDER BY name").fetchall()
    if not demo_mode() and actor is not None and actor.unit_id:
        mine = _unit_row(conn, actor.unit_id)["phase_id"]
        rows = [r for r in rows if r["id"] == mine]
    return [_phase_json(conn, r) for r in rows]


@app.get("/api/units")
def units(phase_id: str | None = None, conn: sqlite3.Connection = Depends(get_conn)) -> list[dict[str, Any]]:
    """The phase layout. Names are included in demo mode (for the demo cast); in a pilot only for the household's
    own home and for the estate office, which already holds the handover list. A real deployment never exposes a
    resident directory. Who is renovating is not here either: see /directory."""
    actor = _current_actor.get()
    rows = conn.execute("SELECT * FROM units WHERE phase_id = ? ORDER BY id", (_phase_id(conn, phase_id),)).fetchall()
    named = lambda r: demo_mode() or (actor is not None and (actor.is_staff or actor.unit_id == r["id"]))  # noqa: E731
    return [_unit_json(r) if named(r) else _unit_public(r) for r in rows]


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
            "ring2_label": (me["street"] or "") if me["kind"] == "terrace" else f"Block {me['block']}",
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


def _quiet_times(conn: sqlite3.Connection, unit_id: str) -> list[dict[str, Any]]:
    row = conn.execute("SELECT quiet_times FROM profiles WHERE unit_id = ?", (unit_id,)).fetchone()
    return json.loads(row["quiet_times"]) if row else []


@app.get("/api/units/{unit_id}/quiet-times")
def get_quiet_times(unit_id: str, conn: sqlite3.Connection = Depends(get_conn)) -> dict[str, Any]:
    """A household's own quiet times. Private: used only to plan the noisy hours of renovations that reach it."""
    _unit_row(conn, unit_id)
    return {"windows": _quiet_times(conn, unit_id), "max_windows": quiet.MAX_QUIET_WINDOWS,
            "max_minutes": quiet.MAX_QUIET_MINUTES}


@app.put("/api/units/{unit_id}/quiet-times")
def set_quiet_times(unit_id: str, body: QuietTimesIn, conn: sqlite3.Connection = Depends(get_conn)) -> dict[str, Any]:
    _require_joined(conn, unit_id)
    windows = sorted((w.model_dump() for w in body.windows), key=lambda w: w["start"])
    conn.execute("UPDATE profiles SET quiet_times = ?, quiet_times_at = ? WHERE unit_id = ?",
                 (json.dumps(windows), db.now(), unit_id))
    conn.commit()
    return get_quiet_times(unit_id, conn)


def _double_works(conn: sqlite3.Connection, unit_id: str, zone: list[str], start: date, end: date) -> dict[str, Any] | None:
    """Homes this renovation would reach that another renovation already reaches on some of the same days, so they
    would have works on two sides at once. Says how many and the first start date that avoids it, never whose works."""
    others = []
    for r in conn.execute("SELECT i.renovation, x.unit_id FROM intros i JOIN intro_recipients x ON x.intro_id = i.id"
                          " WHERE i.renovation IS NOT NULL AND i.from_unit_id != ?", (unit_id,)):
        if r["unit_id"] in zone:
            reno = json.loads(r["renovation"])
            others.append((r["unit_id"], date.fromisoformat(reno["start"]), date.fromisoformat(reno["end"])))
    homes = {h for h, a, b in others if a <= end and start <= b}
    if not homes:
        return None
    length, clear = end - start, start
    for _ in range(len(others) + 1):  # each step moves past at least one other renovation
        hit = [b for _, a, b in others if a <= clear + length and clear <= b]
        if not hit:
            break
        clear = max(hit) + timedelta(days=1)
    return {"homes": len(homes), "clear_from": clear.isoformat()}


@app.get("/api/units/{unit_id}/quiet-plan")
def quiet_plan(unit_id: str, start: str = Query(..., pattern=DATE), end: str = Query(..., pattern=DATE),
               works_type: Literal["wet", "hacking", "structural", "light"] = "hacking",
               noisy_from: str = Query("09:00", pattern=HHMM), noisy_to: str = Query("17:00", pattern=HHMM),
               conn: sqlite3.Connection = Depends(get_conn)) -> dict[str, Any]:
    """Noisy hours planned around the quiet times of every home this renovation would reach, and whether any of them
    would have works on two sides at once. The owner sees times and counts, never whose they are or why."""
    try:
        first, last = date.fromisoformat(start), date.fromisoformat(end)
    except ValueError:
        raise HTTPException(422, "start and end must be real calendar dates") from None
    if last < first or noisy_to <= noisy_from:
        raise HTTPException(422, "The dates or the noisy hours are the wrong way round.")
    if noisy_from < quiet.LEGAL_FROM or noisy_to > quiet.LEGAL_TO:  # the house rule, the same check the notice gets
        raise HTTPException(422, quiet.HOUSE_RULE_HOURS)
    me, _, phase_units = _phase(conn, unit_id)
    zone = [n.unit_id for n in impact_zone(_to_unit(me), phase_units, works_type)]
    plan = quiet.plan(noisy_from, noisy_to, [_quiet_times(conn, u) for u in zone])
    return {**plan, "double_works": _double_works(conn, unit_id, zone, first, last)}


class RenovationTextIn(BaseModel):
    unit_id: str = Field(..., pattern=UNIT_ID)
    text: str = Field(..., min_length=1, max_length=500)


@app.get("/api/ai")
def ai_status() -> dict[str, Any]:
    """Whether Claude is on for translation and notice writing, so the app can say so, and fall back when it isn't."""
    return ai.status()


@app.post("/api/ai/renovation-draft")
def renovation_draft(body: RenovationTextIn, conn: sqlite3.Connection = Depends(get_conn)) -> dict[str, Any]:
    """The owner says what they are doing in one sentence, in any language; Claude fills in the notice for them to
    check. Nothing is sent from here: the owner still goes through the steps and presses send."""
    me = _unit_row(conn, body.unit_id)
    if not ai.enabled():
        raise HTTPException(503, {"code": "ai_off", "message": "AI isn't switched on here. Fill in the steps below."})
    if not ai.spend(body.unit_id):
        raise HTTPException(429, "That's all the AI help for today. Fill in the steps below.")
    draft = ai.draft_renovation(body.text.strip(), me["kind"], date.fromisoformat(_today()), MAX_RENOVATION_DAYS)
    if draft is None:
        raise HTTPException(503, {"code": "ai_busy", "message": "The AI didn't answer in time. Try again, or fill in the steps below."})
    return draft


@app.post("/api/intros", status_code=201)
def send_intro(body: IntroIn, conn: sqlite3.Connection = Depends(get_conn)) -> dict[str, Any]:
    _require_joined(conn, body.from_unit_id)
    # A hello or notice reaches several homes at once, so it gets at least the checks a chat message gets.
    if talk.tone_problem(body.message):
        raise HTTPException(422, {"code": "tone", "message": TONE_MESSAGE})
    # Numbers are swapped only when both households agree. A renovation notice is the exception: CIDB's
    # Hak Jiran guidance says to give neighbours the contractor's contact for complaints.
    if body.renovation is None and talk.contact_details(body.message):
        raise HTTPException(422, {"code": "private", "message": PRIVATE_MESSAGE})
    since = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat(timespec="seconds")
    kind = "NOT NULL" if body.renovation else "NULL"
    sent = conn.execute(f"SELECT COUNT(*) FROM intros WHERE from_unit_id = ? AND created_at > ? AND renovation IS {kind}",
                        (body.from_unit_id, since)).fetchone()[0]
    limit = daily_cap(MAX_RENOVATION_NOTICES_PER_DAY if body.renovation else MAX_HELLOS_PER_DAY)
    if sent >= limit:
        raise HTTPException(429, f"At most {limit} {'renovation notices' if body.renovation else 'hellos'} a day. Try again tomorrow.")
    sent_by = _delegate_name(conn, body.from_unit_id, body.delegate_id)
    return _register_intro(conn, body.from_unit_id, body.message, body.lang,
                           body.renovation.model_dump() if body.renovation else None, body.to_unit_ids, sent_by)


def _register_intro(conn: sqlite3.Connection, from_unit_id: str, message: str, lang: str, renovation: dict[str, Any] | None,
                    to_unit_ids: list[str] | None, sent_by: str | None) -> dict[str, Any]:
    me, rows, phase_units = _phase(conn, from_unit_id)
    if renovation and renovation["works_type"] == "structural":
        # The same rule the app shows: structural work waits for its approval (JMB/MC in strata, the council otherwise).
        approved = (renovation.get("management_approval") if me["kind"] == "apartment" else renovation.get("council_permit")) == "approved"
        if not approved:
            raise HTTPException(422, "Structural work needs approval first: the council (PBT) permit, or the JMB/MC in a strata building.")
    if renovation:
        # The notice goes to everyone the work can affect; the sender cannot leave anyone out. Homes not on
        # Keynection are still on the list: the estate office prints their notice and records the delivery.
        circle = [{"id": n.unit_id, "relation": n.relation} for n in impact_zone(_to_unit(me), phase_units, renovation["works_type"])]
    else:
        circle = [n for n in _circle(conn, from_unit_id) if n["joined"]]  # a hello only reaches people who joined
        if to_unit_ids is not None:
            allowed = {n["id"] for n in circle}
            if not set(to_unit_ids) <= allowed:
                raise HTTPException(403, "An introduction can only go to the homes in your circle that are on Keynection.")
            circle = [n for n in circle if n["id"] in to_unit_ids]
        if not circle:
            raise HTTPException(422, "Pick at least one neighbour.")
    shown = [n["id"] for n in circle]  # who the sender is told the hello went to
    if not renovation:
        # Same gate as a chat message: quiet mode holds a hello back, and so does the sender's own block.
        circle = [n for n in circle if not _profile_row(conn, n["id"])["quiet_mode"] and not _blocked(conn, from_unit_id, n["id"])]
        if not circle:
            raise HTTPException(409, "These neighbours have quiet mode on right now. Try again later.")
        shown = [n["id"] for n in circle]
        # Someone who blocked the sender never gets it, and the sender isn't told (that would reveal the block).
        circle = [n for n in circle if not _blocked(conn, n["id"], from_unit_id)]
    # Each neighbour reads it in their own language (paper notices too). Asked before anything is written, so no
    # lock is held while Claude answers; with no answer the notice goes as written.
    readers = {rows[n["id"]]["lang"] for n in circle} - {lang}
    translations = ai.translate_notice(from_unit_id, message, renovation["scope"] if renovation else None, readers) \
        if readers and ai.enabled() else {}
    cur = conn.execute(
        "INSERT INTO intros (from_unit_id, message, lang, renovation, sent_by, translations, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        (from_unit_id, message, lang, json.dumps(renovation) if renovation else None, sent_by,
         json.dumps(translations, ensure_ascii=False) if translations else None, db.now()),
    )
    intro_id = cur.lastrowid
    paper = []
    kept = {"avoided": 0, "overlap": 0}
    for n in circle:
        # Whether the noisy hours keep clear of this home's quiet times, fixed now: what the neighbour was told
        # stays the same if either side edits something later.
        state = quiet.respected(renovation, _quiet_times(conn, n["id"])) if renovation else None
        if state:
            kept[state] += 1
        conn.execute("INSERT INTO intro_recipients (intro_id, unit_id, relation, quiet) VALUES (?, ?, ?, ?)",
                     (intro_id, n["id"], n["relation"], state))
        if renovation and rows[n["id"]]["joined_at"] is None:
            conn.execute("INSERT INTO paper_notices (intro_id, unit_id, created_at) VALUES (?, ?, ?)", (intro_id, n["id"], db.now()))
            paper.append(n["id"])
    if renovation:
        db.append_event(conn, from_unit_id, "renovation_registered",
                        {**renovation, "neighbours_notified": [n["id"] for n in circle], "quiet_times": kept,
                         **({"paper_notice_for": paper} if paper else {}), **({"acted_by": sent_by} if sent_by else {})})
    conn.commit()
    return {"id": intro_id, "recipients": shown, "paper_notices": paper}


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
        if not n["joined"]:
            # Not on Keynection yet: no name (resident_name is the unit label), no language, no bio, nothing to tap.
            out.append({**n, "lang": None, "known": False, "bio": "", "waved_today": False, "allow_waves": False})
            continue
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
        recent = (datetime.now(timezone.utc) - wave_window()).isoformat(timespec="seconds")
        waved = conn.execute("SELECT 1 FROM waves WHERE from_unit_id = ? AND to_unit_id = ? AND created_at > ?",
                             (unit_id, n["id"], recent)).fetchone() is not None
        out.append({**n, "known": they_replied or i_replied or _mutual(conn, unit_id, n["id"]), "bio": _profile_row(conn, n["id"])["bio"],
                    "waved_today": waved, "allow_waves": bool(_profile_row(conn, n["id"])["allow_waves"])})
    return {"unit_id": unit_id, "neighbours": out, "known_count": sum(n["known"] for n in out),
            "not_joined": sum(not n["joined"] for n in out)}


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
SERVICE = "Keynection"  # automatic case updates: never signed as SDP, so they can't read as SDP's view
PRIVATE_MESSAGE = ("Please don't put phone numbers, emails or links here. "
                   "Exchange numbers in a chat when you both agree.")
TONE_MESSAGE = ("This may come across as hostile. Try calmer words or a quick reply: messages stay on record "
                "and can be reported.")
CALMER_MESSAGE = "This may sound sharper than you mean. Here is a calmer way to say the same thing."


class MessageIn(BaseModel):
    from_unit_id: str = Field(..., pattern=UNIT_ID)
    to_unit_id: str = Field(..., pattern=UNIT_ID)
    body: str | None = Field(None, max_length=500)
    quick_key: str | None = Field(None, pattern=r"^[a-z_]{1,30}$")
    delegate_id: int | None = None
    # Send these words even though a calmer wording was offered: the suggestion is advice. Insults are still refused.
    keep_tone: bool = False

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
    partners = {n["id"]: n for n in _circle(conn, unit_id) if n["joined"]}
    today = datetime.now(MALAYSIA).date()
    for r in conn.execute(
        "SELECT i.from_unit_id, i.renovation, r.unit_id, r.relation FROM intro_recipients r JOIN intros i ON i.id = r.intro_id"
        " WHERE i.renovation IS NOT NULL AND (i.from_unit_id = ? OR r.unit_id = ?)", (unit_id, unit_id),
    ):
        # A renovation links homes beyond the circle only while it matters: until a month after the work ends.
        try:
            ends = date.fromisoformat(json.loads(r["renovation"]).get("end", ""))
        except ValueError:
            continue
        if ends + timedelta(days=RENOVATION_TALK_DAYS) < today:
            continue
        other, rel = (r["unit_id"], r["relation"]) if r["from_unit_id"] == unit_id else (r["from_unit_id"], inverse_relation(r["relation"]))
        if other not in partners and _unit_row(conn, other)["joined_at"] is not None:
            partners[other] = {**_unit_json(_unit_row(conn, other)), "relation": rel}
    for r in conn.execute("SELECT * FROM contact_requests WHERE status = 'accepted' AND (from_unit_id = ? OR to_unit_id = ?)",
                          (unit_id, unit_id)):
        other = r["to_unit_id"] if r["from_unit_id"] == unit_id else r["from_unit_id"]
        if other not in partners:
            partners[other] = {**_unit_json(_unit_row(conn, other)), "relation": "contact"}
    return list(partners.values())


def _require_neighbours(conn: sqlite3.Connection, unit_id: str, other_id: str) -> dict[str, Any]:
    _require_joined(conn, unit_id)
    _require_joined(conn, other_id)
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


def _system_message(conn: sqlite3.Connection, to_unit: str, thread_with: str, text: str, private: bool = False,
                    author: str = ESTATE, code: str | None = None, values: dict[str, str] | None = None) -> None:
    """An automatic notice in a thread. text is the English record; code and values let each reader see it in
    their own language."""
    conn.execute(
        "INSERT INTO messages (from_unit_id, to_unit_id, thread_with, kind, body, lang, author, private, sys_code, sys_values, created_at)"
        " VALUES (NULL, ?, ?, 'system', ?, 'en', ?, ?, ?, ?, ?)",
        (to_unit, thread_with, text, author, int(private), code, json.dumps(values or {}), db.now()),
    )


def _message_json(row: sqlite3.Row, viewer_lang: str, reactions: list[dict[str, Any]] | None = None,
                  viewer: str | None = None) -> dict[str, Any]:
    out = {"type": "message", "id": row["id"], "kind": row["kind"], "from_unit_id": row["from_unit_id"],
           "to_unit_id": row["to_unit_id"], "author": row["author"], "text": row["body"], "lang": row["lang"],
           "translated": False, "by_ai": False, "original": None, "created_at": row["created_at"], "read_at": row["read_at"],
           "reactions": reactions or [], "duration": int(row["body"]) if row["kind"] == "voice" else None,
           "expired": row["kind"] == "voice" and not row["media_id"], "sent_by": row["sent_by"],
           "code": row["sys_code"], "values": json.loads(row["sys_values"] or "{}")}
    if row["kind"] == "voice":
        out["text"] = "Voice message"
    if row["kind"] == "quick" and row["quick_key"] in talk.QUICK_REPLIES:
        out["text"] = talk.quick_text(row["quick_key"], viewer_lang)
        out["translated"] = viewer_lang != row["lang"]
        out["original"] = row["body"] if out["translated"] else None
    # A typed message reaches its reader in Claude's translation; the sender sees their own words.
    translated = json.loads(row["translations"] or "{}").get(viewer_lang) if row["kind"] == "text" and viewer == row["to_unit_id"] else None
    if translated:
        out.update(text=translated, translated=True, by_ai=True, original=row["body"])
    return out


def _concern_row(conn: sqlite3.Connection, concern_id: int) -> sqlite3.Row:
    row = conn.execute("SELECT * FROM concerns WHERE id = ?", (concern_id,)).fetchone()
    if row is None:
        raise HTTPException(404, "concern not found")
    return row


def _concern_json(conn: sqlite3.Connection, row: sqlite3.Row) -> dict[str, Any]:
    raiser, owner = _unit_row(conn, row["from_unit_id"]), _unit_row(conn, row["to_unit_id"])
    reno = _intro(conn, row["intro_id"])["renovation"]
    # Where the moment it was raised falls against the notice: a noise concern shows at once whether it was in the
    # agreed hours, a quiet break, or outside them.
    timing = quiet.timing(reno, datetime.fromisoformat(row["created_at"]).astimezone(MALAYSIA)) if reno else None
    return {"type": "concern", "id": row["id"], "intro_id": row["intro_id"], "scope": reno["scope"] if reno else None,
            "timing": timing,
            "from_unit_id": row["from_unit_id"], "from_label": raiser["label"], "from_name": raiser["resident_name"],
            "to_unit_id": row["to_unit_id"], "to_label": owner["label"], "to_name": owner["resident_name"],
            "category": row["category"], "category_label": talk.CONCERN_CATEGORIES[row["category"]], "note": row["note"],
            "status": row["status"], "response_note": row["response_note"], "estate_note": row["estate_note"],
            "reminders": row["reminders"], "acted_by": row["acted_by"], "created_at": row["created_at"], "acknowledged_at": row["acknowledged_at"],
            "resolved_at": row["resolved_at"], "escalated_at": row["escalated_at"], "closed_at": row["closed_at"]}


def _thread_items(conn: sqlite3.Connection, me: str, other: str, viewer_lang: str) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    for r in conn.execute(
        "SELECT i.*, r.unit_id AS to_unit_id, r.acked_at, r.quiet FROM intros i JOIN intro_recipients r ON r.intro_id = i.id"
        " WHERE (i.from_unit_id = ? AND r.unit_id = ?) OR (i.from_unit_id = ? AND r.unit_id = ?)",
        (me, other, other, me),
    ):
        reno = json.loads(r["renovation"]) if r["renovation"] else None
        item = {"type": "intro", "id": r["id"], "from_unit_id": r["from_unit_id"], "to_unit_id": r["to_unit_id"],
                "text": r["message"], "lang": r["lang"], "acked_at": r["acked_at"], "created_at": r["created_at"], "sent_by": r["sent_by"],
                "renovation": reno, "translated": False, "by_ai": False, "original": None, "original_scope": None,
                "quiet": r["quiet"] if r["to_unit_id"] == me else None}
        mine = _intro_in(r, viewer_lang) if r["to_unit_id"] == me else None
        if mine:
            item.update(text=mine["message"], translated=True, by_ai=True, original=r["message"])
            if reno and mine["scope"]:
                item.update(renovation={**reno, "scope": mine["scope"]}, original_scope=reno["scope"])
        items.append(item)
    for r in conn.execute(
        "SELECT * FROM messages WHERE (from_unit_id = ? AND to_unit_id = ?) OR (from_unit_id = ? AND to_unit_id = ?)"
        " OR (kind = 'system' AND ((to_unit_id = ? AND thread_with = ?) OR (to_unit_id = ? AND thread_with = ?)))",
        (me, other, other, me, me, other, other, me),
    ):
        if r["to_unit_id"] == me and r["withheld"]:
            continue  # sent while I had them blocked
        if r["private"] and r["to_unit_id"] != me:
            continue
        items.append(_message_json(r, viewer_lang, _reactions(conn, r["id"]), viewer=me))
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


def _preview_data(item: dict[str, Any] | None) -> dict[str, Any] | None:
    """The same preview as data, so the chat list can show it in the reader's language."""
    if item is None:
        return None
    if item["type"] == "concern":
        return {"kind": "concern", "category": item["category"]}
    if item["type"] == "intro":
        return {"kind": "renovation"} if item["renovation"] else {"kind": "text", "text": item["text"]}
    if item["type"] == "wave":
        return {"kind": "wave"}
    if item.get("kind") == "voice":
        return {"kind": "voice", "duration": item["duration"]}
    if item.get("kind") == "system" and item.get("code"):
        return {"kind": "system", "code": item["code"], "values": item["values"], "text": item["text"]}
    return {"kind": "text", "text": item["text"]}


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
        out.append({**n, "last": _preview(last), "last_preview": _preview_data(last),
                    "last_at": last["created_at"] if last else None, "unread": unread,
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
def mark_read(unit_id: str, other_id: str, conn: sqlite3.Connection = Depends(get_conn)) -> dict[str, Any]:
    """Opening a thread marks what the other side sent as read. `marked` says how many messages that was, so the
    sender's screen (one tick → two) is refreshed only when something was actually read, never on every open."""
    _require_neighbours(conn, unit_id, other_id)
    marked = conn.execute(
        "UPDATE messages SET read_at = ? WHERE to_unit_id = ? AND read_at IS NULL"
        " AND (from_unit_id = ? OR (kind = 'system' AND thread_with = ?))",
        (db.now(), unit_id, other_id, other_id),
    ).rowcount
    conn.execute("UPDATE waves SET seen_at = ? WHERE to_unit_id = ? AND from_unit_id = ? AND seen_at IS NULL",
                 (db.now(), unit_id, other_id))
    conn.commit()
    return {"ok": True, "marked": marked}


@app.post("/api/messages", status_code=201)
def send_message(body: MessageIn, conn: sqlite3.Connection = Depends(get_conn)) -> dict[str, Any]:
    sender = _unit_row(conn, body.from_unit_id)
    _require_neighbours(conn, body.from_unit_id, body.to_unit_id)
    _check_can_reach(conn, body.from_unit_id, body.to_unit_id)
    _check_daily_limit(conn, body.from_unit_id, body.to_unit_id)
    translations = None
    if body.quick_key:
        if body.quick_key not in talk.QUICK_REPLIES:
            raise HTTPException(404, "unknown quick reply")
        kind, text = "quick", talk.quick_text(body.quick_key, sender["lang"])
    else:
        kind, text = "text", (body.body or "").strip()
        reader_lang = _unit_row(conn, body.to_unit_id)["lang"]
        # One look by Claude: the reader's translation, and a calmer wording if it sounds heated.
        check = ai.check_message(body.from_unit_id, text, reader_lang) if ai.enabled() else None
        calmer = {"suggestion": check.calmer} if check and check.heated and check.calmer else {}
        # Insults are never sent: the word list first, then Claude's own judgement of abuse in any language.
        if talk.tone_problem(text) or (check is not None and check.insult):
            raise HTTPException(422, {"code": "tone", "message": TONE_MESSAGE, **calmer})
        if calmer and not body.keep_tone:
            raise HTTPException(422, {"code": "calmer", "message": CALMER_MESSAGE, **calmer})
        if check and check.translation.strip() and check.translation.strip() != text:
            translations = json.dumps({reader_lang: check.translation.strip()[:1500]}, ensure_ascii=False)
    # If the recipient has blocked the sender, the message is kept (for the record) but never shown to them.
    withheld = int(_blocked(conn, body.to_unit_id, body.from_unit_id))
    sent_by = _delegate_name(conn, body.from_unit_id, body.delegate_id)
    cur = conn.execute(
        "INSERT INTO messages (from_unit_id, to_unit_id, kind, body, quick_key, lang, withheld, sent_by, translations, created_at)"
        " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (body.from_unit_id, body.to_unit_id, kind, text, body.quick_key, sender["lang"], withheld, sent_by, translations, db.now()),
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
        _system_message(conn, unit_id, body.other_unit_id, "Both of you agreed: phone numbers are now shared.",
                        code="contacts_shared")
    conn.commit()
    return {"contact": state}


@app.post("/api/concerns", status_code=201)
def raise_concern(body: ConcernIn, conn: sqlite3.Connection = Depends(get_conn)) -> dict[str, Any]:
    """Step 1 of the ladder: tell the renovating neighbour first, privately and on record."""
    _require_joined(conn, body.from_unit_id)
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


@app.get("/api/estate/concerns", dependencies=[Depends(staff_only)])
def estate_concerns(phase_id: str | None = None, conn: sqlite3.Connection = Depends(get_conn)) -> list[dict[str, Any]]:
    """SDP estate team's view: only concerns a neighbour escalated. Until then a concern stays between the two homes
    (neighbour first, privately), so the estate team never sees, or counts, the ones neighbours settle themselves."""
    rows = conn.execute(
        "SELECT c.* FROM concerns c JOIN units u ON u.id = c.from_unit_id WHERE u.phase_id = ? AND c.escalated_at IS NOT NULL"
        " ORDER BY CASE c.status WHEN 'escalated' THEN 0 ELSE 1 END, c.id DESC",
        (_phase_id(conn, phase_id),),
    ).fetchall()
    per_reno: dict[int, int] = {}
    for r in rows:
        per_reno[r["intro_id"]] = per_reno.get(r["intro_id"], 0) + 1
    return [{**_concern_json(conn, r), "concerns_on_renovation": per_reno[r["intro_id"]]} for r in rows]


@app.post("/api/concerns/{concern_id}/estate", dependencies=[Depends(staff_only)])
def estate_action(concern_id: int, body: EstateActionIn, conn: sqlite3.Connection = Depends(get_conn)) -> dict[str, Any]:
    row = _concern_row(conn, concern_id)
    if row["status"] != "escalated":
        raise HTTPException(409, "Only escalated concerns are handled by the estate team.")
    label = talk.CONCERN_CATEGORIES[row["category"]].lower()
    if body.action == "remind":
        conn.execute("UPDATE concerns SET reminders = reminders + 1, estate_note = ? WHERE id = ?", (body.note, concern_id))
        _system_message(conn, row["to_unit_id"], row["from_unit_id"],
                        f"Reminder from the estate team about {label}: please keep to the house rules and the hours in your "
                        f"renovation notice, and reply here once it's sorted." + (f" Note: {body.note}" if body.note else ""),
                        code="estate_reminder", values={"category": row["category"], "note": body.note})
        payload = {"concern_id": concern_id, "action": "reminder", "note": body.note}
        db.append_event(conn, row["from_unit_id"], "estate_reminder", payload)
        db.append_event(conn, row["to_unit_id"], "estate_reminder", payload)
        conn.commit()
        return _concern_json(conn, _concern_row(conn, concern_id))
    _system_message(conn, row["to_unit_id"], row["from_unit_id"],
                    f"The estate team closed the concern about {label}." + (f" {body.note}" if body.note else ""),
                    code="estate_closed", values={"category": row["category"], "note": body.note})
    return _concern_step(conn, row, "closed_by_estate", "closed_at", "concern_closed_by_estate", "estate_note", body.note)


@app.get("/api/moderation/reports", dependencies=[Depends(staff_only)])
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


@app.post("/api/reports/{report_id}/review", dependencies=[Depends(staff_only)])
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
                        "repeated reports can pause your messaging.", private=True, code="report_warned")
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
    audience: str = Field(..., pattern=r"^(phase|street:.{1,80}|block:.{1,40})$")  # checked against the phase
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
    _require_joined(conn, body.from_unit_id)
    _require_joined(conn, body.to_unit_id)
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
    return ("phase", f"street:{unit['street']}") if unit["kind"] == "terrace" else ("phase", f"block:{unit['block']}")


@app.get("/api/units/{unit_id}/notices")
def notices_for(unit_id: str, conn: sqlite3.Connection = Depends(get_conn)) -> list[dict[str, Any]]:
    me = _unit_row(conn, unit_id)
    a = _audiences(me)
    rows = conn.execute(f"SELECT * FROM notices WHERE phase_id = ? AND audience IN ({','.join('?' * len(a))}) ORDER BY id DESC",
                        (me["phase_id"], *a)).fetchall()
    return [dict(r) for r in rows]


@app.get("/api/notices")
def all_notices(phase_id: str | None = None, conn: sqlite3.Connection = Depends(get_conn)) -> list[dict[str, Any]]:
    return [dict(r) for r in conn.execute("SELECT * FROM notices WHERE phase_id = ? ORDER BY id DESC", (_phase_id(conn, phase_id),))]


@app.post("/api/notices", status_code=201, dependencies=[Depends(staff_only)])
def post_notice(body: NoticeIn, phase_id: str | None = None, conn: sqlite3.Connection = Depends(get_conn)) -> dict[str, Any]:
    """Estate team only. One-way: residents cannot reply to the whole township. A street or block must be in the phase."""
    phase_id = _phase_id(conn, phase_id)
    phase = _phase_json(conn, conn.execute("SELECT * FROM phases WHERE id = ?", (phase_id,)).fetchone())
    kind, _, place = body.audience.partition(":")
    if kind != "phase" and place not in phase["streets" if kind == "street" else "blocks"]:
        raise HTTPException(422, f"{place} isn't a {kind} in {phase['name']}.")
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
    name: str | None = Field(None, min_length=2, max_length=40)  # the name neighbours see (PDPA: correct your data)
    bio: str | None = Field(None, max_length=80)
    accept_requests: bool | None = None
    allow_waves: bool | None = None
    quiet_mode: bool | None = None
    lang: ReadLang | None = None
    easy_mode: bool | None = None  # bigger text and fewer options; private to the household
    whatsapp_alerts: bool | None = None


def _check_daily_limit(conn: sqlite3.Connection, sender: str, recipient: str) -> None:
    """Texts, quick replies and voice notes share one daily limit per neighbour."""
    since = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat(timespec="seconds")
    sent = conn.execute("SELECT COUNT(*) FROM messages WHERE from_unit_id = ? AND to_unit_id = ? AND created_at > ?",
                        (sender, recipient, since)).fetchone()[0]
    if sent >= MAX_MESSAGES_PER_DAY:
        raise HTTPException(429, "Daily message limit for this neighbour reached. Try again tomorrow.")


def _looks_like_audio(raw: bytes, ext: str) -> bool:
    """The file must start the way that audio format does, whatever the upload claimed to be."""
    if ext == "webm":
        return raw[:4] == b"\x1a\x45\xdf\xa3"  # EBML (Chrome, Edge)
    if ext == "ogg":
        return raw[:4] == b"OggS"  # Firefox
    if ext == "m4a":
        return raw[4:8] == b"ftyp"  # MP4 container (Safari, iPhone)
    if ext == "mp3":
        return raw[:3] == b"ID3" or (raw[0] == 0xFF and raw[1] & 0xE0 == 0xE0)
    if ext == "wav":
        return raw[:4] == b"RIFF" and raw[8:12] == b"WAVE"
    return False


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
    recent = (datetime.now(timezone.utc) - wave_window()).isoformat(timespec="seconds")
    if conn.execute("SELECT 1 FROM waves WHERE from_unit_id = ? AND to_unit_id = ? AND created_at > ?",
                    (body.from_unit_id, body.to_unit_id, recent)).fetchone():
        raise HTTPException(409, "You already waved today.")
    since = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat(timespec="seconds")
    if conn.execute("SELECT COUNT(*) FROM waves WHERE from_unit_id = ? AND created_at > ?",
                    (body.from_unit_id, since)).fetchone()[0] >= daily_cap(MAX_WAVES_PER_DAY):
        raise HTTPException(429, f"At most {daily_cap(MAX_WAVES_PER_DAY)} waves a day.")
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
    sent_by = _delegate_name(conn, from_unit_id, delegate_id)  # every check runs before anything is written to disk
    _check_daily_limit(conn, from_unit_id, to_unit_id)
    ext = VOICE_TYPES.get((file.content_type or "").split(";")[0].strip())
    if ext is None:
        raise HTTPException(415, "Please send an audio recording.")
    raw = file.file.read(MAX_VOICE_BYTES + 1)
    if len(raw) > MAX_VOICE_BYTES:
        raise HTTPException(413, "Voice messages can be up to one minute.")
    if len(raw) < 64:
        raise HTTPException(400, "That recording is empty.")
    if not _looks_like_audio(raw, ext):
        raise HTTPException(415, "Please send an audio recording.")
    media_id = f"{uuid.uuid4().hex}.{ext}"
    (data_dir("voice") / media_id).write_bytes(raw)
    withheld = int(_blocked(conn, to_unit_id, from_unit_id))
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
            "quiet_mode": bool(p["quiet_mode"]), "lang": unit["lang"], "easy_mode": bool(p["easy_mode"]),
            "whatsapp_alerts": bool(p["whatsapp_alerts"]), "joined": unit["joined_at"] is not None,
            "blocked": [{"id": b, "label": _unit_row(conn, b)["label"], "resident_name": _unit_row(conn, b)["resident_name"]} for b in blocked]}


@app.get("/api/units/{unit_id}/profile")
def get_profile(unit_id: str, conn: sqlite3.Connection = Depends(get_conn)) -> dict[str, Any]:
    _unit_row(conn, unit_id)
    out = _profile_json(conn, unit_id)
    conn.commit()
    return out


@app.put("/api/units/{unit_id}/profile")
def update_profile(unit_id: str, body: ProfileIn, conn: sqlite3.Connection = Depends(get_conn)) -> dict[str, Any]:
    _require_joined(conn, unit_id)
    _profile_row(conn, unit_id)
    if body.name is not None:
        _check_name(body.name.strip())
        conn.execute("UPDATE units SET resident_name = ? WHERE id = ?", (body.name.strip(), unit_id))
    if body.bio is not None:
        _check_shared_text(body.bio)
        conn.execute("UPDATE profiles SET bio = ? WHERE unit_id = ?", (body.bio.strip(), unit_id))
    for field in ("accept_requests", "allow_waves", "quiet_mode", "easy_mode", "whatsapp_alerts"):
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
    name = f"{_place_name(conn, _unit_row(conn, unit_id)['phase_id'])} Estate Office"
    return {"name": name, "verified": True, "notices": notices,
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
JOIN_CODE_DAYS = 14  # a join code from the handover pack works for two weeks, once
MAX_SHEET = 1000  # welcome packs printed at a time
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
    """Belt and braces for the most sensitive endpoints: in pilot mode the guard must have found a session."""
    if not demo_mode() and _current_actor.get() is None:
        raise HTTPException(401, {"code": "signin", "message": "Please sign in with your digital key."})


def _check_shared_text(text: str) -> None:
    """Text other residents will see (bio, helper name): no insults, and no phone numbers, emails or links,
    which would side-step the rule that numbers are exchanged only when both households agree."""
    if talk.tone_problem(text):
        raise HTTPException(422, {"code": "tone", "message": TONE_MESSAGE})
    if talk.contact_details(text):
        raise HTTPException(422, {"code": "private", "message": PRIVATE_MESSAGE})


def _check_name(name: str) -> None:
    """A name other residents will see: no insults, contact details, or anything posing as an official account."""
    _check_shared_text(name)
    if talk.official_sounding(name):
        raise HTTPException(422, {"code": "official", "message": "A name can't look like SDP, the estate office or an official account."})


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
    """The owner authorises a family member to use Keynection for them (for residents who are not online)."""
    _require_joined(conn, unit_id)
    if not body.consent:
        raise HTTPException(422, "The owner must agree before a helper is added.")
    _check_name(body.name)
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
    """PDPA right of access: everything Keynection holds about this household, as one file. Other residents appear
    by unit only, never by name. In a pilot only the signed-in household gets its own (the guard checks the unit)."""
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
        "about": "Your data held by Keynection. Other residents are listed by unit, not by name.",
        "household": {"unit": me["label"], "kind": me["kind"], "reading_language": me["lang"], "handover_date": me["handover_date"],
                      "joined_at": me["joined_at"], "privacy_notice_agreed": me["consent_version"],
                      "whatsapp_alerts": bool(p["whatsapp_alerts"]), "easy_mode": bool(p["easy_mode"])},
        "profile": {"bio": p["bio"], "accept_requests": bool(p["accept_requests"]), "allow_waves": bool(p["allow_waves"]),
                    "quiet_mode": bool(p["quiet_mode"]), "quiet_times": json.loads(p["quiet_times"])},
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
    return JSONResponse(data, headers={"Content-Disposition": f'attachment; filename="{_export_name(me["label"])}"'})


def _export_name(label: str) -> str:
    """keynection-No2Jln21-my-data.json: letters, digits and dashes only, whatever the address looks like."""
    return f"keynection-{re.sub(r'[^A-Za-z0-9-]', '', label) or 'home'}-my-data.json"


# ---------- pilot health, for staff ----------

@app.get("/api/pilot/status")
def pilot_status(conn: sqlite3.Connection = Depends(get_conn)) -> dict[str, Any]:
    """Is the pilot healthy? What setup still needs, the last backup, how many homes have joined, phones with
    notifications on. Numbers only: never who."""
    _pilot_only()
    last = backup.newest(backup_dir())
    swept = conn.execute("SELECT value FROM settings WHERE key = 'records_swept_at'").fetchone()
    count = lambda sql: conn.execute(sql).fetchone()[0]  # noqa: E731
    return {"checks": _pilot_checks(conn), "origin": _origin() or None,
            "last_backup": last.isoformat(timespec="seconds") if last else None,
            "backups": len(list(backup_dir().glob("keynection-*.db"))), "records_swept_at": swept[0] if swept else None,
            "phases": count("SELECT COUNT(*) FROM phases"), "homes": count("SELECT COUNT(*) FROM units"),
            "joined": count("SELECT COUNT(*) FROM units WHERE joined_at IS NOT NULL"),
            "staff": count("SELECT COUNT(*) FROM staff WHERE revoked_at IS NULL"),
            "phones": count("SELECT COUNT(*) FROM push_subscriptions"), "ai": ai.enabled()}


# ---------- closing an account (PDPA): the household itself, or the estate office after checking ID ----------

class CloseIn(BaseModel):
    confirm: str = Field(..., max_length=40)  # the household types its own unit, e.g. "No. 11"


@app.post("/api/units/{unit_id}/close")
def close_my_account(unit_id: str, body: CloseIn, response: Response, conn: sqlite3.Connection = Depends(get_conn)) -> dict[str, bool]:
    """The household leaves Keynection: its name, messages, photos, keys and phones go; records its neighbours and
    SDP rely on stay, by unit only, until their time is up (privacy.py). Pilot only: the demo cast stays."""
    _pilot_only()
    row = _require_joined(conn, unit_id)
    if body.confirm.strip().casefold() != row["label"].casefold():
        raise HTTPException(422, f"To close the account, type your unit exactly: {row['label']}.")
    privacy.close_account(conn, unit_id, "household", _folders())
    response.delete_cookie(auth.SESSION_COOKIE, path="/")
    return {"closed": True}


class EstateCloseIn(BaseModel):
    staff_name: str = Field(..., min_length=2, max_length=40)
    unit_id: str = Field(..., pattern=UNIT_ID)
    id_checked: bool


@app.post("/api/estate/close-account")
def estate_close_account(body: EstateCloseIn, conn: sqlite3.Connection = Depends(get_conn)) -> dict[str, bool]:
    """For an owner who asks at the counter (no phone, lost access): only after checking their ID, on record."""
    _pilot_only()
    if not body.id_checked:
        raise HTTPException(422, "Check the owner's ID first: closing deletes the household's messages and photos.")
    _check_shared_text(body.staff_name)
    _require_joined(conn, body.unit_id)
    privacy.close_account(conn, body.unit_id, f"estate office ({body.staff_name.strip()})", _folders())
    return {"closed": True}


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
    if not _may_see_photo(conn, row):
        raise HTTPException(404, "photo not found")  # not 403: don't confirm that someone else's photo exists
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
    if followup["created_at"] < baseline["created_at"]:
        raise HTTPException(400, "The follow-up photo must be taken after the pre-work photo.")

    folder = data_dir("photos")
    comp = vision.compare((folder / f"{baseline['id']}.jpg").read_bytes(), (folder / f"{followup['id']}.jpg").read_bytes())
    intro = _intro(conn, baseline["renovation_intro_id"])
    hint = triage_hint(comp.result, baseline["created_at"],
                       intro["renovation"] if intro else None, intro["from_label"] if intro else None,
                       followup_at=followup["created_at"])
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
    incident = conn.execute("SELECT i.reporter_unit_id, n.from_unit_id AS owner FROM incidents i"
                            " LEFT JOIN intros n ON n.id = i.renovation_intro_id WHERE i.id = ?", (incident_id,)).fetchone()
    if incident is None or not _may_see(incident["reporter_unit_id"], incident["owner"]):
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


CASE_OUTCOME = {
    "renovation": "caused by the renovation",
    "warranty": "reported to SDP as a possible building defect",
    "inspect": "an SDP inspector is asked to check",
    "no_action": "no action needed",
}


@app.post("/api/incidents/{incident_id}/decision")
def decide(incident_id: int, body: DecisionIn, conn: sqlite3.Connection = Depends(get_conn)) -> dict[str, Any]:
    """Who may decide what. A building-defect claim, "no action" or "ask an inspector" is the homeowner's own
    call. Blaming the renovation is a claim against the neighbour: it stays a proposal until the renovating owner
    agrees, disagrees or asks an inspector (their answer, so only once blamed), or they accept it themselves.
    Nobody on a resident's phone can record an SDP inspector's finding."""
    row = conn.execute("SELECT * FROM incidents WHERE id = ?", (incident_id,)).fetchone()
    if row is None:
        raise HTTPException(404, "incident not found")
    if body.decided_by == "sdp_inspector":
        raise HTTPException(403, "Only SDP's inspector can record an inspector's finding.")
    intro = _intro(conn, row["renovation_intro_id"])
    reporter, renovator = row["reporter_unit_id"], intro["from_unit_id"] if intro else None
    if body.unit_id == reporter:
        role = "reporter"
    elif body.unit_id == renovator:
        role = "renovating_owner"
    else:
        raise HTTPException(403, "Only the two households in this case can decide it.")
    if row["status"] == "decided":
        raise HTTPException(409, "This case has already been decided.")
    acted_by = _delegate_name(conn, body.unit_id, body.delegate_id)
    note, decision, now = body.note.strip(), body.decision, db.now()
    if decision == "renovation" and renovator is None:
        raise HTTPException(400, "No renovation is linked to this case.")
    if role == "renovating_owner" and decision in ("warranty", "no_action"):
        raise HTTPException(403, "Only the owner of the home can decide this about their own home.")
    # Asking an inspector is the renovating owner's answer to being blamed, not a way to close a case the
    # neighbour has not decided on yet. Until the neighbour proposes, the case is the neighbour's to decide.
    if role == "renovating_owner" and decision == "inspect" and row["status"] not in ("proposed", "disputed"):
        raise HTTPException(403, "You can ask an SDP inspector once your neighbour says the renovation caused it.")

    case = f"Case #{incident_id:03d}"
    me = _unit_row(conn, body.unit_id)
    who = f"{me['resident_name']} ({me['label']})" + (f", by {acted_by}" if acted_by else "")
    # The same notice as values, so each household reads it in its own language.
    values = {"case": f"{incident_id:03d}", "name": me["resident_name"], "label": me["label"], "helper": acted_by or ""}
    my_note = "decision_note" if role == "reporter" else "response_note"
    if decision == "dispute":
        if role != "renovating_owner":
            raise HTTPException(403, "Only the renovating owner can answer that proposal.")
        if row["status"] != "proposed":
            raise HTTPException(409, "Nothing has been proposed for this case yet.")
        if not note:
            raise HTTPException(422, "Say briefly why you disagree.")
        conn.execute("UPDATE incidents SET status = 'disputed', response_note = ? WHERE id = ?", (note, incident_id))
        stage, payload_decision, decided_by = "disputed", "renovation", None
        told, text = reporter, (f"{case}: {who} disagrees that the renovation caused it: “{note}”. "
                                "You can ask an SDP inspector, or report it to SDP as a possible building defect.")
        code, values = "case_disputed", {**values, "note": note}
    elif decision == "renovation" and role == "reporter":
        if row["status"] == "proposed":
            raise HTTPException(409, f"You have already asked {intro['from_label']} to confirm.")
        if row["status"] == "disputed":  # no back-and-forth: after a "no", an inspector settles it
            raise HTTPException(409, f"{intro['from_label']} disagreed. Ask an SDP inspector to check instead.")
        conn.execute("UPDATE incidents SET status = 'proposed', decision_note = ?, proposed_at = ? WHERE id = ?",
                     (note, now, incident_id))
        stage, payload_decision, decided_by = "proposed", "renovation", None
        subject = _photo_row(conn, row["baseline_photo_id"])["subject"]
        told, text = renovator, (f"{case}: {who} believes the change on “{subject}” "
                                 "was caused by your renovation. Open Photos & repairs to agree, disagree or ask an SDP inspector.")
        code, values = "case_proposed", {**values, "subject": subject}
    else:
        agreed = decision == "renovation" and role == "renovating_owner" and row["proposed_at"] is not None
        decided_by = "both_owners" if agreed else role
        conn.execute(f"UPDATE incidents SET status = 'decided', decision = ?, {my_note} = ?, decided_by = ?, decided_at = ?"
                     " WHERE id = ?", (decision, note or row[my_note], decided_by, now, incident_id))
        stage, payload_decision = "decided", decision
        told = renovator if role == "reporter" else reporter
        text = f"{case} decided by {'both owners' if agreed else who}: {CASE_OUTCOME[decision]}."
        code, values = "case_decided", {**values, "both": "1" if agreed else "", "outcome": decision}

    payload = {"incident_id": incident_id, "stage": stage, "decision": payload_decision, "by": role,
               **({"decided_by": decided_by} if decided_by else {}), "note": note,
               **({"acted_by": acted_by} if acted_by else {})}
    db.append_event(conn, reporter, "triage", payload)
    if renovator:
        db.append_event(conn, renovator, "triage", payload)
        _system_message(conn, told, body.unit_id, text, author=SERVICE, code=code, values=values)
    if stage == "decided" and decision == "warranty":
        _open_warranty(conn, row)
    conn.commit()
    return _incident_json(conn, conn.execute("SELECT * FROM incidents WHERE id = ?", (incident_id,)).fetchone())


# ---------- layer 2: agree (schedule, contractor passes, guardhouse) ----------

def _token_hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _pass_json(conn: sqlite3.Connection, row: sqlite3.Row) -> dict[str, Any]:
    entries = conn.execute(
        "SELECT allowed, reason, reason_code, reason_values, scanned_for, created_at FROM gate_logs"
        " WHERE pass_id = ? ORDER BY id DESC LIMIT 8",
        (row["id"],),
    ).fetchall()
    return {"id": row["id"], "intro_id": row["intro_id"], "unit_id": row["unit_id"], "contractor_name": row["contractor_name"],
            "contractor_cidb": bool(row["contractor_cidb"]), "valid_from": row["valid_from"], "valid_to": row["valid_to"],
            "entry_hours": f"{GATE_OPEN}-{GATE_CLOSE}, Mon-Sat", "status": row["status"],
            "created_at": row["created_at"], "revoked_at": row["revoked_at"],
            "gate_log": [{**dict(e), "allowed": bool(e["allowed"]), "reason_values": json.loads(e["reason_values"] or "{}")}
                         for e in entries]}


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
    rules, codes = house_rules_for(me["kind"])
    return {"mine": mine, "nearby": nearby, "gate_hours": f"{GATE_OPEN}-{GATE_CLOSE}, Mon-Sat",
            "gate_open": GATE_OPEN, "gate_close": GATE_CLOSE, "house_rules": rules, "house_rule_codes": codes}


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
    return {**_pass_json(conn, row), "token": token, "qr_payload": f"KNPASS:{token}"}


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


def _gate_decision(row: sqlite3.Row | None, at: datetime) -> tuple[bool, str, str, dict[str, str]]:
    """(allowed, English reason for the record, code and values for the app to show in the reader's language)."""
    if row is None:
        return False, "Unknown pass", "unknown", {}
    if row["status"] != "active":
        return False, "Pass revoked by the homeowner", "revoked", {}
    day = at.strftime("%Y-%m-%d")
    if day < row["valid_from"]:
        return False, f"Renovation has not started (starts {row['valid_from']})", "not_started", {"start": row["valid_from"]}
    if day > row["valid_to"]:
        return False, f"Renovation ended on {row['valid_to']}", "ended", {"end": row["valid_to"]}
    if at.weekday() == 6:
        return False, "No renovation entry on Sundays", "sunday", {}
    if not GATE_OPEN <= at.strftime("%H:%M") < GATE_CLOSE:
        return False, f"Outside entry hours ({GATE_OPEN}-{GATE_CLOSE})", "outside_hours", {"open": GATE_OPEN, "close": GATE_CLOSE}
    return True, "Entry allowed", "allowed", {}


@app.post("/api/gate/scan")
def gate_scan(body: ScanIn, conn: sqlite3.Connection = Depends(get_conn)) -> dict[str, Any]:
    """What the guardhouse tablet does when it scans a contractor QR."""
    if body.at and not demo_mode():
        raise HTTPException(403, "simulated time is only available in demo mode")
    at = datetime.strptime(body.at, "%Y-%m-%dT%H:%M") if body.at else datetime.now(MALAYSIA).replace(tzinfo=None)
    row = conn.execute("SELECT * FROM passes WHERE token_hash = ?", (_token_hash(body.token),)).fetchone()
    allowed, reason, code, values = _gate_decision(row, at)
    conn.execute("INSERT INTO gate_logs (pass_id, allowed, reason, reason_code, reason_values, scanned_for, created_at)"
                 " VALUES (?, ?, ?, ?, ?, ?, ?)",
                 (row["id"] if row else None, int(allowed), reason, code, json.dumps(values), at.strftime("%Y-%m-%dT%H:%M"), db.now()))
    conn.commit()
    if row is None:
        return {"allowed": False, "reason": reason, "reason_code": code, "reason_values": values, "pass": None}
    unit = _unit_row(conn, row["unit_id"])
    reno = json.loads(conn.execute("SELECT renovation FROM intros WHERE id = ?", (row["intro_id"],)).fetchone()[0])
    return {"allowed": allowed, "reason": reason, "reason_code": code, "reason_values": values, "scanned_for": at.strftime("%Y-%m-%dT%H:%M"),
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
            "entry_hours": f"{GATE_OPEN}-{GATE_CLOSE}, Mon-Sat", "house_rules": house_rules_for(unit["kind"])[0],
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


def _at_local(day: date, hhmm: str) -> str:
    """A date and time in Malaysia, as a stored (UTC) timestamp."""
    h, m = map(int, hhmm.split(":"))
    return datetime(day.year, day.month, day.day, h, m, tzinfo=MALAYSIA).astimezone(timezone.utc).isoformat(timespec="seconds")


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
            # The demo invents PC-20xx when a repair is submitted (see _submit_repair); the screens mark it as a demo
            # number. A pilot shows only what SDP's warranty team wrote back, so this is never true there.
            "procore_demo": demo_mode() and row["procore_ref"] == f"PC-{2000 + row['id']}",
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
    # The demo shows a simulated Procore item; a pilot shows only the number SDP's warranty team writes back.
    procore_ref = ticket["procore_ref"] or (f"PC-{2000 + ticket['id']}" if demo_mode() else None)
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


# ---------- warranty tickets to SDP's defect system (Procore) ----------

PUNCH_LIST = ["Item Name", "Description", "Location", "Trade", "Assigned To", "Due Date", "Priority", "Reference", "Status",
              "Reported On", "Days Left", "Procore Item", "Photos"]
STATUS_NAME = {"open": "Open", "repair_submitted": "Repair submitted", "closed": "Closed"}
CHECK_TEXT = {"restored": "matches the pre-work photo again", "still_changed": "still differs from the pre-work photo",
              "unverified": "could not be compared with the pre-work photo"}
PUNCH_LIST_README = """Keynection warranty tickets for Procore, {phase}, exported {day}.

punch-list.csv: one row per warranty ticket. The columns use the names of Procore's punch list import (Item Name,
Location, Assigned To, Due Date as MM/DD/YYYY, Priority). Procore asks that its template is not changed, so
download the punch list import template of your own Procore project (Procore Imports) and copy each column of
this file into the matching column of the template.

photos/: each ticket's defect photo, the photo from before the neighbour's works (when there is one) and the
repair photo, named by Reference (KN-...). Attach them to the Procore item.

Once the item is in Procore, type its number on the ticket in Keynection (Command view, Warranty), so both
systems point at each other and the owner sees SDP logged it.

Homes appear by unit only: residents' names are not in this file. Keep it only as long as it is needed.
"""


class WarrantyExportIn(BaseModel):
    which: Literal["new", "open", "all"] = "new"  # new: not taken into Procore yet; open: not closed; all


@app.post("/api/warranty/export")
def warranty_export(body: WarrantyExportIn, phase_id: str | None = None, conn: sqlite3.Connection = Depends(get_conn)) -> Response:
    """SDP's warranty team takes tickets into Procore: a punch list (CSV) and the photos, as one ZIP. The tickets in
    it are marked as exported, so the next 'new' download has only tickets that came in since."""
    phase_id = _phase_id(conn, phase_id)
    where = {"new": "w.exported_at IS NULL", "open": "w.status != 'closed'", "all": "1 = 1"}[body.which]
    rows = conn.execute(f"SELECT w.* FROM warranty_tickets w JOIN units u ON u.id = w.unit_id WHERE u.phase_id = ? AND {where}"
                        " ORDER BY w.id", (phase_id,)).fetchall()
    if not rows:
        raise HTTPException(409, "Nothing new to export since the last download." if body.which == "new" else "No tickets to export.")
    place = _place_name(conn, phase_id)
    folder = data_dir("photos")
    sheet, pack_buf = io.StringIO(), io.BytesIO()
    writer = csv.writer(sheet)
    writer.writerow(PUNCH_LIST)
    with zipfile.ZipFile(pack_buf, "w", zipfile.ZIP_DEFLATED) as pack:
        for r in rows:
            unit = _unit_row(conn, r["unit_id"])
            clock = _warranty_clock(unit, r)
            ref = f"KN-{r['id']}"
            photos = []
            for kind, pid in (("defect", r["defect_photo_id"]), ("before", r["baseline_photo_id"]), ("repair", r["repair_photo_id"])):
                if pid and (folder / f"{pid}.jpg").exists():
                    name = f"{ref}-{kind}.jpg"
                    pack.write(folder / f"{pid}.jpg", f"photos/{name}")
                    photos.append(name)
            check = json.loads(r["repair_check"]) if r["repair_check"] else None
            notes = [f"Opened through Keynection on {date.fromisoformat(clock['notice_date']):%d %b %Y} (the owner's written notice;"
                     f" the developer repairs within {HDA_REPAIR_DAYS} days)."]
            if r["baseline_photo_id"]:
                notes.append("A photo from before the neighbour's works is attached.")
            if check:
                notes.append(f"Repair photo {CHECK_TEXT.get(check.get('verdict'), CHECK_TEXT['unverified'])}.")
            if r["reopen_count"]:
                notes.append(f"Reopened {r['reopen_count']} time(s) after the owner rejected a repair.")
            if r["owner_note"]:
                notes.append(f"Owner's note: {r['owner_note']}")
            where_is = unit["street"] if unit["kind"] == "terrace" else f"Block {unit['block']}"
            open_now = r["status"] != "closed"
            writer.writerow([
                f"{r['subject']} ({unit['label']})"[:255], " ".join(notes), " > ".join(x for x in (place, where_is, unit["label"]) if x),
                "", r["subcontractor"] or "", date.fromisoformat(clock["repair_due"]).strftime("%m/%d/%Y"),
                "High" if open_now and (clock["overdue"] or clock["days_left"] <= 7) else "Medium", ref, STATUS_NAME[r["status"]],
                date.fromisoformat(clock["notice_date"]).strftime("%m/%d/%Y"), clock["days_left"] if open_now else "",
                r["procore_ref"] or "", "; ".join(photos),
            ])
        day = datetime.now(MALAYSIA).date()
        pack.writestr("punch-list.csv", "\ufeff" + sheet.getvalue())  # the mark tells Excel it is UTF-8
        pack.writestr("README.txt", PUNCH_LIST_README.format(phase=place, day=f"{day:%d %b %Y}"))
    stamp = db.now()
    conn.executemany("UPDATE warranty_tickets SET exported_at = ? WHERE id = ? AND exported_at IS NULL", [(stamp, r["id"]) for r in rows])
    conn.commit()
    log.info("%d warranty ticket(s) exported for Procore", len(rows))
    return Response(pack_buf.getvalue(), media_type="application/zip",
                    headers={"Content-Disposition": f'attachment; filename="keynection-warranty-{day:%Y%m%d}.zip"'})


class ProcoreRefIn(BaseModel):
    ref: str = Field(..., min_length=1, max_length=40, pattern=r"^[A-Za-z0-9][A-Za-z0-9#./ _-]*$")
    staff_name: str = Field(..., min_length=2, max_length=40)


@app.post("/api/warranty/{ticket_id}/procore")
def warranty_procore(ticket_id: int, body: ProcoreRefIn, conn: sqlite3.Connection = Depends(get_conn)) -> dict[str, Any]:
    """The Procore item number, written on the ticket: both systems point at each other, and the owner's home log
    shows that SDP logged the defect."""
    ticket = _ticket_row(conn, ticket_id)
    ref = body.ref.strip()
    conn.execute("UPDATE warranty_tickets SET procore_ref = ? WHERE id = ?", (ref, ticket_id))
    db.append_event(conn, ticket["unit_id"], "procore_linked", {"ticket_id": ticket_id, "procore_ref": ref})
    conn.commit()
    return _ticket_json(conn, _ticket_row(conn, ticket_id))


@app.get("/api/warranty", dependencies=[Depends(staff_only)])
def warranty_queue(phase_id: str | None = None, conn: sqlite3.Connection = Depends(get_conn)) -> list[dict[str, Any]]:
    """SDP warranty team's queue."""
    rows = conn.execute(
        "SELECT w.* FROM warranty_tickets w JOIN units u ON u.id = w.unit_id WHERE u.phase_id = ? ORDER BY w.id DESC",
        (_phase_id(conn, phase_id),),
    ).fetchall()
    return [_ticket_json(conn, r) for r in rows]


@app.get("/api/units/{unit_id}/warranty")
def my_warranty(unit_id: str, conn: sqlite3.Connection = Depends(get_conn)) -> list[dict[str, Any]]:
    _unit_row(conn, unit_id)
    rows = conn.execute("SELECT * FROM warranty_tickets WHERE unit_id = ? ORDER BY id DESC", (unit_id,)).fetchall()
    return [_ticket_json(conn, r) for r in rows]


@app.post("/api/warranty/{ticket_id}/repair", dependencies=[Depends(staff_only)])
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
    if not _may_see(ticket["unit_id"]):
        raise HTTPException(404, "warranty ticket not found")
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


@app.post("/api/demo/reset")
def reset_demo(conn: sqlite3.Connection = Depends(get_conn)) -> dict[str, str]:
    """Wipe and re-seed the fictional demo data (for rehearsals). Disabled when KEYNECTION_DEMO_MODE=0."""
    if not demo_mode():
        raise HTTPException(403, "demo mode is off")
    _reset_demo_data(conn)
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

@app.get("/api/dashboard", dependencies=[Depends(staff_only)])
def dashboard(phase_id: str | None = None, conn: sqlite3.Connection = Depends(get_conn)) -> dict[str, Any]:
    phase_id = _phase_id(conn, phase_id)
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
        "households_joined": count("SELECT COUNT(*) FROM units WHERE joined_at IS NOT NULL AND id IN ({marks})"),
        "paper_notices_pending": count("SELECT COUNT(*) FROM paper_notices WHERE status IN ('to_print', 'printed') AND unit_id IN ({marks})"),
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
        "noise_concerns": count("SELECT COUNT(*) FROM concerns WHERE category = 'noise_hours' AND from_unit_id IN ({marks})"),
        "quiet_times_kept": count("SELECT COUNT(*) FROM intro_recipients WHERE quiet = 'avoided' AND unit_id IN ({marks})"),
        "quiet_times_missed": count("SELECT COUNT(*) FROM intro_recipients WHERE quiet = 'overlap' AND unit_id IN ({marks})"),
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


# ---------- joining at handover (PDPA consent) ----------

class JoinLookupIn(BaseModel):
    token: str = Field(..., min_length=20, max_length=64)


class JoinIn(JoinLookupIn):
    display_name: str = Field(..., min_length=2, max_length=30)
    lang: ReadLang
    consent: bool
    whatsapp_alerts: bool = True
    easy_mode: bool = False


def _join_code(conn: sqlite3.Connection, token: str) -> sqlite3.Row:
    row = conn.execute("SELECT * FROM join_codes WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?",
                       (_token_hash(token), db.now())).fetchone()
    if row is None:
        raise HTTPException(404, "This join code isn't valid any more. Ask the estate office for a new one.")
    return row


@app.post("/api/units/{unit_id}/join-code", status_code=201)
def issue_join_code(unit_id: str, conn: sqlite3.Connection = Depends(get_conn)) -> dict[str, Any]:
    """SDP's handover team gives the owner a one-time code (as a QR in the welcome pack). Only a hash is stored,
    a new code cancels the old one, and a household that already joined can't be taken over with a fresh code."""
    _require_sign_in_or_demo()
    row = _unit_row(conn, unit_id)
    if row["joined_at"] is not None:
        raise HTTPException(409, "This household has already joined. A lost phone is handled at the estate office, with ID.")
    expires = (datetime.now(timezone.utc) + timedelta(days=JOIN_CODE_DAYS)).isoformat(timespec="seconds")
    token = _new_join_code(conn, unit_id, expires)
    conn.commit()
    return {"token": token, "expires_at": expires}


def _new_join_code(conn: sqlite3.Connection, unit_id: str, expires: str) -> str:
    """A one-time code for the welcome pack. Only its hash is kept, and it cancels any older code of that home."""
    token = secrets.token_urlsafe(24)
    conn.execute("UPDATE join_codes SET expires_at = ? WHERE unit_id = ? AND used_at IS NULL AND expires_at > ?",
                 (db.now(), unit_id, db.now()))
    conn.execute("INSERT INTO join_codes (unit_id, token_hash, created_at, expires_at) VALUES (?, ?, ?, ?)",
                 (unit_id, _token_hash(token), db.now(), expires))
    actor = _current_actor.get()
    db.append_event(conn, unit_id, "join_code_issued", {"expires_at": expires, **({"by": actor.name} if actor else {})})
    return token


class JoinSheetIn(BaseModel):
    handover_from: date | None = None
    handover_to: date | None = None


@app.post("/api/phases/{phase_id}/join-codes")
def issue_join_sheet(phase_id: str, body: JoinSheetIn, conn: sqlite3.Connection = Depends(get_conn)) -> dict[str, Any]:
    """Welcome-pack codes for every home of a phase still to join (or those handed over in a date range), to print
    in one go. Each works once, from now until two weeks after that home's handover date; a new sheet cancels the
    old codes. The owner's name comes from SDP's own handover list and is printed only on their card."""
    _pilot_only()
    phase_id = _phase_id(conn, phase_id)
    rows = conn.execute("SELECT * FROM units WHERE phase_id = ? AND joined_at IS NULL"
                        " ORDER BY handover_date, street, block, floor, pos, id",  # in the order keys are handed over
                        (phase_id,)).fetchall()
    if body.handover_from:
        rows = [r for r in rows if r["handover_date"] >= body.handover_from.isoformat()]
    if body.handover_to:
        rows = [r for r in rows if r["handover_date"] <= body.handover_to.isoformat()]
    if len(rows) > MAX_SHEET:
        raise HTTPException(422, f"Print up to {MAX_SHEET} welcome packs at a time: choose a shorter range of handover dates.")
    today = datetime.now(timezone.utc).date()
    codes = []
    for r in rows:
        start = max(today, date.fromisoformat(r["handover_date"]))
        expires = datetime.combine(min(start, today + timedelta(days=90)) + timedelta(days=JOIN_CODE_DAYS),
                                   datetime.min.time(), timezone.utc).isoformat(timespec="seconds")
        codes.append({"unit_id": r["id"], "label": r["label"], "street": r["street"], "block": r["block"],
                      "owner": r["record_name"], "handover_date": r["handover_date"], "lang": r["lang"],
                      "token": _new_join_code(conn, r["id"], expires), "expires_at": expires})
    conn.commit()
    return {"phase": _place_name(conn, phase_id), "codes": codes}


# ---------- a real phase, from SDP's handover list (pilot) ----------

class PhaseImportIn(BaseModel):
    name: str = Field(..., min_length=2, max_length=80)
    phase_id: str | None = Field(None, max_length=40)  # an existing phase to add homes to or correct
    csv: str = Field(..., min_length=1, max_length=phase_import.MAX_BYTES)
    staff_name: str | None = Field(None, max_length=40)


def _checked_list(conn: sqlite3.Connection, body: PhaseImportIn) -> phase_import.Report:
    _pilot_only()
    if body.phase_id is not None:
        _phase_id(conn, body.phase_id)  # must exist
    _check_shared_text(body.name)
    report = phase_import.parse(body.csv)
    phase_import.check(conn, report, body.phase_id)
    return report


@app.post("/api/phases/import/preview")
def phase_import_preview(body: PhaseImportIn, conn: sqlite3.Connection = Depends(get_conn)) -> dict[str, Any]:
    """What importing this list would do: every circle, and every line that needs fixing. Nothing is saved."""
    return _checked_list(conn, body).json()


@app.post("/api/phases/import")
def phase_import_save(body: PhaseImportIn, conn: sqlite3.Connection = Depends(get_conn)) -> dict[str, Any]:
    """Save a list with no mistakes: the phase, its homes and their handover records, under the staff member's name."""
    report = _checked_list(conn, body)
    if report.errors:
        raise HTTPException(422, {"code": "import", "message": f"{len(report.errors) + report.more_errors} line(s) need fixing first.",
                                  "report": report.json()})
    actor = _current_actor.get()
    phase_id = body.phase_id or phase_import.new_phase_id(conn, body.name)
    phase_import.apply(conn, report, phase_id, body.name.strip(), actor.name if actor else (body.staff_name or "SDP staff"))
    log.info("Phase %s imported: %d added, %d corrected", phase_id, len(report.added), len(report.updated))
    return {"phase": _phase_json(conn, conn.execute("SELECT * FROM phases WHERE id = ?", (phase_id,)).fetchone()),
            **{k: v for k, v in report.json().items() if k in ("added", "updated", "unchanged", "kept")}}


@app.post("/api/join/lookup")
def join_lookup(body: JoinLookupIn, conn: sqlite3.Connection = Depends(get_conn)) -> dict[str, Any]:
    """What the join page shows before anything is agreed: the home, never the neighbours' names."""
    code = _join_code(conn, body.token)
    me, _, phase_units = _phase(conn, code["unit_id"])
    phase = conn.execute("SELECT name FROM phases WHERE id = ?", (me["phase_id"],)).fetchone()
    return {"unit_id": me["id"], "label": me["label"], "kind": me["kind"], "phase": phase["name"] if phase else "",
            "suggested_name": me["record_name"] or "", "lang": me["lang"], "consent_version": _consent_version(),
            "circle_size": len(neighbour_circle(_to_unit(me), phase_units)), "expires_at": code["expires_at"]}


@app.post("/api/join")
def join(body: JoinIn, request: Request, response: Response, conn: sqlite3.Connection = Depends(get_conn)) -> dict[str, Any]:
    code = _join_code(conn, body.token)
    if not body.consent:
        raise HTTPException(422, "Keynection can only set up your household once you agree to the privacy notice.")
    name = body.display_name.strip()
    _check_name(name)
    unit_id = code["unit_id"]
    conn.execute("UPDATE units SET resident_name = ?, lang = ?, joined_at = ?, consent_version = ? WHERE id = ?",
                 (name, body.lang, db.now(), _consent_version(), unit_id))
    conn.execute("UPDATE profiles SET whatsapp_alerts = ?, easy_mode = ? WHERE unit_id = ?",
                 (int(body.whatsapp_alerts), int(body.easy_mode), unit_id))
    conn.execute("UPDATE join_codes SET used_at = ? WHERE id = ?", (db.now(), code["id"]))
    # Notices not printed yet now arrive in the app instead.
    conn.execute("UPDATE paper_notices SET status = 'superseded' WHERE unit_id = ? AND status = 'to_print'", (unit_id,))
    # No name in the permanent log: only what was agreed.
    db.append_event(conn, unit_id, "joined", {"privacy_notice": _consent_version(), "whatsapp_alerts": body.whatsapp_alerts})
    conn.commit()
    if not demo_mode():  # the one-time code proved who they are: sign this phone in, then it makes its digital key
        _set_session(request, response, auth.new_session(conn, auth.unit_subject(unit_id)))
    return _unit_json(_unit_row(conn, unit_id))


# ---------- sign-in (pilot mode): every key comes with a digital key ----------

# Which endpoints need what, in pilot mode. Anything not listed acts for one household: the unit it names (in the
# path, the query or the body) must be the signed-in household's own.
PUBLIC_ENDPOINTS = {"health", "ai_status", "join_lookup", "join", "auth_me", "auth_signin_options", "auth_signin",
                    "auth_signout", "auth_redeem_code", "gate_scan", "contractor_view"}
DEMO_ENDPOINTS = {"reset_demo", "demo_photos", "use_demo_photo", "submit_demo_repair"}
SIGNED_IN_ENDPOINTS = {"units", "phases", "photo_file", "incident_image", "warranty_image", "auth_passkey_options",
                       "auth_add_passkey", "push_key", "push_status", "push_subscribe", "push_unsubscribe", "push_test"}  # anyone signed in; the photo endpoints check whose photo it is
STAFF_ENDPOINTS = {"warranty_export", "warranty_procore", "pilot_status", "estate_close_account", "phase_import_preview", "phase_import_save", "issue_join_sheet", "estate_concerns", "estate_action", "moderation_reports", "reported_voice", "review_report",
                   "all_notices", "post_notice", "warranty_queue", "submit_repair", "dashboard", "issue_join_code",
                   "front_desk", "paper_printed", "paper_delivered", "estate_register_renovation", "whatsapp_outbox",
                   "planner_preview", "issue_reentry_code", "add_staff_member"}
ACTOR_FIELDS = ("unit_id", "from_unit_id", "reporter_unit_id")  # the household doing something, wherever it is named


async def _json_body(request: Request) -> dict[str, Any]:
    if "application/json" not in request.headers.get("content-type", ""):
        return {}
    try:
        data = json.loads(await request.body() or b"{}")
    except ValueError:
        return {}
    return data if isinstance(data, dict) else {}


async def _claimed_units(request: Request) -> list[str]:
    """Every household this request says is acting: path, query, JSON body or form."""
    claimed = [request.path_params.get("unit_id"), request.query_params.get("unit_id")]
    body = await _json_body(request)
    claimed += [body.get(f) for f in ACTOR_FIELDS]
    content = request.headers.get("content-type", "")
    if "multipart/form-data" in content or "x-www-form-urlencoded" in content:
        form = await request.form()
        claimed += [form.get(f) for f in ACTOR_FIELDS]
    return [c for c in claimed if c is not None]


async def _check_access(request: Request) -> None:
    """The sign-in guard, run before every endpoint. Demo mode: open, as the demo's cast switcher needs. Pilot mode:
    the server decides who is asking, from the session cookie, and refuses anything that person may not do."""
    if demo_mode():
        return
    name = getattr(request.scope.get("endpoint"), "__name__", "")
    if name in PUBLIC_ENDPOINTS:
        return
    if name in DEMO_ENDPOINTS:
        raise HTTPException(403, "This is part of the demo only.")
    conn = db.connect(db_path())
    try:
        actor = auth.actor_for(conn, request.cookies.get(auth.SESSION_COOKIE))
    finally:
        conn.close()
    if actor is None:
        raise HTTPException(401, {"code": "signin", "message": "Please sign in with your digital key."})
    _current_actor.set(actor)
    if name in SIGNED_IN_ENDPOINTS:
        return
    if name in STAFF_ENDPOINTS:
        if not actor.is_staff:
            raise HTTPException(403, "This is for the estate office and SDP staff.")
        signed = (await _json_body(request)).get("staff_name")
        if isinstance(signed, str) and signed.strip().casefold() != actor.name.strip().casefold():
            raise HTTPException(403, "Records are signed with your own name.")
        return
    if actor.is_staff:
        raise HTTPException(403, "Staff can't act for a household.")
    if any(unit != actor.unit_id for unit in await _claimed_units(request)):
        raise HTTPException(403, "You can only act for your own home.")


def _may_see(*units: str | None) -> bool:
    """Demo mode, staff, or one of these households."""
    actor = _current_actor.get()
    return actor is None or actor.is_staff or actor.unit_id in units


def _may_see_photo(conn: sqlite3.Connection, photo: sqlite3.Row) -> bool:
    """A photo inside someone's home: theirs, the other side of a case it is part of, or its warranty ticket."""
    if _may_see(photo["unit_id"]):
        return True
    parties = conn.execute("SELECT i.reporter_unit_id, n.from_unit_id FROM incidents i LEFT JOIN intros n ON n.id = i.renovation_intro_id"
                           " WHERE i.baseline_photo_id = ? OR i.followup_photo_id = ?", (photo["id"], photo["id"])).fetchall()
    return any(_may_see(r[0], r[1]) for r in parties)


def _set_session(request: Request, response: Response, token: str) -> None:
    secure = request.headers.get("x-forwarded-proto", request.url.scheme) == "https"  # the host ends HTTPS
    response.set_cookie(auth.SESSION_COOKIE, token, max_age=auth.SESSION_DAYS * 86400, httponly=True, samesite="lax",
                        secure=secure, path="/")


def _relying_party(request: Request) -> tuple[str, list[str]]:
    """The site a passkey belongs to and the page origins allowed to use it. Online, set KEYNECTION_ORIGIN (for
    example https://keynection.example.com) so it never depends on what a request says about its host."""
    configured = [o.strip().rstrip("/") for o in os.environ.get("KEYNECTION_ORIGIN", "").split(",") if o.strip()]
    if configured:
        return urlparse(configured[0]).hostname or "", configured
    proto = request.headers.get("x-forwarded-proto", request.url.scheme)
    origin = f"{proto}://{request.headers.get('host', request.url.netloc)}"
    return urlparse(origin).hostname or "", [origin]


def _pilot_only() -> None:
    if demo_mode():
        raise HTTPException(409, "Sign-in is part of pilot mode (KEYNECTION_DEMO_MODE=0); the demo switches households instead.")


def _me_json(conn: sqlite3.Connection, actor: auth.Actor | None) -> dict[str, Any]:
    if actor is None:
        return {"mode": "demo" if demo_mode() else "pilot", "signed_in": False}
    return {"mode": "pilot", "signed_in": True, "kind": "staff" if actor.is_staff else "household",
            "unit_id": actor.unit_id, "phase_id": _unit_row(conn, actor.unit_id)["phase_id"] if actor.unit_id else None,
            "name": actor.name, "role": actor.role, "passkeys": auth.passkey_count(conn, actor.subject)}


class CredentialIn(BaseModel):
    challenge_id: str = Field(..., min_length=10, max_length=64)
    credential: dict[str, Any]


class CodeIn(BaseModel):
    token: str = Field(..., min_length=20, max_length=64)


class StaffMemberIn(BaseModel):
    name: str = Field(..., min_length=2, max_length=40)
    role: Literal["estate", "sdp"] = "estate"


@app.get("/api/auth/me")
def auth_me(request: Request, conn: sqlite3.Connection = Depends(get_conn)) -> dict[str, Any]:
    """Demo or pilot mode, and in pilot mode who this phone is signed in as."""
    actor = None if demo_mode() else auth.actor_for(conn, request.cookies.get(auth.SESSION_COOKIE))
    return _me_json(conn, actor)


@app.post("/api/auth/signin/options")
def auth_signin_options(request: Request, conn: sqlite3.Connection = Depends(get_conn)) -> dict[str, Any]:
    _pilot_only()
    rp_id, _ = _relying_party(request)
    return auth.signin_options(conn, rp_id)


@app.post("/api/auth/signin")
def auth_signin(body: CredentialIn, request: Request, response: Response, conn: sqlite3.Connection = Depends(get_conn)) -> dict[str, Any]:
    _pilot_only()
    rp_id, origins = _relying_party(request)
    try:
        subject = auth.finish_signin(conn, body.challenge_id, body.credential, rp_id, origins)
    except auth.SignInError as e:
        raise HTTPException(401, {"code": e.reason, "message": str(e)}) from None
    token = auth.new_session(conn, subject)
    actor = auth.actor_for(conn, token)
    if actor is None:  # the home closed its account, or the staff member left
        auth.end_session(conn, token)
        raise HTTPException(401, {"code": "signin", "message": "This key no longer opens Keynection."})
    _set_session(request, response, token)
    return _me_json(conn, actor)


@app.post("/api/auth/signout")
def auth_signout(request: Request, response: Response, conn: sqlite3.Connection = Depends(get_conn)) -> dict[str, bool]:
    auth.end_session(conn, request.cookies.get(auth.SESSION_COOKIE))
    response.delete_cookie(auth.SESSION_COOKIE, path="/")
    return {"ok": True}


@app.post("/api/auth/code")
def auth_redeem_code(body: CodeIn, request: Request, response: Response, conn: sqlite3.Connection = Depends(get_conn)) -> dict[str, Any]:
    """A one-time code from the estate office: a staff member's first sign-in, or a household's after a lost phone.
    A re-entry retires every old key and session of that home first, in case the lost phone is in someone's hands."""
    _pilot_only()
    try:
        purpose, subject = auth.use_code(conn, body.token)
    except auth.SignInError as e:
        raise HTTPException(404, {"code": e.reason, "message": str(e)}) from None
    if purpose == "reentry":
        auth.retire_all(conn, subject)
        db.append_event(conn, subject[5:], "signed_in_again", {"old_keys_retired": True})
        conn.commit()
    token = auth.new_session(conn, subject)
    _set_session(request, response, token)
    return _me_json(conn, auth.actor_for(conn, token))


@app.post("/api/auth/passkeys/options")
def auth_passkey_options(request: Request, conn: sqlite3.Connection = Depends(get_conn)) -> dict[str, Any]:
    """Start making a digital key on this phone for the signed-in household or staff member."""
    _pilot_only()
    actor = _current_actor.get()
    rp_id, _ = _relying_party(request)
    label = f"{actor.name} · {_unit_row(conn, actor.unit_id)['label']}" if actor.unit_id else f"{actor.name} · staff"
    return auth.registration_options(conn, actor, rp_id, label)


@app.post("/api/auth/passkeys")
def auth_add_passkey(body: CredentialIn, request: Request, conn: sqlite3.Connection = Depends(get_conn)) -> dict[str, Any]:
    _pilot_only()
    actor = _current_actor.get()
    rp_id, origins = _relying_party(request)
    try:
        count = auth.finish_registration(conn, actor, body.challenge_id, body.credential, rp_id, origins)
    except auth.SignInError as e:
        raise HTTPException(422, {"code": e.reason, "message": str(e)}) from None
    if actor.unit_id:
        db.append_event(conn, actor.unit_id, "digital_key_added", {"keys": count})
        conn.commit()
    return {"ok": True, "passkeys": count}


@app.post("/api/units/{unit_id}/reentry-code", status_code=201)
def issue_reentry_code(unit_id: str, conn: sqlite3.Connection = Depends(get_conn)) -> dict[str, Any]:
    """A household lost its phone: after checking ID, the estate office gives a one-time code. Using it retires
    the old keys, so a lost phone can't be used to read the household's chats."""
    _pilot_only()
    _require_joined(conn, unit_id, "This household hasn't joined yet: give them a join code instead.")
    token, expires = auth.issue_code(conn, "reentry", auth.unit_subject(unit_id))
    db.append_event(conn, unit_id, "reentry_code_issued", {"by": _current_actor.get().name, "expires_at": expires})
    conn.commit()
    return {"token": token, "expires_at": expires}


@app.post("/api/staff", status_code=201)
def add_staff_member(body: StaffMemberIn, conn: sqlite3.Connection = Depends(get_conn)) -> dict[str, Any]:
    """A signed-in staff member adds a colleague, who gets a one-time code for their first sign-in."""
    _pilot_only()
    _check_name(body.name.strip())
    staff_id, token, expires = auth.add_staff(conn, body.name.strip(), body.role)
    return {"staff_id": staff_id, "token": token, "expires_at": expires}


# ---------- estate front desk: handover codes, paper notices, help for residents who are not online ----------

class StaffIn(BaseModel):
    staff_name: str = Field(..., min_length=2, max_length=40)


class EstateRenovationIn(StaffIn):
    unit_id: str = Field(..., pattern=UNIT_ID)
    owner_signed: bool  # the owner signed the estate office's paper renovation form
    message: str = Field(..., min_length=1, max_length=1000)
    lang: ReadLang = "en"
    renovation: Renovation


def _paper_json(conn: sqlite3.Connection, row: sqlite3.Row) -> dict[str, Any]:
    unit = _unit_row(conn, row["unit_id"])
    intro = conn.execute("SELECT i.*, u.label AS from_label, u.resident_name AS from_name FROM intros i"
                         " JOIN units u ON u.id = i.from_unit_id WHERE i.id = ?", (row["intro_id"],)).fetchone()
    reno = json.loads(intro["renovation"]) if intro["renovation"] else None
    printed = _intro_in(intro, unit["lang"])  # printed in the household's own language when there is a translation
    if reno and printed and printed["scope"]:
        reno = {**reno, "scope": printed["scope"]}
    return {"id": row["id"], "status": row["status"], "created_at": row["created_at"], "printed_at": row["printed_at"],
            "delivered_at": row["delivered_at"], "delivered_by": row["delivered_by"],
            "unit_id": unit["id"], "unit_label": unit["label"], "lang": unit["lang"],
            "intro_id": intro["id"], "from_label": intro["from_label"], "from_name": intro["from_name"], "sent_by": intro["sent_by"],
            "message": printed["message"] if printed else intro["message"], "translated": bool(printed), "renovation": reno}


@app.get("/api/estate/frontdesk")
def front_desk(phase_id: str | None = None, conn: sqlite3.Connection = Depends(get_conn)) -> dict[str, Any]:
    _require_sign_in_or_demo()
    units = conn.execute("SELECT * FROM units WHERE phase_id = ? ORDER BY id", (_phase_id(conn, phase_id),)).fetchall()
    not_joined = []
    for u in units:
        if u["joined_at"] is not None:
            continue
        code = conn.execute("SELECT * FROM join_codes WHERE unit_id = ? AND used_at IS NULL AND expires_at > ? ORDER BY id DESC LIMIT 1",
                            (u["id"], db.now())).fetchone()
        not_joined.append({"id": u["id"], "label": u["label"], "kind": u["kind"],
                           "code_issued_at": code["created_at"] if code else None, "code_expires_at": code["expires_at"] if code else None})
    ids = [u["id"] for u in units]
    marks = ",".join("?" * len(ids))
    paper = conn.execute(f"SELECT * FROM paper_notices WHERE unit_id IN ({marks}) ORDER BY id DESC", ids).fetchall()
    return {"households": len(units), "joined": sum(u["joined_at"] is not None for u in units), "not_joined": not_joined,
            "paper_notices": [_paper_json(conn, r) for r in paper]}


def _paper_row(conn: sqlite3.Connection, notice_id: int) -> sqlite3.Row:
    row = conn.execute("SELECT * FROM paper_notices WHERE id = ?", (notice_id,)).fetchone()
    if row is None:
        raise HTTPException(404, "paper notice not found")
    return row


@app.post("/api/paper-notices/{notice_id}/printed")
def paper_printed(notice_id: int, body: StaffIn, conn: sqlite3.Connection = Depends(get_conn)) -> dict[str, Any]:
    _require_sign_in_or_demo()
    _check_shared_text(body.staff_name)
    row = _paper_row(conn, notice_id)
    if row["status"] != "to_print":
        raise HTTPException(409, "This notice isn't waiting to be printed.")
    conn.execute("UPDATE paper_notices SET status = 'printed', printed_at = ? WHERE id = ?", (db.now(), notice_id))
    conn.commit()
    return _paper_json(conn, _paper_row(conn, notice_id))


@app.post("/api/paper-notices/{notice_id}/delivered")
def paper_delivered(notice_id: int, body: StaffIn, conn: sqlite3.Connection = Depends(get_conn)) -> dict[str, Any]:
    """Recorded in both home logs, so the renovating owner can show the neighbour was told, even without the app."""
    _require_sign_in_or_demo()
    _check_shared_text(body.staff_name)
    row = _paper_row(conn, notice_id)
    if row["status"] not in ("to_print", "printed"):
        raise HTTPException(409, "This notice was already delivered, or now arrives in the app.")
    staff = f"Estate office ({body.staff_name.strip()})"
    conn.execute("UPDATE paper_notices SET status = 'delivered', delivered_at = ?, delivered_by = ? WHERE id = ?",
                 (db.now(), staff, notice_id))
    owner = conn.execute("SELECT from_unit_id FROM intros WHERE id = ?", (row["intro_id"],)).fetchone()["from_unit_id"]
    payload = {"intro_id": row["intro_id"], "delivered_to": _unit_row(conn, row["unit_id"])["label"], "delivered_by": staff}
    db.append_event(conn, owner, "notice_delivered_on_paper", payload)
    db.append_event(conn, row["unit_id"], "notice_delivered_on_paper", payload)
    conn.commit()
    return _paper_json(conn, _paper_row(conn, notice_id))


@app.post("/api/estate/renovations", status_code=201)
def estate_register_renovation(body: EstateRenovationIn, conn: sqlite3.Connection = Depends(get_conn)) -> dict[str, Any]:
    """An owner who isn't comfortable online fills in the paper form; the estate office registers it for them.
    Same rules as in the app: everyone the work can affect is told, and the staff member's name goes on record."""
    _require_sign_in_or_demo()
    if not body.owner_signed:
        raise HTTPException(422, "The owner needs to sign the paper renovation form first.")
    _check_shared_text(body.staff_name)
    _require_joined(conn, body.unit_id, "Help the owner join first: their consent is needed before Keynection holds their renovation.")
    staff = f"Estate office ({body.staff_name.strip()})"
    return _register_intro(conn, body.unit_id, body.message, body.lang, body.renovation.model_dump(), None, staff)


# ---------- what reaches a household on WhatsApp ----------

def _alerts(conn: sqlite3.Connection, unit_id: str) -> list[dict[str, Any]]:
    """Everything this household is told about, in its own language and in time order: the WhatsApp preview shows
    it, and in a pilot it goes to the phones that turned notifications on. Each alert has a stable reference so it
    goes out once, and the screen a tap opens. Chat alerts never contain the message itself; quiet mode holds back
    chat alerts but not formal notices."""
    me = _unit_row(conn, unit_id)
    p = _profile_row(conn, unit_id)
    lang, quiet_mode = me["lang"], bool(p["quiet_mode"])
    out: list[dict[str, Any]] = []

    now = db.now()

    def add(at: str, key: str, ref: str, buttons: tuple[str, ...] = (), social: bool = False, tab: str = "chats",
            **values: Any) -> None:
        if social and quiet_mode:
            return
        out.append({"at": at, "kind": key, "ref": ref, "social": social, "tab": tab, "lang": lang, "scheduled": at > now,
                    "text": talk.wa_text(key, lang, **{k: str(v) for k, v in values.items()}),
                    "buttons": [talk.wa_button(b, lang) for b in buttons]})

    for r in conn.execute("SELECT i.*, u.resident_name AS name, u.label, x.quiet FROM intro_recipients x"
                          " JOIN intros i ON i.id = x.intro_id JOIN units u ON u.id = i.from_unit_id WHERE x.unit_id = ?", (unit_id,)):
        if r["renovation"]:
            reno = json.loads(r["renovation"])
            scope = (_intro_in(r, lang) or {}).get("scope") or reno["scope"]
            add(r["created_at"], "reno", f"intro:{r['id']}", ("open", "concern"), name=r["name"], label=r["label"], scope=scope,
                start=talk.date_text(reno["start"], lang), end=talk.date_text(reno["end"], lang),
                hours=talk.hours_text(reno, lang), quiet=talk.quiet_note(r["quiet"], lang),
                contractor=talk.contractor_note(reno.get("contractor"), lang))
            # Then, on their own: a reminder to photograph before the work starts, and a check once it has ended.
            first, last = date.fromisoformat(reno["start"]), date.fromisoformat(reno["end"])
            if _local_date(r["created_at"]) < first:
                add(max(_at_local(first - timedelta(days=3), "09:00"), r["created_at"]), "reno_photo", f"intro:{r['id']}:photo",
                    ("photo",), tab="evidence", label=r["label"], start=talk.date_text(reno["start"], lang))
            add(_at_local(last + timedelta(days=1), "10:00"), "reno_done", f"intro:{r['id']}:done", ("all_good", "changed"),
                tab="evidence", label=r["label"], end=talk.date_text(reno["end"], lang))
        else:
            add(r["created_at"], "hello", f"intro:{r['id']}", ("wave",), social=True, name=r["name"], label=r["label"])
    for r in conn.execute("SELECT m.*, u.resident_name AS name, u.label FROM messages m JOIN units u ON u.id = m.from_unit_id"
                          " WHERE m.to_unit_id = ? AND m.withheld = 0 AND m.kind != 'system'", (unit_id,)):
        add(r["created_at"], "voice" if r["kind"] == "voice" else "message", f"message:{r['id']}", ("open",), social=True,
            name=r["name"], label=r["label"])
    for r in conn.execute("SELECT w.*, u.resident_name AS name, u.label FROM waves w JOIN units u ON u.id = w.from_unit_id"
                          " WHERE w.to_unit_id = ?", (unit_id,)):
        if not _blocked(conn, unit_id, r["from_unit_id"]):
            add(r["created_at"], "wave", f"wave:{r['id']}", ("wave",), social=True, name=r["name"], label=r["label"])
    for r in conn.execute("SELECT c.*, u.label FROM contact_requests c JOIN units u ON u.id = c.from_unit_id WHERE c.to_unit_id = ?", (unit_id,)):
        add(r["created_at"], "request", f"request:{r['id']}", ("accept",), social=True, tab="circle", label=r["label"])
    for r in conn.execute("SELECT * FROM concerns WHERE to_unit_id = ? OR from_unit_id = ?", (unit_id, unit_id)):
        other = _unit_row(conn, r["from_unit_id"] if r["to_unit_id"] == unit_id else r["to_unit_id"])
        ref = f"concern:{r['id']}"
        if r["to_unit_id"] == unit_id:  # my renovation
            add(r["created_at"], "concern_new", f"{ref}:new", ("open",), label=other["label"],
                category=talk.category_label(r["category"], lang))
            if r["escalated_at"]:
                add(r["escalated_at"], "concern_estate_owner", f"{ref}:estate", ("open",))
        else:  # a concern I raised
            if r["acknowledged_at"]:
                add(r["acknowledged_at"], "concern_reply", f"{ref}:reply", ("open",), name=other["resident_name"], label=other["label"])
            if r["resolved_at"]:
                add(r["resolved_at"], "concern_sorted", f"{ref}:sorted", ("open",), name=other["resident_name"], label=other["label"])
            if r["escalated_at"]:
                add(r["escalated_at"], "concern_estate_raiser", f"{ref}:estate", ("open",))
        if r["closed_at"]:
            add(r["closed_at"], "concern_closed", f"{ref}:closed", ("open",), note=r["estate_note"] or "-")
    audiences = _audiences(me)
    for r in conn.execute(f"SELECT * FROM notices WHERE phase_id = ? AND audience IN ({','.join('?' * len(audiences))})",
                          (me["phase_id"], *audiences)):
        add(r["created_at"], "notice", f"notice:{r['id']}", ("open",), title=r["title"], body=r["body"])
    for r in conn.execute("SELECT * FROM intros WHERE from_unit_id = ? AND renovation IS NOT NULL", (unit_id,)):
        reno = json.loads(r["renovation"])
        add(_at_local(date.fromisoformat(reno["end"]) + timedelta(days=1), "10:00"), "reno_done_owner", f"intro:{r['id']}:owner",
            ("open",), tab="works", end=talk.date_text(reno["end"], lang))
    for r in conn.execute("SELECT * FROM warranty_tickets WHERE unit_id = ? AND status = 'repair_submitted' AND repaired_at IS NOT NULL", (unit_id,)):
        add(r["repaired_at"], "repair", f"ticket:{r['id']}:{r['repaired_at']}", ("open",), tab="evidence", subject=r["subject"])
    out.sort(key=lambda m: m["at"])
    return out


@app.get("/api/units/{unit_id}/whatsapp", dependencies=[Depends(staff_only)])
def whatsapp_outbox(unit_id: str, conn: sqlite3.Connection = Depends(get_conn)) -> dict[str, Any]:
    """The alerts this household would get from the Keynection WhatsApp Business account, in its own language."""
    me = _unit_row(conn, unit_id)
    if me["joined_at"] is None:
        return {"channel": "paper", "lang": me["lang"], "messages": []}
    if not _profile_row(conn, unit_id)["whatsapp_alerts"]:
        return {"channel": "app", "lang": me["lang"], "messages": []}
    shown = ("at", "kind", "scheduled", "text", "buttons")
    return {"channel": "whatsapp", "lang": me["lang"], "business_name": f"Keynection · {_place_name(conn, me['phase_id'])}",
            "messages": [{k: a[k] for k in shown} for a in _alerts(conn, unit_id)[-25:]]}


def _staff_alerts(conn: sqlite3.Connection) -> list[dict[str, Any]]:
    """What the estate office's phones are told about: a reported message to review, a concern passed to the estate
    office, a new warranty ticket. In English, like SDP's screens, and never the words of a reported message."""
    phases = {r["id"]: r["name"] for r in conn.execute("SELECT id, name FROM phases")}
    out: list[dict[str, Any]] = []

    def add(at: str, ref: str, text: str) -> None:
        out.append({"at": at, "ref": ref, "social": False, "tab": "sdp", "lang": "en", "text": text})

    for r in conn.execute("SELECT r.id, r.created_at, u.phase_id FROM reports r JOIN units u ON u.id = r.reporter_unit_id"):
        add(r["created_at"], f"report:{r['id']}", f"A message was reported in {phases[r['phase_id']]}. Review it in Keynection.")
    for r in conn.execute("SELECT c.id, c.escalated_at, f.label AS from_label, t.label AS to_label, t.phase_id FROM concerns c"
                          " JOIN units f ON f.id = c.from_unit_id JOIN units t ON t.id = c.to_unit_id WHERE c.escalated_at IS NOT NULL"):
        add(r["escalated_at"], f"concern:{r['id']}:estate",
            f"A concern from {r['from_label']} about the renovation at {r['to_label']} ({phases[r['phase_id']]}) is now with the estate office.")
    for r in conn.execute("SELECT w.id, w.opened_at, w.subject, u.label, u.phase_id FROM warranty_tickets w JOIN units u ON u.id = w.unit_id"):
        add(r["opened_at"], f"ticket:{r['id']}:open", f"New warranty ticket from {r['label']} ({phases[r['phase_id']]}): {r['subject']}.")
    out.sort(key=lambda a: a["at"])
    return out


# ---------- real notifications (pilot): each alert once, to the phones that turned them on ----------

SOCIAL_FRESH = timedelta(minutes=30)  # a chat alert later than this stays in the app instead of ringing
PUSH_SECONDS = 30


def _push_contact() -> str:
    """Who push services can contact about this server (part of every signed request)."""
    origin = os.environ.get("KEYNECTION_ORIGIN", "").split(",")[0].strip()
    return os.environ.get("KEYNECTION_PUSH_CONTACT", "").strip() or origin or "mailto:keynection@example.com"


def _push_to(conn: sqlite3.Connection, phone: sqlite3.Row, alert: dict[str, Any]) -> bool:
    """One alert to one phone. A phone its push service no longer knows is forgotten; one that keeps failing too."""
    try:
        status = push.send(conn, phone, alert, _push_contact())
    except (httpx.HTTPError, OSError, ValueError) as e:
        log.warning("push to phone %s failed: %s", phone["id"], e)
        status = 0
    if status in (404, 410):
        conn.execute("DELETE FROM push_subscriptions WHERE id = ?", (phone["id"],))
        return False
    if 200 <= status < 300:
        conn.execute("UPDATE push_subscriptions SET last_sent_at = ?, failures = 0 WHERE id = ?", (db.now(), phone["id"]))
        return True
    conn.execute("UPDATE push_subscriptions SET failures = failures + 1 WHERE id = ?", (phone["id"],))
    conn.execute("DELETE FROM push_subscriptions WHERE id = ? AND failures >= 20", (phone["id"],))
    return False


def _alerts_for(conn: sqlite3.Connection, subject: str) -> list[dict[str, Any]] | None:
    if subject.startswith("unit:"):
        row = conn.execute("SELECT joined_at FROM units WHERE id = ?", (subject[5:],)).fetchone()
        return _alerts(conn, subject[5:]) if row and row["joined_at"] else None
    staff = conn.execute("SELECT 1 FROM staff WHERE id = ? AND revoked_at IS NULL", (subject.removeprefix("staff:"),)).fetchone()
    return _staff_alerts(conn) if staff else None


def dispatch_alerts(now: datetime | None = None) -> int:
    """Send every alert that is due, once, to the phones that turned notifications on; returns how many alerts went
    out. Only what happens after a phone turned them on (see _seen); between 22:00 and 07:00 nothing rings: formal
    notices wait for the morning, chat alerts stay in the app (as do chat alerts older than half an hour)."""
    now = now or datetime.now(timezone.utc)
    local = now.astimezone(MALAYSIA)
    night = local.hour >= 22 or local.hour < 7
    conn = db.connect(db_path())
    try:
        phones: dict[str, list[sqlite3.Row]] = {}
        for row in conn.execute("SELECT * FROM push_subscriptions ORDER BY id"):
            phones.setdefault(row["subject"], []).append(row)
        sent = 0
        for subject, devices in phones.items():
            alerts = _alerts_for(conn, subject)
            if alerts is None:
                continue
            done = {r["ref"] for r in conn.execute("SELECT ref FROM deliveries WHERE subject = ? AND channel = 'push'", (subject,))}
            for a in alerts:
                at = datetime.fromisoformat(a["at"])
                if a["ref"] in done or at > now:
                    continue
                if a["social"] and (night or now - at > SOCIAL_FRESH):
                    status = "skipped"
                elif night:
                    continue  # a formal notice waits for the morning
                else:
                    message = {"title": "Keynection", "body": a["text"], "tag": a["ref"], "url": f"/#tab={a['tab']}", "lang": a["lang"]}
                    for device in devices:
                        _push_to(conn, device, message)
                    status, sent = "sent", sent + 1
                conn.execute("INSERT OR IGNORE INTO deliveries (subject, ref, channel, status, at) VALUES (?, ?, 'push', ?, ?)",
                             (subject, a["ref"], status, now.isoformat(timespec="seconds")))
                done.add(a["ref"])
            conn.commit()
        return sent
    finally:
        conn.close()


async def _alert_sender() -> None:
    """Pilot: look for alerts to send every half minute while the server runs."""
    while True:
        await asyncio.sleep(PUSH_SECONDS)
        try:
            await asyncio.to_thread(dispatch_alerts)
        except Exception:  # never let a failed send stop the server
            log.exception("sending notifications failed")


class PushSubscriptionIn(BaseModel):
    endpoint: str = Field(..., max_length=1000)
    keys: dict[str, str]


class PushEndpointIn(BaseModel):
    endpoint: str = Field(..., max_length=1000)


def _devices(conn: sqlite3.Connection, subject: str) -> int:
    return conn.execute("SELECT COUNT(*) FROM push_subscriptions WHERE subject = ?", (subject,)).fetchone()[0]


def _signed_in() -> auth.Actor:
    _pilot_only()
    actor = _current_actor.get()
    if actor is None:
        raise HTTPException(401, {"code": "signin", "message": "Please sign in again."})
    return actor


@app.get("/api/push/key")
def push_key(conn: sqlite3.Connection = Depends(get_conn)) -> dict[str, str]:
    """This server's public key: a phone accepts notifications signed with it, and from nobody else."""
    _signed_in()
    return {"key": push.public_key(conn)}


@app.get("/api/push/status")
def push_status(conn: sqlite3.Connection = Depends(get_conn)) -> dict[str, int]:
    return {"devices": _devices(conn, _signed_in().subject)}


def _seen(conn: sqlite3.Connection, subject: str) -> None:
    """A phone that turns notifications on starts from now: whatever has already happened stays in the app instead of
    arriving all at once. Reminders still to come (a photo before the works start) will ring."""
    stamp = db.now()
    for a in _alerts_for(conn, subject) or []:
        if a["at"] <= stamp:
            conn.execute("INSERT OR IGNORE INTO deliveries (subject, ref, channel, status, at) VALUES (?, ?, 'push', 'skipped', ?)",
                         (subject, a["ref"], stamp))


@app.post("/api/push/subscriptions")
def push_subscribe(body: PushSubscriptionIn, conn: sqlite3.Connection = Depends(get_conn)) -> dict[str, int]:
    """This phone turns notifications on. A phone that turns them on again (or for someone else) is updated."""
    actor = _signed_in()
    if not push.allowed(body.endpoint):
        raise HTTPException(422, "Notifications can only go through Google's, Apple's, Mozilla's or Microsoft's push service.")
    if not push.valid_keys(body.keys.get("p256dh", ""), body.keys.get("auth", "")):
        raise HTTPException(422, "This phone's notification keys aren't valid. Please try again.")
    conn.execute("INSERT INTO push_subscriptions (subject, endpoint, p256dh, auth, created_at) VALUES (?, ?, ?, ?, ?)"
                 " ON CONFLICT(endpoint) DO UPDATE SET subject = excluded.subject, p256dh = excluded.p256dh,"
                 " auth = excluded.auth, created_at = excluded.created_at, failures = 0",
                 (actor.subject, body.endpoint, body.keys["p256dh"], body.keys["auth"], db.now()))
    _seen(conn, actor.subject)
    conn.commit()
    return {"devices": _devices(conn, actor.subject)}


@app.post("/api/push/subscriptions/remove")
def push_unsubscribe(body: PushEndpointIn, conn: sqlite3.Connection = Depends(get_conn)) -> dict[str, int]:
    """This phone turns notifications off (also when signing out). Only the signed-in person's own phones."""
    actor = _signed_in()
    conn.execute("DELETE FROM push_subscriptions WHERE endpoint = ? AND subject = ?", (body.endpoint, actor.subject))
    conn.commit()
    return {"devices": _devices(conn, actor.subject)}


@app.post("/api/push/test")
def push_test(conn: sqlite3.Connection = Depends(get_conn)) -> dict[str, int]:
    """A first notification to every phone of the signed-in person, so they see it works."""
    actor = _signed_in()
    lang = _unit_row(conn, actor.unit_id)["lang"] if actor.unit_id else "en"
    text = talk.push_test_text(lang) if actor.unit_id else (
        "Notifications are on for this device. Keynection will tell you about reported messages, concerns passed to "
        "the estate office and new warranty tickets.")
    alert = {"title": "Keynection", "body": text, "tag": "test", "url": "/#tab=me" if actor.unit_id else "/#tab=sdp", "lang": lang}
    results = [_push_to(conn, d, alert) for d in conn.execute("SELECT * FROM push_subscriptions WHERE subject = ?", (actor.subject,)).fetchall()]
    conn.commit()
    return {"sent": sum(results), "failed": len(results) - sum(results)}


# ---------- phase setup ----------

class PlannerIn(BaseModel):
    lorongs: int = Field(0, ge=0, le=60)
    houses_per_row: int = Field(10, ge=2, le=80)
    facing: bool = True
    blocks: int = Field(0, ge=0, le=12)
    floors: int = Field(10, ge=1, le=60)
    units_per_floor: int = Field(8, ge=2, le=20)


@app.post("/api/planner/preview")
def planner_preview(body: PlannerIn) -> dict[str, Any]:
    """Work out every household's circle and notice zones for a new phase. Read-only: nothing is saved."""
    homes = home_count(body.lorongs, body.houses_per_row, body.facing, body.blocks, body.floors, body.units_per_floor)
    if homes == 0:
        raise HTTPException(422, "Add at least one lorong or one block.")
    if homes > MAX_HOMES:
        raise HTTPException(422, f"The prototype sets up phases of up to {MAX_HOMES} homes at a time.")
    return plan_phase(body.lorongs, body.houses_per_row, body.facing, body.blocks, body.floors, body.units_per_floor)


# ---------- built web app (demo mode: one process, one port) ----------
# Mounted last so every /api route above takes precedence. Present only after `npm run build`.
STATIC_DIR = Path(setting("STATIC_DIR") or Path(__file__).resolve().parents[2] / "frontend" / "dist")
if STATIC_DIR.is_dir():
    app.mount("/", StaticFiles(directory=STATIC_DIR, html=True), name="web")
