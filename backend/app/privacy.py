"""PDPA promises in a pilot, kept by code: what the privacy notice says is what happens.

How long: messages, photos and records are kept until one year after the home's defect liability period ends (the
period is 24 months from vacant possession, HDA Schedules G and H), or one year after they were made if that is
later. A record shared by two homes follows the later of the two. Anything still being dealt with stays until it is
done: a warranty ticket not closed, a concern with the estate office, a report not yet reviewed. The home log stays
with the unit. Voice messages go after 30 days (main._expire_voice).

Closing an account (the household itself, or the estate office after checking ID): its sign-ins, keys, phones,
family helpers, profile, its own messages, waves, requests and its photos that aren't part of a case are deleted.
Records the neighbours or SDP rely on (renovation notices, concerns, cases, warranty tickets, a message someone
reported) stay until their time is up, by unit only: the household's name is gone everywhere. The home can join
again with a new code, for example after it is sold.
"""
from __future__ import annotations

import calendar
import json
import sqlite3
from collections import Counter
from collections.abc import Iterable
from datetime import date, datetime, time, timedelta, timezone
from pathlib import Path

from . import db

DLP_MONTHS = 24  # defect liability period, from vacant possession
AFTER_DLP_MONTHS = 12  # then one more year, for claims after it (e.g. the Tribunal for Homebuyer Claims)
MIN_KEEP = timedelta(days=365)  # anything made later is kept a year
DELIVERY_LOG_DAYS = 400  # which alerts went out to which phones


def _add_months(day: date, months: int) -> date:
    year, month = divmod(day.month - 1 + months, 12)
    year, month = day.year + year, month + 1
    return date(year, month, min(day.day, calendar.monthrange(year, month)[1]))


def _period_ends(conn: sqlite3.Connection) -> dict[str, datetime]:
    """Per home: when its defect liability period plus one year is over."""
    return {r["id"]: datetime.combine(_add_months(date.fromisoformat(r["handover_date"]), DLP_MONTHS + AFTER_DLP_MONTHS),
                                      time.min, timezone.utc)
            for r in conn.execute("SELECT id, handover_date FROM units")}


def _latest(*stamps: str | None) -> datetime:
    """The last thing that happened to a record (a date alone counts from the start of that day)."""
    seen = [datetime.fromisoformat(s if "T" in s else f"{s}T00:00:00+00:00") for s in stamps if s]
    return max(seen)


