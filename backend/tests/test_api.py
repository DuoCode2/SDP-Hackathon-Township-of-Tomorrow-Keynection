import pytest
from fastapi.testclient import TestClient


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("JIRAN_DB_PATH", str(tmp_path / "test.db"))
    from app.main import app

    with TestClient(app) as c:
        yield c


def test_intro_reaches_the_five_neighbours_and_wave_back_forms_the_card(client):
    sent = client.post("/api/intros", json={
        "from_unit_id": "T-12",
        "message": "Hi! I'm Aiman from No. 12, moving in this December.",
        "renovation": {"scope": "Extend kitchen (rear wall)", "start": "2026-10-15", "end": "2026-10-30",
                       "contractor": "ABC Renovation", "contractor_cidb_registered": True},
    })
    assert sent.status_code == 201
    assert sorted(sent.json()["recipients"]) == ["T-11", "T-13", "T-21", "T-22", "T-23"]

    inbox = client.get("/api/units/T-11/inbox").json()
    assert len(inbox) == 1 and inbox[0]["from_unit_id"] == "T-12"
    assert inbox[0]["relation_to_me"] == "right"  # No. 12 is No. 11's right-hand neighbour

    assert client.post(f"/api/intros/{inbox[0]['id']}/ack", json={"unit_id": "T-11"}).status_code == 200

    card = client.get("/api/units/T-12/card").json()
    assert card["known_count"] == 1
    assert next(n for n in card["neighbours"] if n["id"] == "T-11")["known"] is True


def test_someone_outside_the_circle_cannot_wave_back(client):
    intro_id = client.post("/api/intros", json={"from_unit_id": "T-12", "message": "Hi"}).json()["id"]
    assert client.post(f"/api/intros/{intro_id}/ack", json={"unit_id": "T-15"}).status_code == 404


def test_home_history_starts_with_handover_and_records_renovation(client):
    client.post("/api/intros", json={
        "from_unit_id": "T-12", "message": "Hi",
        "renovation": {"scope": "Bathroom tiles", "start": "2026-11-01", "end": "2026-11-07"},
    })
    history = client.get("/api/units/T-12/history").json()
    assert [e["type"] for e in history["events"]] == ["handover", "renovation_registered"]
    assert history["chain_ok"] is True


def test_reset_wipes_demo_activity(client):
    client.post("/api/intros", json={"from_unit_id": "T-12", "message": "Hi"})
    assert client.post("/api/demo/reset").status_code == 200
    d = client.get("/api/dashboard").json()
    assert d["intros_sent"] == 0 and d["households"] == 24 and d["home_histories_verified"] == 24


def test_dashboard_counts(client):
    intro_id = client.post("/api/intros", json={"from_unit_id": "A-14-3", "message": "Hi"}).json()["id"]
    client.post(f"/api/intros/{intro_id}/ack", json={"unit_id": "A-13-3"})
    d = client.get("/api/dashboard").json()
    assert d["households"] == 24
    assert d["intros_sent"] == 1
    assert d["reply_rate"] == 0.25
    assert d["households_with_a_known_neighbour"] == 2
    assert d["home_histories_verified"] == 24
