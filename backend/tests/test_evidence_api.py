import io
import os
import sqlite3

import pytest
from fastapi.testclient import TestClient
from PIL import Image


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("KEYNECTION_DB_PATH", str(tmp_path / "test.db"))
    monkeypatch.setenv("KEYNECTION_DEMO_MODE", "1")
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
    # Work at No. 12 starts in 2099, so a crack photographed today was there before any work began.
    assert case["hint"]["suggestion"] == "warranty"
    assert client.get(case["images"]["overlay"]).headers["content-type"] == "image/jpeg"

    # The renovating household sees the case too.
    assert [c["id"] for c in client.get("/api/units/T-12/incidents").json()] == [case["id"]]

    decided = client.post(f"/api/incidents/{case['id']}/decision",
                          json={"unit_id": "T-12", "decision": "renovation", "note": "Contractor will patch"})
    assert decided.json()["status"] == "decided"
    assert client.post(f"/api/incidents/{case['id']}/decision", json={"unit_id": "T-11", "decision": "warranty"}).status_code == 409

    # Both home histories record it, and both chains still verify.
    for unit, expected in (("T-11", ["handover", "photo_baseline", "incident", "triage"]), ("T-12", ["handover", "renovation_registered", "triage"])):
        h = client.get(f"/api/units/{unit}/history").json()
        assert [e["type"] for e in h["events"]] == expected and h["chain_ok"] is True


def test_change_seen_after_work_began_is_suggested_as_renovation_with_a_caveat(client):
    intro_id = client.post("/api/intros", json={
        "from_unit_id": "T-12", "message": "Hi, renovating",
        "renovation": {"scope": "Hack kitchen tiles", "start": "2020-01-10", "end": "2020-01-20"},
    }).json()["id"]
    baseline = _demo(client, "T-11", "wall_before", "baseline", intro_id).json()
    # Pretend the pre-work photo was taken before the 2020 works began.
    conn = sqlite3.connect(os.environ["KEYNECTION_DB_PATH"])
    conn.execute("UPDATE photos SET created_at = '2020-01-05T02:00:00+00:00' WHERE id = ?", (baseline["id"],))
    conn.commit()
    conn.close()
    followup = _demo(client, "T-11", "wall_after_crack", "followup").json()
    case = client.post("/api/incidents", json={
        "reporter_unit_id": "T-11", "baseline_photo_id": baseline["id"], "followup_photo_id": followup["id"]}).json()
    assert case["hint"]["suggestion"] == "renovation"
    assert any("Timing alone does not prove" in r for r in case["hint"]["reasons"])


def test_follow_up_must_be_taken_after_the_pre_work_photo(client):
    intro_id = _renovation_by_12(client)
    followup = _demo(client, "T-11", "wall_after_crack", "followup").json()
    baseline = _demo(client, "T-11", "wall_before", "baseline", intro_id).json()
    conn = sqlite3.connect(os.environ["KEYNECTION_DB_PATH"])
    conn.execute("UPDATE photos SET created_at = '2020-01-01T00:00:00+00:00' WHERE id = ?", (followup["id"],))
    conn.commit()
    conn.close()
    r = client.post("/api/incidents", json={
        "reporter_unit_id": "T-11", "baseline_photo_id": baseline["id"], "followup_photo_id": followup["id"]})
    assert r.status_code == 400


def test_baseline_photo_hash_is_sealed_in_home_history(client):
    intro_id = _renovation_by_12(client)
    photo = _demo(client, "T-13", "wall_before", "baseline", intro_id).json()
    event = client.get("/api/units/T-13/history").json()["events"][-1]
    assert event["type"] == "photo_baseline" and event["payload"]["sha256"] == photo["sha256"]


def test_only_notified_neighbours_can_attach_photos_to_a_renovation(client):
    intro_id = _renovation_by_12(client)
    assert _demo(client, "T-15", "wall_before", "baseline", intro_id).status_code == 403


