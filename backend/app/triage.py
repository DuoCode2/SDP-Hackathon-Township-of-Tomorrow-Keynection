"""Triage suggestion for a reported change.

Plain, visible rules, never a verdict: the suggestion and its reasons are shown to
both owners, and a person (the owners together, or an SDP inspector) decides.
Dates only show what is possible: a change seen before work began cannot come from it,
but a change seen after work began is not proof that the work caused it.

Each reason is kept as an English sentence (the record) and as a code with plain values,
so the app can show it in the reader's language.
"""

from datetime import date, datetime, timedelta, timezone
from typing import Any

MALAYSIA = timezone(timedelta(hours=8))

SUGGESTIONS = {
    "renovation": "Appeared after work began next door: both owners look at it together first",
    "warranty": "Possible building defect: refer to SDP warranty with these photos",
    "inspect": "Not clear: ask an SDP inspector to look",
    "no_change": "No visible change found between the photos",
    "retake": "Photos could not be matched: retake from the same spot",
}

Reason = tuple[str, dict[str, Any], str]  # (code, values, English sentence)


def triage_hint(
    comparison: dict[str, Any],
    baseline_at: str,
    renovation: dict[str, Any] | None,
    renovation_label: str | None,
    *,
    followup_at: str,
) -> dict[str, Any]:
    if not comparison.get("aligned"):
        return _hint("retake", [
            ("retake_unaligned", {}, "The two photos could not be lined up."),
            ("retake_tip", {}, "Stand where you took the first photo and include a fixed feature: a corner, socket or window frame."),
        ])
    if not comparison.get("changed"):
        return _hint("no_change", [
            ("no_change_none", {}, "No new crack, stain or mark was flagged."),
            ("no_change_tip", {}, "If you can still see damage, retake the photo closer and from the same angle."),
        ])

    shape_set = {r["shape"] for r in comparison["regions"]}
    shapes = [s for s in ("line", "patch") if s in shape_set]
    found = " and a ".join({"line": "crack-like line", "patch": "stain-like patch"}[s] for s in shapes)
    maybe_defect: Reason = ("maybe_defect", {}, "This may be a building defect: the photos can go straight into the SDP warranty claim.")
    if renovation is None:
        return _hint("warranty", [
            ("change_found", {"shapes": shapes}, f"A new {found} appeared in the same spot."),
            ("no_renovation", {}, "No renovation is registered in your neighbour circle."),
            maybe_defect,
        ])

    start, label = renovation.get("start", ""), renovation_label or ""
    taken, seen = _local_day(baseline_at), _local_day(followup_at)
    if seen < start:
        return _hint("warranty", [
            ("seen_before_work", {"seen": seen, "label": label, "start": start},
             f"The change was photographed on {_day(seen)}, before work started at {label} ({_day(start)}), "
             "so the renovation cannot have caused it."),
            maybe_defect,
        ])
    if taken <= start:
        return _hint("renovation", [
            ("photo_before_work", {"taken": taken, "label": label, "start": start},
             f"Your pre-work photo was taken on {_day(taken)}, before work started at {label} ({_day(start)})."),
            ("seen_after_work", {"shapes": shapes, "seen": seen},
             f"A new {found} was photographed in the same spot on {_day(seen)}, after work began."),
            ("work_scope", {"label": label, "scope": renovation.get("scope", "renovation")},
             f"Work at {label}: {renovation.get('scope', 'renovation')}."),
            ("timing_not_proof", {},
             "Timing alone does not prove the cause: new homes also crack as they settle. If you can't agree, ask an SDP inspector."),
        ])
    return _hint("inspect", [
        ("change_found", {"shapes": shapes}, f"A new {found} appeared in the same spot."),
        ("photo_after_start", {"taken": taken, "label": label, "start": start},
         f"But the pre-work photo was taken on {_day(taken)}, after work at {label} began ({_day(start)})."),
        ("inspector_check", {}, "An SDP inspector should check whether the damage was there before."),
    ])


def _local_day(iso: str) -> str:
    """A stored timestamp (UTC) or a plain date -> the Malaysian calendar date, as 'YYYY-MM-DD'."""
    if len(iso) <= 10:
        return iso
    try:
        t = datetime.fromisoformat(iso)
    except ValueError:
        return iso[:10]
    if t.tzinfo is not None:
        t = t.astimezone(MALAYSIA)
    return t.date().isoformat()


def _day(iso: str) -> str:
    """'2026-10-15' or a timestamp -> '15 Oct 2026'."""
    try:
        d = date.fromisoformat(iso[:10])
    except ValueError:
        return iso
    return f"{d.day} {d.strftime('%b %Y')}"


def _hint(suggestion: str, reasons: list[Reason]) -> dict[str, Any]:
    return {"suggestion": suggestion, "headline": SUGGESTIONS[suggestion],
            "reasons": [text for _, _, text in reasons],
            "codes": [{"code": code, **values} for code, values, _ in reasons]}
