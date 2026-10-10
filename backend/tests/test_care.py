import sqlite3

import pytest
from fastapi.testclient import TestClient


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("JIRAN_DB_PATH", str(tmp_path / "test.db"))
    monkeypatch.setenv("JIRAN_DEMO_MODE", "1")
    from app.main import app

    with TestClient(app) as c:
        c.db_path = str(tmp_path / "test.db")
        yield c


def _voice(client, frm="T-12", to="T-11"):
    return client.post("/api/messages/voice", data={"from_unit_id": frm, "to_unit_id": to, "duration": "3"},
                       files={"file": ("v.wav", b"RIFF" + b"\0" * 4 + b"WAVE" + b"\0" * 200, "audio/wav")}).json()


def _backdate(client, message_id, days=31):
    with sqlite3.connect(client.db_path) as db:
        db.execute("UPDATE messages SET created_at = datetime('now', ?) WHERE id = ?", (f"-{days} days", message_id))


# ---------- voice retention and moderation ----------

def test_voice_notes_are_deleted_after_30_days(client):
    msg = _voice(client)
    _backdate(client, msg["id"])
    client.get("/api/units/T-11/conversations")  # any conversation load runs the clean-up
    item = next(i for i in client.get("/api/units/T-11/conversations/T-12").json()["items"] if i["type"] == "message")
    assert item["expired"] is True
    assert client.get(f"/api/messages/{msg['id']}/voice?unit_id=T-11").status_code == 410


def test_reported_voice_is_kept_until_reviewed_and_playable_by_moderators(client):
    msg = _voice(client)
    rep = client.post(f"/api/messages/{msg['id']}/report", json={"unit_id": "T-11", "reason": "harassment"}).json()
    _backdate(client, msg["id"])
    client.get("/api/units/T-11/conversations")
    queued = client.get("/api/moderation/reports").json()[0]["message"]
    assert queued["kind"] == "voice" and queued["voice_url"]
    assert client.get(queued["voice_url"]).status_code == 200
    client.post(f"/api/reports/{rep['id']}/review", json={"outcome": "dismissed"})
    client.get("/api/units/T-11/conversations")
    assert client.get("/api/moderation/reports").json()[0]["message"]["voice_url"] is None


# ---------- family helpers ----------

def test_owner_adds_a_helper_who_acts_on_the_record(client):
    assert client.post("/api/units/T-11/delegates", json={"name": "Adam", "relation": "child", "consent": False}).status_code == 422
    helper = client.post("/api/units/T-11/delegates", json={"name": "Adam", "relation": "child", "consent": True}).json()
    sent = client.post("/api/messages", json={"from_unit_id": "T-11", "to_unit_id": "T-12", "body": "Hi, this is Adam for my mum",
                                              "delegate_id": helper["id"]}).json()
    assert sent["sent_by"] == "Adam (child)"
    types = [e["type"] for e in client.get("/api/units/T-11/history").json()["events"]]
    assert "delegate_added" in types


def test_helpers_are_limited_checked_and_revocable(client):
    for name in ("Adam", "Aisha"):
        client.post("/api/units/T-11/delegates", json={"name": name, "relation": "child", "consent": True})
    assert client.post("/api/units/T-11/delegates", json={"name": "Third", "relation": "other", "consent": True}).status_code == 409
    other = client.post("/api/units/T-13/delegates", json={"name": "Raj", "relation": "spouse", "consent": True}).json()
    r = client.post("/api/messages", json={"from_unit_id": "T-11", "to_unit_id": "T-12", "body": "hi", "delegate_id": other["id"]})
    assert r.status_code == 403  # someone else's helper
    first = client.get("/api/units/T-11/delegates").json()[0]
    client.post(f"/api/delegates/{first['id']}/revoke", json={"unit_id": "T-11"})
    assert len(client.get("/api/units/T-11/delegates").json()) == 1
    r = client.post("/api/messages", json={"from_unit_id": "T-11", "to_unit_id": "T-12", "body": "hi", "delegate_id": first["id"]})
    assert r.status_code == 403


def test_helper_registering_renovation_is_written_to_the_home_log(client):
    helper = client.post("/api/units/T-12/delegates", json={"name": "Nora", "relation": "spouse", "consent": True}).json()
    client.post("/api/intros", json={"from_unit_id": "T-12", "message": "Works next week", "delegate_id": helper["id"],
                                     "renovation": {"scope": "Extend kitchen", "start": "2026-10-15", "end": "2026-10-30", "works_type": "structural",
                                                    "council_permit": "approved"}})
    event = next(e for e in client.get("/api/units/T-12/history").json()["events"] if e["type"] == "renovation_registered")
    assert event["payload"]["acted_by"] == "Nora (spouse)"


# ---------- download my data ----------

