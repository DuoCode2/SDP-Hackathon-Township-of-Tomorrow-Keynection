"""Pilot: a phase from SDP's handover list.

Staff upload a CSV with one row per home (Excel's "CSV UTF-8" works; a byte order mark or semicolons are fine).
Keynection checks every row and shows what it would do. Nothing is saved until staff confirm, and nothing at all
while any line is wrong. The circles come from the layout columns, with the same rules the app uses (neighbours.py).

  unit        SDP's unit code, e.g. C21-01: letters, digits, '-', '_' or '.', and unique in Keynection
  label       what neighbours see, e.g. "No. 1 Jln 2/1"; unique in the phase (the unit code if left empty)
  type        terrace (also landed, link, semi-d, house) or apartment (also condo, flat, serviced apartment)
  street      terrace: the road the house is on
  row         terrace: one row of houses. Leave it empty when a street has houses on one side only
  facing_row  terrace: the row across the road. Number both rows from the same end, so facing houses share a position
  back_row    terrace: the row behind, sharing the back fence; same pos numbering. Told about wet, hacking and
              structural works, but not part of the circle
  pos         position along the row or along the floor, from 1. A gap keeps homes apart (semi-D pairs: 1, 2, 4, 5)
  block, floor  apartment
  owner       the name on SDP's sales record: pre-fills the join form and the welcome-pack card, never shown to neighbours
  handover    vacant possession date: 2026-09-01 or 1/9/2026 (day first, as written in Malaysia)
  language    en, ms (BM), zh (Chinese) or ta (Tamil). The owner chooses again when joining

Any other column (phone, e-mail, IC...) is left out on purpose: owners give their own contact details when they join.
A household that has joined keeps its place: importing again can add homes and correct homes still to join.
"""
from __future__ import annotations

import csv
import io
import re
import sqlite3
from collections import Counter
from dataclasses import dataclass, field
from datetime import date

from . import db
from .neighbours import Unit, neighbour_circle, slot_index
from .planner import MAX_HOMES

MAX_BYTES = 1_000_000
MAX_ISSUES = 200  # enough to fix a list in one go; any more are only counted
UNIT_CODE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$")
ALIASES = {
    "unit": ("unit", "unit_no", "unit_code", "lot", "lot_no"),
    "label": ("label", "house_no", "address"),
    "type": ("type", "kind", "property_type"),
    "street": ("street", "road", "jalan"),
    "row": ("row",),
    "facing_row": ("facing_row", "facing", "opposite_row"),
    "back_row": ("back_row", "behind", "back"),
    "pos": ("pos", "position"),
    "block": ("block", "tower"),
    "floor": ("floor", "level"),
    "owner": ("owner", "owner_name", "purchaser"),
    "handover": ("handover", "handover_date", "vp_date", "vacant_possession"),
    "language": ("language", "lang"),
}
COLUMN = {alias: name for name, aliases in ALIASES.items() for alias in aliases}
REQUIRED = ("unit", "type", "pos", "handover")
KINDS = {"terrace": "terrace", "landed": "terrace", "link": "terrace", "semi-d": "terrace", "semi-detached": "terrace",
         "house": "terrace", "apartment": "apartment", "condo": "apartment", "condominium": "apartment", "flat": "apartment",
         "serviced apartment": "apartment"}
LANGS = {"en": "en", "english": "en", "ms": "ms", "bm": "ms", "malay": "ms", "bahasa melayu": "ms", "zh": "zh",
         "chinese": "zh", "mandarin": "zh", "中文": "zh", "华文": "zh", "ta": "ta", "tamil": "ta", "தமிழ்": "ta"}
CONTACT = re.compile(r"phone|mobile|tel|mail|^ic|nric|passport|contact|^hp$")
LAYOUT = ("kind", "label", "street", "row", "facing_row", "back_row", "block", "floor", "pos")


@dataclass
class Home:
    line: int
    id: str
    label: str
    kind: str
    street: str | None
    row: str | None
    facing_row: str | None
    block: str | None
    floor: int | None
    pos: int
    owner: str | None
    handover: str
    lang: str
    back_row: str | None = None

    def unit(self) -> Unit:
        return Unit(id=self.id, kind=self.kind, label=self.label, row=self.row, facing_row=self.facing_row, back_row=self.back_row,
                    block=self.block, floor=self.floor, pos=self.pos)


