"""PDPA promises in a pilot: what the privacy notice says is what the code does.

- Messages, photos and records are kept until one year after the home's defect liability period ends (24 months
  after the keys, so three years), or one year after they were made if that is later. The home log stays with the
  unit, and anything still being dealt with (an open warranty ticket, a report not yet reviewed) stays until done.
- A household corrects the name its neighbours see, and closes its account itself or at the estate office.
- Backups are kept 14 days, so deleted data doesn't live on in them.
"""
import io
import json
import os
import sqlite3
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient
from PIL import Image

TODAY = datetime.now(timezone(timedelta(hours=8))).date()
RENO = {"scope": "Extend kitchen (rear wall)", "start": (TODAY + timedelta(days=5)).isoformat(),
        "end": (TODAY + timedelta(days=20)).isoformat(), "contractor": "ABC Renovation", "contractor_cidb_registered": True}
RECENT_KEYS = (TODAY - timedelta(days=14)).isoformat()  # like the demo: keys two weeks ago


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("JIRAN_DB_PATH", str(tmp_path / "test.db"))
    monkeypatch.setenv("JIRAN_DEMO_MODE", "1")  # seed the fictional phase, then switch to pilot mode
    monkeypatch.delenv("JIRAN_SITE_PASSWORD", raising=False)
    from app.main import app

    with TestClient(app) as c:
        monkeypatch.setenv("JIRAN_DEMO_MODE", "0")
        yield c


def _db() -> sqlite3.Connection:
    from app import db

    return db.connect(os.environ["JIRAN_DB_PATH"])


def _count(sql: str, *args) -> int:
    conn = _db()
    try:
        return conn.execute(sql, args).fetchone()[0]
    finally:
        conn.close()


def _keys_handed_over(unit_id: str, day: str) -> None:
    conn = _db()
    conn.execute("UPDATE units SET handover_date = ? WHERE id = ?", (day, unit_id))
    conn.commit()
    conn.close()


def _jpeg() -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (1200, 900), (200, 200, 200)).save(buf, "JPEG")
    return buf.getvalue()


def _sweep(when: str | datetime) -> dict:
    from app.main import sweep_records

    return sweep_records(when if isinstance(when, datetime) else datetime.fromisoformat(when).replace(tzinfo=timezone.utc))


def _period_over(keys: str) -> datetime:
    """When a home's defect liability period (24 months) plus one year is over."""
    from app.privacy import _add_months

    return datetime.combine(_add_months(datetime.fromisoformat(keys).date(), 36), datetime.min.time(), timezone.utc)


def _say(client, sign_in, frm: str, to: str, text: str) -> int:
    client.cookies.clear()
    sign_in(client, frm)
    r = client.post("/api/messages", json={"from_unit_id": frm, "to_unit_id": to, "body": text})
    assert r.status_code == 201, r.text
    return r.json()["id"]


# ---------- how long ----------

def test_records_stay_until_a_year_after_the_defect_liability_period(client, sign_in):
    """Keys two weeks ago: the 24-month period ends, plus a year, three years after the keys."""
    _keys_handed_over("T-11", RECENT_KEYS)
    _keys_handed_over("T-12", RECENT_KEYS)
    message = _say(client, sign_in, "T-12", "T-11", "Hello neighbour")
    log = _count("SELECT COUNT(*) FROM events WHERE unit_id = 'T-11'")
    over = _period_over(RECENT_KEYS)
    _sweep(over - timedelta(days=20))
    assert _count("SELECT COUNT(*) FROM messages WHERE id = ?", message) == 1
    _sweep(over + timedelta(days=1))
    assert _count("SELECT COUNT(*) FROM messages WHERE id = ?", message) == 0
    assert _count("SELECT COUNT(*) FROM events WHERE unit_id = 'T-11'") == log  # the home log stays with the unit


