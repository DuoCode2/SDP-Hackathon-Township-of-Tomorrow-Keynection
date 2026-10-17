"""A hello goes to several neighbours at once, so it gets the same protections as a chat message:
blocks and quiet mode are respected, insults and contact details are stopped, and it can't be repeated all day.
Renovation notices keep their reach, but only for a real date range, and the chat link they open ends with the work."""
from datetime import date, timedelta

import pytest
from fastapi.testclient import TestClient


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("KEYNECTION_DB_PATH", str(tmp_path / "test.db"))
    monkeypatch.setenv("KEYNECTION_DEMO_MODE", "1")
    from app.main import app

    with TestClient(app) as c:
        yield c


def _hello(client, to, message="Hi! I'm Aiman from No. 12."):
    return client.post("/api/intros", json={"from_unit_id": "T-12", "message": message, "to_unit_ids": to})


def _inbox_from_12(client, unit):
    return [i for i in client.get(f"/api/units/{unit}/inbox").json() if i["from_unit_id"] == "T-12"]


def test_a_hello_never_reaches_someone_who_blocked_you_and_does_not_reveal_the_block(client):
    client.post("/api/units/T-11/blocks", json={"other_unit_id": "T-12", "blocked": True})
    r = _hello(client, ["T-11", "T-13"])
    assert r.status_code == 201 and set(r.json()["recipients"]) == {"T-11", "T-13"}
    assert _inbox_from_12(client, "T-11") == []
    assert len(_inbox_from_12(client, "T-13")) == 1


def test_a_hello_waits_for_quiet_mode(client):
    client.put("/api/units/T-11/profile", json={"quiet_mode": True})
    r = _hello(client, ["T-11", "T-13"])
    assert r.status_code == 201 and r.json()["recipients"] == ["T-13"]
    assert _inbox_from_12(client, "T-11") == []
    assert _hello(client, ["T-11"]).status_code == 409


def test_a_hello_gets_the_tone_and_contact_checks(client):
    r = _hello(client, ["T-11"], "Hi, you idiot")
    assert r.status_code == 422 and r.json()["detail"]["code"] == "tone"
    r = _hello(client, ["T-11"], "Hi! WhatsApp me on 012-345 6789")
    assert r.status_code == 422 and r.json()["detail"]["code"] == "private"


def test_a_renovation_notice_may_give_the_contractors_number_but_not_insults(client):
    reno = {"scope": "Hack kitchen tiles", "start": "2099-01-05", "end": "2099-01-20"}
    ok = client.post("/api/intros", json={"from_unit_id": "T-12", "renovation": reno,
                                          "message": "Questions? Call ABC Renovation on 012-345 6789."})
    assert ok.status_code == 201
    bad = client.post("/api/intros", json={"from_unit_id": "T-12", "renovation": reno, "message": "Deal with it, idiot"})
    assert bad.status_code == 422


def test_hellos_are_limited_per_day(client):
    from app import main

    cap = main.daily_cap(main.MAX_HELLOS_PER_DAY)  # 3 a day in a pilot; the shared demo allows ten times that
    for _ in range(cap):
        assert _hello(client, ["T-13"]).status_code == 201
    assert _hello(client, ["T-13"]).status_code == 429


@pytest.mark.parametrize("start,end", [("2026-02-30", "2026-03-10"), ("2099-01-05", "2099-99-99")])
def test_renovation_dates_must_be_real(client, start, end):
    r = client.post("/api/intros", json={"from_unit_id": "T-12", "message": "Hi",
                                         "renovation": {"scope": "Tiles", "start": start, "end": end}})
    assert r.status_code == 422


def test_a_renovation_cannot_run_for_more_than_a_year(client):
    r = client.post("/api/intros", json={"from_unit_id": "T-12", "message": "Hi",
                                         "renovation": {"scope": "Tiles", "start": "2099-01-01", "end": "2100-03-01"}})
    assert r.status_code == 422


def test_structural_work_needs_its_approval_on_the_server_too(client):
    structural = {"scope": "Extend kitchen", "start": "2099-01-05", "end": "2099-02-20", "works_type": "structural"}
    send = lambda unit, **extra: client.post("/api/intros", json={  # noqa: E731
        "from_unit_id": unit, "message": "Works notice", "renovation": {**structural, **extra}})
    assert send("T-12").status_code == 422
    assert send("T-12", council_permit="applied").status_code == 422
    assert send("T-12", council_permit="approved", permit_ref="PBT/2099/1").status_code == 201
    assert send("A-15-3", management_approval="pending").status_code == 422
    assert send("A-15-3", management_approval="approved").status_code == 201


def _wet_reno_by_15_3(client, end: date) -> None:
    start = end - timedelta(days=10)
    assert client.post("/api/intros", json={"from_unit_id": "A-15-3", "message": "Bathroom works",
                                            "renovation": {"scope": "Bathroom", "start": start.isoformat(),
                                                           "end": end.isoformat(), "works_type": "wet"}}).status_code == 201


def test_a_renovation_opens_a_chat_two_floors_down_while_it_matters(client):
    _wet_reno_by_15_3(client, date.today() + timedelta(days=5))
    assert client.post("/api/messages", json={"from_unit_id": "A-13-3", "to_unit_id": "A-15-3", "body": "Hi, water stain?"}).status_code == 201


def test_that_chat_link_ends_a_month_after_the_work(client):
    _wet_reno_by_15_3(client, date.today() - timedelta(days=31))
    assert client.post("/api/messages", json={"from_unit_id": "A-13-3", "to_unit_id": "A-15-3", "body": "Hi"}).status_code == 403
