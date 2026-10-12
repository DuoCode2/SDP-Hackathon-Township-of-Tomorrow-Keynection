import os
from pathlib import Path

import pytest
from fastapi.testclient import TestClient


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("KEYNECTION_DB_PATH", str(tmp_path / "test.db"))
    monkeypatch.setenv("KEYNECTION_DEMO_MODE", "1")
    from app.main import app

    with TestClient(app) as c:
        yield c


def _wave(client, frm, to):
    return client.post("/api/waves", json={"from_unit_id": frm, "to_unit_id": to})


def _thread(client, me, other):
    return client.get(f"/api/units/{me}/conversations/{other}").json()


WAV = b"RIFF" + b"\0" * 4 + b"WAVE" + b"\0" * 200  # the smallest header a real WAV file starts with


def _voice(client, frm="T-12", to="T-11", data=WAV, ctype="audio/wav", duration="4", **form):
    return client.post("/api/messages/voice", data={"from_unit_id": frm, "to_unit_id": to, "duration": duration, **form},
                       files={"file": ("note.wav", data, ctype)})


# ---------- waves ----------

def test_wave_once_a_day_and_waving_back_makes_you_known(client):
    assert _wave(client, "T-12", "T-11").status_code == 201
    assert _wave(client, "T-12", "T-11").status_code == 409
    card = {n["id"]: n for n in client.get("/api/units/T-12/card").json()["neighbours"]}
    assert card["T-11"]["known"] is False
    assert _wave(client, "T-11", "T-12").status_code == 201
    card = {n["id"]: n for n in client.get("/api/units/T-12/card").json()["neighbours"]}
    assert card["T-11"]["known"] is True
    assert [i["type"] for i in _thread(client, "T-11", "T-12")["items"]] == ["wave", "wave"]


def test_waves_only_reach_people_you_may_talk_to(client):
    assert _wave(client, "T-12", "T-15").status_code == 403


def test_unseen_waves_count_as_unread_until_opened(client):
    _wave(client, "T-12", "T-11")
    convo = next(c for c in client.get("/api/units/T-11/conversations").json() if c["id"] == "T-12")
    assert convo["unread"] == 1 and convo["last"] == "👋 Wave"
    client.post("/api/units/T-11/conversations/T-12/read")
    convo = next(c for c in client.get("/api/units/T-11/conversations").json() if c["id"] == "T-12")
    assert convo["unread"] == 0


# ---------- reactions ----------

def test_react_toggle_and_only_participants(client):
    msg = client.post("/api/messages", json={"from_unit_id": "T-12", "to_unit_id": "T-11", "body": "Hello!"}).json()
    r = client.post(f"/api/messages/{msg['id']}/react", json={"unit_id": "T-11", "emoji": "👍"})
    assert r.json() == [{"emoji": "👍", "unit_id": "T-11"}]
    assert client.post(f"/api/messages/{msg['id']}/react", json={"unit_id": "T-11", "emoji": "👍"}).json() == []
    assert client.post(f"/api/messages/{msg['id']}/react", json={"unit_id": "T-13", "emoji": "👍"}).status_code == 403
    assert client.post(f"/api/messages/{msg['id']}/react", json={"unit_id": "T-11", "emoji": "💩"}).status_code == 422
    client.post(f"/api/messages/{msg['id']}/react", json={"unit_id": "T-11", "emoji": "❤️"})
    item = next(i for i in _thread(client, "T-12", "T-11")["items"] if i["type"] == "message")
    assert item["reactions"] == [{"emoji": "❤️", "unit_id": "T-11"}]


# ---------- voice notes ----------

def test_voice_note_round_trip_and_privacy(client):
    sent = _voice(client)
    assert sent.status_code == 201 and sent.json()["kind"] == "voice" and sent.json()["duration"] == 4
    mid = sent.json()["id"]
    assert client.get(f"/api/messages/{mid}/voice?unit_id=T-11").status_code == 200
    assert client.get(f"/api/messages/{mid}/voice?unit_id=T-13").status_code == 404
    convo = next(c for c in client.get("/api/units/T-11/conversations").json() if c["id"] == "T-12")
    assert convo["last"].startswith("🎤")


