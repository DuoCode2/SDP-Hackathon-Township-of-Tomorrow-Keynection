"""Who may decide what about a reported change.

A building-defect claim is the homeowner's own right, so the reporting household can make it alone.
Blaming the renovation is a claim against the neighbour, so it stays a proposal until the renovating
owner agrees (or accepts it themselves). Residents can never record an "SDP inspector" decision.
"""
import pytest
from fastapi.testclient import TestClient


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("KEYNECTION_DB_PATH", str(tmp_path / "test.db"))
    monkeypatch.setenv("KEYNECTION_DEMO_MODE", "1")
    from app.main import app

    with TestClient(app) as c:
        yield c


def _case(client, with_renovation: bool = True) -> dict:
    intro_id = None
    if with_renovation:
        intro_id = client.post("/api/intros", json={
            "from_unit_id": "T-12", "message": "Hi, renovating soon",
            "renovation": {"scope": "Hack kitchen tiles", "start": "2099-10-15", "end": "2099-10-30"},
        }).json()["id"]
    demo = lambda name, kind, intro=None: client.post("/api/units/T-11/photos/demo", json={  # noqa: E731
        "name": name, "kind": kind, "subject": "Shared wall with No. 12", "renovation_intro_id": intro}).json()
    b, f = demo("wall_before", "baseline", intro_id), demo("wall_after_crack", "followup")
    return client.post("/api/incidents", json={"reporter_unit_id": "T-11", "baseline_photo_id": b["id"],
                                               "followup_photo_id": f["id"]}).json()


def _decide(client, case_id: int, unit: str, decision: str, note: str = "", **extra):
    return client.post(f"/api/incidents/{case_id}/decision",
                       json={"unit_id": unit, "decision": decision, "note": note, **extra})


def _triage_events(client, unit: str) -> list[dict]:
    h = client.get(f"/api/units/{unit}/history").json()
    assert h["chain_ok"] is True
    return [e["payload"] for e in h["events"] if e["type"] == "triage"]


def test_blaming_the_renovation_is_only_a_proposal_until_the_renovating_owner_agrees(client):
    case = _case(client)
    proposed = _decide(client, case["id"], "T-11", "renovation", "Crack appeared after the hacking")
    assert proposed.status_code == 200
    p = proposed.json()
    assert p["status"] == "proposed" and p["decision"] is None and p["proposed_by"] == "T-11"
    assert client.get("/api/units/T-11/warranty").json() == []

    # The renovating owner is told in their thread with the neighbour, by Keynection rather than "SDP".
    items = client.get("/api/units/T-12/conversations/T-11").json()["items"]
    notice = [i for i in items if i.get("kind") == "system" and f"#{case['id']:03d}" in i["text"]]
    assert len(notice) == 1 and notice[0]["author"] == "Keynection"

    agreed = _decide(client, case["id"], "T-12", "renovation", "We'll patch it on Saturday").json()
    assert agreed["status"] == "decided" and agreed["decision"] == "renovation" and agreed["decided_by"] == "both_owners"
    for unit in ("T-11", "T-12"):
        assert [e["stage"] for e in _triage_events(client, unit)] == ["proposed", "decided"]


def test_renovating_owner_can_disagree_and_the_neighbour_then_asks_an_inspector(client):
    case = _case(client)
    _decide(client, case["id"], "T-11", "renovation")
    assert _decide(client, case["id"], "T-12", "dispute").status_code == 422  # a reason is required
    disputed = _decide(client, case["id"], "T-12", "dispute", "The crack was there at handover").json()
    assert disputed["status"] == "disputed" and disputed["response_note"] == "The crack was there at handover"

    # No back-and-forth: once the renovating owner has said no, the neighbour can't simply propose again.
    assert _decide(client, case["id"], "T-11", "renovation").status_code == 409
    inspect = _decide(client, case["id"], "T-11", "inspect").json()
    assert inspect["status"] == "decided" and inspect["decision"] == "inspect" and inspect["decided_by"] == "reporter"
    assert [e["stage"] for e in _triage_events(client, "T-12")] == ["proposed", "disputed", "decided"]


