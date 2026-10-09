from app.triage import triage_hint

CRACK = {"aligned": True, "changed": True, "regions": [{"shape": "line"}]}
RENO = {"scope": "Extend kitchen (rear wall)", "start": "2026-10-15", "end": "2026-10-30"}
BEFORE_WORK = "2026-10-05T03:00:00+00:00"
DURING_WORK = "2026-10-20T03:00:00+00:00"


def test_change_after_work_began_points_to_renovation_but_says_timing_is_not_proof():
    h = triage_hint(CRACK, BEFORE_WORK, RENO, "No. 12", followup_at=DURING_WORK)
    assert h["suggestion"] == "renovation"
    assert any("before work started" in r for r in h["reasons"])
    assert any("Timing alone does not prove" in r for r in h["reasons"])
    assert not h["headline"].startswith("Likely")  # no causal claim from dates alone


def test_change_already_there_before_work_began_cannot_be_the_renovation():
    h = triage_hint(CRACK, BEFORE_WORK, RENO, "No. 12", followup_at="2026-10-10T03:00:00+00:00")
    assert h["suggestion"] == "warranty"
    assert any("before work started" in r and "cannot have caused" in r for r in h["reasons"])


def test_dates_are_compared_in_malaysian_time():
    # 14 Oct 23:00 in Malaysia is still the day before work starts...
    assert triage_hint(CRACK, BEFORE_WORK, RENO, "No. 12", followup_at="2026-10-14T15:00:00+00:00")["suggestion"] == "warranty"
    # ...but 15 Oct 01:00 in Malaysia is the start day, even though it is still 14 Oct in UTC.
    assert triage_hint(CRACK, BEFORE_WORK, RENO, "No. 12", followup_at="2026-10-14T17:00:00+00:00")["suggestion"] == "renovation"


def test_photo_taken_after_work_began_needs_an_inspector():
    assert triage_hint(CRACK, DURING_WORK, RENO, "No. 12", followup_at="2026-10-25T03:00:00+00:00")["suggestion"] == "inspect"


def test_no_renovation_next_door_points_to_warranty():
    assert triage_hint(CRACK, BEFORE_WORK, None, None, followup_at=DURING_WORK)["suggestion"] == "warranty"


def test_every_reason_comes_with_a_code_the_app_can_translate():
    # The English sentences stay as the record; the codes (with plain values) let the app show the reasons
    # in the reader's language.
    h = triage_hint(CRACK, BEFORE_WORK, RENO, "No. 12", followup_at=DURING_WORK)
    assert len(h["codes"]) == len(h["reasons"])
    assert [c["code"] for c in h["codes"]] == ["photo_before_work", "seen_after_work", "work_scope", "timing_not_proof"]
    assert h["codes"][0] == {"code": "photo_before_work", "taken": "2026-10-05", "label": "No. 12", "start": "2026-10-15"}
    assert h["codes"][1] == {"code": "seen_after_work", "shapes": ["line"], "seen": "2026-10-20"}
    before = triage_hint(CRACK, BEFORE_WORK, RENO, "No. 12", followup_at="2026-10-10T03:00:00+00:00")
    assert [c["code"] for c in before["codes"]] == ["seen_before_work", "maybe_defect"]
    for comparison in ({"aligned": False}, {"aligned": True, "changed": False, "regions": []}):
        h = triage_hint(comparison, BEFORE_WORK, None, None, followup_at=DURING_WORK)
        assert len(h["codes"]) == len(h["reasons"]) and all("code" in c for c in h["codes"])


def test_no_change_and_unmatched_photos():
    assert triage_hint({"aligned": True, "changed": False, "regions": []}, "2026-10-05", RENO, "No. 12",
                       followup_at=DURING_WORK)["suggestion"] == "no_change"
    assert triage_hint({"aligned": False}, "2026-10-05", RENO, "No. 12", followup_at=DURING_WORK)["suggestion"] == "retake"
