"""Phase setup: from a simple layout description to every household's circle and notice zones.

This is what SDP would run once per new phase, from the site plan it already has. It uses exactly the same
neighbour rules as the live app (neighbours.py), never touches the database, and is capped in size.
Irregular plots (corner lots, semi-Ds, shoplots) are flagged for a person to check rather than guessed.
"""

import time
from collections import Counter
from statistics import mean

from .neighbours import WORKS_TYPES, Unit, impact_zone, neighbour_circle, slot_index

MAX_HOMES = 3000
FULL_CIRCLE = {"terrace": 5, "apartment": 4}


def _terrace_units(lorongs: int, houses_per_row: int, facing: bool) -> list[list[Unit]]:
    """One group per lorong: a row of houses, plus the row facing it across the road."""
    groups = []
    for n in range(1, lorongs + 1):
        rows = [f"L{n}A", f"L{n}B"] if facing else [f"L{n}A"]
        group = []
        for row in rows:
            other = (rows[1] if row == rows[0] else rows[0]) if facing else None
            for pos in range(houses_per_row):
                group.append(Unit(id=f"{row}-{pos + 1}", kind="terrace", label=f"Lorong {n}, {row[-1]}{pos + 1}",
                                  row=row, facing_row=other, pos=pos))
        groups.append(group)
    return groups


def _block_units(blocks: int, floors: int, units_per_floor: int) -> list[list[Unit]]:
    """One group per block: every unit on every floor."""
    groups = []
    for b in range(blocks):
        name = chr(ord("A") + b)
        groups.append([Unit(id=f"{name}-{f}-{p}", kind="apartment", label=f"{name}-{f}-{p}", block=name, floor=f, pos=p)
                       for f in range(1, floors + 1) for p in range(1, units_per_floor + 1)])
    return groups


def home_count(lorongs: int, houses_per_row: int, facing: bool, blocks: int, floors: int, units_per_floor: int) -> int:
    return lorongs * houses_per_row * (2 if facing else 1) + blocks * floors * units_per_floor


def plan_phase(lorongs: int, houses_per_row: int, facing: bool, blocks: int, floors: int, units_per_floor: int,
               include_units: bool = True) -> dict:
    started = time.perf_counter()
    groups = _terrace_units(lorongs, houses_per_row, facing) + _block_units(blocks, floors, units_per_floor)
    sizes: Counter[int] = Counter()
    zones: dict[str, list[int]] = {w: [] for w in WORKS_TYPES}
    ring2: list[int] = []
    fewer = 0
    units_out = []
    for group in groups:
        index = slot_index(group)  # neighbours only ever live in the same lorong or block
        for u in group:
            circle = neighbour_circle(u, group, index)
            sizes[len(circle)] += 1
            if len(circle) < FULL_CIRCLE[u.kind]:
                fewer += 1
            for w in WORKS_TYPES:
                zones[w].append(len(impact_zone(u, group, w, index)))
            ring2.append(len(group) - 1 - len(circle))
            if include_units:
                units_out.append({"id": u.id, "label": u.label, "kind": u.kind, "circle": [n.unit_id for n in circle]})
    homes = sum(sizes.values())
    took_ms = round((time.perf_counter() - started) * 1000, 1)
    return {
        "homes": homes,
        "terrace_homes": sum(len(g) for g in groups if g and g[0].kind == "terrace"),
        "apartment_homes": sum(len(g) for g in groups if g and g[0].kind == "apartment"),
        "circle_sizes": {str(k): v for k, v in sorted(sizes.items())},
        "avg_circle": round(mean(sizes.elements()), 2) if homes else 0,
        "fewer_neighbours": fewer,
        # Whole homes: "about 186 more homes", never 185.6.
        "avg_ring2": round(mean(ring2)) if ring2 else 0,
        "notice_zone": {w: {"avg": round(mean(z), 1) if z else 0, "max": max(z) if z else 0} for w, z in zones.items()},
        "took_ms": took_ms,
        "checks": [
            "End and corner lots, top and ground floors get fewer neighbours automatically.",
            "Semi-Ds, shoplots and odd-shaped plots are not modelled: the estate office checks those circles by hand.",
            "Lower floors of a block share the same rules; podium car parks and facilities floors should be left out.",
        ],
        "units": units_out if include_units else [],
    }