def sweep(conn: sqlite3.Connection, now: datetime, folders: dict[str, Path]) -> dict[str, int]:
    """Delete every message, photo and record whose time is up. Returns how many went, by kind."""
    ends = _period_ends(conn)
    gone: Counter[str] = Counter()

    def due(made: datetime, homes: Iterable[str | None]) -> bool:
        keep = max([made + MIN_KEEP] + [ends[h] for h in homes if h in ends])
        return now > keep

    def remove(table: str, ids: list, key: str = "id") -> None:
        for i in ids:
            conn.execute(f"DELETE FROM {table} WHERE {key} = ?", (i,))
        gone[table] += len(ids)

    def unlink(folder: str, pattern: str) -> None:
        for f in folders[folder].glob(pattern):
            f.unlink(missing_ok=True)

    # Warranty tickets, once closed; then the cases they came from, and the comparison pictures.
    tickets = [t["id"] for t in conn.execute("SELECT * FROM warranty_tickets WHERE status = 'closed'").fetchall()
               if due(_latest(t["opened_at"], t["repaired_at"], t["closed_at"]), [t["unit_id"]])]
    for t in tickets:
        unlink("compare", f"w{t}_*")
    remove("warranty_tickets", tickets)
    kept = {r[0] for r in conn.execute("SELECT incident_id FROM warranty_tickets WHERE incident_id IS NOT NULL")}
    incidents = [i["id"] for i in conn.execute(
        "SELECT i.*, n.from_unit_id AS owner FROM incidents i LEFT JOIN intros n ON n.id = i.renovation_intro_id").fetchall()
        if i["id"] not in kept and due(_latest(i["created_at"], i["decided_at"]), [i["reporter_unit_id"], i["owner"]])]
    for i in incidents:
        unlink("compare", f"{i}_*")
    remove("incidents", incidents)
    # Concerns (one with the estate office stays until it is closed), paper notices, contractor passes.
    remove("concerns", [c["id"] for c in conn.execute("SELECT * FROM concerns").fetchall()
                        if c["status"] != "escalated" and due(_latest(c["created_at"], c["acknowledged_at"], c["resolved_at"],
                                                                         c["escalated_at"], c["closed_at"]), [c["from_unit_id"], c["to_unit_id"]])])
    remove("paper_notices", [p["id"] for p in conn.execute(
        "SELECT p.*, n.from_unit_id AS owner FROM paper_notices p JOIN intros n ON n.id = p.intro_id").fetchall()
        if due(_latest(p["created_at"], p["delivered_at"]), [p["unit_id"], p["owner"]])])
    passes = [p["id"] for p in conn.execute("SELECT * FROM passes").fetchall()
              if due(_latest(p["created_at"], p["valid_to"], p["revoked_at"]), [p["unit_id"]])]
    for p in passes:
        conn.execute("DELETE FROM gate_logs WHERE pass_id = ?", (p,))
    remove("passes", passes)
    # Reports once reviewed, then messages (with their reactions and voice), waves and contact requests.
    remove("reports", [r["id"] for r in conn.execute(
        "SELECT r.*, m.from_unit_id AS author FROM reports r JOIN messages m ON m.id = r.message_id WHERE r.status != 'open'").fetchall()
        if due(_latest(r["created_at"], r["reviewed_at"]), [r["reporter_unit_id"], r["author"]])])
    reported = {r[0] for r in conn.execute("SELECT message_id FROM reports")}
    messages = [m for m in conn.execute("SELECT * FROM messages").fetchall()
                if m["id"] not in reported and due(_latest(m["created_at"]), [m["from_unit_id"], m["to_unit_id"]])]
    for m in messages:
        conn.execute("DELETE FROM reactions WHERE message_id = ?", (m["id"],))
        if m["kind"] == "voice" and m["media_id"]:
            (folders["voice"] / m["media_id"]).unlink(missing_ok=True)
    remove("messages", [m["id"] for m in messages])
    remove("waves", [w["id"] for w in conn.execute("SELECT * FROM waves").fetchall()
                     if due(_latest(w["created_at"]), [w["from_unit_id"], w["to_unit_id"]])])
    remove("contact_requests", [c["id"] for c in conn.execute("SELECT * FROM contact_requests").fetchall()
                                if due(_latest(c["created_at"], c["responded_at"]), [c["from_unit_id"], c["to_unit_id"]])])
    # Photos no case still uses.
    in_cases = {r[0] for r in conn.execute(
        "SELECT baseline_photo_id FROM incidents UNION SELECT followup_photo_id FROM incidents UNION SELECT defect_photo_id"
        " FROM warranty_tickets UNION SELECT baseline_photo_id FROM warranty_tickets UNION SELECT repair_photo_id FROM warranty_tickets")}
    photos = [p["id"] for p in conn.execute("SELECT * FROM photos").fetchall()
              if p["id"] not in in_cases and due(_latest(p["created_at"]), [p["unit_id"]])]
    for p in photos:
        (folders["photos"] / f"{p}.jpg").unlink(missing_ok=True)
    remove("photos", photos)
    # Renovation notices and hellos nothing else still points to (counted from when the works ended).
    used = {r[0] for r in conn.execute(
        "SELECT intro_id FROM concerns UNION SELECT renovation_intro_id FROM incidents UNION SELECT intro_id FROM paper_notices"
        " UNION SELECT intro_id FROM passes UNION SELECT renovation_intro_id FROM photos")}
    intros = []
    for n in conn.execute("SELECT * FROM intros").fetchall():
        if n["id"] in used:
            continue
        homes = [n["from_unit_id"], *[r[0] for r in conn.execute("SELECT unit_id FROM intro_recipients WHERE intro_id = ?", (n["id"],))]]
        end = json.loads(n["renovation"])["end"] if n["renovation"] else None
        if due(_latest(n["created_at"], end), homes):
            intros.append(n["id"])
    for n in intros:
        conn.execute("DELETE FROM intro_recipients WHERE intro_id = ?", (n,))
    remove("intros", intros)
    cutoff = (now - timedelta(days=DELIVERY_LOG_DAYS)).isoformat(timespec="seconds")
    gone["deliveries"] += conn.execute("DELETE FROM deliveries WHERE at < ?", (cutoff,)).rowcount
    conn.commit()
    return {k: v for k, v in gone.items() if v}


