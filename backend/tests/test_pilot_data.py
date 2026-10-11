"""Pilot mode keeps real households' records: no fictional seed, and a newer version of Keynection adds to the
database instead of rebuilding it. Demo mode (rebuilt from the fictional seed) is unchanged."""
import pytest
from fastapi.testclient import TestClient

from app import db


def _connect(tmp_path):
    return db.connect(str(tmp_path / "pilot.db"))


def test_a_pilot_database_starts_empty(tmp_path):
    conn = _connect(tmp_path)
    db.init_db(conn, keep_data=True)
    assert conn.execute("SELECT COUNT(*) FROM phases").fetchone()[0] == 0
    assert conn.execute("SELECT COUNT(*) FROM units").fetchone()[0] == 0
    assert conn.execute("PRAGMA user_version").fetchone()[0] == db.SCHEMA_VERSION


def test_the_demo_database_is_still_seeded_and_rebuilt(tmp_path):
    conn = _connect(tmp_path)
    db.init_db(conn)
    assert conn.execute("SELECT COUNT(*) FROM units").fetchone()[0] == 36
    conn.execute(f"PRAGMA user_version = {db.SCHEMA_VERSION - 1}")
    conn.execute("DELETE FROM notices")
    db.init_db(conn)  # an older demo layout is simply rebuilt from the seed
    assert conn.execute("SELECT COUNT(*) FROM notices").fetchone()[0] > 0


def _old_pilot(tmp_path):
    """A pilot database written by an older Keynection: one column and one table it didn't have yet."""
    conn = _connect(tmp_path)
    db.init_db(conn, keep_data=True)
    conn.execute("INSERT INTO phases (id, name) VALUES ('p1', 'Real Phase')")
    conn.execute("INSERT INTO units (id, phase_id, kind, label, street, terrace_row, pos, handover_date)"
                 " VALUES ('L-1', 'p1', 'terrace', 'No. 1', 'Jalan Satu', 'Jalan Satu', 1, '2026-10-01')")
    conn.commit()
    conn.execute("ALTER TABLE units DROP COLUMN street")
    conn.execute("DROP TABLE auth_challenges")
    conn.execute(f"PRAGMA user_version = {db.SCHEMA_VERSION - 1}")
    conn.commit()
    return conn


def test_a_newer_keynection_adds_to_a_pilot_database_and_keeps_every_record(tmp_path):
    conn = _old_pilot(tmp_path)
    db.init_db(conn, keep_data=True)
    assert conn.execute("SELECT label FROM units WHERE id = 'L-1'").fetchone()[0] == "No. 1"
    assert "street" in [r["name"] for r in conn.execute("PRAGMA table_info(units)")]
    assert conn.execute("SELECT COUNT(*) FROM auth_challenges").fetchone()[0] == 0  # the missing table is back
    assert conn.execute("SELECT COUNT(*) FROM phases").fetchone()[0] == 1  # and no fictional phase was added
    assert conn.execute("PRAGMA user_version").fetchone()[0] == db.SCHEMA_VERSION


def test_a_change_that_could_lose_data_stops_instead(tmp_path):
    conn = _old_pilot(tmp_path)
    conn.execute("ALTER TABLE units ADD COLUMN old_name TEXT")  # a column the new layout doesn't know (renamed?)
    conn.commit()
    with pytest.raises(db.SchemaChangeError, match="units.old_name"):
        db.init_db(conn, keep_data=True)
    assert conn.execute("SELECT COUNT(*) FROM units").fetchone()[0] == 1  # nothing was touched
    assert conn.execute("PRAGMA user_version").fetchone()[0] == db.SCHEMA_VERSION - 1


def test_the_pilot_server_starts_without_the_fictional_phase(tmp_path, monkeypatch):
    monkeypatch.setenv("JIRAN_DB_PATH", str(tmp_path / "server.db"))
    monkeypatch.setenv("JIRAN_DEMO_MODE", "0")
    monkeypatch.delenv("JIRAN_SITE_PASSWORD", raising=False)
    from app.main import app

    with TestClient(app):
        pass
    conn = db.connect(str(tmp_path / "server.db"))
    assert conn.execute("SELECT COUNT(*) FROM units").fetchone()[0] == 0


def test_adding_the_first_staff_member_never_rebuilds_a_pilot_database(tmp_path, monkeypatch):
    conn = _old_pilot(tmp_path)
    conn.close()
    monkeypatch.setenv("JIRAN_DB_PATH", str(tmp_path / "pilot.db"))
    from scripts.add_staff import main

    assert main(["Farah Aziz"]) == 0
    conn = _connect(tmp_path)
    assert conn.execute("SELECT label FROM units WHERE id = 'L-1'").fetchone()[0] == "No. 1"
    assert conn.execute("SELECT name FROM staff").fetchone()[0] == "Farah Aziz"
