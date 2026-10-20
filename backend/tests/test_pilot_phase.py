"""Pilot: a real phase comes from SDP's handover list (a CSV, one row per home). Keynection checks every row and
shows what it would do before saving; the township's own names then appear everywhere instead of Taman Demo."""
import os

import pytest
from fastapi.testclient import TestClient

# Jalan Contoh 2/1: houses on both sides of the road, numbered from the same end so that No. 1 faces No. 2.
# Jalan Contoh 2/2: semi-detached pairs, so a gap in the positions (no 3) keeps the pairs apart.
# Block B: three floors of three units.
HEADER = "unit,label,type,street,row,facing_row,pos,block,floor,owner,handover,language"
TERRACES = [
    "C21-01,No. 1 Jln 2/1,terrace,Jalan Contoh 2/1,north,south,1,,,Tan Ah Kow,2026-09-01,zh",
    "C21-03,No. 3 Jln 2/1,terrace,Jalan Contoh 2/1,north,south,2,,,Siti Aminah,2026-09-01,BM",
    "C21-05,No. 5 Jln 2/1,terrace,Jalan Contoh 2/1,north,south,3,,,Rajesh Kumar,2026-09-01,Tamil",
    "C21-02,No. 2 Jln 2/1,terrace,Jalan Contoh 2/1,south,north,1,,,Lim Mei Ling,2/9/2026,",
    "C21-04,No. 4 Jln 2/1,terrace,Jalan Contoh 2/1,south,north,2,,,,2/9/2026,English",
    "C21-06,No. 6 Jln 2/1,terrace,Jalan Contoh 2/1,south,north,3,,,Wong Kar Wai,2/9/2026,Chinese",
    "C22-01,No. 1 Jln 2/2,semi-d,Jalan Contoh 2/2,,,1,,,Ahmad Faiz,2026-09-03,ms",
    "C22-03,No. 3 Jln 2/2,semi-d,Jalan Contoh 2/2,,,2,,,Chong Wei,2026-09-03,zh",
    "C22-05,No. 5 Jln 2/2,semi-d,Jalan Contoh 2/2,,,4,,,Devi Rani,2026-09-03,ta",
    "C22-07,No. 7 Jln 2/2,semi-d,Jalan Contoh 2/2,,,5,,,Grace Ng,2026-09-03,en",
]
FLATS = [f"B-{f}-{p},B-{f}-{p},apartment,,,,{p},B,{f},Owner {f}{p},2026-09-10,ms" for f in (1, 2, 3) for p in (1, 2, 3)]
LIST = "\n".join([HEADER, *TERRACES, *FLATS]) + "\n"


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("KEYNECTION_DB_PATH", str(tmp_path / "pilot.db"))
    monkeypatch.setenv("KEYNECTION_DEMO_MODE", "0")  # a real pilot: starts with no phase at all
    monkeypatch.delenv("KEYNECTION_SITE_PASSWORD", raising=False)
    from app.main import app

    with TestClient(app) as c:
        yield c


@pytest.fixture()
def staff(client, sign_in):
    sign_in(client, "staff:Farah")
    return client


def _as_staff(client) -> None:
    """Sign the client back in as the staff member made by the `staff` fixture."""
    from app import auth, db

    conn = db.connect(os.environ["KEYNECTION_DB_PATH"])
    try:
        staff_id = conn.execute("SELECT id FROM staff ORDER BY id").fetchone()[0]
        client.cookies.clear()
        client.cookies.set(auth.SESSION_COOKIE, auth.new_session(conn, f"staff:{staff_id}"))
    finally:
        conn.close()


def _join(client, unit_id: str, token: str | None = None) -> None:
    """A household from the imported list joins (signed in as it afterwards)."""
    if token is None:
        _as_staff(client)
        token = client.post(f"/api/units/{unit_id}/join-code").json()["token"]
    client.cookies.clear()
    r = client.post("/api/join", json={"token": token, "display_name": "Mei Ling", "lang": "zh", "consent": True})
    assert r.status_code == 200, r.text


def _preview(client, text=LIST, **extra):
    return client.post("/api/phases/import/preview", json={"name": "Taman Contoh Phase 2", "csv": text, **extra})


def _import(client, text=LIST, **extra):
    return client.post("/api/phases/import", json={"name": "Taman Contoh Phase 2", "csv": text, **extra})


def _lines(report, kind="errors"):
    return {e["line"]: e["message"] for e in report[kind]}