def test_a_photo_can_be_linked_to_a_renovation_notice_but_never_to_a_hello(client):
    hello = client.post("/api/intros", json={"from_unit_id": "T-12", "message": "Hi, I'm Aiman from No. 12.", "to_unit_ids": ["T-11"]})
    assert hello.status_code == 201 and hello.json()["recipients"] == ["T-11"]
    hello_id = hello.json()["id"]
    # The hello is in T-11's inbox, so the recipient check alone would have let it through.
    assert any(i["id"] == hello_id for i in client.get("/api/units/T-11/inbox").json())

    r = _demo(client, "T-11", "wall_before", "baseline", hello_id)
    assert r.status_code == 422 and "renovation notice" in r.json()["detail"]
    assert _demo(client, "T-11", "wall_after_crack", "followup", hello_id).status_code == 422
    assert client.get("/api/units/T-11/evidence").json()["photos"] == []

    intro_id = _renovation_by_12(client)
    ok = _demo(client, "T-11", "wall_before", "baseline", intro_id)
    assert ok.status_code == 201 and ok.json()["renovation_intro_id"] == intro_id
    # A home that was never notified is still refused as before.
    assert _demo(client, "T-15", "wall_before", "baseline", intro_id).status_code == 403


def test_follow_up_cannot_point_the_case_at_a_different_renovation(client):
    first, second = _renovation_by_12(client), _renovation_by_12(client)
    baseline = _demo(client, "T-11", "wall_before", "baseline", first).json()

    other = _demo(client, "T-11", "wall_after_crack", "followup", second).json()
    r = client.post("/api/incidents", json={"reporter_unit_id": "T-11", "baseline_photo_id": baseline["id"], "followup_photo_id": other["id"]})
    assert r.status_code == 400 and "different renovation" in r.json()["detail"]
    assert client.get("/api/units/T-11/incidents").json() == []

    # The same notice on the follow-up is accepted, and the case keeps the pre-work photo's renovation.
    same = _demo(client, "T-11", "wall_after_crack", "followup", first).json()
    case = client.post("/api/incidents", json={"reporter_unit_id": "T-11", "baseline_photo_id": baseline["id"], "followup_photo_id": same["id"]})
    assert case.status_code == 201 and case.json()["renovation"]["id"] == first


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


def test_oversized_bodies_are_refused_even_without_a_content_length(client):
    def multipart():  # streamed, so no Content-Length header: the size can only be checked while reading
        yield (b'--zzz\r\nContent-Disposition: form-data; name="kind"\r\n\r\nfollowup\r\n'
               b'--zzz\r\nContent-Disposition: form-data; name="subject"\r\n\r\nWall\r\n'
               b'--zzz\r\nContent-Disposition: form-data; name="file"; filename="big.jpg"\r\n'
               b'Content-Type: image/jpeg\r\n\r\n')
        for _ in range(14):
            yield b"x" * (1024 * 1024)
        yield b"\r\n--zzz--\r\n"

    def json_body():
        yield b'{"from_unit_id": "T-12", "message": "'
        for _ in range(14):
            yield b"x" * (1024 * 1024)
        yield b'"}'

    r = client.post("/api/units/T-11/photos", content=multipart(),
                    headers={"Content-Type": "multipart/form-data; boundary=zzz"})
    assert r.status_code == 413
    assert client.post("/api/intros", content=json_body(), headers={"Content-Type": "application/json"}).status_code == 413


def test_photo_ids_cannot_be_used_for_path_tricks(client):
    assert client.get("/api/photos/..%2F..%2Fapp.db").status_code == 404
    assert client.get("/api/photos/" + "a" * 32).status_code == 404


def test_demo_endpoints_are_disabled_outside_demo_mode(client, monkeypatch):
    monkeypatch.setenv("KEYNECTION_DEMO_MODE", "0")
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
