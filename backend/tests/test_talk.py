import pytest
from fastapi.testclient import TestClient

from app import talk

RENO = {"scope": "Extend kitchen (rear wall)", "start": "2026-10-15", "end": "2026-10-30",
        "council_permit": "approved", "permit_ref": "PBT/2026/0412"}


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("JIRAN_DB_PATH", str(tmp_path / "test.db"))
    monkeypatch.setenv("JIRAN_DEMO_MODE", "1")
    from app.main import app

    with TestClient(app) as c:
        yield c


def _send(client, frm, to, **kw):
    return client.post("/api/messages", json={"from_unit_id": frm, "to_unit_id": to, **kw})


def _thread(client, me, other):
    return client.get(f"/api/units/{me}/conversations/{other}").json()


def _reno(client, unit="T-12") -> int:
    return client.post("/api/intros", json={"from_unit_id": unit, "message": "Hi", "renovation": RENO}).json()["id"]


# ---------- messages ----------

def test_neighbours_can_message_each_other_both_ways(client):
    assert _send(client, "T-12", "T-11", body="Hi Siti, nice to meet you").status_code == 201
    assert _send(client, "T-11", "T-12", body="Hi Aiman!").status_code == 201
    texts = [i["text"] for i in _thread(client, "T-11", "T-12")["items"]]
    assert texts == ["Hi Siti, nice to meet you", "Hi Aiman!"]


def test_only_households_in_the_circle_can_message(client):
    assert _send(client, "T-12", "T-15", body="hello").status_code == 403
    assert client.get("/api/units/T-12/conversations/T-15").status_code == 403


def test_quick_replies_arrive_translated_into_the_readers_language(client):
    # Siti reads Malay, Aiman reads English (seed data).
    _send(client, "T-11", "T-12", quick_key="quiet_nap")
    for_aiman = _thread(client, "T-12", "T-11")["items"][0]
    assert for_aiman["text"] == talk.quick_text("quiet_nap", "en")
    assert for_aiman["translated"] is True and for_aiman["original"] == talk.quick_text("quiet_nap", "ms")
    for_siti = _thread(client, "T-11", "T-12")["items"][0]
    assert for_siti["text"] == talk.quick_text("quiet_nap", "ms") and for_siti["translated"] is False


def test_every_quick_reply_exists_in_every_language():
    for key, texts in talk.QUICK_REPLIES.items():
        assert set(texts) == set(talk.LANGS), key


def test_tone_check_stops_obvious_insults(client):
    r = _send(client, "T-11", "T-12", body="You are so stupid, stop the noise")
    assert r.status_code == 422 and r.json()["detail"]["code"] == "tone"
    assert _send(client, "T-11", "T-12", body="Could you please stop the noise after 6pm?").status_code == 201


def test_send_requires_exactly_one_of_text_or_quick_reply(client):
    assert _send(client, "T-11", "T-12").status_code == 422
    assert _send(client, "T-11", "T-12", body="hi", quick_key="noted").status_code == 422
    assert _send(client, "T-11", "T-12", body="x" * 501).status_code == 422


def test_daily_limit_per_neighbour(client, monkeypatch):
    import app.main as main
    monkeypatch.setattr(main, "MAX_MESSAGES_PER_DAY", 2)
    assert _send(client, "T-11", "T-12", body="1").status_code == 201
    assert _send(client, "T-11", "T-12", body="2").status_code == 201
    assert _send(client, "T-11", "T-12", body="3").status_code == 429


def test_unread_count_and_mark_read(client):
    _send(client, "T-11", "T-12", body="hello")
    convo = next(c for c in client.get("/api/units/T-12/conversations").json() if c["id"] == "T-11")
    assert convo["unread"] == 1 and convo["last"] == "hello"
    client.post("/api/units/T-12/conversations/T-11/read")
    convo = next(c for c in client.get("/api/units/T-12/conversations").json() if c["id"] == "T-11")
    assert convo["unread"] == 0


# ---------- safety: block, report, contact consent ----------

def test_blocked_neighbours_messages_are_withheld_silently(client):
    client.post("/api/units/T-12/blocks", json={"other_unit_id": "T-11", "blocked": True})
    assert _send(client, "T-11", "T-12", body="are you there?").status_code == 201  # sender isn't told
    assert _thread(client, "T-12", "T-11")["items"] == []
    assert _send(client, "T-12", "T-11", body="hi").status_code == 409  # unblock first


def test_only_the_recipient_can_report_and_moderation_warns_privately(client):
    msg = _send(client, "T-11", "T-12", body="Your contractor is useless").json()
    assert client.post(f"/api/messages/{msg['id']}/report", json={"unit_id": "T-11", "reason": "harassment"}).status_code == 403
    rep = client.post(f"/api/messages/{msg['id']}/report", json={"unit_id": "T-12", "reason": "harassment"})
    assert rep.status_code == 201
    queue = client.get("/api/moderation/reports").json()
    assert queue[0]["message"]["text"] == "Your contractor is useless" and queue[0]["status"] == "open"
    assert client.post(f"/api/reports/{rep.json()['id']}/review", json={"outcome": "warned"}).json()["status"] == "warned"
    # The sender sees the warning; the reporter does not.
    assert any(i["kind"] == "system" for i in _thread(client, "T-11", "T-12")["items"] if i["type"] == "message")
    assert not any(i.get("kind") == "system" for i in _thread(client, "T-12", "T-11")["items"])


