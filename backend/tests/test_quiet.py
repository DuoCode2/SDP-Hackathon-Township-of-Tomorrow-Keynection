"""Quiet times: a renovation's noisy hours are planned around the neighbours before anyone has to ask, the notice
says so, reminders go out on their own at the right moments, and a noise concern is checked against what was agreed.
In the demo Siti (No. 11, next door) keeps 13:00–15:00 quiet for her baby and Hafiz (No. 22, across the road)
09:00–11:00 after night shifts."""
import sqlite3
from datetime import date, datetime, timedelta

import pytest
from fastapi.testclient import TestClient

from app import quiet

START, END = (date.today() + timedelta(days=10)).isoformat(), (date.today() + timedelta(days=20)).isoformat()
RENO = {"scope": "Retile the master bathroom", "start": START, "end": END, "works_type": "wet",
        "noisy_from": "09:00", "noisy_to": "17:00", "weekdays_only": True}
SITI, HAFIZ = [{"start": "13:00", "end": "15:00"}], [{"start": "09:00", "end": "11:00"}]


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("JIRAN_DB_PATH", str(tmp_path / "test.db"))
    monkeypatch.setenv("JIRAN_DEMO_MODE", "1")
    monkeypatch.delenv("JIRAN_SITE_PASSWORD", raising=False)
    from app.main import app

    with TestClient(app) as c:
        c.db_path = str(tmp_path / "test.db")
        yield c


def _notice(client, frm="T-12", **reno):
    return client.post("/api/intros", json={"from_unit_id": frm, "message": "Hello, works soon", "lang": "en",
                                            "renovation": {**RENO, **reno}})


def _intro_item(client, me, other):
    return [i for i in client.get(f"/api/units/{me}/conversations/{other}").json()["items"] if i["type"] == "intro"][-1]


# ---------- the plan ----------

def test_noisy_hours_are_planned_around_the_neighbours():
    p = quiet.plan("09:00", "17:00", [SITI, HAFIZ, []])
    # Hafiz's quiet time is at the start of the day, so work starts later; Siti's becomes a quiet break.
    assert (p["noisy_from"], p["noisy_to"], p["quiet_breaks"]) == ("11:00", "17:00", [{"start": "13:00", "end": "15:00"}])
    assert p["avoided"] == 2 and p["not_avoided"] == 0 and p["homes_with_quiet_times"] == 2 and p["noisy_minutes"] == 240


def test_the_renovating_owner_always_keeps_a_fair_working_day():
    homes = [[{"start": "10:00", "end": "12:00"}], [{"start": "13:00", "end": "15:00"}], [{"start": "15:00", "end": "16:30"}]]
    p = quiet.plan("09:00", "18:00", homes)
    assert p["noisy_minutes"] >= quiet.MIN_NOISY_MINUTES
    assert p["avoided"] == 2 and p["not_avoided"] == 1  # the one that doesn't fit is told, not hidden


def test_plans_stay_inside_the_councils_hours():
    p = quiet.plan("07:00", "21:00", [])
    assert (p["noisy_from"], p["noisy_to"]) == (quiet.LEGAL_FROM, quiet.LEGAL_TO)
    # Quiet time outside the noisy hours costs the owner nothing.
    assert quiet.plan("09:00", "17:00", [[{"start": "06:00", "end": "08:30"}]])["avoided"] == 1


def test_a_notice_either_avoids_a_households_quiet_time_or_it_doesnt():
    planned = {"noisy_from": "11:00", "noisy_to": "17:00", "quiet_breaks": [{"start": "13:00", "end": "15:00"}]}
    assert quiet.respected(planned, SITI) == "avoided" and quiet.respected(planned, HAFIZ) == "avoided"
    assert quiet.respected({"noisy_from": "09:00", "noisy_to": "17:00"}, SITI) == "overlap"
    assert quiet.respected(planned, []) is None


