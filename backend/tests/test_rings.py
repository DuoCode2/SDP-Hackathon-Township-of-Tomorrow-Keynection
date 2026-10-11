import pytest
from fastapi.testclient import TestClient

from app.neighbours import Unit, impact_zone, street_or_block
from app.seed import demo_units

RENO = {"scope": "Re-tile bathroom", "start": "2026-10-15", "end": "2026-10-30"}


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("JIRAN_DB_PATH", str(tmp_path / "test.db"))
    monkeypatch.setenv("JIRAN_DEMO_MODE", "1")
    from app.main import app

    with TestClient(app) as c:
        yield c


def _units() -> list[Unit]:
    return [Unit(id=u["id"], kind=u["kind"], label=u["label"], row=u.get("row"), facing_row=u.get("facing_row"),
                 block=u.get("block"), floor=u.get("floor"), pos=u["pos"]) for u in demo_units()]


def _zone(unit_id: str, works: str) -> dict[str, str]:
    units = _units()
    me = next(u for u in units if u.id == unit_id)
    return {n.unit_id: n.relation for n in impact_zone(me, units, works)}


def _notice(client, unit="A-15-3", works="wet") -> int:
    return client.post("/api/intros", json={"from_unit_id": unit, "message": "Hi",
                                            "renovation": {**RENO, "works_type": works}}).json()["id"]


# ---------- impact zone by type of work ----------

def test_wet_work_reaches_two_floors_down_but_not_up():
    assert _zone("A-15-3", "wet") == {"A-15-2": "left", "A-15-4": "right", "A-14-3": "below", "A-13-3": "below-2"}


def test_hacking_reaches_two_floors_up_and_down():
    assert _zone("A-14-3", "hacking") == {"A-14-2": "left", "A-14-4": "right", "A-15-3": "above", "A-16-3": "above-2",
                                          "A-13-3": "below", "A-12-3": "below-2"}


def test_light_work_only_tells_the_shared_walls():
    assert _zone("T-12", "light") == {"T-11": "left", "T-13": "right"}
    assert _zone("A-14-3", "light") == {"A-14-2": "left", "A-14-4": "right"}


def test_terrace_extension_tells_the_whole_circle():
    assert set(_zone("T-12", "structural")) == {"T-11", "T-13", "T-21", "T-22", "T-23"}


def test_two_floors_down_gets_the_notice_a_photo_task_and_a_chat(client):
    intro_id = _notice(client)
    task = next(t for t in client.get("/api/units/A-13-3/evidence").json()["renovations"] if t["intro_id"] == intro_id)
    assert task["relation_to_me"] == "above-2" and task["needs_photo"] and task["suggested_subject"].startswith("Ceiling")
    # Not in each other's circle, but the notice connects them for this renovation.
    assert client.post("/api/messages", json={"from_unit_id": "A-13-3", "to_unit_id": "A-15-3", "body": "Noted, thanks"}).status_code == 201
    concern = client.post("/api/concerns", json={"from_unit_id": "A-13-3", "intro_id": intro_id, "category": "damage"})
    assert concern.status_code == 201


def test_the_sender_cannot_shrink_a_renovation_notice(client):
    r = client.post("/api/intros", json={"from_unit_id": "A-15-3", "message": "Hi", "to_unit_ids": ["A-15-2"],
                                         "renovation": {**RENO, "works_type": "wet"}})
    assert set(r.json()["recipients"]) == {"A-15-2", "A-15-4", "A-14-3", "A-13-3"}


def test_impact_preview_hides_names_outside_the_circle(client):
    zone = {z["id"]: z for z in client.get("/api/units/A-15-3/impact?works_type=wet").json()}
    assert zone["A-14-3"]["resident_name"] == "Arjun"  # directly below: in the circle
    assert "resident_name" not in zone["A-13-3"] and zone["A-13-3"]["reason"].startswith("Two floors below")


# ---------- hello to part of the circle ----------

def test_hello_can_go_to_some_of_the_circle_only(client):
    r = client.post("/api/intros", json={"from_unit_id": "T-12", "message": "Hi", "to_unit_ids": ["T-11", "T-13"]})
    assert r.json()["recipients"] == ["T-11", "T-13"]
    outside = client.post("/api/intros", json={"from_unit_id": "T-12", "message": "Hi", "to_unit_ids": ["T-15"]})
    assert outside.status_code == 403


# ---------- ring 2: the street or block, by request ----------

def test_ring_two_is_the_rest_of_the_lorong_or_block():
    units = _units()
    t12 = next(u for u in units if u.id == "T-12")
    assert {n.unit_id for n in street_or_block(t12, units)} == {"T-10", "T-14", "T-15", "T-20", "T-24", "T-25"}
    a14 = next(u for u in units if u.id == "A-14-3")
    ring = {n.unit_id: n.hint for n in street_or_block(a14, units)}
    assert len(ring) == 24 - 1 - 4 and ring["A-11-3"] == "3 floors below" and ring["A-14-1"] == "Same floor"