def close_account(conn: sqlite3.Connection, unit_id: str, by: str, folders: dict[str, Path]) -> None:
    """The household leaves Keynection: see the module notes for what goes and what stays. One transaction."""
    subject = f"unit:{unit_id}"
    try:
        for table in ("sessions", "passkeys", "push_subscriptions", "webauthn_handles", "deliveries"):
            conn.execute(f"DELETE FROM {table} WHERE subject = ?", (subject,))
        conn.execute("DELETE FROM access_codes WHERE subject = ? AND used_at IS NULL", (subject,))
        conn.execute("DELETE FROM delegates WHERE unit_id = ?", (unit_id,))
        # Its own words, except a message someone reported: that stays for the estate office's review.
        mine = conn.execute("SELECT id, kind, media_id FROM messages WHERE from_unit_id = ?"
                            " AND id NOT IN (SELECT message_id FROM reports WHERE status = 'open')", (unit_id,)).fetchall()
        for m in mine:
            conn.execute("DELETE FROM reactions WHERE message_id = ?", (m["id"],))
            conn.execute("DELETE FROM reports WHERE message_id = ?", (m["id"],))
            conn.execute("DELETE FROM messages WHERE id = ?", (m["id"],))
            if m["kind"] == "voice" and m["media_id"]:
                (folders["voice"] / m["media_id"]).unlink(missing_ok=True)
        conn.execute("DELETE FROM reactions WHERE unit_id = ?", (unit_id,))
        for table, a, b in (("waves", "from_unit_id", "to_unit_id"), ("contact_requests", "from_unit_id", "to_unit_id"),
                            ("contact_consents", "unit_id", "other_unit_id"), ("blocks", "unit_id", "blocked_unit_id")):
            conn.execute(f"DELETE FROM {table} WHERE {a} = ? OR {b} = ?", (unit_id, unit_id))
        # Hellos it sent or got (a renovation notice is a record the neighbours rely on, so it stays).
        hellos = [r[0] for r in conn.execute("SELECT id FROM intros WHERE from_unit_id = ? AND renovation IS NULL", (unit_id,))]
        for i in hellos:
            conn.execute("DELETE FROM intro_recipients WHERE intro_id = ?", (i,))
            conn.execute("DELETE FROM intros WHERE id = ?", (i,))
        conn.execute("DELETE FROM intro_recipients WHERE unit_id = ? AND intro_id IN (SELECT id FROM intros WHERE renovation IS NULL)",
                     (unit_id,))
        # Photos inside the home that no case uses.
        loose = [r[0] for r in conn.execute(
            "SELECT id FROM photos WHERE unit_id = ? AND id NOT IN (SELECT baseline_photo_id FROM incidents UNION"
            " SELECT followup_photo_id FROM incidents UNION SELECT defect_photo_id FROM warranty_tickets UNION"
            " SELECT baseline_photo_id FROM warranty_tickets UNION SELECT repair_photo_id FROM warranty_tickets)", (unit_id,))
            if r[0]]
        for p in loose:
            conn.execute("DELETE FROM photos WHERE id = ?", (p,))
            (folders["photos"] / f"{p}.jpg").unlink(missing_ok=True)
        conn.execute("UPDATE profiles SET bio = '', accept_requests = 1, allow_waves = 1, quiet_mode = 0, notices_read_at = NULL,"
                     " easy_mode = 0, whatsapp_alerts = 1, quiet_times = '[]', quiet_times_at = NULL WHERE unit_id = ?", (unit_id,))
        # Case notices in the neighbours' threads name this home by unit (the reader's screen looks the name up), so
        # from here on they read as its unit. A name in their values is taken out all the same.
        conn.execute("UPDATE messages SET sys_values = json_remove(sys_values, '$.name')"
                     " WHERE kind = 'system' AND json_extract(sys_values, '$.unit') = ?", (unit_id,))
        # Old data: notices written before that carried the name itself, in the values and in the English record
        # ("Siti (No. 11) believes ..."). Matched by the name once, here, and left naming the unit.
        unit = conn.execute("SELECT resident_name, label FROM units WHERE id = ?", (unit_id,)).fetchone()
        conn.execute("UPDATE messages SET body = replace(body, ?, ?), sys_values = json_set(json_remove(sys_values, '$.name'), '$.unit', ?)"
                     " WHERE kind = 'system' AND thread_with = ? AND json_extract(sys_values, '$.unit') IS NULL"
                     " AND json_extract(sys_values, '$.name') = ?",
                     (f"{unit['resident_name']} ({unit['label']})", unit["label"], unit_id, unit_id, unit["resident_name"]))
        conn.execute("UPDATE units SET resident_name = label, record_name = NULL, joined_at = NULL, consent_version = NULL WHERE id = ?",
                     (unit_id,))
        conn.execute("UPDATE join_codes SET expires_at = ? WHERE unit_id = ? AND used_at IS NULL", (db.now(), unit_id))
        db.append_event(conn, unit_id, "account_closed", {"by": by})  # no name: only who closed it
        conn.commit()
    except Exception:
        conn.rollback()
        raise
