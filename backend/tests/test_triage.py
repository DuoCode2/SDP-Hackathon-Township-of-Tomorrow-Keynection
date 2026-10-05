from app.triage import triage_hint

CRACK = {"aligned": True, "changed": True, "regions": [{"shape": "line"}]}
RENO = {"scope": "Extend kitchen (rear wall)", "start": "2026-10-15", "end": "2026-10-30"}


def test_photo_before_renovation_plus_new_crack_points_to_renovation():
    h = triage_hint(CRACK, "2026-10-05T03:00:00+00:00", RENO, "No. 12")
    assert h["suggestion"] == "renovation"
    assert any("before work started" in r for r in h["reasons"])


def test_photo_taken_after_work_began_needs_an_inspector():
    assert triage_hint(CRACK, "2026-10-20T03:00:00+00:00", RENO, "No. 12")["suggestion"] == "inspect"


def test_no_renovation_next_door_points_to_warranty():
    assert triage_hint(CRACK, "2026-10-05T03:00:00+00:00", None, None)["suggestion"] == "warranty"


def test_no_change_and_unmatched_photos():
    assert triage_hint({"aligned": True, "changed": False, "regions": []}, "2026-10-05", RENO, "No. 12")["suggestion"] == "no_change"
    assert triage_hint({"aligned": False}, "2026-10-05", RENO, "No. 12")["suggestion"] == "retake"