def _db_text() -> str:
    from app import db

    conn = db.connect(os.environ["KEYNECTION_DB_PATH"])
    try:
        return str([tuple(r) for r in conn.execute("SELECT * FROM units")])
    finally:
        conn.close()


# ---------- checking the list before anything is saved ----------

def test_the_preview_works_out_every_circle_and_saves_nothing(staff):
    r = _preview(staff).json()
    assert r["errors"] == [] and r["homes"] == 19 and r["added"] == 19
    assert r["streets"] == ["Jalan Contoh 2/1", "Jalan Contoh 2/2"] and r["blocks"] == ["B"]
    circles = {s["label"]: sorted(s["circle"]) for s in r["sample"]}
    assert circles["No. 1 Jln 2/1"] == ["No. 2 Jln 2/1", "No. 3 Jln 2/1", "No. 4 Jln 2/1"]  # beside and across
    assert circles["No. 3 Jln 2/2"] == ["No. 1 Jln 2/2"]  # its semi-D twin only
    assert circles["B-2-2"] == ["B-1-2", "B-2-1", "B-2-3", "B-3-2"]
    assert staff.get("/api/phases").json() == []  # nothing saved


def test_every_mistake_is_named_with_its_line(staff):
    bad = "\n".join([
        HEADER,
        TERRACES[0],
        "C21-01,No. 9,terrace,Jalan Contoh 2/1,north,south,9,,,X,2026-09-01,en",       # 3: same unit code again
        "C21-11,No. 11,bungalow,Jalan Contoh 2/1,north,south,10,,,X,2026-09-01,en",    # 4: unknown type
        "C21-13,No. 13,terrace,,north,south,11,,,X,2026-09-01,en",                     # 5: no street
        "C21-15,No. 15,terrace,Jalan Contoh 2/1,north,south,first,,,X,2026-09-01,en",  # 6: position not a number
        "C21-17,No. 17,terrace,Jalan Contoh 2/1,north,south,1,,,X,2026-09-01,en",      # 7: same place as line 2
        "C21-19,No. 19,terrace,Jalan Contoh 2/1,north,south,12,,,X,31/2/2026,en",      # 8: no such date
        "C 21/21,No. 21,terrace,Jalan Contoh 2/1,north,south,13,,,X,2026-09-01,en",    # 9: unit code with a space
        "B-9-1,B-9-1,apartment,,,,1,B,,X,2026-09-01,en",                               # 10: no floor
        "C21-23,No. 1 Jln 2/1,terrace,Jalan Contoh 2/1,north,south,14,,,X,2026-09-01,en",  # 11: label taken
    ])
    r = _preview(staff, bad).json()
    errors = _lines(r)
    assert set(errors) == {3, 4, 5, 6, 7, 8, 9, 10, 11}
    assert "C21-01" in errors[3] and "bungalow" in errors[4] and "street" in errors[5].lower()
    assert "line 2" in errors[7] and "floor" in errors[10].lower() and "No. 1 Jln 2/1" in errors[11]
    assert _import(staff, bad).status_code == 422  # nothing is saved while any line is wrong
    assert staff.get("/api/phases").json() == []


def test_the_list_needs_its_key_columns(staff):
    r = _preview(staff, "unit,label,owner\nC21-01,No. 1,Tan\n").json()
    assert {e["line"] for e in r["errors"]} == {1}
    assert all(c in r["errors"][0]["message"] for c in ("type", "pos", "handover"))


def test_warnings_point_at_likely_slips_without_blocking(staff):
    odd = "\n".join([HEADER, *TERRACES[:3],
                     "C30-01,No. 1 Jln 3,terrace,Jalan Contoh 3,,park,1,,,X,2026-09-01,Japanese"])  # line 5
    r = _preview(staff, odd).json()
    assert r["errors"] == []
    warnings = [w for w in r["warnings"] if w["line"] == 5]
    assert any("park" in w["message"] for w in warnings)  # a facing row that isn't in the list
    assert any("no neighbours" in w["message"] for w in warnings)
    assert any("Japanese" in w["message"] for w in warnings)  # English is used; the owner chooses at joining


def test_contact_details_in_the_list_are_left_out(staff):
    lines = LIST.strip().splitlines()
    with_phone = "\n".join([lines[0] + ",phone"] + [ln + ",0123456789" for ln in lines[1:]])
    r = _preview(staff, with_phone).json()
    assert r["errors"] == [] and any("phone" in w["message"] for w in r["warnings"])
    assert _import(staff, with_phone).status_code == 200
    assert "0123456789" not in _db_text()  # owners give their own contact details when they join


