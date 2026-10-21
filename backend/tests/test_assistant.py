"""The household's assistant: one sentence, said or typed, becomes something ready to check (a renovation notice
filled in, a hello with its homes ticked, a quiet time, a status, a page). It never sends anything to a neighbour.
Every test uses a stand-in for the AI; with none, a few key words decide."""
from datetime import date, timedelta

import pytest
from fastapi.testclient import TestClient

from app import ai

START, END = (date.today() + timedelta(days=9)).isoformat(), (date.today() + timedelta(days=20)).isoformat()


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("KEYNECTION_DB_PATH", str(tmp_path / "test.db"))
    monkeypatch.setenv("KEYNECTION_DEMO_MODE", "1")
    from app.main import app

    with TestClient(app) as c:
        yield c


class StandIn:
    """Answers in place of the AI: answers[schema name] is a reply, or None (no answer)."""

    def __init__(self) -> None:
        self.calls: list[dict[str, str]] = []
        self.answers: dict = {}

    def __call__(self, system, text, schema, **options):
        self.calls.append({"system": system, "text": text, "schema": schema.__name__})
        return self.answers.get(schema.__name__)


@pytest.fixture()
def claude(monkeypatch):
    stand_in = StandIn()
    monkeypatch.setattr(ai, "_ask", stand_in)
    monkeypatch.setattr(ai, "provider", lambda: "anthropic")
    return stand_in


def _plan(intent, **fields):
    base = {"language": "en", "reply": "Ready for you to check.", "page": None, "quiet_window": None, "hello_to": [],
            "status_topic": None, "missing": []}
    return ai.AssistantPlan(intent=intent, **{**base, **fields})


def _ask(client, text, unit="T-12"):
    r = client.post("/api/assistant", json={"unit_id": unit, "text": text, "page": "circle", "lang": "en"})
    assert r.status_code == 200
    return r.json()


def _case_against_t12(client) -> dict:
    """T-12 registers a renovation; T-11 reports a crack on the shared wall."""
    intro_id = client.post("/api/intros", json={"from_unit_id": "T-12", "message": "Hi, renovating soon", "renovation": {
        "scope": "Hack kitchen tiles", "start": START, "end": END}}).json()["id"]
    demo = lambda name, kind, intro=None: client.post("/api/units/T-11/photos/demo", json={  # noqa: E731
        "name": name, "kind": kind, "subject": "Shared wall with No. 12", "renovation_intro_id": intro}).json()
    b, f = demo("wall_before", "baseline", intro_id), demo("wall_after_crack", "followup")
    return client.post("/api/incidents", json={"reporter_unit_id": "T-11", "baseline_photo_id": b["id"],
                                               "followup_photo_id": f["id"]}).json()


def test_a_renovation_is_filled_in_by_the_notice_s_own_draft(client, claude):
    claude.answers["AssistantPlan"] = _plan("register_renovation", reply="I filled in your notice: check it and send it.")
    claude.answers["RenovationDraft"] = ai.RenovationDraft(
        language="en", works_type="wet", scope="Retile the bathroom", start=START, end=END, noisy_from="09:00",
        noisy_to="18:00", weekdays_only=True, contractor="ABC Renovation", why="Water work.", missing=[])
    said = "Saturday I'm retiling the bathroom, ABC Renovation, two weeks"
    d = _ask(client, said)
    assert d["intent"] == "register_renovation" and d["by_ai"] is True
    reno = d["renovation"]
    assert (reno["works_type"], reno["start"], reno["end"], reno["contractor"]) == ("wet", START, END, "ABC Renovation")
    # The form is filled in by the same request as the notice's own one-sentence box, with the resident's words.
    assert [c["schema"] for c in claude.calls] == ["AssistantPlan", "RenovationDraft"]
    assert f"<owner>\n{said}\n</owner>" in claude.calls[1]["text"]
    assert client.get("/api/units/T-11/inbox").json() == []  # nothing was sent


@pytest.mark.parametrize("said, intent", [
    ("renovate bathroom next Saturday", "register_renovation"),
    ("我下周六开始换浴室瓷砖，大概两个星期", "register_renovation"),  # the demo's Chinese example
    ("Saya nak sapa jiran baru", "say_hello"),
    ("宝宝下午要睡觉，需要安静", "set_quiet_time"),
    ("my warranty status", "check_status"),
    ("what's the weather like", "unknown"),
])
def test_without_ai_a_few_key_words_decide(client, said, intent):
    d = _ask(client, said)
    assert d["intent"] == intent and d["by_ai"] is False and d["renovation"] is None and d["reply"]