@dataclass
class Report:
    homes: list[Home] = field(default_factory=list)
    errors: list[dict] = field(default_factory=list)
    warnings: list[dict] = field(default_factory=list)
    more_errors: int = 0
    more_warnings: int = 0
    added: list[str] = field(default_factory=list)
    updated: list[str] = field(default_factory=list)
    unchanged: list[str] = field(default_factory=list)
    kept: int = 0  # homes already in the phase that the list leaves out: they stay as they are
    phase_homes: list[Unit] = field(default_factory=list)
    streets: list[str] = field(default_factory=list)
    blocks: list[str] = field(default_factory=list)
    circles: dict[str, list[str]] = field(default_factory=dict)

    def error(self, line: int, message: str) -> None:
        if len(self.errors) < MAX_ISSUES:
            self.errors.append({"line": line, "message": message})
        else:
            self.more_errors += 1

    def warn(self, line: int, message: str) -> None:
        if len(self.warnings) < MAX_ISSUES:
            self.warnings.append({"line": line, "message": message})
        else:
            self.more_warnings += 1

    def json(self) -> dict:
        labels = {h.id: h.label for h in self.homes}
        return {
            "errors": sorted(self.errors, key=lambda e: e["line"]), "more_errors": self.more_errors,
            "warnings": sorted(self.warnings, key=lambda w: w["line"]), "more_warnings": self.more_warnings,
            "homes": len(self.phase_homes), "added": len(self.added), "updated": len(self.updated),
            "unchanged": len(self.unchanged), "kept": self.kept, "streets": self.streets, "blocks": self.blocks,
            "circle_sizes": dict(sorted(Counter(len(c) for c in self.circles.values()).items())),
            "sample": [{"unit": h.id, "label": labels[h.id], "circle": self.circles.get(h.id, [])} for h in self.homes[:MAX_ISSUES]],
        }


# ---------- reading the list ----------

def parse(text: str) -> Report:
    """Every home in the list, and every line that can't be used (with its line number in the file)."""
    report = Report()
    if len(text.encode("utf-8")) > MAX_BYTES:
        report.error(0, "The list is larger than 1 MB. Split the phase into two lists.")
        return report
    text = text.lstrip("﻿")
    first = next((ln for ln in text.splitlines() if ln.strip()), "")
    if not first:
        report.error(0, "The list is empty.")
        return report
    delimiter = max(",;\t", key=first.count)  # Excel writes ';' where the decimal mark is a comma
    rows = csv.reader(io.StringIO(text), delimiter=delimiter if first.count(delimiter) else ",")
    header = next(rows)
    columns: dict[str, int] = {}
    for i, raw in enumerate(header):
        key = re.sub(r"[\s-]+", "_", raw.strip().lower())
        name = COLUMN.get(key)
        if name is None:
            if key:
                why = ": owners give their own contact details when they join" if CONTACT.search(key) else ""
                report.warn(1, f"Column '{raw.strip()}' is left out{why}.")
            continue
        if name in columns:
            report.error(1, f"Two columns mean '{name}': '{header[columns[name]].strip()}' and '{raw.strip()}'.")
            continue
        columns[name] = i
    missing = [c for c in REQUIRED if c not in columns]
    if missing:
        report.error(1, "The list needs these columns: " + ", ".join(missing) + ".")
        return report
    while True:
        line = rows.line_num + 1
        try:
            row = next(rows)
        except StopIteration:
            break
        except csv.Error as e:
            report.error(line, f"This line can't be read ({e}).")
            break
        if any(cell.strip() for cell in row):
            home = _home(report, line, row, columns)
            if home is not None:
                report.homes.append(home)
    if not report.homes and not report.errors:
        report.error(0, "The list has no homes.")
    return report


def _home(report: Report, line: int, row: list[str], columns: dict[str, int]) -> Home | None:
    def get(name: str) -> str:
        i = columns.get(name)
        return row[i].strip() if i is not None and i < len(row) else ""

    problems: list[str] = []
    code = get("unit")
    if not code:
        problems.append("The unit code is empty.")
    elif not UNIT_CODE.match(code):
        problems.append(f"Unit code '{code}' can only use letters, digits, '-', '_' or '.' (up to 40).")
    kind = KINDS.get(get("type").lower())
    if kind is None:
        problems.append(f"Type '{get('type')}' isn't known: use terrace or apartment.")
    pos = _whole(get("pos"))
    if pos is None or not 1 <= pos <= 9999:
        problems.append(f"Position '{get('pos')}' must be a whole number from 1.")
    street, row_id, facing, block, floor = get("street") or None, get("row") or None, get("facing_row") or None, None, None
    back = get("back_row") or None
    if kind == "terrace":
        if not street:
            problems.append("A terrace house needs its street.")
        row_id = row_id or street
    elif kind == "apartment":
        street = row_id = facing = back = None
        block = get("block") or None
        if not block:
            problems.append("An apartment needs its block.")
        floor = _whole(get("floor"))
        if floor is None or not -5 <= floor <= 200:
            problems.append(f"Floor '{get('floor')}' must be a whole number.")
    handover = _day(get("handover"))
    if handover is None:
        problems.append(f"Handover date '{get('handover')}' isn't a real date: write 2026-09-01 or 1/9/2026.")
    label = get("label") or code
    if len(label) > 40:
        problems.append("The label is longer than 40 characters.")
    owner = get("owner") or None
    if owner and len(owner) > 80:
        problems.append("The owner's name is longer than 80 characters.")
    for p in problems:
        report.error(line, p)
    if problems:
        return None
    spoken = get("language")
    lang = LANGS.get(spoken.lower()) if spoken else "en"
    if lang is None:
        report.warn(line, f"Language '{spoken}' isn't one Keynection speaks yet: English is used, and the owner chooses when joining.")
        lang = "en"
    return Home(line, code, label, kind, street, row_id, facing, block, floor, pos, owner, handover, lang, back)


