"""Claude in two places on the main story: one sentence becomes a renovation notice, and whatever a neighbour types
(a chat message, a hello, a notice) arrives in the reader's own language, with a calmer wording offered first when
it sounds heated. Every test here uses a stand-in for Claude; with no key the app behaves exactly as before."""
from datetime import date, timedelta

import pytest
from fastapi.testclient import TestClient

from app import ai

RENO = {"scope": "Extend kitchen (rear wall)", "start": "2026-10-15", "end": "2026-10-30", "works_type": "structural",
        "council_permit": "approved"}


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("JIRAN_DB_PATH", str(tmp_path / "test.db"))
    monkeypatch.setenv("JIRAN_DEMO_MODE", "1")
    monkeypatch.delenv("JIRAN_SITE_PASSWORD", raising=False)
    from app.main import app

    with TestClient(app) as c:
        yield c


class StandIn:
    """Answers in place of Claude: answers[schema name] is a reply, a function of the prompt, or None (no answer)."""

    def __init__(self) -> None:
        self.calls: list[dict[str, str]] = []
        self.answers: dict = {}

    def __call__(self, system, text, schema, **options):
        self.calls.append({"system": system, "text": text, "schema": schema.__name__})
        answer = self.answers.get(schema.__name__)
        return answer(text) if callable(answer) else answer


@pytest.fixture()
def claude(monkeypatch):
    stand_in = StandIn()
    monkeypatch.setattr(ai, "_ask", stand_in)
    monkeypatch.setattr(ai, "enabled", lambda: True)
    return stand_in


def _items(client, me, other, kind):
    return [i for i in client.get(f"/api/units/{me}/conversations/{other}").json()["items"] if i["type"] == kind]


START, END = (date.today() + timedelta(days=9)).isoformat(), (date.today() + timedelta(days=20)).isoformat()


def _draft(**overrides):
    fields = {"language": "zh", "works_type": "wet", "scope": "Retile the master bathroom", "start": START, "end": END,
              "noisy_from": "09:00", "noisy_to": "17:00", "weekdays_only": True, "contractor": "ABC Renovation",
              "why": "Water work can leak into the home below.", "missing": []}
    return ai.RenovationDraft(**{**fields, **overrides})


# ---------- off by default ----------

def test_ai_is_off_without_a_key_and_nothing_else_changes(client):
    assert client.get("/api/ai").json() == {"on": False, "model": None}
    r = client.post("/api/ai/renovation-draft", json={"unit_id": "T-12", "text": "Retiling the bathroom next week"})
    assert r.status_code == 503 and r.json()["detail"]["code"] == "ai_off"
    assert client.post("/api/messages", json={"from_unit_id": "T-12", "to_unit_id": "T-11", "body": "Good morning!"}).status_code == 201
    item = _items(client, "T-11", "T-12", "message")[-1]
    assert item["text"] == "Good morning!" and item["translated"] is False and item["by_ai"] is False


def test_status_names_the_model(client, claude):
    assert client.get("/api/ai").json() == {"on": True, "model": "claude-opus-5-5"}


def test_with_ai_on_households_agree_to_the_notice_that_says_so(client, claude):
    from app.seed import CONSENT_VERSION_AI

    token = client.post("/api/units/T-23/join-code").json()["token"]
    assert client.post("/api/join/lookup", json={"token": token}).json()["consent_version"] == CONSENT_VERSION_AI
    client.post("/api/join", json={"token": token, "display_name": "Mei Ling", "lang": "zh", "consent": True})
    joined = next(e for e in client.get("/api/units/T-23/history").json()["events"] if e["type"] == "joined")
    assert joined["payload"]["privacy_notice"] == CONSENT_VERSION_AI


# ---------- one sentence becomes a renovation notice ----------

def test_one_sentence_fills_in_the_notice(client, claude):
    from app.main import _today

    claude.answers["RenovationDraft"] = _draft()
    said = "下礼拜一开始重铺主人房浴室瓷砖，两个星期，ABC Renovation 做，平日九点到五点"
    r = client.post("/api/ai/renovation-draft", json={"unit_id": "T-12", "text": said})
    assert r.status_code == 200
    d = r.json()
    assert d["works_type"] == "wet" and d["start"] == START and d["end"] == END
    assert (d["noisy_from"], d["noisy_to"], d["weekdays_only"], d["contractor"]) == ("09:00", "17:00", True, "ABC Renovation")
    assert d["why"] and d["unsure"] == [] and d["language"] == "zh"  # the notice is then written in Chinese too
    # Approvals and the CIDB tick are the owner's own statements to every neighbour: the AI never fills them in.
    assert not {"council_permit", "management_approval", "contractor_cidb_registered", "permit_ref"} & d.keys()
    # "Next Monday" is worked out from today's date in Malaysia; the owner's words go in as they said them.
    asked = claude.calls[-1]["text"]
    assert said in asked and _today() in asked and "terrace" in asked


