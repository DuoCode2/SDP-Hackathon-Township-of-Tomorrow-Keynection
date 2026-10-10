"""SDP back-office actions need a staff sign-in in pilot mode (JIRAN_DEMO_MODE=0): signed out, nobody can post as
the estate team, clear reports, submit repairs or read the queues. In demo mode anyone can try them."""
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


def _jpeg() -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (1200, 900), (210, 210, 210)).save(buf, "JPEG")
    return buf.getvalue()


STAFF_CALLS = [
    ("get", "/api/estate/concerns", {}),
    ("post", "/api/concerns/1/estate", {"json": {"action": "remind", "note": "Pay at the guardhouse"}}),
    ("get", "/api/moderation/reports", {}),
    ("post", "/api/reports/1/review", {"json": {"outcome": "dismissed"}}),
    ("post", "/api/notices", {"json": {"audience": "phase", "title": "Pay RM50 to the guard", "body": "Cash only, today."}}),
    ("get", "/api/warranty", {}),
    ("post", "/api/warranty/1/repair", {"data": {"subcontractor": "X"}, "files": {"file": ("r.jpg", _jpeg(), "image/jpeg")}}),
    ("get", "/api/dashboard", {}),
    ("get", "/api/units/T-11/whatsapp", {}),
]


@pytest.mark.parametrize("method,url,kwargs", STAFF_CALLS, ids=[c[1] for c in STAFF_CALLS])
def test_staff_actions_are_closed_outside_demo_mode(client, monkeypatch, method, url, kwargs):
    monkeypatch.setenv("JIRAN_DEMO_MODE", "0")
    assert getattr(client, method)(url, **kwargs).status_code == 401  # signed out: please sign in


def test_closed_even_before_the_request_is_checked(client, monkeypatch):
    monkeypatch.setenv("JIRAN_DEMO_MODE", "0")
    assert client.post("/api/notices", json={}).status_code == 401  # not 422: no hints about the expected fields


def test_staff_actions_still_work_in_demo_mode(client):
    assert client.post("/api/notices", json={"audience": "phase", "title": "Water cut", "body": "Tuesday 9am to noon."}).status_code == 201
    assert client.get("/api/dashboard").status_code == 200
    assert client.get("/api/warranty").status_code == 200


def test_no_one_can_write_arbitrary_records_into_a_home_log(client):
    r = client.post("/api/units/T-11/events", json={"type": "warranty_closed_by_owner", "payload": {"ticket_id": 1}})
    assert r.status_code in (404, 405)
    assert "warranty_closed_by_owner" not in [e["type"] for e in client.get("/api/units/T-11/history").json()["events"]]
