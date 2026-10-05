import pytest
from fastapi.testclient import TestClient

RENO = {"scope": "Extend kitchen (rear wall)", "start": "2026-10-15", "end": "2026-10-30",
        "contractor": "ABC Renovation", "contractor_cidb_registered": True}


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("JIRAN_DB_PATH", str(tmp_path / "test.db"))
    monkeypatch.setenv("JIRAN_DEMO_MODE", "1")
    from app.main import app

    with TestClient(app) as c:
        yield c


def _reno(client, unit="T-12", **overrides) -> int:
    return client.post("/api/intros", json={"from_unit_id": unit, "message": "Hi", "renovation": {**RENO, **overrides}}).json()["id"]


def _issue(client, intro_id, unit="T-12"):
    return client.post(f"/api/intros/{intro_id}/passes", json={"unit_id": unit})


def _scan(client, token, at):
    return client.post("/api/gate/scan", json={"token": token, "at": at}).json()


# ---------- layer 2 ----------

def test_only_the_renovating_home_can_issue_a_pass(client):
    intro_id = _reno(client)
    assert _issue(client, intro_id, unit="T-11").status_code == 403
    assert _issue(client, intro_id).status_code == 201


def test_token_is_shown_once_and_never_stored(client):
    intro_id = _reno(client)
    issued = _issue(client, intro_id).json()
    assert issued["qr_payload"] == f"J5PASS:{issued['token']}" and len(issued["token"]) >= 30
    listed = client.get("/api/units/T-12/works").json()["mine"][0]["passes"][0]
    assert "token" not in listed and "token_hash" not in listed


def test_gate_rules(client):
    token = _issue(client, _reno(client)).json()["token"]
    assert _scan(client, token, "2026-10-16T10:00")["allowed"] is True  # Friday, inside dates and hours
    assert "Sundays" in _scan(client, token, "2026-10-18T10:00")["reason"]
    assert "entry hours" in _scan(client, token, "2026-10-16T20:30")["reason"]
    assert "not started" in _scan(client, token, "2026-10-10T10:00")["reason"]
    assert "ended" in _scan(client, token, "2026-11-02T10:00")["reason"]
    assert _scan(client, "x" * 32, "2026-10-16T10:00")["reason"] == "Unknown pass"


def test_revoked_pass_is_refused_and_only_owner_can_revoke(client):
    issued = _issue(client, _reno(client)).json()
    assert client.post(f"/api/passes/{issued['id']}/revoke", json={"unit_id": "T-11"}).status_code == 403
    assert client.post(f"/api/passes/{issued['id']}/revoke", json={"unit_id": "T-12"}).json()["status"] == "revoked"
    assert "revoked" in _scan(client, issued["token"], "2026-10-16T10:00")["reason"]


def test_pass_limit(client):
    intro_id = _reno(client)
    for _ in range(3):
        assert _issue(client, intro_id).status_code == 201
    assert _issue(client, intro_id).status_code == 409


def test_contractor_view_shows_only_the_job(client):
    token = _issue(client, _reno(client)).json()["token"]
    view = client.get("/api/passes/view", params={"token": token}).json()
    assert view["unit_label"] == "No. 12" and view["scope"] == RENO["scope"]
    text = str(view)
    for private in ("Aiman", "Siti", "Kumar", "resident_name", "phone", "photo_id", "sha256"):
        assert private not in text
    assert client.get("/api/passes/view", params={"token": "../../etc"}).status_code == 404


def test_gate_log_appears_on_the_pass(client):
    token = _issue(client, _reno(client)).json()["token"]
    _scan(client, token, "2026-10-16T10:00")
    _scan(client, token, "2026-10-18T10:00")
    log = client.get("/api/units/T-12/works").json()["mine"][0]["passes"][0]["gate_log"]
    assert [e["allowed"] for e in log] == [False, True]


def test_simulated_time_is_demo_only(client, monkeypatch):
    token = _issue(client, _reno(client)).json()["token"]
    monkeypatch.setenv("JIRAN_DEMO_MODE", "0")
    assert client.post("/api/gate/scan", json={"token": token, "at": "2026-10-16T10:00"}).status_code == 403