def test_directory_shows_units_not_names_outside_the_circle(client):
    d = client.get("/api/units/T-12/directory").json()
    assert {n["id"] for n in d["circle"]} == {"T-11", "T-13", "T-21", "T-22", "T-23"}
    assert all("resident_name" not in n for n in d["nearby"])
    assert d["ring2_label"] == "Jalan Demo 1"


def test_who_is_renovating_is_only_visible_to_the_impact_zone(client):
    client.post("/api/intros", json={"from_unit_id": "T-12", "message": "Hi", "renovation": {**RENO, "works_type": "structural", "council_permit": "approved"}})
    assert "T-12" in client.get("/api/units/T-11/directory").json()["works"]
    assert "T-12" in client.get("/api/units/T-12/directory").json()["works"]
    assert "T-12" not in client.get("/api/units/T-15/directory").json()["works"]


def test_contact_request_flow_hides_names_until_accepted(client):
    assert client.post("/api/contact-requests", json={"from_unit_id": "T-12", "to_unit_id": "T-11", "reason": "parking"}).status_code == 409
    assert client.post("/api/contact-requests", json={"from_unit_id": "T-12", "to_unit_id": "A-14-3", "reason": "parking"}).status_code == 403
    assert client.post("/api/messages", json={"from_unit_id": "T-12", "to_unit_id": "T-15", "body": "hi"}).status_code == 403

    req = client.post("/api/contact-requests", json={"from_unit_id": "T-12", "to_unit_id": "T-15", "reason": "parking",
                                                      "note": "Your lorry blocked my gate this morning"}).json()
    incoming = client.get("/api/units/T-15/contact-requests").json()["incoming"][0]
    assert "resident_name" not in incoming["from"] and incoming["from"]["label"] == "No. 12"
    assert client.post(f"/api/contact-requests/{req['id']}/respond", json={"unit_id": "T-12", "accept": True}).status_code == 403
    done = client.post(f"/api/contact-requests/{req['id']}/respond", json={"unit_id": "T-15", "accept": True}).json()
    assert done["status"] == "accepted" and done["from"]["resident_name"] == "Aiman"
    assert client.post("/api/messages", json={"from_unit_id": "T-12", "to_unit_id": "T-15", "body": "Thanks!"}).status_code == 201
    nearby = {n["id"]: n for n in client.get("/api/units/T-12/directory").json()["nearby"]}
    assert nearby["T-15"]["contact"] == "connected" and nearby["T-15"]["resident_name"] == "Nurul"


def test_declined_requests_cannot_be_repeated_and_requests_are_rate_limited(client):
    req = client.post("/api/contact-requests", json={"from_unit_id": "T-12", "to_unit_id": "T-15", "reason": "noise"}).json()
    client.post(f"/api/contact-requests/{req['id']}/respond", json={"unit_id": "T-15", "accept": False})
    again = client.post("/api/contact-requests", json={"from_unit_id": "T-12", "to_unit_id": "T-15", "reason": "noise"})
    assert again.status_code == 409
    for to in ("T-10", "T-14"):
        assert client.post("/api/contact-requests", json={"from_unit_id": "T-12", "to_unit_id": to, "reason": "other"}).status_code == 201
    assert client.post("/api/contact-requests", json={"from_unit_id": "T-12", "to_unit_id": "T-20", "reason": "other"}).status_code == 429


def test_contact_request_note_gets_the_tone_check(client):
    r = client.post("/api/contact-requests", json={"from_unit_id": "T-12", "to_unit_id": "T-15", "reason": "parking", "note": "you idiot"})
    assert r.status_code == 422 and r.json()["detail"]["code"] == "tone"


# ---------- ring 3: notices; and no directory outside demo mode ----------

def test_notices_reach_the_right_audience(client):
    terrace = {n["audience"] for n in client.get("/api/units/T-12/notices").json()}
    block = {n["audience"] for n in client.get("/api/units/A-14-3/notices").json()}
    assert terrace == {"phase", "street:Jalan Demo 1"} and block == {"phase", "block:A"}
    client.post("/api/notices", json={"audience": "block:A", "title": "Lift servicing", "body": "Lift B is off on Monday morning."})
    assert client.get("/api/units/A-14-3/notices").json()[0]["title"] == "Lift servicing"
    assert all(n["title"] != "Lift servicing" for n in client.get("/api/units/T-12/notices").json())


def test_no_resident_names_in_the_phase_listing_outside_demo_mode(client, monkeypatch, sign_in):
    monkeypatch.setenv("JIRAN_DEMO_MODE", "0")
    sign_in(client, "T-12")
    others = [u for u in client.get("/api/units").json() if u["id"] != "T-12"]  # your own name greets you
    assert others and all("resident_name" not in u for u in others)