def test_after_that_a_record_is_kept_a_year_from_when_it_was_made(client, sign_in):
    _keys_handed_over("T-11", "2021-10-01")  # long past the period plus a year
    _keys_handed_over("T-10", "2021-10-01")
    _keys_handed_over("T-12", RECENT_KEYS)  # a newer neighbour: shared records follow the later date
    old_pair = _say(client, sign_in, "T-10", "T-11", "Morning")
    shared = _say(client, sign_in, "T-12", "T-11", "Hi")
    made = datetime.now(timezone.utc)
    _sweep(made + timedelta(days=330))
    assert _count("SELECT COUNT(*) FROM messages WHERE id IN (?, ?)", old_pair, shared) == 2
    _sweep(made + timedelta(days=370))  # a year after they were made
    assert _count("SELECT COUNT(*) FROM messages WHERE id = ?", old_pair) == 0
    assert _count("SELECT COUNT(*) FROM messages WHERE id = ?", shared) == 1  # T-12's period isn't over


def test_renovation_records_photos_and_waves_go_together_when_their_time_is_up(client, sign_in, tmp_path):
    for unit in ("T-11", "T-12", "T-13", "T-21", "T-22", "T-23"):
        _keys_handed_over(unit, RECENT_KEYS)
    client.cookies.clear()
    sign_in(client, "T-12")
    intro = client.post("/api/intros", json={"from_unit_id": "T-12", "message": "Hi", "renovation": RENO}).json()["id"]
    client.post("/api/waves", json={"from_unit_id": "T-12", "to_unit_id": "T-11"})
    client.cookies.clear()
    sign_in(client, "T-11")
    photo = client.post("/api/units/T-11/photos", data={"kind": "baseline", "subject": "Shared wall", "renovation_intro_id": str(intro)},
                        files={"file": ("wall.jpg", _jpeg(), "image/jpeg")}).json()
    client.post("/api/concerns", json={"intro_id": intro, "from_unit_id": "T-11", "category": "noise_hours", "note": "Too early"})
    from app.main import data_dir

    stored = data_dir("photos") / f"{photo['id']}.jpg"
    assert stored.exists()
    over = _period_over(RECENT_KEYS)
    _sweep(over - timedelta(days=20))
    assert _count("SELECT COUNT(*) FROM intros WHERE id = ?", intro) == 1 and stored.exists()
    _sweep(over + timedelta(days=1))
    assert _count("SELECT COUNT(*) FROM intros WHERE id = ?", intro) == 0
    assert _count("SELECT COUNT(*) FROM intro_recipients WHERE intro_id = ?", intro) == 0
    assert _count("SELECT COUNT(*) FROM concerns WHERE intro_id = ?", intro) == 0
    assert _count("SELECT COUNT(*) FROM waves WHERE to_unit_id = 'T-11'") == 0
    assert _count("SELECT COUNT(*) FROM photos WHERE id = ?", photo["id"]) == 0 and not stored.exists()


def test_a_warranty_ticket_still_open_is_never_swept_away(client, monkeypatch):
    from test_layers_2_4 import _warranty_ticket

    monkeypatch.setenv("JIRAN_DEMO_MODE", "1")
    ticket = _warranty_ticket(client)
    monkeypatch.setenv("JIRAN_DEMO_MODE", "0")
    _sweep("2032-01-01")
    assert _count("SELECT COUNT(*) FROM warranty_tickets WHERE id = ?", ticket["id"]) == 1  # SDP still owes a repair
    conn = _db()
    conn.execute("UPDATE warranty_tickets SET status = 'closed', closed_at = '2027-01-10T02:00:00+00:00' WHERE id = ?", (ticket["id"],))
    conn.commit()
    conn.close()
    _sweep("2032-01-01")
    assert _count("SELECT COUNT(*) FROM warranty_tickets WHERE id = ?", ticket["id"]) == 0
    assert _count("SELECT COUNT(*) FROM incidents") == 0 and _count("SELECT COUNT(*) FROM photos WHERE unit_id = 'T-11'") == 0


# ---------- correcting ----------

