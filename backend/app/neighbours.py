"""Five-household neighbour circle (向こう三軒両隣).

Terrace house: the left and right houses on the same row, plus the three houses
facing it across the road.
Apartment: the left and right units on the same floor, plus the units directly
above and below.

End units and top/bottom floors simply have fewer neighbours.
"""

from dataclasses import dataclass


@dataclass(frozen=True)
class Unit:
    id: str
    kind: str  # "terrace" | "apartment"
    label: str
    row: str | None = None  # terrace: row id
    facing_row: str | None = None  # terrace: the row across the road
    block: str | None = None  # apartment: block id
    floor: int | None = None  # apartment: floor number
    pos: int | None = None  # position along the row / along the floor


@dataclass(frozen=True)
class Neighbour:
    unit_id: str
    relation: str  # left | right | across-left | across | across-right | above | below


_INVERSE = {
    "left": "right", "right": "left",
    "across-left": "across-right", "across-right": "across-left", "across": "across",
    "above": "below", "below": "above",
}


def inverse_relation(relation: str) -> str:
    """If B is A's `relation`, A is B's `inverse_relation(relation)`."""
    return _INVERSE[relation]


def neighbour_circle(unit: Unit, units: list[Unit]) -> list[Neighbour]:
    if unit.kind == "terrace":
        return _terrace_circle(unit, units)
    if unit.kind == "apartment":
        return _apartment_circle(unit, units)
    raise ValueError(f"unknown unit kind: {unit.kind}")


def _terrace_circle(unit: Unit, units: list[Unit]) -> list[Neighbour]:
    by_slot = {(u.row, u.pos): u for u in units if u.kind == "terrace"}
    wanted = [
        ((unit.row, unit.pos - 1), "left"),
        ((unit.row, unit.pos + 1), "right"),
        ((unit.facing_row, unit.pos - 1), "across-left"),
        ((unit.facing_row, unit.pos), "across"),
        ((unit.facing_row, unit.pos + 1), "across-right"),
    ]
    return [Neighbour(by_slot[slot].id, relation) for slot, relation in wanted if slot in by_slot]


def _apartment_circle(unit: Unit, units: list[Unit]) -> list[Neighbour]:
    by_slot = {(u.block, u.floor, u.pos): u for u in units if u.kind == "apartment"}
    wanted = [
        ((unit.block, unit.floor, unit.pos - 1), "left"),
        ((unit.block, unit.floor, unit.pos + 1), "right"),
        ((unit.block, unit.floor + 1, unit.pos), "above"),
        ((unit.block, unit.floor - 1, unit.pos), "below"),
    ]
    return [Neighbour(by_slot[slot].id, relation) for slot, relation in wanted if slot in by_slot]