def test_quiet_times_are_limited_so_nobody_can_block_a_renovation():
    two = SITI + [{"start": "09:00", "end": "10:00"}]  # two quiet times, three hours in all
    assert quiet.check_windows(two) is None
    assert quiet.check_windows(two + [{"start": "16:00", "end": "16:30"}]) is not None
    assert quiet.check_windows([{"start": "09:00", "end": "13:00"}]) is not None  # more than 3 hours
    assert quiet.check_windows([{"start": "15:00", "end": "13:00"}]) is not None


def test_a_moment_is_checked_against_the_notice():
    reno = {**RENO, "start": "2026-10-19", "end": "2026-10-30", "noisy_from": "11:00", "noisy_to": "17:00",
            "quiet_breaks": [{"start": "13:00", "end": "15:00"}]}
    at = lambda d, t: datetime.fromisoformat(f"{d}T{t}")
    assert quiet.timing(reno, at("2026-10-20", "11:30")) == "within_hours"  # a Tuesday
    assert quiet.timing(reno, at("2026-10-20", "13:30")) == "quiet_break"
    assert quiet.timing(reno, at("2026-10-20", "08:15")) == "outside_hours"
    assert quiet.timing(reno, at("2026-10-24", "11:30")) == "not_a_work_day"  # Saturday, weekdays only
    assert quiet.timing(reno, at("2026-10-25", "11:30")) == "not_a_work_day"  # Sunday
    assert quiet.timing(reno, at("2026-11-02", "11:30")) == "outside_dates"


# ---------- quiet times stay private ----------

def test_a_household_sets_its_own_quiet_times_and_nobody_sees_why(client):
    assert client.get("/api/units/T-11/quiet-times").json()["windows"] == [{**SITI[0], "why": "baby"}]
    assert client.put("/api/units/T-14/quiet-times", json={"windows": [{"start": "14:00", "end": "16:00", "why": "work_from_home"}]}).status_code == 200
    assert client.get("/api/units/T-14/quiet-times").json()["windows"][0]["why"] == "work_from_home"
    too_many = [{"start": "09:00", "end": "10:00"}, {"start": "11:00", "end": "12:00"}, {"start": "13:00", "end": "14:00"}]
    assert client.put("/api/units/T-14/quiet-times", json={"windows": too_many}).status_code == 422
    assert client.put("/api/units/T-14/quiet-times", json={"windows": [{"start": "09:00", "end": "13:30"}]}).status_code == 422
    # The renovating owner sees times and a count, never whose they are or why.
    plan = client.get("/api/units/T-12/quiet-plan", params={**RENO}).text
    for secret in ("baby", "night_shift", "Siti", "Hafiz", "T-11", "T-22", "No. 11", "No. 22"):
        assert secret not in plan, secret


# ---------- registering a renovation ----------

def test_the_owner_is_offered_hours_that_avoid_the_neighbours(client):
    p = client.get("/api/units/T-12/quiet-plan", params={**RENO}).json()
    assert (p["noisy_from"], p["noisy_to"], p["quiet_breaks"]) == ("11:00", "17:00", [{"start": "13:00", "end": "15:00"}])
    assert p["avoided"] == 2 and p["double_works"] is None


def test_the_notice_tells_each_neighbour_their_quiet_time_was_kept(client):
    assert _notice(client, noisy_from="11:00", quiet_breaks=[{"start": "13:00", "end": "15:00"}]).status_code == 201
    assert _intro_item(client, "T-11", "T-12")["quiet"] == "avoided"  # Siti
    assert _intro_item(client, "T-13", "T-12")["quiet"] is None  # Kumar set no quiet time
    assert _intro_item(client, "T-12", "T-11")["quiet"] is None  # the owner's own view
    alert = next(m for m in client.get("/api/units/T-11/whatsapp").json()["messages"] if m["kind"] == "reno")["text"]
    assert "senyap 13:00–15:00" in alert and "waktu senyap anda" in alert  # Malay: hours, and that hers was kept
    logged = next(e for e in client.get("/api/units/T-12/history").json()["events"] if e["type"] == "renovation_registered")
    assert logged["payload"]["quiet_times"] == {"avoided": 2, "overlap": 0}


