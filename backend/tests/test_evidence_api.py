import io

import pytest
from fastapi.testclient import TestClient
from PIL import Image


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("JIRAN_DB_PATH", str(tmp_path / "test.db"))
    monkeypatch.setenv("JIRAN_DEMO_MODE", "1")
    from app.main import app

    with TestClient(app) as c:
        yield c


def _renovation_by_12(client) -> int:
    return client.post("/api/intros", json={
        "from_unit_id": "T-12", "message": "Hi, renovating soon",
        "renovation": {"scope": "Extend kitchen (rear wall)", "start": "2099-10-15", "end": "2099-10-30"},
    }).json()["id"]


def _demo(client, unit, name, kind, intro_id=None):
    return client.post(f"/api/units/{unit}/photos/demo", json={
        "name": name, "kind": kind, "subject": "Shared wall with No. 12", "renovation_intro_id": intro_id,
    })


def test_neighbour_sees_renovation_task_with_wall_subject(client):
    intro_id = _renovation_by_12(client)
    ev = client.get("/api/units/T-11/evidence").json()
    task = ev["renovations"][0]
    assert task["intro_id"] == intro_id and task["needs_photo"] is True
    assert task["suggested_subject"] == "Shared wall with No. 12" and task["baseline"] is None


def test_full_flow_baseline_followup_compare_and_decide(client):
    intro_id = _renovation_by_12(client)
    baseline = _demo(client, "T-11", "wall_before", "baseline", intro_id)
    assert baseline.status_code == 201 and baseline.json()["quality"]["ok"] is True
    followup = _demo(client, "T-11", "wall_after_crack", "followup").json()

    incident = client.post("/api/incidents", json={
        "reporter_unit_id": "T-11", "baseline_photo_id": baseline.json()["id"], "followup_photo_id": followup["id"],
    })
    assert incident.status_code == 201
    case = incident.json()
    assert case["comparison"]["changed"] is True
    assert case["hint"]["suggestion"] == "renovation"
    assert client.get(case["images"]["overlay"]).headers["content-type"] == "image/jpeg"

    # The renovating household sees the case too.
    assert [c["id"] for c in client.get("/api/units/T-12/incidents").json()] == [case["id"]]

    decided = client.post(f"/api/incidents/{case['id']}/decision", json={"decision": "renovation", "note": "Contractor will patch"})
    assert decided.json()["status"] == "decided"
    assert client.post(f"/api/incidents/{case['id']}/decision", json={"decision": "warranty"}).status_code == 409

    # Both home histories record it, and both chains still verify.
    for unit, expected in (("T-11", ["handover", "photo_baseline", "incident", "triage"]), ("T-12", ["handover", "renovation_registered", "triage"])):
        h = client.get(f"/api/units/{unit}/history").json()
        assert [e["type"] for e in h["events"]] == expected and h["chain_ok"] is True


def test_baseline_photo_hash_is_sealed_in_home_history(client):
    intro_id = _renovation_by_12(client)
    photo = _demo(client, "T-13", "wall_before", "baseline", intro_id).json()
    event = client.get("/api/units/T-13/history").json()["events"][-1]
    assert event["type"] == "photo_baseline" and event["payload"]["sha256"] == photo["sha256"]


def test_only_notified_neighbours_can_attach_photos_to_a_renovation(client):
    intro_id = _renovation_by_12(client)
    assert _demo(client, "T-15", "wall_before", "baseline", intro_id).status_code == 403


def test_cannot_compare_someone_elses_photos(client):
    intro_id = _renovation_by_12(client)
    b = _demo(client, "T-11", "wall_before", "baseline", intro_id).json()
    f = _demo(client, "T-13", "wall_after_crack", "followup").json()
    r = client.post("/api/incidents", json={"reporter_unit_id": "T-11", "baseline_photo_id": b["id"], "followup_photo_id": f["id"]})
    assert r.status_code == 403


def test_real_upload_validates_files(client):
    buf = io.BytesIO()
    Image.new("RGB", (1200, 900), (210, 210, 210)).save(buf, "JPEG")
    ok = client.post("/api/units/T-11/photos", data={"kind": "followup", "subject": "Wall"},
                     files={"file": ("wall.jpg", buf.getvalue(), "image/jpeg")})
    assert ok.status_code == 201
    bad = client.post("/api/units/T-11/photos", data={"kind": "followup", "subject": "Wall"},
                      files={"file": ("evil.jpg", b"not an image", "image/jpeg")})
    assert bad.status_code == 400


def test_photo_ids_cannot_be_used_for_path_tricks(client):
    assert client.get("/api/photos/..%2F..%2Fapp.db").status_code == 404
    assert client.get("/api/photos/" + "a" * 32).status_code == 404


def test_demo_endpoints_are_disabled_outside_demo_mode(client, monkeypatch):
    monkeypatch.setenv("JIRAN_DEMO_MODE", "0")
    assert client.post("/api/demo/reset").status_code == 403
    assert client.get("/api/demo/photos").status_code == 403


def test_image_urls_differ_when_case_numbers_restart_after_reset(client):
    def make_case(baseline_name, followup_name):
        intro_id = _renovation_by_12(client)
        b = _demo(client, "T-11", baseline_name, "baseline", intro_id).json()
        f = _demo(client, "T-11", followup_name, "followup").json()
        return client.post("/api/incidents", json={
            "reporter_unit_id": "T-11", "baseline_photo_id": b["id"], "followup_photo_id": f["id"]}).json()

    first = make_case("wall_before", "wall_after_crack")
    client.post("/api/demo/reset")
    second = make_case("ceiling_before", "ceiling_after_stain")
    assert first["id"] == second["id"] == 1
    assert first["images"]["overlay"] != second["images"]["overlay"]


def test_reset_removes_photos_and_cases(client):
    intro_id = _renovation_by_12(client)
    _demo(client, "T-11", "wall_before", "baseline", intro_id)
    client.post("/api/demo/reset")
    d = client.get("/api/dashboard").json()
    assert d["baseline_photos"] == 0 and d["incidents"] == 0 and d["intros_sent"] == 0