def test_voice_note_must_really_be_audio(client):
    page = b"<html><script>alert(1)</script></html>" + b" " * 100
    assert _voice(client, data=page, ctype="audio/webm").status_code == 415
    assert _voice(client, data=b"RIFF" + b"\0" * 200).status_code == 415  # RIFF but not WAVE
    assert _voice(client, data=b"\x1a\x45\xdf\xa3" + b"\0" * 200, ctype="audio/webm").status_code == 201  # Chrome
    assert _voice(client, data=b"\0\0\0\x20ftypM4A " + b"\0" * 200, ctype="audio/mp4").status_code == 201  # Safari


def test_a_refused_voice_note_leaves_no_file_behind(client):
    folder = Path(os.environ["KEYNECTION_DB_PATH"]).parent / "voice"
    assert _voice(client, delegate_id="999").status_code == 403  # not this household's helper
    assert not folder.exists() or list(folder.iterdir()) == []


def test_voice_notes_count_towards_the_daily_message_limit(client):
    for i in range(30):
        assert client.post("/api/messages", json={"from_unit_id": "T-12", "to_unit_id": "T-11", "body": f"note {i}"}).status_code == 201
    assert _voice(client).status_code == 429


def test_voice_note_limits(client):
    assert _voice(client, ctype="image/png").status_code == 415
    assert _voice(client, duration="61").status_code == 422
    assert _voice(client, data=b"x" * 1_500_001).status_code == 413
    assert _voice(client, to="T-15").status_code == 403


# ---------- profile & privacy ----------

def test_profile_bio_and_language(client):
    p = client.put("/api/units/T-12/profile", json={"bio": "Hello neighbours", "lang": "zh"}).json()
    assert p["bio"] == "Hello neighbours" and p["lang"] == "zh"
    card = {n["id"]: n for n in client.get("/api/units/T-11/card").json()["neighbours"]}
    assert card["T-12"]["bio"] == "Hello neighbours"
    assert client.put("/api/units/T-12/profile", json={"bio": "stupid neighbours"}).status_code == 422
    assert client.put("/api/units/T-12/profile", json={"bio": "x" * 81}).status_code == 422


def test_quiet_mode_blocks_chat_but_not_formal_notices(client):
    client.put("/api/units/T-11/profile", json={"quiet_mode": True})
    assert client.post("/api/messages", json={"from_unit_id": "T-12", "to_unit_id": "T-11", "body": "hi"}).status_code == 409
    assert _wave(client, "T-12", "T-11").status_code == 409
    intro = client.post("/api/intros", json={"from_unit_id": "T-12", "message": "Works next week",
                                             "renovation": {"scope": "Extend kitchen", "start": "2026-10-15", "end": "2026-10-30",
                                                            "works_type": "structural", "council_permit": "approved"}})
    assert "T-11" in intro.json()["recipients"]


def test_turning_off_waves_and_requests(client):
    client.put("/api/units/T-11/profile", json={"allow_waves": False})
    assert _wave(client, "T-12", "T-11").status_code == 409
    client.put("/api/units/T-15/profile", json={"accept_requests": False})
    r = client.post("/api/contact-requests", json={"from_unit_id": "T-12", "to_unit_id": "T-15", "reason": "parking"})
    assert r.status_code == 409


def test_profile_lists_blocked_neighbours(client):
    client.post("/api/units/T-12/blocks", json={"other_unit_id": "T-11", "blocked": True})
    assert [b["id"] for b in client.get("/api/units/T-12/profile").json()["blocked"]] == ["T-11"]


# ---------- the estate office account ----------

def test_estate_office_account_is_read_only_with_unread_count(client):
    o = client.get("/api/units/A-14-3/official").json()
    assert o["verified"] and o["unread"] == 2 and {n["audience"] for n in o["notices"]} == {"phase", "block:A"}
    client.post("/api/units/A-14-3/official/read")
    assert client.get("/api/units/A-14-3/official").json()["unread"] == 0
    client.post("/api/notices", json={"audience": "block:A", "title": "Lift servicing", "body": "Lift B off on Monday."})
    assert client.get("/api/units/A-14-3/official").json()["unread"] == 1