def test_a_household_corrects_the_name_its_neighbours_see(client, sign_in):
    sign_in(client, "T-11")
    assert client.put("/api/units/T-11/profile", json={"name": "Siti Aminah"}).status_code == 200
    for bad in ("Call 012-345 6789", "SDP Estate Office"):
        assert client.put("/api/units/T-11/profile", json={"name": bad}).status_code == 422
    client.cookies.clear()
    sign_in(client, "T-12")
    circle = {n["id"]: n for n in client.get("/api/units/T-12/directory").json()["circle"]}
    assert circle["T-11"]["resident_name"] == "Siti Aminah"


# ---------- closing an account ----------

def _with_everything(client, sign_in) -> dict:
    """T-11 uses every part of Keynection, then T-12 writes to it."""
    client.cookies.clear()
    sign_in(client, "T-11")
    mine = client.post("/api/messages", json={"from_unit_id": "T-11", "to_unit_id": "T-12", "body": "My own words"}).json()["id"]
    client.put("/api/units/T-11/profile", json={"bio": "Two kids and a cat"})
    client.post("/api/units/T-11/delegates", json={"name": "Adam", "relation": "child", "consent": True})
    photo = client.post("/api/units/T-11/photos", data={"kind": "baseline", "subject": "Kitchen wall"},
                        files={"file": ("wall.jpg", _jpeg(), "image/jpeg")}).json()["id"]
    intro = client.post("/api/intros", json={"from_unit_id": "T-11", "message": "Hi", "renovation": {**RENO, "works_type": "light"}}).json()["id"]
    theirs = _say(client, sign_in, "T-12", "T-11", "Their words")
    client.cookies.clear()
    sign_in(client, "T-11")
    return {"mine": mine, "photo": photo, "intro": intro, "theirs": theirs}


def test_a_household_closes_its_own_account(client, sign_in):
    made = _with_everything(client, sign_in)
    assert client.post("/api/units/T-11/close", json={"confirm": "No. 12"}).status_code == 422  # must type its own unit
    r = client.post("/api/units/T-11/close", json={"confirm": "No. 11"})
    assert r.status_code == 200, r.text
    assert client.get("/api/units/T-11/conversations").status_code == 401  # signed out everywhere
    conn = _db()
    unit = conn.execute("SELECT * FROM units WHERE id = 'T-11'").fetchone()
    assert unit["joined_at"] is None and unit["resident_name"] == "No. 11" and unit["record_name"] is None
    assert tuple(conn.execute("SELECT bio, quiet_times FROM profiles WHERE unit_id = 'T-11'").fetchone()) == ("", "[]")
    assert conn.execute("SELECT COUNT(*) FROM delegates WHERE unit_id = 'T-11'").fetchone()[0] == 0
    assert conn.execute("SELECT COUNT(*) FROM messages WHERE id = ?", (made["mine"],)).fetchone()[0] == 0  # its own words
    assert conn.execute("SELECT COUNT(*) FROM messages WHERE id = ?", (made["theirs"],)).fetchone()[0] == 1  # the neighbour's
    assert conn.execute("SELECT COUNT(*) FROM photos WHERE id = ?", (made["photo"],)).fetchone()[0] == 0
    assert conn.execute("SELECT COUNT(*) FROM intros WHERE id = ?", (made["intro"],)).fetchone()[0] == 1  # a record for the neighbours
    assert conn.execute("SELECT COUNT(*) FROM sessions WHERE subject = 'unit:T-11'").fetchone()[0] == 0
    last = conn.execute("SELECT type, payload FROM events WHERE unit_id = 'T-11' ORDER BY id DESC LIMIT 1").fetchone()
    assert last["type"] == "account_closed" and "household" in last["payload"]
    conn.close()
    client.cookies.clear()
    sign_in(client, "T-12")
    names = {n["id"]: n["resident_name"] for n in client.get("/api/units/T-12/directory").json()["circle"]}
    assert names["T-11"] == "No. 11"  # neighbours now see the unit only