def test_no_answer_or_no_allowance_falls_back_to_key_words(client, claude, monkeypatch):
    claude.answers["AssistantPlan"] = None
    assert _ask(client, "renovating the kitchen")["by_ai"] is False
    monkeypatch.setattr(ai, "CALLS_PER_HOME_PER_DAY", 0)
    claude.answers["AssistantPlan"] = _plan("unknown")
    d = _ask(client, "renovating the kitchen")
    assert d["intent"] == "register_renovation" and d["by_ai"] is False


def test_the_ai_gets_unit_numbers_and_own_records_never_neighbours_names_or_words(client, claude):
    from app.seed import demo_units

    _case_against_t12(client)
    client.post("/api/messages", json={"from_unit_id": "T-11", "to_unit_id": "T-12", "body": "Our cat hides from the drilling"})
    claude.answers["AssistantPlan"] = _plan("unknown")
    _ask(client, "what is happening next door?")
    asked = claude.calls[-1]["system"] + claude.calls[-1]["text"]
    assert "No. 11" in asked and "No. 13" in asked and "Hack kitchen tiles" in asked  # unit numbers and own records
    assert "<request>\nwhat is happening next door?\n</request>" in asked
    names = {u["resident_name"] for u in demo_units() if u["id"] != "T-12"}
    assert not [n for n in names if n in asked] and "cat hides" not in asked


def test_status_is_counted_by_the_server_with_the_ticket_and_its_days(client, claude):
    case = _case_against_t12(client)
    client.post(f"/api/incidents/{case['id']}/decision", json={"unit_id": "T-11", "decision": "warranty", "note": ""})
    ticket = client.get("/api/units/T-11/warranty").json()[0]
    claude.answers["AssistantPlan"] = _plan("check_status", status_topic="warranty", reply="Your ticket is fine, 99 days left.")
    d = _ask(client, "where is my warranty ticket?", unit="T-11")
    assert f"#{ticket['id']}" in d["reply"] and f"{ticket['clock']['days_left']} days left" in d["reply"]
    assert "99" not in d["reply"] and d["page"] == "evidence"
    # Without AI the same words get the same count.
    claude.answers["AssistantPlan"] = None
    assert _ask(client, "my warranty status", unit="T-11")["reply"] == d["reply"]


def test_an_open_case_says_whose_move_it_is(client, claude):
    _case_against_t12(client)
    claude.answers["AssistantPlan"] = _plan("check_status", status_topic="case")
    assert _ask(client, "my case?", unit="T-12")["reply"] == "1 open case, waiting for No. 11."
    assert _ask(client, "my case?", unit="T-11")["reply"] == "1 open case, waiting for you."


def test_hello_ticks_only_joined_homes_in_the_circle(client, claude):
    claude.answers["AssistantPlan"] = _plan("say_hello", hello_to=["No. 11", "no. 13", "No. 23", "No. 99"])
    d = _ask(client, "say hi to 11, 13, 23 and 99")
    assert d["hello_to"] == ["No. 11", "No. 13"] and d["hello_ids"] == ["T-11", "T-13"]  # No. 23 hasn't joined


def test_a_quiet_time_that_does_not_read_as_times_is_dropped_and_a_page_must_be_named(client, claude):
    window = ai.QuietWindow(start="13:00", end="15:00", why="baby")
    claude.answers["AssistantPlan"] = _plan("set_quiet_time", quiet_window=window)
    assert _ask(client, "baby naps 1 to 3")["quiet_window"] == {"start": "13:00", "end": "15:00", "why": "baby"}
    claude.answers["AssistantPlan"] = _plan("set_quiet_time", quiet_window=ai.QuietWindow(start="15:00", end="13:00", why="baby"))
    assert _ask(client, "baby naps 3 to 1")["quiet_window"] is None
    claude.answers["AssistantPlan"] = _plan("go_to_page", page=None)
    assert _ask(client, "open that thing")["intent"] == "unknown"


def test_a_question_is_answered_only_from_the_rules_given_and_shown_as_written(client, claude):
    said = "No: the house rules allow no work on Sundays or public holidays. Noisy work is allowed 09:00–18:00, Monday to Saturday."
    claude.answers["AssistantPlan"] = _plan("answer", reply=said)
    d = _ask(client, "Can I renovate on Sunday?")
    assert d["intent"] == "answer" and d["reply"] == said and d["by_ai"] is True
    # knowledge.py's three parts follow the instructions: this home's house rules, the guideline, the ladder.
    system = claude.calls[-1]["system"]
    assert "No work on Sundays and public holidays" in system and "Noisy work is allowed 09:00–18:00" in system
    assert "OSC 3.0 Plus" in system and "within 30 days of the owner's written notice" in system
    assert "Protect the lift" not in system  # a terrace has no lift
    _ask(client, "Boleh saya buat kerja hari Ahad?", unit="A-15-3")
    assert "Protect the lift" in claude.calls[-1]["system"]