def _whole(text: str) -> int | None:
    return int(text) if re.fullmatch(r"-?\d{1,4}", text) else None


def _day(text: str) -> str | None:
    """2026-09-01, or 1/9/2026 day first (also with '-' or '.'); a time after the date (from Excel) is ignored."""
    text = text.split(" ")[0].split("T")[0]
    if m := re.fullmatch(r"(\d{4})-(\d{1,2})-(\d{1,2})", text):
        y, mo, d = m.groups()
    elif m := re.fullmatch(r"(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})", text):
        d, mo, y = m.groups()
    else:
        return None
    try:
        day = date(int(y), int(mo), int(d))
    except ValueError:
        return None
    return day.isoformat() if 2000 <= day.year <= 2100 else None


# ---------- checking it against Keynection ----------

def check(conn: sqlite3.Connection, report: Report, phase_id: str | None) -> None:
    """What saving would do: added, corrected or unchanged homes, and every circle. Errors for anything that would
    put two homes in one place, reuse a unit code or a label, or move a household that has joined."""
    homes, first_line = [], {}
    for h in report.homes:
        if h.id in first_line:
            report.error(h.line, f"Unit {h.id} is already on line {first_line[h.id]}.")
            continue
        first_line[h.id] = h.line
        homes.append(h)
    report.homes = homes
    held = {r["id"]: r for r in conn.execute("SELECT u.*, p.name AS phase_name FROM units u JOIN phases p ON p.id = u.phase_id")}
    for h in homes:
        row = held.get(h.id)
        if row is None:
            report.added.append(h.id)
        elif row["phase_id"] != phase_id:
            report.error(h.line, f"Unit {h.id} is already in {row['phase_name']}. Use SDP's full unit code.")
        elif row["joined_at"] is not None:
            now = {"kind": row["kind"], "label": row["label"], "street": row["street"], "row": row["terrace_row"],
                   "facing_row": row["facing_row"], "back_row": row["back_row"], "block": row["block"], "floor": row["floor"],
                   "pos": row["pos"]}
            if any(getattr(h, k) != now[k] for k in LAYOUT):
                report.error(h.line, f"{row['label']} has joined Keynection, so its place and label stay as they are "
                                     "(its neighbours already know it). Leave this line as it was, or ask the Keynection team.")
            else:
                report.unchanged.append(h.id)  # the household's own name and language are theirs now
        else:
            before = (row["kind"], row["label"], row["street"], row["terrace_row"], row["facing_row"], row["back_row"], row["block"],
                      row["floor"], row["pos"], row["record_name"], row["handover_date"], row["lang"])
            after = (h.kind, h.label, h.street, h.row, h.facing_row, h.back_row, h.block, h.floor, h.pos, h.owner, h.handover, h.lang)
            (report.updated if before != after else report.unchanged).append(h.id)
    # The phase as it would be: homes already in it that the list leaves out stay where they are.
    in_list = {h.id for h in homes}
    others = [r for r in held.values() if r["phase_id"] == phase_id and r["id"] not in in_list]
    report.kept = len(others)
    units = [Unit(id=r["id"], kind=r["kind"], label=r["label"], row=r["terrace_row"], facing_row=r["facing_row"],
                  back_row=r["back_row"], block=r["block"], floor=r["floor"], pos=r["pos"]) for r in others] + [h.unit() for h in homes]
    if len(units) > MAX_HOMES:
        report.error(0, f"A phase can have up to {MAX_HOMES} homes; this one would have {len(units)}.")
    where, label_line = {}, {}
    for r in others:
        where[_slot(r["kind"], r["terrace_row"], r["block"], r["floor"], r["pos"])] = f"{r['label']} (already in Keynection)"
        label_line[r["label"]] = "a home already in Keynection"
    for h in homes:
        slot = _slot(h.kind, h.row, h.block, h.floor, h.pos)
        if slot in where:
            report.error(h.line, f"{h.label} is in the same place as {where[slot]}: {_place(h)}.")
        else:
            where[slot] = f"line {h.line}"
        if h.label in label_line:
            report.error(h.line, f"Label '{h.label}' is already used by {label_line[h.label]}: each home needs its own (add the street).")
        else:
            label_line[h.label] = f"line {h.line}"
    rows = {u.row for u in units if u.kind == "terrace"}
    for h in homes:
        if h.kind == "terrace" and h.facing_row and h.facing_row not in rows:
            report.warn(h.line, f"Facing row '{h.facing_row}' isn't in the list, so no houses across the road are counted.")
        if h.kind == "terrace" and h.back_row and h.back_row not in rows:
            report.warn(h.line, f"Back row '{h.back_row}' isn't in the list, so no house behind is told about works.")
    index = slot_index(units)
    label_of = {u.id: u.label for u in units}
    for u in units:
        report.circles[u.id] = [label_of[n.unit_id] for n in neighbour_circle(u, units, index)]
    for h in homes:
        if not report.circles.get(h.id):
            report.warn(h.line, f"{h.label} has no neighbours in this list: check its row and position.")
    report.phase_homes = units
    report.streets = sorted({h.street for h in homes if h.street} | {r["street"] for r in others if r["street"]})
    report.blocks = sorted({u.block for u in units if u.kind == "apartment" and u.block})