def test_a_home_whose_account_closed_can_join_again(client, sign_in):
    client.cookies.clear()
    sign_in(client, "T-11")
    client.post("/api/units/T-11/close", json={"confirm": "No. 11"})
    client.cookies.clear()
    sign_in(client, "staff:Farah")
    token = client.post("/api/units/T-11/join-code").json()["token"]  # say the house was sold
    client.cookies.clear()
    joined = client.post("/api/join", json={"token": token, "display_name": "New Owner", "lang": "en", "consent": True})
    assert joined.status_code == 200 and joined.json()["resident_name"] == "New Owner"


def test_the_estate_office_closes_an_account_after_checking_id(client, sign_in):
    sign_in(client, "staff:Farah")
    body = {"unit_id": "T-13", "staff_name": "Farah", "id_checked": False}
    assert client.post("/api/estate/close-account", json=body).status_code == 422
    assert client.post("/api/estate/close-account", json={**body, "id_checked": True}).status_code == 200
    conn = _db()
    last = conn.execute("SELECT payload FROM events WHERE unit_id = 'T-13' ORDER BY id DESC LIMIT 1").fetchone()[0]
    assert "Farah" in last and _count("SELECT COUNT(*) FROM units WHERE id = 'T-13' AND joined_at IS NULL") == 1
    conn.close()


def test_a_reported_message_stays_for_the_estate_offices_review(client, sign_in):
    reported = _say(client, sign_in, "T-12", "T-11", "You will regret this")
    other = _say(client, sign_in, "T-12", "T-11", "Never mind")
    client.cookies.clear()
    sign_in(client, "T-11")
    client.post(f"/api/messages/{reported}/report", json={"unit_id": "T-11", "reason": "threat"})
    client.cookies.clear()
    sign_in(client, "T-12")
    assert client.post("/api/units/T-12/close", json={"confirm": "No. 12"}).status_code == 200
    assert _count("SELECT COUNT(*) FROM messages WHERE id = ?", reported) == 1
    assert _count("SELECT COUNT(*) FROM messages WHERE id = ?", other) == 0


def test_the_demo_households_cant_be_closed(client, monkeypatch):
    monkeypatch.setenv("JIRAN_DEMO_MODE", "1")
    assert client.post("/api/units/T-11/close", json={"confirm": "No. 11"}).status_code == 409


# ---------- backups ----------

def test_backups_are_kept_14_days_and_follow_deletions(tmp_path):
    from app import backup, db

    source = tmp_path / "data" / "app.db"
    conn = db.connect(str(source))
    db.init_db(conn)
    conn.close()
    photos = tmp_path / "data" / "photos"
    photos.mkdir()
    (photos / "a.jpg").write_bytes(b"one")
    (photos / "b.jpg").write_bytes(b"two")
    folder = tmp_path / "backups"
    folder.mkdir()
    old = datetime(2026, 10, 11, 2, 0, tzinfo=timezone.utc)
    for days in range(1, 21):  # twenty earlier daily copies
        (folder / f"keynection-{(old - timedelta(days=days)):%Y%m%d-%H%M}.db").write_bytes(b"old")
    made = backup.backup_now(str(source), folder, {"photos": photos}, now=old)
    copies = sorted(folder.glob("keynection-*.db"))
    assert made in copies and len(copies) == 14  # today's and the 13 before it
    with sqlite3.connect(made) as copy:
        assert copy.execute("SELECT COUNT(*) FROM units").fetchone()[0] == 36  # a working database
    assert sorted(p.name for p in (folder / "photos").iterdir()) == ["a.jpg", "b.jpg"]
    (photos / "a.jpg").unlink()  # a photo deleted (closed account, or its time was up)
    backup.backup_now(str(source), folder, {"photos": photos}, now=old + timedelta(days=1))
    assert sorted(p.name for p in (folder / "photos").iterdir()) == ["b.jpg"]


def test_the_data_download_has_a_safe_file_name_for_real_addresses():
    from app.main import _export_name

    assert _export_name("No. 2 Jln 2/1") == "keynection-No2Jln21-my-data.json"
    assert _export_name("B-12-3A") == "keynection-B-12-3A-my-data.json"
