import threading

from app import db
from app.ledger import GENESIS_HASH, compute_hash, verify_chain


def _chain(n: int) -> list[dict]:
    events, prev = [], GENESIS_HASH
    for i in range(n):
        e = {"unit_id": "T-12", "type": f"event-{i}", "payload": {"i": i}, "created_at": f"2026-10-0{i + 1}T00:00:00+00:00"}
        e["prev_hash"] = prev
        e["hash"] = compute_hash(prev, e["unit_id"], e["type"], e["payload"], e["created_at"])
        prev = e["hash"]
        events.append(e)
    return events


def test_untouched_chain_verifies():
    assert verify_chain(_chain(4)) == (True, None)


def test_editing_a_past_record_is_detected():
    events = _chain(4)
    events[1]["payload"] = {"i": 999}
    assert verify_chain(events) == (False, 1)


def test_deleting_a_record_is_detected():
    events = _chain(4)
    del events[2]
    assert verify_chain(events) == (False, 2)


def test_records_written_at_the_same_moment_still_form_one_chain(tmp_path):
    """Two requests writing to one home's log at once must not both chain onto the same previous record."""
    path = str(tmp_path / "race.db")
    setup = db.connect(path)
    db.init_db(setup)
    setup.close()
    workers, each, errors = 8, 5, []
    start = threading.Barrier(workers)

    def write(i: int) -> None:
        conn = db.connect(path)
        try:
            start.wait()
            for j in range(each):
                db.append_event(conn, "T-11", "note", {"writer": i, "n": j})
                conn.commit()
        except Exception as e:  # noqa: BLE001 - collected and asserted below
            errors.append(e)
        finally:
            conn.close()

    threads = [threading.Thread(target=write, args=(i,)) for i in range(workers)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    check = db.connect(path)
    events = db.unit_events(check, "T-11")
    check.close()
    assert errors == []
    assert len(events) == 1 + workers * each  # the handover record plus every note
    assert verify_chain(events) == (True, None)