def test_answers_that_break_the_notice_rules_are_dropped_not_trusted(client, claude):
    claude.answers["RenovationDraft"] = _draft(start=END, end=START, noisy_from="18:00", noisy_to="25:00",
                                               scope="x" * 300, contractor="  ")
    d = client.post("/api/ai/renovation-draft", json={"unit_id": "T-12", "text": "bathroom"}).json()
    assert d["start"] is None and d["end"] is None and d["noisy_from"] is None and d["noisy_to"] is None
    assert d["unsure"] == ["dates", "hours"] and len(d["scope"]) == 120 and d["contractor"] is None


def test_no_answer_means_fill_in_the_steps_yourself(client, claude):
    claude.answers["RenovationDraft"] = None
    r = client.post("/api/ai/renovation-draft", json={"unit_id": "T-12", "text": "bathroom next week"})
    assert r.status_code == 503 and r.json()["detail"]["code"] == "ai_busy"


def test_each_home_has_a_daily_ai_allowance(client, claude, monkeypatch):
    monkeypatch.setattr(ai, "CALLS_PER_HOME_PER_DAY", 2)
    claude.answers["RenovationDraft"] = _draft()
    for _ in range(2):
        assert client.post("/api/ai/renovation-draft", json={"unit_id": "T-12", "text": "bathroom"}).status_code == 200
    assert client.post("/api/ai/renovation-draft", json={"unit_id": "T-12", "text": "bathroom"}).status_code == 429
    assert client.post("/api/ai/renovation-draft", json={"unit_id": "T-11", "text": "bathroom"}).status_code == 200
    # Past the allowance a chat message still goes, as written.
    claude.answers["MessageCheck"] = ai.MessageCheck(heated=False, calmer=None, calmer_translation=None, translation="Hai!")
    assert client.post("/api/messages", json={"from_unit_id": "T-12", "to_unit_id": "T-11", "body": "Hi!"}).status_code == 201
    assert _items(client, "T-11", "T-12", "message")[-1]["text"] == "Hi!"


# ---------- typed messages arrive in the reader's language ----------

def test_typed_message_arrives_in_the_readers_language(client, claude):
    claude.answers["MessageCheck"] = ai.MessageCheck(heated=False, calmer=None, calmer_translation=None,
                                                     translation="Selamat pagi! Boleh saya pinjam tangga?")
    sent = client.post("/api/messages", json={"from_unit_id": "T-12", "to_unit_id": "T-11", "body": "Good morning! Could I borrow a ladder?"})
    assert sent.status_code == 201 and sent.json()["text"] == "Good morning! Could I borrow a ladder?"
    assert sent.json()["translated"] is False  # the sender sees their own words
    item = _items(client, "T-11", "T-12", "message")[-1]
    assert item["text"] == "Selamat pagi! Boleh saya pinjam tangga?" and item["translated"] is True and item["by_ai"] is True
    assert item["original"] == "Good morning! Could I borrow a ladder?"
    mine = _items(client, "T-12", "T-11", "message")[-1]
    assert mine["text"] == "Good morning! Could I borrow a ladder?" and mine["translated"] is False
    # Only the words go to Claude: no names, homes or who is writing to whom.
    asked = claude.calls[-1]["system"] + claude.calls[-1]["text"]
    assert "Malay" in asked and not any(x in asked for x in ("Aiman", "Siti", "T-12", "T-11", "No. 12"))


def test_a_translation_that_changes_nothing_is_not_stored(client, claude):
    claude.answers["MessageCheck"] = ai.MessageCheck(heated=False, calmer=None, calmer_translation=None, translation="Hello!")
    client.post("/api/messages", json={"from_unit_id": "T-11", "to_unit_id": "T-12", "body": "Hello!"})
    item = _items(client, "T-12", "T-11", "message")[-1]
    assert item["text"] == "Hello!" and item["translated"] is False