def test_export_contains_my_records_but_not_other_names(client):
    client.post("/api/messages", json={"from_unit_id": "T-12", "to_unit_id": "T-11", "body": "Hello neighbour"})
    client.post("/api/waves", json={"from_unit_id": "T-11", "to_unit_id": "T-12"})
    r = client.get("/api/units/T-12/export")
    assert r.status_code == 200 and "attachment" in r.headers["content-disposition"]
    data = r.json()
    assert data["household"]["unit"] == "No. 12"
    assert data["messages"][0]["text"] == "Hello neighbour" and data["messages"][0]["with"] == "No. 11"
    assert data["waves"][0]["direction"] == "received"
    assert data["home_log"][0]["type"] == "handover"
    assert "Siti" not in r.text


# ---------- community health ----------

def test_dashboard_reports_how_connected_the_phase_is(client):
    before = client.get("/api/dashboard").json()
    assert before["known_pairs"] == 0 and before["days_to_first_hello"] is None and before["circle_pairs"] > 30
    client.post("/api/waves", json={"from_unit_id": "T-12", "to_unit_id": "T-11"})
    client.post("/api/waves", json={"from_unit_id": "T-11", "to_unit_id": "T-12"})
    d = client.get("/api/dashboard").json()
    assert d["known_pairs"] == 1 and d["households_reached_out"] == 2 and d["active_circles_30d"] == 2
    assert d["days_to_first_hello"] >= 0


# ---------- translation keys ----------

def test_directory_and_impact_carry_translation_keys(client):
    nearby = {n["id"]: n for n in client.get("/api/units/A-14-3/directory").json()["nearby"]}
    assert nearby["A-11-3"]["hint_key"] == "floors_below" and nearby["A-11-3"]["hint_n"] == 3
    zone = {z["id"]: z for z in client.get("/api/units/A-15-3/impact?works_type=wet").json()}
    assert zone["A-13-3"]["reason_key"] == "below-2_wet"


# ---------- safety hardening ----------

def test_reported_voice_is_not_kept_forever(client):
    msg = _voice(client)
    client.post(f"/api/messages/{msg['id']}/report", json={"unit_id": "T-11", "reason": "harassment"})
    _backdate(client, msg["id"], days=91)  # the report was never reviewed
    from app.main import _sweep_once

    assert _sweep_once() == 1
    assert client.get("/api/moderation/reports").json()[0]["message"]["voice_url"] is None


def test_bulk_export_and_reported_audio_need_sign_in_outside_demo_mode(client, monkeypatch, sign_in):
    msg = _voice(client)
    rep = client.post(f"/api/messages/{msg['id']}/report", json={"unit_id": "T-11", "reason": "harassment"}).json()
    monkeypatch.setenv("JIRAN_DEMO_MODE", "0")
    assert client.get("/api/units/T-12/export").status_code == 401
    assert client.get(f"/api/moderation/reports/{rep['id']}/voice").status_code == 401
    sign_in(client, "T-11")  # a household downloads its own data, nobody else's, and can't play reported audio
    assert client.get("/api/units/T-11/export").status_code == 200
    assert client.get("/api/units/T-12/export").status_code == 403
    assert client.get(f"/api/moderation/reports/{rep['id']}/voice").status_code == 403


def test_shared_text_cannot_carry_contact_details_or_pose_as_officials(client):
    bad = client.put("/api/units/T-12/profile", json={"bio": "WhatsApp me at 012-345 6789"})
    assert bad.status_code == 422 and bad.json()["detail"]["code"] == "private"
    assert client.put("/api/units/T-12/profile", json={"bio": "Two cats, one very loud"}).status_code == 200
    for name in ("Adam 0123456789", "SDP Estate Office", "Polis Bantuan", "you idiot"):
        r = client.post("/api/units/T-11/delegates", json={"name": name, "relation": "other", "consent": True})
        assert r.status_code == 422, name
    assert client.post("/api/units/T-11/delegates", json={"name": "Adminah", "relation": "child", "consent": True}).status_code == 201


def test_quick_replies_show_how_they_arrive(client):
    replies = client.get("/api/units/T-12/conversations/T-11").json()["quick_replies"]
    from app import talk

    first = replies[0]
    assert first["text"] == talk.quick_text(first["key"], "en") and first["arrives"] == talk.quick_text(first["key"], "ms")


def test_demo_dates_are_worked_out_from_today(monkeypatch):
    from datetime import date

    from app import seed

    monkeypatch.setattr(seed, "today_my", lambda: date(2027, 2, 24))  # a Wednesday
    assert seed.handover_date() == "2027-02-10"
    bodies = [body for _, _, body in seed.demo_notices()]
    assert "Saturday 27 Feb" in bodies[0] and "Thursday 4 Mar" in bodies[1]
    # The third notice is a standing rule with no date in it, so it can't go stale either.
    assert "Sundays" in bodies[2] and not any(m in bodies[2] for m in ("Jan", "Feb", "Mar", "Apr", "May", "Jun",
                                                                        "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"))