def test_noisy_hours_must_be_in_order(client):
    r = client.post("/api/intros", json={"from_unit_id": "T-12", "message": "Hi",
                                         "renovation": {**RENO, "noisy_from": "17:00", "noisy_to": "09:00"}})
    assert r.status_code == 422


# ---------- layer 4 ----------

def _warranty_ticket(client, followup="wall_after_crack") -> dict:
    intro_id = _reno(client, start="2099-01-01", end="2099-01-30")
    demo = lambda name, kind, intro=None: client.post("/api/units/T-11/photos/demo", json={  # noqa: E731
        "name": name, "kind": kind, "subject": "Shared wall with No. 12", "renovation_intro_id": intro}).json()
    b, f = demo("wall_before", "baseline", intro_id), demo(followup, "followup")
    case = client.post("/api/incidents", json={"reporter_unit_id": "T-11", "baseline_photo_id": b["id"], "followup_photo_id": f["id"]}).json()
    client.post(f"/api/incidents/{case['id']}/decision", json={"decision": "warranty", "decided_by": "sdp_inspector"})
    return client.get("/api/units/T-11/warranty").json()[0]


def test_warranty_decision_opens_a_ticket_for_sdp(client):
    t = _warranty_ticket(client)
    assert t["status"] == "open" and t["unit_id"] == "T-11"
    assert [x["id"] for x in client.get("/api/warranty").json()] == [t["id"]]


def test_good_repair_is_checked_against_prework_photo_and_owner_closes(client):
    t = _warranty_ticket(client)
    r = client.post(f"/api/warranty/{t['id']}/repair/demo", json={"name": "wall_repair_good", "subcontractor": "Jaya Plaster Sdn Bhd"}).json()
    assert r["status"] == "repair_submitted" and r["repair_check"]["verdict"] == "restored"
    assert client.post(f"/api/warranty/{t['id']}/owner", json={"unit_id": "T-13", "decision": "accept"}).status_code == 403
    closed = client.post(f"/api/warranty/{t['id']}/owner", json={"unit_id": "T-11", "decision": "accept", "note": "Looks good"}).json()
    assert closed["status"] == "closed"
    types = [e["type"] for e in client.get("/api/units/T-11/history").json()["events"]]
    assert types[-3:] == ["warranty_opened", "repair_submitted", "warranty_closed_by_owner"]


def test_poor_repair_is_flagged_and_rejection_reopens(client):
    t = _warranty_ticket(client)
    r = client.post(f"/api/warranty/{t['id']}/repair/demo", json={"name": "wall_repair_poor", "subcontractor": "Jaya Plaster Sdn Bhd"}).json()
    assert r["repair_check"]["verdict"] == "still_changed"
    reopened = client.post(f"/api/warranty/{t['id']}/owner", json={"unit_id": "T-11", "decision": "reject", "note": "Crack still visible"}).json()
    assert reopened["status"] == "open" and reopened["reopen_count"] == 1
    again = client.post(f"/api/warranty/{t['id']}/repair/demo", json={"name": "wall_repair_good", "subcontractor": "Jaya Plaster Sdn Bhd"}).json()
    assert again["repair_check"]["verdict"] == "restored"
    assert client.get("/api/dashboard").json()["repairs_rejected"] == 1


def test_sdp_cannot_close_a_ticket_and_states_are_enforced(client):
    t = _warranty_ticket(client)
    assert client.post(f"/api/warranty/{t['id']}/owner", json={"unit_id": "T-11", "decision": "accept"}).status_code == 409
    client.post(f"/api/warranty/{t['id']}/repair/demo", json={"name": "wall_repair_good", "subcontractor": "X"})
    assert client.post(f"/api/warranty/{t['id']}/repair/demo", json={"name": "wall_repair_good", "subcontractor": "X"}).status_code == 409


def test_all_home_logs_stay_verified(client):
    t = _warranty_ticket(client)
    client.post(f"/api/warranty/{t['id']}/repair/demo", json={"name": "wall_repair_good", "subcontractor": "X"})
    client.post(f"/api/warranty/{t['id']}/owner", json={"unit_id": "T-11", "decision": "accept"})
    d = client.get("/api/dashboard").json()
    assert d["home_histories_verified"] == d["households"] and d["warranty_closed"] == 1
