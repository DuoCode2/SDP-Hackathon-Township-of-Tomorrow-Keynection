"""Fictional demo phase: two facing terrace rows and one apartment block.

All names and units are made up for the prototype; nothing here is real SDP data.
"""

PHASE = {
    "id": "demo",
    "name": "Taman Demo (fictional phase)",
    "note": "Two facing terrace rows on Jalan Demo 1 and one apartment block. Made-up data for the prototype.",
}

_SOUTH_NAMES = ["Farid", "Siti", "Aiman", "Kumar", "Wei Jie", "Nurul"]
_NORTH_NAMES = ["Ah Hock", "Priya", "Hafiz", "Mei Ling", "Daniel", "Aisyah"]
_APT_NAMES = [
    "Rahman", "Jia Hui", "Suresh", "Liyana",
    "Kevin", "Zainab", "Arjun", "Yong",
    "Hana", "Rajesh", "Sofia", "Chong",
]


def demo_units() -> list[dict]:
    units = []
    # South row: houses 10-15, facing north row houses 20-25 (house 12 faces 22).
    for pos in range(6):
        units.append({
            "id": f"T-{10 + pos}", "phase_id": "demo", "kind": "terrace", "label": f"No. {10 + pos}",
            "resident_name": _SOUTH_NAMES[pos], "row": "south", "facing_row": "north", "pos": pos,
        })
        units.append({
            "id": f"T-{20 + pos}", "phase_id": "demo", "kind": "terrace", "label": f"No. {20 + pos}",
            "resident_name": _NORTH_NAMES[pos], "row": "north", "facing_row": "south", "pos": pos,
        })
    # Block A: floors 13-15, units 1-4 per floor.
    i = 0
    for floor in (13, 14, 15):
        for pos in range(1, 5):
            units.append({
                "id": f"A-{floor}-{pos}", "phase_id": "demo", "kind": "apartment", "label": f"A-{floor}-{pos}",
                "resident_name": _APT_NAMES[i], "block": "A", "floor": floor, "pos": pos,
            })
            i += 1
    return units