def test_heated_message_gets_a_calmer_wording_first(client, claude):
    calmer = "Hi, the drilling started at 7am today. Could the workers start after 9, please?"
    claude.answers["MessageCheck"] = ai.MessageCheck(heated=True, calmer=calmer, calmer_translation="Hai, gerudi bermula 7 pagi tadi...",
                                                     translation="Pekerja anda menggerudi pukul 7 pagi LAGI.")
    angry = "Your workers started drilling at 7am AGAIN. This is ridiculous."
    r = client.post("/api/messages", json={"from_unit_id": "T-12", "to_unit_id": "T-11", "body": angry})
    assert r.status_code == 422 and r.json()["detail"]["code"] == "calmer" and r.json()["detail"]["suggestion"] == calmer
    assert _items(client, "T-11", "T-12", "message") == []  # nothing was sent
    # It is advice, not a block: the sender can still send their own words.
    r = client.post("/api/messages", json={"from_unit_id": "T-12", "to_unit_id": "T-11", "body": angry, "keep_tone": True})
    assert r.status_code == 201
    assert _items(client, "T-11", "T-12", "message")[-1]["original"] == angry
    assert len(claude.calls) == 1  # the same words are not checked twice


def test_sending_the_calmer_wording_needs_no_second_check(client, claude):
    calmer = "Could the workers start after 9, please?"
    claude.answers["MessageCheck"] = ai.MessageCheck(heated=True, calmer=calmer, calmer_translation="Boleh pekerja mula selepas 9?",
                                                     translation="...")
    client.post("/api/messages", json={"from_unit_id": "T-12", "to_unit_id": "T-11", "body": "Stop drilling at 7am!!!"})
    assert client.post("/api/messages", json={"from_unit_id": "T-12", "to_unit_id": "T-11", "body": calmer}).status_code == 201
    assert _items(client, "T-11", "T-12", "message")[-1]["text"] == "Boleh pekerja mula selepas 9?"
    assert len(claude.calls) == 1


def test_insults_are_still_stopped_and_a_calmer_wording_offered(client, claude):
    claude.answers["MessageCheck"] = ai.MessageCheck(heated=True, calmer="Please keep the noise down after 10pm.",
                                                     calmer_translation=None, translation="...")
    for keep in (False, True):
        r = client.post("/api/messages", json={"from_unit_id": "T-12", "to_unit_id": "T-11", "body": "Shut up, you idiot", "keep_tone": keep})
        assert r.status_code == 422 and r.json()["detail"]["code"] == "tone"
        assert r.json()["detail"]["suggestion"] == "Please keep the noise down after 10pm."


def test_message_goes_as_written_when_claude_cannot_answer(client, claude):
    claude.answers["MessageCheck"] = None
    assert client.post("/api/messages", json={"from_unit_id": "T-12", "to_unit_id": "T-11", "body": "Hi there"}).status_code == 201
    item = _items(client, "T-11", "T-12", "message")[-1]
    assert item["text"] == "Hi there" and item["translated"] is False


def test_quick_replies_need_no_ai(client, claude):
    key = client.get("/api/units/T-12/conversations/T-11").json()["quick_replies"][0]["key"]
    assert client.post("/api/messages", json={"from_unit_id": "T-12", "to_unit_id": "T-11", "quick_key": key}).status_code == 201
    assert claude.calls == []
    item = _items(client, "T-11", "T-12", "message")[-1]
    assert item["translated"] is True and item["by_ai"] is False


# ---------- hellos and renovation notices ----------

def _translations(text):
    return ai.NoticeTranslations(translations=[ai.NoticeTranslation(lang=lang, message=f"[{lang}] notice", scope=f"[{lang}] kitchen")
                                               for lang in ("en", "ms", "zh", "ta")])


def test_renovation_notice_reaches_each_neighbour_in_their_language(client, claude):
    claude.answers["NoticeTranslations"] = _translations
    sent = client.post("/api/intros", json={"from_unit_id": "T-12", "message": "Hi, we're extending the kitchen.", "lang": "en",
                                            "renovation": RENO}).json()
    assert "T-13" in sent["recipients"] and len(claude.calls) == 1
    kumar = _items(client, "T-13", "T-12", "intro")[-1]  # reads Tamil
    assert kumar["text"] == "[ta] notice" and kumar["renovation"]["scope"] == "[ta] kitchen"
    assert kumar["translated"] is True and kumar["by_ai"] is True
    assert kumar["original"] == "Hi, we're extending the kitchen." and kumar["original_scope"] == "Extend kitchen (rear wall)"
    siti = _items(client, "T-11", "T-12", "intro")[-1]  # reads Malay
    assert siti["text"] == "[ms] notice"
    own = _items(client, "T-12", "T-13", "intro")[-1]  # the owner sees what they wrote
    assert own["text"] == "Hi, we're extending the kitchen." and own["translated"] is False
    # The WhatsApp alert carries the work in the reader's language; the home log keeps the owner's own words.
    alerts = client.get("/api/units/T-13/whatsapp").json()["messages"]
    assert any("[ta] kitchen" in a["text"] for a in alerts)
    logged = next(e for e in client.get("/api/units/T-12/history").json()["events"] if e["type"] == "renovation_registered")
    assert logged["payload"]["scope"] == "Extend kitchen (rear wall)"
    # A home not on Keynection gets its printed notice in its own language too.
    for p in client.get("/api/estate/frontdesk").json()["paper_notices"]:
        assert p["message"] == f"[{p['lang']}] notice" if p["lang"] != "en" else p["message"] == "Hi, we're extending the kitchen."


