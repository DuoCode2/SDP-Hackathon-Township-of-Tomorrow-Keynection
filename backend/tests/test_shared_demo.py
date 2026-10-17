"""The online demo is one database for everyone who opens it. In demo mode it starts over by itself after a quiet
spell, so the next visitor begins from the fictional phase as seeded; and the per-day limits that keep a real
neighbour from becoming a nuisance are loosened, so one visitor's wave or notice doesn't block the next. A pilot
(KEYNECTION_DEMO_MODE=0) never resets and keeps every limit as it is."""
import os
import sqlite3
import time
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("KEYNECTION_DB_PATH", str(tmp_path / "test.db"))
    from app.main import app

    with TestClient(app) as c:
        yield c


def _wave(client, frm="T-12", to="T-11"):
    return client.post("/api/waves", json={"from_unit_id": frm, "to_unit_id": to})


def _waved(client, frm="T-12", to="T-11") -> bool:
    neighbours = client.get(f"/api/units/{frm}/card").json()["neighbours"]
    return next(n for n in neighbours if n["id"] == to)["waved_today"]


def test_the_demo_starts_over_after_a_quiet_spell(client, monkeypatch):
    from app import main

    assert _wave(client).status_code == 201
    assert _waved(client)
    monkeypatch.setattr(main, "_last_request", time.monotonic() - main.demo_idle_seconds() - 1)
    assert not _waved(client)  # the first request after the quiet spell already sees fresh demo data
    assert client.get("/api/dashboard").json()["intros_sent"] == 0


def test_the_demo_keeps_going_while_someone_is_using_it(client):
    assert _wave(client).status_code == 201
    assert _waved(client)
    assert _waved(client)  # one request after another: nothing is reset


def test_a_pilot_never_starts_over_by_itself(monkeypatch):
    from app import main

    monkeypatch.setenv("KEYNECTION_DEMO_MODE", "0")
    monkeypatch.setattr(main, "_last_request", time.monotonic() - main.demo_idle_seconds() - 1)
    assert main.start_over_if_idle(sqlite3.connect(":memory:")) is False  # whatever it is handed, it is left alone


def test_the_quiet_spell_is_twenty_minutes_unless_set(monkeypatch):
    from app import main

    assert main.demo_idle_seconds() == 20 * 60
    monkeypatch.setenv("KEYNECTION_DEMO_IDLE_MINUTES", "5")
    assert main.demo_idle_seconds() == 5 * 60


def test_in_the_demo_a_wave_can_be_repeated_after_a_few_minutes(client):
    from app import main

    assert _wave(client).status_code == 201
    assert _wave(client).status_code == 409  # right away it is still "already waved"
    old = (datetime.now(timezone.utc) - main.wave_window() - timedelta(seconds=1)).isoformat(timespec="seconds")
    conn = sqlite3.connect(os.environ["KEYNECTION_DB_PATH"])
    conn.execute("UPDATE waves SET created_at = ? WHERE from_unit_id = 'T-12' AND to_unit_id = 'T-11'", (old,))
    conn.commit()
    conn.close()
    assert not _waved(client)
    assert _wave(client).status_code == 201


def test_a_pilot_keeps_waves_to_one_a_day(monkeypatch):
    from app import main

    assert main.wave_window() <= timedelta(minutes=10)
    monkeypatch.setenv("KEYNECTION_DEMO_MODE", "0")
    assert main.wave_window() == timedelta(days=1)


def test_demo_caps_are_ten_times_a_pilots(monkeypatch):
    from app import main

    assert main.daily_cap(main.MAX_HELLOS_PER_DAY) == 10 * main.MAX_HELLOS_PER_DAY
    monkeypatch.setenv("KEYNECTION_DEMO_MODE", "0")
    assert main.daily_cap(main.MAX_HELLOS_PER_DAY) == main.MAX_HELLOS_PER_DAY


def test_several_visitors_can_each_register_a_renovation_in_the_demo(client):
    reno = {"scope": "Hack kitchen tiles", "start": "2099-01-05", "end": "2099-01-20"}
    for _ in range(4):  # a pilot allows 3 a day
        assert client.post("/api/intros", json={"from_unit_id": "T-12", "renovation": reno, "message": "Hi"}).status_code == 201