def test_reporter_alone_can_report_a_building_defect(client):
    case = _case(client)
    r = _decide(client, case["id"], "T-11", "warranty").json()
    assert r["status"] == "decided" and r["decision"] == "warranty" and r["decided_by"] == "reporter"
    assert len(client.get("/api/units/T-11/warranty").json()) == 1


def test_renovating_owner_can_accept_responsibility_directly(client):
    case = _case(client)
    r = _decide(client, case["id"], "T-12", "renovation", "Sorry, our contractor will fix it").json()
    assert r["status"] == "decided" and r["decided_by"] == "renovating_owner"


def test_renovating_owner_cannot_decide_about_the_neighbours_home(client):
    case = _case(client)
    assert _decide(client, case["id"], "T-12", "warranty").status_code == 403
    assert _decide(client, case["id"], "T-12", "no_action").status_code == 403
    assert _decide(client, case["id"], "T-12", "dispute", "no").status_code == 409  # nothing proposed yet


def test_renovating_owner_cannot_ask_an_inspector_before_being_blamed(client):
    case = _case(client)
    # Nothing has been proposed yet: the case is still the reporter's to decide.
    refused = _decide(client, case["id"], "T-12", "inspect")
    assert refused.status_code == 403
    assert "neighbour" in refused.json()["detail"]
    assert client.get("/api/units/T-11/incidents").json()[0]["status"] == "open"
    # The refused attempt does not lock the reporter out of their own choices.
    r = _decide(client, case["id"], "T-11", "warranty").json()
    assert r["status"] == "decided" and r["decision"] == "warranty" and r["decided_by"] == "reporter"
    assert len(client.get("/api/units/T-11/warranty").json()) == 1


def test_renovating_owner_can_ask_an_inspector_in_answer_to_a_proposal(client):
    case = _case(client)
    _decide(client, case["id"], "T-11", "renovation", "Crack appeared after the hacking")
    r = _decide(client, case["id"], "T-12", "inspect", "Let SDP check it").json()
    assert r["status"] == "decided" and r["decision"] == "inspect" and r["decided_by"] == "renovating_owner"
    assert r["response_note"] == "Let SDP check it"
    for unit in ("T-11", "T-12"):
        assert [e["stage"] for e in _triage_events(client, unit)] == ["proposed", "decided"]
    # Once decided, nobody can decide again.
    assert _decide(client, case["id"], "T-11", "warranty").status_code == 409


def test_renovating_owner_can_still_ask_an_inspector_after_disagreeing(client):
    case = _case(client)
    _decide(client, case["id"], "T-11", "renovation")
    _decide(client, case["id"], "T-12", "dispute", "The crack was there at handover")
    r = _decide(client, case["id"], "T-12", "inspect").json()
    assert r["status"] == "decided" and r["decision"] == "inspect" and r["decided_by"] == "renovating_owner"
    # The owner's earlier reason is kept on the record (no note was sent with the inspector request).
    assert r["response_note"] == "The crack was there at handover"


def test_households_outside_the_case_cannot_decide(client):
    case = _case(client)
    for decision in ("renovation", "warranty", "inspect", "no_action"):
        assert _decide(client, case["id"], "T-13", decision).status_code == 403


def test_residents_cannot_record_an_sdp_inspector_decision(client):
    case = _case(client)
    assert _decide(client, case["id"], "T-11", "warranty", decided_by="sdp_inspector").status_code == 403
    assert client.get(f"/api/units/T-11/incidents").json()[0]["status"] == "open"


def test_reporter_cannot_confirm_their_own_proposal_and_decided_cases_are_final(client):
    case = _case(client)
    _decide(client, case["id"], "T-11", "renovation")
    assert _decide(client, case["id"], "T-11", "renovation").status_code == 409
    assert _decide(client, case["id"], "T-11", "warranty").json()["status"] == "decided"
    assert _decide(client, case["id"], "T-12", "renovation").status_code == 409


def test_blame_needs_a_linked_renovation(client):
    case = _case(client, with_renovation=False)
    assert _decide(client, case["id"], "T-11", "renovation").status_code == 400


def test_a_helper_who_is_not_authorised_cannot_decide(client):
    case = _case(client)
    assert _decide(client, case["id"], "T-11", "warranty", delegate_id=999).status_code == 403
