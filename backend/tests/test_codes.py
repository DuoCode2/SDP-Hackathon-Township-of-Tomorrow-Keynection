"""Text the server writes for residents (house rules, gate results, automatic chat notices) also comes as a code with
plain values, so the app can show it in the reader's language. The English sentence stays as the record."""
import pytest
from fastapi.testclient import TestClient


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("KEYNECTION_DB_PATH", str(tmp_path / "test.db"))
    monkeypatch.setenv("KEYNECTION_DEMO_MODE", "1")
    from app.main import app

    with TestClient(app) as c:
        yield c


RENO = {"scope": "Hack kitchen tiles", "start": "2026-10-15", "end": "2026-10-30"}


def _reno(client) -> int:
    return client.post("/api/intros", json={"from_unit_id": "T-12", "message": "Hi", "renovation": RENO}).json()["id"]


def test_house_rules_come_with_codes(client):
    _reno(client)
    w = client.get("/api/units/T-12/works").json()
    assert len(w["house_rule_codes"]) == len(w["house_rules"]) == 4  # a terrace: no lift to protect
    assert w["house_rule_codes"][0] == "noisy_hours_only"
    assert "protect_lift" not in w["house_rule_codes"]


def test_apartment_house_rules_include_the_lift(client):
    w = client.get("/api/units/A-15-3/works").json()
    assert len(w["house_rule_codes"]) == len(w["house_rules"]) == 5
    assert "protect_lift" in w["house_rule_codes"]


@pytest.mark.parametrize("at,code,values", [
    ("2026-10-14T10:00", "not_started", {"start": "2026-10-15"}),
    ("2026-10-31T10:00", "ended", {"end": "2026-10-30"}),
    ("2026-10-18T10:00", "sunday", {}),
    ("2026-10-16T20:30", "outside_hours", {"open": "08:00", "close": "18:00"}),
    ("2026-10-16T10:00", "allowed", {}),
])
def test_gate_results_come_with_codes_and_so_does_the_gate_log(client, at, code, values):
    token = client.post(f"/api/intros/{_reno(client)}/passes", json={"unit_id": "T-12"}).json()["token"]
    r = client.post("/api/gate/scan", json={"token": token, "at": at}).json()
    assert r["reason_code"] == code and r["reason_values"] == values and r["reason"]
    entry = client.get("/api/units/T-12/works").json()["mine"][0]["passes"][0]["gate_log"][0]
    assert entry["reason_code"] == code and entry["reason_values"] == values


def test_automatic_chat_notices_come_with_codes(client):
    client.post("/api/units/T-12/contact", json={"other_unit_id": "T-11"})
    client.post("/api/units/T-11/contact", json={"other_unit_id": "T-12"})
    items = client.get("/api/units/T-11/conversations/T-12").json()["items"]
    notice = next(i for i in items if i.get("kind") == "system")
    assert notice["code"] == "contacts_shared" and notice["values"] == {} and notice["text"]


def test_chat_list_previews_come_as_data_too(client):
    intro_id = _reno(client)
    previews = {c["id"]: c["last_preview"] for c in client.get("/api/units/T-11/conversations").json()}
    assert previews["T-12"] == {"kind": "renovation"}
    assert client.post("/api/waves", json={"from_unit_id": "T-10", "to_unit_id": "T-11"}).status_code == 201  # Farid, next door
    previews = {c["id"]: c["last_preview"] for c in client.get("/api/units/T-11/conversations").json()}
    assert previews["T-10"] == {"kind": "wave", "from": "T-10"}  # whose wave, so the list says "waved at you"
    client.post("/api/concerns", json={"from_unit_id": "T-11", "intro_id": intro_id, "category": "debris"})
    previews = {c["id"]: c["last_preview"] for c in client.get("/api/units/T-11/conversations").json()}
    assert previews["T-12"] == {"kind": "concern", "category": "debris"}


def test_chat_list_preview_of_an_automatic_notice(client):
    # A thread whose only item is the notice (items written in the same second have no fixed order).
    client.post("/api/units/T-12/contact", json={"other_unit_id": "T-11"})
    client.post("/api/units/T-11/contact", json={"other_unit_id": "T-12"})
    c = next(c for c in client.get("/api/units/T-11/conversations").json() if c["id"] == "T-12")
    assert c["last_preview"] == {"kind": "system", "code": "contacts_shared", "values": {}, "text": c["last"]}


def test_case_notices_carry_the_case_and_who(client):
    intro_id = _reno(client)
    demo = lambda name, kind, intro=None: client.post("/api/units/T-11/photos/demo", json={  # noqa: E731
        "name": name, "kind": kind, "subject": "Shared wall with No. 12", "renovation_intro_id": intro}).json()
    b, f = demo("wall_before", "baseline", intro_id), demo("wall_after_crack", "followup")
    case = client.post("/api/incidents", json={"reporter_unit_id": "T-11", "baseline_photo_id": b["id"], "followup_photo_id": f["id"]}).json()
    client.post(f"/api/incidents/{case['id']}/decision", json={"unit_id": "T-11", "decision": "renovation"})
    items = client.get("/api/units/T-12/conversations/T-11").json()["items"]
    notice = next(i for i in items if i.get("code") == "case_proposed")
    assert notice["values"] == {"case": "001", "unit": "T-11", "label": "No. 11", "helper": "", "subject": "Shared wall with No. 12"}