def test_a_notice_that_ignores_a_quiet_time_says_so_and_keeps_saying_so(client):
    _notice(client)  # 09:00–17:00 straight through
    assert _intro_item(client, "T-11", "T-12")["quiet"] == "overlap"
    # What Siti was told is fixed when the notice goes out: changing her quiet time later doesn't rewrite it.
    client.put("/api/units/T-11/quiet-times", json={"windows": [{"start": "17:30", "end": "18:00"}]})
    assert _intro_item(client, "T-11", "T-12")["quiet"] == "overlap"


def test_quiet_breaks_must_sit_inside_the_noisy_hours(client):
    assert _notice(client, quiet_breaks=[{"start": "08:00", "end": "09:30"}]).status_code == 422
    assert _notice(client, quiet_breaks=[{"start": "14:00", "end": "13:00"}]).status_code == 422


def test_a_home_about_to_get_works_from_two_sides_is_spotted(client):
    # Farid (No. 10) is already renovating next to Siti; Aiman (No. 12) on her other side plans overlapping dates.
    first_end = (date.fromisoformat(START) + timedelta(days=4)).isoformat()
    _notice(client, frm="T-10", end=first_end)
    p = client.get("/api/units/T-12/quiet-plan", params={**RENO}).json()
    assert p["double_works"]["homes"] >= 1
    assert p["double_works"]["clear_from"] == (date.fromisoformat(first_end) + timedelta(days=1)).isoformat()
    later = {**RENO, "start": p["double_works"]["clear_from"],
             "end": (date.fromisoformat(p["double_works"]["clear_from"]) + timedelta(days=10)).isoformat()}
    assert client.get("/api/units/T-12/quiet-plan", params=later).json()["double_works"] is None


# ---------- reminders go out on their own ----------

def test_reminders_are_scheduled_for_the_right_moments(client):
    _notice(client)
    alerts = {m["kind"]: m for m in client.get("/api/units/T-13/whatsapp").json()["messages"]}
    photo, done = alerts["reno_photo"], alerts["reno_done"]
    assert photo["scheduled"] and photo["at"].startswith((date.fromisoformat(START) - timedelta(days=3)).isoformat())
    assert done["scheduled"] and done["at"].startswith((date.fromisoformat(END) + timedelta(days=1)).isoformat())
    assert alerts["reno"]["scheduled"] is False
    owner = {m["kind"] for m in client.get("/api/units/T-12/whatsapp").json()["messages"]}
    assert "reno_done_owner" in owner


# ---------- a noise concern is checked against what was agreed ----------

def test_a_noise_concern_records_whether_the_work_was_inside_the_agreed_hours(client):
    intro = _notice(client, start="2026-10-19", end="2026-10-30", noisy_from="11:00",
                    quiet_breaks=[{"start": "13:00", "end": "15:00"}]).json()["id"]
    concern = client.post("/api/concerns", json={"from_unit_id": "T-11", "intro_id": intro, "category": "noise_hours"}).json()
    with sqlite3.connect(client.db_path) as db:  # raised on Tuesday 20 Oct at 13:30 in Malaysia
        db.execute("UPDATE concerns SET created_at = '2026-10-20T05:30:00+00:00' WHERE id = ?", (concern["id"],))
    item = next(i for i in client.get("/api/units/T-12/conversations/T-11").json()["items"] if i["type"] == "concern")
    assert item["timing"] == "quiet_break"


# ---------- SDP sees how many clashes were avoided ----------

def test_sdp_counts_quiet_times_kept_and_missed(client):
    _notice(client, noisy_from="11:00", quiet_breaks=[{"start": "13:00", "end": "15:00"}])
    _notice(client, frm="T-14", works_type="light")  # Wei Jie: light work reaches the shared walls only, no quiet times there
    d = client.get("/api/dashboard").json()
    assert d["quiet_times_kept"] == 2 and d["quiet_times_missed"] == 0
