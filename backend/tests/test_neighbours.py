from app.neighbours import Unit, impact_reason, impact_zone, neighbour_circle
from app.seed import demo_units


def _units() -> list[Unit]:
    return [
        Unit(id=u["id"], kind=u["kind"], label=u["label"], row=u.get("row"), facing_row=u.get("facing_row"), back_row=u.get("back_row"),
             block=u.get("block"), floor=u.get("floor"), pos=u["pos"])
        for u in demo_units()
    ]


def _circle(unit_id: str) -> dict[str, str]:
    units = _units()
    me = next(u for u in units if u.id == unit_id)
    return {n.unit_id: n.relation for n in neighbour_circle(me, units)}


def test_terrace_middle_house_gets_left_right_and_three_across():
    assert _circle("T-12") == {
        "T-11": "left", "T-13": "right",
        "T-21": "across-left", "T-22": "across", "T-23": "across-right",
    }


def test_terrace_end_house_has_fewer_neighbours():
    assert _circle("T-10") == {"T-11": "right", "T-20": "across", "T-21": "across-right"}


def test_apartment_gets_left_right_above_below():
    assert _circle("A-14-3") == {"A-14-2": "left", "A-14-4": "right", "A-15-3": "above", "A-13-3": "below"}


def test_apartment_top_floor_corner_has_no_above_or_right():
    assert _circle("A-16-4") == {"A-16-3": "left", "A-15-4": "below"}


def test_terrace_and_apartment_never_mix():
    assert all(not n.startswith("A-") for n in _circle("T-12"))
    assert all(not n.startswith("T-") for n in _circle("A-14-3"))


def test_back_row_is_told_for_wet_structural_hacking_only():
    """The house behind shares the back fence and drain: told about works that reach them, never part of the circle."""
    units = _units()
    me = next(u for u in units if u.id == "T-12")
    for works in ("wet", "structural", "hacking"):
        zone = {n.unit_id: n.relation for n in impact_zone(me, units, works)}
        assert zone.get("T-32") == "behind" and len(zone) == 6, works
        assert impact_reason("behind", works) != "Nearby"
    assert "T-32" not in {n.unit_id for n in impact_zone(me, units, "light")}
    assert "T-32" not in _circle("T-12") and len(_circle("T-12")) == 5
    # Back to back works both ways: wet works at No. 32 tell No. 12.
    lane = next(u for u in units if u.id == "T-32")
    assert {n.unit_id: n.relation for n in impact_zone(lane, units, "wet")}.get("T-12") == "behind"
