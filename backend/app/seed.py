"""Fictional demo phase: two facing terrace rows and one apartment block.

All names and units are made up for the prototype; nothing here is real SDP data.
Dates are worked out from today, so a rehearsal or a judging day always opens on a phase handed over two weeks ago.
"""

from datetime import date, datetime, timedelta, timezone

MALAYSIA = timezone(timedelta(hours=8))
HANDOVER_DAYS_AGO = 14
# Version of the plain-language privacy notice a household agrees to when it joins (PDPA consent). Where AI is on,
# the notice has one more paragraph (what residents type is translated by Claude, outside Malaysia): its own version.
CONSENT_VERSION = "pilot-2026-10"
CONSENT_VERSION_AI = "pilot-2026-10-ai"

# Households that have not joined Keynection yet. Until they do, neighbours see their unit number only, never a name,
# and renovation notices reach them on paper through the estate office.
NOT_JOINED = {"T-23"}
# Households that use easy mode (bigger text, fewer options). Private to the household itself.
EASY_MODE = {"T-20"}
# Family helpers already set up at handover: (unit, helper name, relationship).
SEED_HELPERS = [("T-20", "Mei Fong", "child")]

PHASE = {
    "id": "demo",
    "name": "Taman Demo (fictional phase)",
    "note": "Two facing terrace rows on Jalan Demo 1 and one apartment block. Made-up data for the prototype.",
}


def today_my() -> date:
    return datetime.now(MALAYSIA).date()


def handover_date() -> str:
    """Vacant possession date for the whole phase; the 24-month defect liability period runs from here."""
    return (today_my() - timedelta(days=HANDOVER_DAYS_AGO)).isoformat()


def _next(weekday: int, after: date) -> date:
    """The first given weekday (Mon=0) at least three days after `after`, so residents get notice."""
    d = after + timedelta(days=3)
    return d + timedelta(days=(weekday - d.weekday()) % 7)


def _day(d: date) -> str:
    return f"{d:%A} {d.day} {d:%b}"


def demo_notices() -> list[tuple[str, str, str]]:
    """Community notices (ring 3): one-way, from the estate team. Fictional examples."""
    today = today_my()
    return [
        ("block:A", "Block A water tank cleaning",
         f"Water supply to Block A pauses on {_day(_next(5, today))}, 9am to 1pm. Please store water the night before."),
        ("terrace", "Drain clearing on Jalan Demo 1",
         f"Contractors will clear the roadside drains on {_day(_next(3, today))}. Please keep cars off the drain covers."),
        ("phase", "Renovation hours in Taman Demo",
         "Noisy renovation work only Monday to Saturday, 9am to 6pm, and never on Sundays or public holidays. "
         "Register your renovation in Keynection so your neighbours hear about it from you first."),
    ]

_SOUTH_NAMES = ["Farid", "Siti", "Aiman", "Kumar", "Wei Jie", "Nurul"]
_NORTH_NAMES = ["Ah Hock", "Priya", "Hafiz", "Mei Ling", "Daniel", "Aisyah"]
_APT_NAMES = {
    11: ["Faizal", "Mei Xin", "Ganesh", "Amira"],
    12: ["Ismail", "Hui Min", "Lakshmi", "Danish"],
    13: ["Rahman", "Jia Hui", "Suresh", "Liyana"],
    14: ["Kevin", "Zainab", "Arjun", "Yong"],
    15: ["Hana", "Rajesh", "Sofia", "Chong"],
    16: ["Nadia", "Wei Ming", "Thinesh", "Farah"],
}
# Language each household reads messages in (quick replies and alerts arrive translated into it). Kumar, next door to
# Aiman, reads Tamil, so the demo shows a renovation notice reaching him in Tamil.
_LANG = {
    "Farid": "ms", "Siti": "ms", "Aiman": "en", "Kumar": "ta", "Wei Jie": "zh", "Nurul": "ms",
    "Ah Hock": "zh", "Priya": "en", "Hafiz": "ms", "Mei Ling": "zh", "Daniel": "en", "Aisyah": "ms",
    "Rahman": "ms", "Jia Hui": "zh", "Suresh": "en", "Liyana": "ms", "Kevin": "en", "Zainab": "ms",
    "Arjun": "en", "Yong": "zh", "Hana": "ms", "Rajesh": "en", "Sofia": "en", "Chong": "zh",
    "Faizal": "ms", "Mei Xin": "zh", "Ganesh": "en", "Amira": "ms", "Ismail": "ms", "Hui Min": "zh",
    "Lakshmi": "en", "Danish": "ms", "Nadia": "ms", "Wei Ming": "zh", "Thinesh": "en", "Farah": "ms",
}


# Short, harmless "about me" lines. The profile screen warns residents not to share schedules or travel dates.
BIOS = {
    "Aiman": "Just moved in. Happy to help with Wi-Fi and computers.",
    "Siti": "Two kids and a cat. Say hi if you see us at the playground!",
    "Kumar": "Gardener. Ask me about mango trees.",
    "Priya": "Teacher. Always up for a teh tarik chat.",
    "Hafiz": "Works shifts: a quick message before noisy work really helps.",
    "Mei Ling": "Bakes on weekends and shares the extras.",
    "Sofia": "Re-doing the bathroom in October. Sorry in advance!",
    "Arjun": "Works from home. Big on football.",
    "Suresh": "Retired engineer, happy to look at a leak with you.",
    "Ah Hock": "Retired. Voice messages are easiest for me; my daughter helps with the app.",
}


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
    # Block A: floors 11-16 shown (the lower floors are left out of the demo), units 1-4 per floor.
    for floor, names in _APT_NAMES.items():
        for pos in range(1, 5):
            units.append({
                "id": f"A-{floor}-{pos}", "phase_id": "demo", "kind": "apartment", "label": f"A-{floor}-{pos}",
                "resident_name": names[pos - 1], "block": "A", "floor": floor, "pos": pos,
            })
    for u in units:
        u["lang"] = _LANG[u["resident_name"]]
    return units
