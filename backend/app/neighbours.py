"""Who counts as a neighbour, in three rings.

Ring 1, the circle (向こう三軒両隣): homes that share a wall, a slab or a road frontage.
  Terrace house: left and right on the same row, plus the three houses facing it.
  Apartment: left and right on the same floor, plus the units directly above and below.
Ring 2, the street or block: everyone else on the same lorong (both rows) or in the same block.
  Reachable only through a contact request the other side accepts.
Ring 3, the township: community notices only.

The impact zone of a renovation is separate: it depends on the type of work (water travels down,
hacking noise travels up and down), so a wet job on level 15 also reaches level 13.

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
    relation: str  # left | right | across-left | across | across-right | above | below | above-2 | below-2


_INVERSE = {
    "left": "right", "right": "left",
    "across-left": "across-right", "across-right": "across-left", "across": "across",
    "above": "below", "below": "above", "above-2": "below-2", "below-2": "above-2",
    "street": "street", "block": "block", "contact": "contact",
}

WORKS_TYPES = ("wet", "hacking", "structural", "light")


def inverse_relation(relation: str) -> str:
    """If B is A's `relation`, A is B's `inverse_relation(relation)`."""
    return _INVERSE[relation]


def slot_index(units: list[Unit]) -> dict[str, dict[tuple, Unit]]:
    """Where every home sits, for fast lookups when the same layout is asked about many times."""
    return {
        "terrace": {(u.row, u.pos): u for u in units if u.kind == "terrace"},
        "apartment": {(u.block, u.floor, u.pos): u for u in units if u.kind == "apartment"},
    }


def neighbour_circle(unit: Unit, units: list[Unit], index: dict | None = None) -> list[Neighbour]:
    if unit.kind == "terrace":
        return _terrace_circle(unit, units, index)
    if unit.kind == "apartment":
        return _apartment_circle(unit, units, index)
    raise ValueError(f"unknown unit kind: {unit.kind}")


def _terrace_circle(unit: Unit, units: list[Unit], index: dict | None = None) -> list[Neighbour]:
    by_slot = index["terrace"] if index else {(u.row, u.pos): u for u in units if u.kind == "terrace"}
    wanted = [
        ((unit.row, unit.pos - 1), "left"),
        ((unit.row, unit.pos + 1), "right"),
        ((unit.facing_row, unit.pos - 1), "across-left"),
        ((unit.facing_row, unit.pos), "across"),
        ((unit.facing_row, unit.pos + 1), "across-right"),
    ]
    return [Neighbour(by_slot[slot].id, relation) for slot, relation in wanted if slot in by_slot]


def _apartment_circle(unit: Unit, units: list[Unit], index: dict | None = None) -> list[Neighbour]:
    by_slot = index["apartment"] if index else {(u.block, u.floor, u.pos): u for u in units if u.kind == "apartment"}
    wanted = [
        ((unit.block, unit.floor, unit.pos - 1), "left"),
        ((unit.block, unit.floor, unit.pos + 1), "right"),
        ((unit.block, unit.floor + 1, unit.pos), "above"),
        ((unit.block, unit.floor - 1, unit.pos), "below"),
    ]
    return [Neighbour(by_slot[slot].id, relation) for slot, relation in wanted if slot in by_slot]


def impact_zone(unit: Unit, units: list[Unit], works_type: str, index: dict | None = None) -> list[Neighbour]:
    """Who must be told before a renovation starts, by type of work.

    wet (bathroom, kitchen, plumbing): leaks travel down, so two floors below as well.
    hacking / structural: noise and vibration travel through the frame, two floors up and down.
    light (painting, carpentry): the homes sharing a wall only.
    """
    if works_type not in WORKS_TYPES:
        raise ValueError(f"unknown works type: {works_type}")
    if unit.kind == "terrace":
        circle = _terrace_circle(unit, units, index)
        return [n for n in circle if n.relation in ("left", "right")] if works_type == "light" else circle
    by_slot = index["apartment"] if index else {(u.block, u.floor, u.pos): u for u in units if u.kind == "apartment"}
    b, f, p = unit.block, unit.floor, unit.pos
    wanted = [((b, f, p - 1), "left"), ((b, f, p + 1), "right")]
    if works_type == "wet":
        wanted += [((b, f - 1, p), "below"), ((b, f - 2, p), "below-2")]
    elif works_type in ("hacking", "structural"):
        wanted += [((b, f + 1, p), "above"), ((b, f + 2, p), "above-2"), ((b, f - 1, p), "below"), ((b, f - 2, p), "below-2")]
    return [Neighbour(by_slot[slot].id, relation) for slot, relation in wanted if slot in by_slot]


IMPACT_REASON = {
    ("left", None): "Shares a wall", ("right", None): "Shares a wall",
    ("across-left", None): "Across the road: noise, dust and lorries",
    ("across", None): "Directly across the road: noise, dust and lorries",
    ("across-right", None): "Across the road: noise, dust and lorries",
    ("below", "wet"): "Directly below: leak risk", ("below-2", "wet"): "Two floors below: leaks can travel",
    ("above", None): "Directly above: noise and vibration", ("above-2", None): "Two floors up: noise travels through the frame",
    ("below", None): "Directly below: noise, vibration and leaks", ("below-2", None): "Two floors below: noise travels through the frame",
}


def impact_reason(relation: str, works_type: str) -> str:
    return IMPACT_REASON.get((relation, works_type)) or IMPACT_REASON.get((relation, None), "Nearby")


@dataclass(frozen=True)
class Nearby:
    unit_id: str
    hint: str
    key: str = ""  # same_row | across_road | floors_above | floors_below | same_floor | level
    n: int = 0


def street_or_block(unit: Unit, units: list[Unit]) -> list[Nearby]:
    """Ring 2: the rest of my lorong (terrace) or my block (apartment), excluding my circle."""
    circle = {n.unit_id for n in neighbour_circle(unit, units)} | {unit.id}
    out = []
    for u in units:
        if u.id in circle or u.kind != unit.kind:
            continue
        if unit.kind == "terrace" and u.row in (unit.row, unit.facing_row):
            same = u.row == unit.row
            out.append(Nearby(u.id, "Same row" if same else "Across the road", "same_row" if same else "across_road"))
        elif unit.kind == "apartment" and u.block == unit.block:
            diff = u.floor - unit.floor
            if u.pos == unit.pos and diff:
                hint, key, n = f"{abs(diff)} floors {'above' if diff > 0 else 'below'}", "floors_above" if diff > 0 else "floors_below", abs(diff)
            elif diff == 0:
                hint, key, n = "Same floor", "same_floor", 0
            else:
                hint, key, n = f"Level {u.floor}", "level", u.floor
            out.append(Nearby(u.id, hint, key, n))
    return out