def test_excel_files_with_a_byte_order_mark_or_semicolons_read_the_same(staff):
    excel = "﻿" + LIST.replace(",", ";")
    r = _preview(staff, excel).json()
    assert r["errors"] == [] and r["homes"] == 19


# ---------- saving ----------

def test_saving_creates_the_phase_with_every_home_and_its_handover_record(staff):
    r = _import(staff)
    assert r.status_code == 200, r.text
    phase = r.json()["phase"]
    assert phase["name"] == "Taman Contoh Phase 2" and phase["homes"] == 19 and phase["joined"] == 0
    assert phase["imported_by"] == "Farah"
    homes = {u["id"]: u for u in staff.get("/api/units", params={"phase_id": phase["id"]}).json()}
    assert homes["C21-02"]["street"] == "Jalan Contoh 2/1" and homes["C21-02"]["label"] == "No. 2 Jln 2/1"
    assert homes["C21-03"]["lang"] == "ms" and homes["C21-02"]["lang"] == "en"  # BM understood; blank is English
    assert homes["C21-02"]["handover_date"] == "2026-09-02"  # day first, as written in Malaysia
    assert homes["C21-01"]["resident_name"] == "No. 1 Jln 2/1"  # neighbours see the address until the owner joins
    from app import db

    conn = db.connect(os.environ["KEYNECTION_DB_PATH"])
    first = conn.execute("SELECT type, payload FROM events WHERE unit_id = 'C21-01' ORDER BY id LIMIT 1").fetchone()
    assert first["type"] == "handover" and "2026-09-01" in first["payload"]  # every home log starts with the handover


def test_a_row_behind_is_read_from_the_list_and_stays_out_of_the_circle(staff):
    # Two rows back to back across a fence ("back" is read as back_row); the house behind is told about works that
    # reach the back (neighbours.py), but the circle is still only the homes beside and across the road.
    text = "\n".join(["unit,label,type,street,row,back,pos,handover",
                      "F-1,No. 1 Jln A,terrace,Jalan A,front,rear,1,2026-09-01", "F-2,No. 2 Jln A,terrace,Jalan A,front,rear,2,2026-09-01",
                      "R-1,No. 1 Jln B,terrace,Jalan B,rear,front,1,2026-09-01", "R-2,No. 2 Jln B,terrace,Jalan B,rear,front,2,2026-09-01",
                      "S-1,No. 1 Jln C,terrace,Jalan C,solo,lane,1,2026-09-01"]) + "\n"
    r = _preview(staff, text).json()
    assert r["errors"] == [] and any(w["line"] == 6 and "Back row 'lane'" in w["message"] for w in r["warnings"])
    assert {s["label"]: s["circle"] for s in r["sample"]}["No. 1 Jln A"] == ["No. 2 Jln A"]
    phase = _import(staff, text).json()["phase"]
    homes = {u["id"]: u for u in staff.get("/api/units", params={"phase_id": phase["id"]}).json()}
    assert homes["F-1"]["back_row"] == "rear" and homes["R-2"]["back_row"] == "front"


def test_importing_again_adds_new_homes_and_never_moves_a_household_that_joined(staff):
    phase_id = _import(staff).json()["phase"]["id"]
    _join(staff, "C21-02")
    _as_staff(staff)
    later = LIST + "C21-07,No. 7 Jln 2/1,terrace,Jalan Contoh 2/1,north,south,4,,,New Owner,2026-10-01,en\n"
    later = later.replace("Wong Kar Wai", "Wong Kar Wai Jr")  # an owner name corrected before joining
    r = _preview(staff, later, phase_id=phase_id).json()
    assert (r["added"], r["updated"], r["errors"]) == (1, 1, [])
    moved = later.replace("C21-02,No. 2 Jln 2/1,terrace,Jalan Contoh 2/1,south,north,1",
                          "C21-02,No. 2 Jln 2/1,terrace,Jalan Contoh 2/1,south,north,7")
    errors = _preview(staff, moved, phase_id=phase_id).json()["errors"]
    assert errors and "joined" in errors[0]["message"]
    assert _import(staff, later, phase_id=phase_id).json()["phase"]["homes"] == 20


