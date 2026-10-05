"""Tamper-evident home history (屋历).

Every record for a home is appended to that home's own hash chain:
hash = sha256(previous hash + this record). Editing or deleting any past record
breaks every hash after it, so the chain shows whether the history was changed.
No blockchain needed.
"""

import hashlib
import json
from typing import Any

GENESIS_HASH = "0" * 64


def compute_hash(prev_hash: str, unit_id: str, event_type: str, payload: dict[str, Any], created_at: str) -> str:
    body = json.dumps(
        {"prev": prev_hash, "unit": unit_id, "type": event_type, "payload": payload, "at": created_at},
        sort_keys=True,
        ensure_ascii=False,
        separators=(",", ":"),
    )
    return hashlib.sha256(body.encode("utf-8")).hexdigest()


def verify_chain(events: list[dict[str, Any]]) -> tuple[bool, int | None]:
    """Check one home's events in order. Returns (ok, index of the first bad event)."""
    prev = GENESIS_HASH
    for i, e in enumerate(events):
        expected = compute_hash(prev, e["unit_id"], e["type"], e["payload"], e["created_at"])
        if e["prev_hash"] != prev or e["hash"] != expected:
            return False, i
        prev = e["hash"]
    return True, None
