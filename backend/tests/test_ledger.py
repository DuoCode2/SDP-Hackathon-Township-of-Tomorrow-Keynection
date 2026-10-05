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
