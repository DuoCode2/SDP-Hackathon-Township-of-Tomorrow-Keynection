"""Triage suggestion for a reported change.

Plain, visible rules, never a verdict: the suggestion and its reasons are shown to
both owners, and a person (the owners together, or an SDP inspector) decides.
"""

from datetime import date
from typing import Any

SUGGESTIONS = {
    "renovation": "Likely linked to the renovation next door: owners and contractor settle it first",
    "warranty": "Possible building defect: refer to SDP warranty with these photos",
    "inspect": "Not clear: ask an SDP inspector to look",
    "no_change": "No visible change found between the photos",
    "retake": "Photos could not be matched: retake from the same spot",
}


def triage_hint(
    comparison: dict[str, Any],
    baseline_at: str,
    renovation: dict[str, Any] | None,
    renovation_label: str | None,
) -> dict[str, Any]:
    if not comparison.get("aligned"):
        return _hint("retake", [
            "The two photos could not be lined up.",
            "Stand where you took the first photo and include a fixed feature: a corner, socket or window frame.",
        ])
    if not comparison.get("changed"):
        return _hint("no_change", [
            "No new crack, stain or mark was flagged.",
            "If you can still see damage, retake the photo closer and from the same angle.",
        ])

    shapes = {r["shape"] for r in comparison["regions"]}
    found = " and a ".join(
        s for s in (("crack-like line" if "line" in shapes else ""), ("stain-like patch" if "patch" in shapes else "")) if s
    )
    if renovation is None:
        return _hint("warranty", [
            f"A new {found} appeared in the same spot.",
            "No renovation is registered in your neighbour circle.",
            "This may be a building defect: the photos can go straight into the SDP warranty claim.",
        ])

    start = renovation.get("start", "")
    taken = _day(baseline_at)
    if baseline_at[:10] <= start:
        return _hint("renovation", [
            f"Your pre-work photo was taken on {taken}, before work started at {renovation_label} ({_day(start)}).",
            f"A new {found} appeared in the same spot after that.",
            f"Work at {renovation_label}: {renovation.get('scope', 'renovation')}.",
        ])
    return _hint("inspect", [
        f"A new {found} appeared in the same spot.",
        f"But the pre-work photo was taken on {taken}, after work at {renovation_label} began ({_day(start)}).",
        "An SDP inspector should check whether the damage was there before.",
    ])


def _day(iso: str) -> str:
    """'2026-10-15' or a timestamp -> '15 Oct 2026'."""
    try:
        d = date.fromisoformat(iso[:10])
    except ValueError:
        return iso
    return f"{d.day} {d.strftime('%b %Y')}"


def _hint(suggestion: str, reasons: list[str]) -> dict[str, Any]:
    return {"suggestion": suggestion, "headline": SUGGESTIONS[suggestion], "reasons": reasons}