def test_phone_numbers_shared_only_when_both_agree(client):
    assert client.post("/api/units/T-12/contact", json={"other_unit_id": "T-11"}).json()["contact"] == "requested_by_me"
    assert _thread(client, "T-11", "T-12")["contact"] == "requested_by_them"
    assert client.post("/api/units/T-11/contact", json={"other_unit_id": "T-12"}).json()["contact"] == "mutual"


# ---------- concerns: neighbour first, then the estate team ----------

def test_concern_ladder_with_home_log_records(client):
    intro_id = _reno(client)
    c = client.post("/api/concerns", json={"from_unit_id": "T-11", "intro_id": intro_id, "category": "noise_hours",
                                           "note": "Drilling at 7.30pm yesterday"})
    assert c.status_code == 201
    cid = c.json()["id"]
    # Only the renovating home answers; only the raiser escalates.
    assert client.post(f"/api/concerns/{cid}/acknowledge", json={"unit_id": "T-11"}).status_code == 403
    assert client.post(f"/api/concerns/{cid}/acknowledge", json={"unit_id": "T-12", "note": "Sorry, will tell them"}).json()["status"] == "acknowledged"
    assert client.post(f"/api/concerns/{cid}/escalate", json={"unit_id": "T-12"}).status_code == 403
    assert client.post(f"/api/concerns/{cid}/escalate", json={"unit_id": "T-11"}).json()["status"] == "escalated"
    queue = client.get("/api/estate/concerns").json()
    assert queue[0]["id"] == cid and queue[0]["status"] == "escalated"
    client.post(f"/api/concerns/{cid}/estate", json={"action": "remind"})
    assert any(i.get("kind") == "system" for i in _thread(client, "T-12", "T-11")["items"])
    done = client.post(f"/api/concerns/{cid}/estate", json={"action": "resolve", "note": "Contractor briefed"}).json()
    assert done["status"] == "closed_by_estate"
    for unit in ("T-11", "T-12"):
        types = [e["type"] for e in client.get(f"/api/units/{unit}/history").json()["events"]]
        assert {"concern_raised", "concern_acknowledged", "concern_escalated", "estate_reminder", "concern_closed_by_estate"} <= set(types)
        assert client.get(f"/api/units/{unit}/history").json()["chain_ok"]


def test_only_notified_neighbours_can_raise_concerns(client):
    intro_id = _reno(client)
    r = client.post("/api/concerns", json={"from_unit_id": "T-15", "intro_id": intro_id, "category": "debris"})
    assert r.status_code == 403


def test_escalation_waits_24h_outside_demo_mode(client, monkeypatch):
    intro_id = _reno(client)
    cid = client.post("/api/concerns", json={"from_unit_id": "T-11", "intro_id": intro_id, "category": "access"}).json()["id"]
    monkeypatch.setenv("JIRAN_DEMO_MODE", "0")
    assert client.post(f"/api/concerns/{cid}/escalate", json={"unit_id": "T-11"}).status_code == 409


def test_neighbour_settled_concern_counts_on_dashboard(client):
    intro_id = _reno(client)
    cid = client.post("/api/concerns", json={"from_unit_id": "T-11", "intro_id": intro_id, "category": "debris"}).json()["id"]
    client.post(f"/api/concerns/{cid}/resolve", json={"unit_id": "T-12", "note": "Skip emptied"})
    d = client.get("/api/dashboard").json()
    assert d["concerns_raised"] == 1 and d["concerns_settled_by_neighbours"] == 1 and d["concerns_escalated"] == 0


# ---------- warranty clock, permits, map flags ----------

def test_units_carry_language_and_handover_date(client):
    from datetime import date, timedelta

    from app.seed import HANDOVER_DAYS_AGO, today_my

    units = {u["id"]: u for u in client.get("/api/units").json()}
    handed_over = date.fromisoformat(units["T-12"]["handover_date"])
    assert units["T-11"]["lang"] == "ms" and handed_over == today_my() - timedelta(days=HANDOVER_DAYS_AGO)


def test_renovation_keeps_council_permit(client):
    _reno(client)
    item = client.get("/api/units/T-11/inbox").json()[0]
    assert item["renovation"]["council_permit"] == "approved" and item["renovation"]["permit_ref"] == "PBT/2026/0412"


def test_warranty_clock_follows_hda_schedule(client):
    from app.main import _add_months
    from datetime import date
    assert _add_months(date(2026, 3, 16), 24) == date(2028, 3, 16)
    assert _add_months(date(2024, 1, 31), 1) == date(2024, 2, 29)