def test_a_unit_code_belongs_to_one_phase_only(staff):
    _import(staff)
    r = staff.post("/api/phases/import/preview", json={"name": "Another Phase", "csv": "\n".join([HEADER, TERRACES[0]])}).json()
    assert r["errors"] and "Taman Contoh Phase 2" in r["errors"][0]["message"]


def test_only_signed_in_staff_import(client):
    assert _preview(client).status_code == 401
    assert _import(client).status_code == 401


# ---------- the township's own names, from the list ----------

def test_a_household_from_the_list_sees_its_real_street_and_estate_office(staff):
    _import(staff)
    _join(staff, "C21-02")
    assert staff.get("/api/units/C21-02/directory").json()["ring2_label"] == "Jalan Contoh 2/1"
    assert staff.get("/api/units/C21-02/official").json()["name"] == "Taman Contoh Phase 2 Estate Office"
    me = staff.get("/api/auth/me").json()
    phases = staff.get("/api/phases").json()
    assert me["phase_id"] == phases[0]["id"] and phases[0]["name"] == "Taman Contoh Phase 2"
    assert len(staff.get("/api/units").json()) == 19  # no phase named: its own


def test_notices_go_to_a_real_street_or_block(staff):
    phase_id = _import(staff).json()["phase"]["id"]
    sent = staff.post("/api/notices", params={"phase_id": phase_id},
                      json={"audience": "street:Jalan Contoh 2/1", "title": "Drain works", "body": "Drains cleared on Monday."})
    assert sent.status_code == 201
    assert staff.post("/api/notices", params={"phase_id": phase_id},
                      json={"audience": "street:Jalan Demo 1", "title": "Drain works", "body": "Not a street here."}).status_code == 422
    _join(staff, "C21-02")
    assert [n["title"] for n in staff.get("/api/units/C21-02/notices").json()] == ["Drain works"]
    _join(staff, "B-2-2")
    assert staff.get("/api/units/B-2-2/notices").json() == []


def test_staff_name_the_phase_when_there_is_more_than_one(staff):
    first = _import(staff).json()["phase"]["id"]
    assert staff.get("/api/dashboard").status_code == 200  # one phase: no need to say which
    staff.post("/api/phases/import", json={"name": "Taman Contoh Phase 3",
                                           "csv": "\n".join([HEADER, "C31-01,No. 1 Jln 3/1,terrace,Jalan Contoh 3/1,,,1,,,A,2026-10-01,en"])})
    r = staff.get("/api/dashboard")
    assert r.status_code == 422 and r.json()["detail"]["code"] == "phase"
    assert staff.get("/api/dashboard", params={"phase_id": first}).status_code == 200
    assert len(staff.get("/api/phases").json()) == 2


def test_with_no_phase_yet_staff_are_told_to_import_one(staff):
    r = staff.get("/api/dashboard")
    assert r.status_code == 409 and r.json()["detail"]["code"] == "no_phase"


# ---------- welcome-pack codes for a whole phase ----------

def test_one_click_makes_a_code_for_every_home_still_to_join(staff):
    phase_id = _import(staff).json()["phase"]["id"]
    batch = staff.post(f"/api/phases/{phase_id}/join-codes", json={}).json()
    assert len(batch["codes"]) == 19
    card = next(c for c in batch["codes"] if c["unit_id"] == "C21-01")
    assert card["owner"] == "Tan Ah Kow" and card["label"] == "No. 1 Jln 2/1" and card["street"] == "Jalan Contoh 2/1"
    _join(staff, "C21-01", card["token"])
    _as_staff(staff)
    again = staff.post(f"/api/phases/{phase_id}/join-codes", json={}).json()["codes"]
    assert len(again) == 18 and all(c["unit_id"] != "C21-01" for c in again)  # joined homes are left out
    old = next(c for c in batch["codes"] if c["unit_id"] == "C21-02")["token"]
    assert staff.post("/api/join/lookup", json={"token": old}).status_code == 404  # a new sheet cancels the old codes


def test_a_batch_can_be_just_the_homes_handed_over_in_a_date_range(staff):
    phase_id = _import(staff).json()["phase"]["id"]
    codes = staff.post(f"/api/phases/{phase_id}/join-codes",
                       json={"handover_from": "2026-09-03", "handover_to": "2026-09-03"}).json()["codes"]
    assert sorted(c["unit_id"] for c in codes) == ["C22-01", "C22-03", "C22-05", "C22-07"]
    assert all(c["expires_at"] >= "2026-09-17" for c in codes)  # at least two weeks after the keys are handed over