def test_notice_goes_as_written_when_claude_cannot_answer(client, claude):
    claude.answers["NoticeTranslations"] = None
    assert client.post("/api/intros", json={"from_unit_id": "T-12", "message": "Hi, we're extending the kitchen.", "lang": "en",
                                            "renovation": RENO}).status_code == 201
    kumar = _items(client, "T-13", "T-12", "intro")[-1]
    assert kumar["text"] == "Hi, we're extending the kitchen." and kumar["translated"] is False


def test_a_hello_is_translated_too(client, claude):
    claude.answers["NoticeTranslations"] = _translations
    client.post("/api/intros", json={"from_unit_id": "T-12", "message": "Hi! We just moved in.", "lang": "en"})
    kumar = _items(client, "T-13", "T-12", "intro")[-1]
    assert kumar["text"] == "[ta] notice" and kumar["original"] == "Hi! We just moved in." and kumar["original_scope"] is None


# ---------- the real request, through the SDK, with the network replaced ----------

def _sdk(monkeypatch, handler):
    """Point the real client at a stand-in network: nothing leaves this computer."""
    import anthropic
    import httpx2

    client = anthropic.Anthropic(api_key="test-not-a-real-key", max_retries=0,
                                 http_client=anthropic.DefaultHttpxClient(transport=httpx2.MockTransport(handler)))
    monkeypatch.setattr(ai, "_client", client)


def _reply(answer, stop_reason="end_turn"):
    import json

    import httpx2

    return httpx2.Response(200, json={"id": "msg_test", "type": "message", "role": "assistant", "model": "claude-opus-5-5",
                                      "content": [{"type": "text", "text": json.dumps(answer)}], "stop_reason": stop_reason,
                                      "stop_sequence": None, "usage": {"input_tokens": 1, "output_tokens": 1}})


ANSWER = {"heated": False, "calmer": None, "calmer_translation": None, "translation": "Selamat pagi!"}


def test_the_request_claude_receives(monkeypatch):
    import json

    seen = []
    _sdk(monkeypatch, lambda request: seen.append(request) or _reply(ANSWER))
    assert ai.check_message("T-12", "Good morning!", "ms").translation == "Selamat pagi!"
    body = json.loads(seen[0].content)
    assert body["model"] == "claude-opus-5-5" and body["output_config"]["effort"] == "low"
    assert body["output_config"]["format"]["type"] == "json_schema"  # answers come back in fixed fields
    # If a safety check declines, the API retries on the model Anthropic recommends.
    assert body["fallbacks"] == "default" and seen[0].headers["anthropic-beta"] == "server-side-fallback-2026-07-01"
    assert "<message>\nGood morning!\n</message>" in body["messages"][0]["content"]


def test_an_account_without_the_fallback_option_still_gets_answers(monkeypatch):
    import json

    import httpx2

    seen = []

    def network(request):
        seen.append(json.loads(request.content))
        if "fallbacks" in seen[-1]:
            return httpx2.Response(400, json={"type": "error", "error": {"type": "invalid_request_error", "message": "fallbacks"}})
        return _reply(ANSWER)

    _sdk(monkeypatch, network)
    assert ai.check_message("T-12", "Good morning!", "ms").translation == "Selamat pagi!"
    assert ai.check_message("T-12", "See you!", "ms") is not None
    assert ["fallbacks" in b for b in seen] == [True, False, False]  # asked once with it, never again


def test_no_network_a_refusal_or_a_cut_off_answer_means_no_ai(monkeypatch):
    import httpx2

    def offline(request):
        raise httpx2.ConnectError("offline")

    _sdk(monkeypatch, offline)
    assert ai.check_message("T-12", "Good morning!", "ms") is None
    for stop in ("refusal", "max_tokens"):
        _sdk(monkeypatch, lambda request: _reply(ANSWER, stop_reason=stop))
        assert ai.check_message("T-12", f"Hello ({stop})", "ms") is None
