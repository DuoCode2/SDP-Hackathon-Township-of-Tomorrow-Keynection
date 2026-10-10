"""Quiet times: renovation hours are worked out before anyone has to ask.

Each household may name up to two times a day when it needs quiet (a baby's nap, sleep after a night shift). The
reason is never shown to anyone. When a neighbour registers a renovation, its noisy hours are planned around the
quiet times of every home the works reach, inside the hours the council allows, and the renovating owner always
keeps a fair share of working time. Plain rules, no AI: the same answer every time, with or without a network.
"""
from __future__ import annotations

from datetime import date, datetime
from typing import Any

LEGAL_FROM, LEGAL_TO = "09:00", "18:00"  # noisy renovation work, Monday to Saturday (the estate's house rules)
MIN_NOISY_MINUTES = 4 * 60  # the renovating owner always keeps at least this much noisy work a day
MAX_QUIET_WINDOWS = 2  # per household
MAX_QUIET_MINUTES = 3 * 60  # per household per day, so nobody can block a renovation by asking for quiet all day
REASONS = ("baby", "night_shift", "work_from_home", "elderly", "other")


def minutes(hhmm: str) -> int:
    h, m = hhmm.split(":")
    return int(h) * 60 + int(m)


def hhmm(total: int) -> str:
    return f"{total // 60:02d}:{total % 60:02d}"


def _merge(spans: list[tuple[int, int]]) -> list[tuple[int, int]]:
    out: list[tuple[int, int]] = []
    for a, b in sorted(spans):
        if out and a <= out[-1][1]:
            out[-1] = (out[-1][0], max(out[-1][1], b))
        else:
            out.append((a, b))
    return out


def _length(spans: list[tuple[int, int]]) -> int:
    return sum(b - a for a, b in spans)


def check_windows(windows: list[dict[str, Any]]) -> str | None:
    """Why a household's quiet times can't be kept, or None if they can."""
    if len(windows) > MAX_QUIET_WINDOWS:
        return f"At most {MAX_QUIET_WINDOWS} quiet times."
    spans = [(minutes(w["start"]), minutes(w["end"])) for w in windows]
    if any(a >= b for a, b in spans):
        return "A quiet time must end after it starts."
    if _length(_merge(spans)) > MAX_QUIET_MINUTES:
        return f"Quiet times can add up to {MAX_QUIET_MINUTES // 60} hours a day, so neighbours can still renovate."
    return None


def plan(noisy_from: str, noisy_to: str, homes: list[list[dict[str, Any]]]) -> dict[str, Any]:
    """Noisy hours around the quiet times of the homes a renovation reaches (one list of windows per home).

    The owner's hours are kept inside the council's. Homes are fitted in from the smallest request up, and a home's
    quiet time is kept only if the owner still has MIN_NOISY_MINUTES of noisy work a day; a home that doesn't fit
    is counted as not avoided, so both sides can be told before work starts. Quiet time at either end of the day
    moves the start or the end; in the middle it becomes a quiet break."""
    start = max(minutes(noisy_from), minutes(LEGAL_FROM))
    end = min(minutes(noisy_to), minutes(LEGAL_TO))
    if end <= start:  # the owner's hours lie outside the council's: plan inside the owner's own
        start, end = minutes(noisy_from), minutes(noisy_to)
    asked = [h for h in homes if h]
    clipped = []
    for windows in asked:
        spans = _merge([(max(minutes(w["start"]), start), min(minutes(w["end"]), end)) for w in windows])
        clipped.append([(a, b) for a, b in spans if a < b])
    kept: list[tuple[int, int]] = []
    avoided = not_avoided = 0
    for spans in sorted(clipped, key=_length):
        trial = _merge(kept + spans)
        if not spans or (end - start) - _length(trial) >= MIN_NOISY_MINUTES:
            kept, avoided = trial, avoided + 1
        else:
            not_avoided += 1
    breaks = [(a, b) for a, b in kept]
    if breaks and breaks[0][0] <= start:
        start = breaks.pop(0)[1]
    if breaks and breaks[-1][1] >= end:
        end = breaks.pop()[0]
    return {"noisy_from": hhmm(start), "noisy_to": hhmm(end),
            "quiet_breaks": [{"start": hhmm(a), "end": hhmm(b)} for a, b in breaks],
            "noisy_minutes": (end - start) - _length(breaks),
            "homes_with_quiet_times": len(asked), "avoided": avoided, "not_avoided": not_avoided}


def _noisy_spans(reno: dict[str, Any]) -> list[tuple[int, int]]:
    start, end = minutes(reno.get("noisy_from") or "09:00"), minutes(reno.get("noisy_to") or "17:00")
    spans, at = [], start
    for b in sorted(reno.get("quiet_breaks") or [], key=lambda w: w["start"]):
        a, z = minutes(b["start"]), minutes(b["end"])
        if a > at:
            spans.append((at, min(a, end)))
        at = max(at, z)
    if at < end:
        spans.append((at, end))
    return spans


def respected(reno: dict[str, Any], windows: list[dict[str, Any]]) -> str | None:
    """'avoided' if a notice's noisy hours miss all of a household's quiet times, 'overlap' if not, None if it has none."""
    if not windows:
        return None
    noisy = _noisy_spans(reno)
    for w in windows:
        a, b = minutes(w["start"]), minutes(w["end"])
        if any(a < z and x < b for x, z in noisy):
            return "overlap"
    return "avoided"


def timing(reno: dict[str, Any], at: datetime) -> str:
    """Where a moment falls against a renovation notice (at in Malaysian time): for a noise concern, the record says
    straight away whether the work was inside what was agreed."""
    day = at.date()
    if not date.fromisoformat(reno["start"]) <= day <= date.fromisoformat(reno["end"]):
        return "outside_dates"
    if day.weekday() == 6 or (day.weekday() == 5 and reno.get("weekdays_only", True)):
        return "not_a_work_day"
    now = at.hour * 60 + at.minute
    if any(minutes(b["start"]) <= now < minutes(b["end"]) for b in reno.get("quiet_breaks") or []):
        return "quiet_break"
    if not minutes(reno.get("noisy_from") or "09:00") <= now < minutes(reno.get("noisy_to") or "17:00"):
        return "outside_hours"
    return "within_hours"