def _slot(kind: str, row: str | None, block: str | None, floor: int | None, pos: int) -> tuple:
    return ("terrace", row, pos) if kind == "terrace" else ("apartment", block, floor, pos)


def _place(h: Home) -> str:
    return f"row {h.row}, position {h.pos}" if h.kind == "terrace" else f"block {h.block}, floor {h.floor}, position {h.pos}"


# ---------- saving ----------

def new_phase_id(conn: sqlite3.Connection, name: str) -> str:
    base = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")[:32] or "phase"
    if base == "demo":
        base = "phase-demo"  # 'demo' is the fictional phase of demo mode
    phase_id, n = base, 2
    while conn.execute("SELECT 1 FROM phases WHERE id = ?", (phase_id,)).fetchone():
        phase_id, n = f"{base}-{n}", n + 1
    return phase_id


def apply(conn: sqlite3.Connection, report: Report, phase_id: str, name: str, staff: str) -> None:
    """Save a checked list (no errors): the phase, new homes with their handover record, corrections to homes that
    haven't joined. One transaction: all of it or none of it."""
    stamp = db.now()
    try:
        if conn.execute("SELECT 1 FROM phases WHERE id = ?", (phase_id,)).fetchone():
            conn.execute("UPDATE phases SET name = ?, imported_by = ?, imported_at = ? WHERE id = ?", (name, staff, stamp, phase_id))
        else:
            conn.execute("INSERT INTO phases (id, name, note, imported_by, imported_at) VALUES (?, ?, ?, ?, ?)",
                         (phase_id, name, "From SDP's handover list", staff, stamp))
        homes = {h.id: h for h in report.homes}
        for unit_id in report.added:
            h = homes[unit_id]
            conn.execute(
                "INSERT INTO units (id, phase_id, kind, label, resident_name, street, terrace_row, facing_row, back_row, block, floor,"
                " pos, lang, handover_date, record_name) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (h.id, phase_id, h.kind, h.label, h.label, h.street, h.row, h.facing_row, h.back_row, h.block, h.floor, h.pos,
                 h.lang, h.handover, h.owner))
            conn.execute("INSERT INTO profiles (unit_id) VALUES (?)", (h.id,))
            db.append_event(conn, h.id, "handover", {"note": "Vacant possession, from SDP's handover list",
                                                     "vacant_possession": h.handover})
        for unit_id in report.updated:
            h = homes[unit_id]
            before = conn.execute("SELECT handover_date FROM units WHERE id = ?", (unit_id,)).fetchone()[0]
            conn.execute(
                "UPDATE units SET kind = ?, label = ?, resident_name = ?, street = ?, terrace_row = ?, facing_row = ?, back_row = ?,"
                " block = ?, floor = ?, pos = ?, lang = ?, handover_date = ?, record_name = ? WHERE id = ? AND joined_at IS NULL",
                (h.kind, h.label, h.label, h.street, h.row, h.facing_row, h.back_row, h.block, h.floor, h.pos, h.lang, h.handover,
                 h.owner, unit_id))
            if before != h.handover:
                db.append_event(conn, unit_id, "handover", {"note": "Handover date corrected from SDP's handover list",
                                                            "vacant_possession": h.handover})
        conn.commit()
    except Exception:
        conn.rollback()
        raise
