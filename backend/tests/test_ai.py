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
    monkeypatch.setenv("KEYNECTION_DB_PATH", str(tmp_path / "test.db"))
    monkeypatch.setenv("KEYNECTION_DEMO_MODE", "1")
    monkeypatch.delenv("KEYNECTION_SITE_PASSWORD", raising=False)
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
    monkeypatch.setattr(ai, "provider", lambda: "anthropic")
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
    assert client.get("/api/ai").json() == {"on": False, "model": None, "provider": None, "listen": False, "speak": False}
    r = client.post("/api/ai/renovation-draft", json={"unit_id": "T-12", "text": "Retiling the bathroom next week"})
    assert r.status_code == 501 and r.json()["detail"]["code"] == "ai_off"  # not 502-504: the app would say "can't reach"
    assert client.post("/api/messages", json={"from_unit_id": "T-12", "to_unit_id": "T-11", "body": "Good morning!"}).status_code == 201
    item = _items(client, "T-11", "T-12", "message")[-1]
    assert item["text"] == "Good morning!" and item["translated"] is False and item["by_ai"] is False


def test_status_names_the_model(client, claude):
    assert client.get("/api/ai").json() == {"on": True, "model": "claude-opus-5-5", "provider": "anthropic", "listen": False, "speak": False}


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


def test_the_description_says_only_what_the_work_is(client, claude):
    # Dates, hours and the contractor have their own fields: repeated in the description, every notice says them twice.
    for said, kept in (("Retiling the master bathroom, weekdays only, for two weeks", "Retiling the master bathroom"),
                       ("重铺浴室瓷砖，两个星期，平日 09:00–18:00", "重铺浴室瓷砖"),
                       ("Retile the master bathroom, ABC Renovation", "Retile the master bathroom, ABC Renovation")):
        claude.answers["RenovationDraft"] = _draft(scope=said)
        assert client.post("/api/ai/renovation-draft", json={"unit_id": "T-12", "text": "bathroom"}).json()["scope"] == kept
    assert "no dates, length, days, hours or contractor" in claude.calls[-1]["system"]


def test_the_why_only_names_neighbours_the_home_has(client, claude):
    claude.answers["RenovationDraft"] = _draft()
    client.post("/api/ai/renovation-draft", json={"unit_id": "T-12", "text": "Retiling the bathroom"})
    assert "a terrace house: nothing above or below it" in claude.calls[-1]["text"]
    assert "a terrace house has no home above or below it" in claude.calls[-1]["system"]
    client.post("/api/ai/renovation-draft", json={"unit_id": "A-15-3", "text": "Retiling the bathroom"})
    assert "homes above and below it" in claude.calls[-1]["text"]


def test_no_answer_means_fill_in_the_steps_yourself(client, claude):
    claude.answers["RenovationDraft"] = None
    r = client.post("/api/ai/renovation-draft", json={"unit_id": "T-12", "text": "bathroom next week"})
    assert r.status_code == 424 and r.json()["detail"]["code"] == "ai_busy"  # not 502-504: the app would say "can't reach"


def test_each_home_has_a_daily_ai_allowance(client, claude, monkeypatch):
    monkeypatch.setattr(ai, "CALLS_PER_HOME_PER_DAY", 2)
    claude.answers["RenovationDraft"] = _draft()
    for _ in range(2):
        assert client.post("/api/ai/renovation-draft", json={"unit_id": "T-12", "text": "bathroom"}).status_code == 200
    assert client.post("/api/ai/renovation-draft", json={"unit_id": "T-12", "text": "bathroom"}).status_code == 429
    assert client.post("/api/ai/renovation-draft", json={"unit_id": "T-11", "text": "bathroom"}).status_code == 200
    # Past the allowance a chat message still goes, as written.
    claude.answers["MessageCheck"] = ai.MessageCheck(insult=False, heated=False, calmer=None, calmer_translation=None, translation="Hai!")
    assert client.post("/api/messages", json={"from_unit_id": "T-12", "to_unit_id": "T-11", "body": "Hi!"}).status_code == 201
    assert _items(client, "T-11", "T-12", "message")[-1]["text"] == "Hi!"


# ---------- typed messages arrive in the reader's language ----------

def test_typed_message_arrives_in_the_readers_language(client, claude):
    claude.answers["MessageCheck"] = ai.MessageCheck(insult=False, heated=False, calmer=None, calmer_translation=None,
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
    claude.answers["MessageCheck"] = ai.MessageCheck(insult=False, heated=False, calmer=None, calmer_translation=None, translation="Hello!")
    client.post("/api/messages", json={"from_unit_id": "T-11", "to_unit_id": "T-12", "body": "Hello!"})
    item = _items(client, "T-12", "T-11", "message")[-1]
    assert item["text"] == "Hello!" and item["translated"] is False


def test_heated_message_gets_a_calmer_wording_first(client, claude):
    calmer = "Hi, the drilling started at 7am today. Could the workers start after 9, please?"
    claude.answers["MessageCheck"] = ai.MessageCheck(insult=False, heated=True, calmer=calmer, calmer_translation="Hai, gerudi bermula 7 pagi tadi...",
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
    claude.answers["MessageCheck"] = ai.MessageCheck(insult=False, heated=True, calmer=calmer, calmer_translation="Boleh pekerja mula selepas 9?",
                                                     translation="...")
    client.post("/api/messages", json={"from_unit_id": "T-12", "to_unit_id": "T-11", "body": "Stop drilling at 7am!!!"})
    assert client.post("/api/messages", json={"from_unit_id": "T-12", "to_unit_id": "T-11", "body": calmer}).status_code == 201
    assert _items(client, "T-11", "T-12", "message")[-1]["text"] == "Boleh pekerja mula selepas 9?"
    assert len(claude.calls) == 1


def test_insults_are_still_stopped_and_a_calmer_wording_offered(client, claude):
    claude.answers["MessageCheck"] = ai.MessageCheck(insult=False, heated=True, calmer="Please keep the noise down after 10pm.",
                                                     calmer_translation=None, translation="...")
    for keep in (False, True):
        r = client.post("/api/messages", json={"from_unit_id": "T-12", "to_unit_id": "T-11", "body": "Shut up, you idiot", "keep_tone": keep})
        assert r.status_code == 422 and r.json()["detail"]["code"] == "tone"
        assert r.json()["detail"]["suggestion"] == "Please keep the noise down after 10pm."


def test_an_insult_claude_recognises_is_refused_even_when_the_word_list_misses_it(client, claude):
    # Not on the word list, but abuse all the same: Claude says so, and the words are refused outright, with the
    # calmer wording offered. "Send mine anyway" (keep_tone) does not apply to an insult.
    claude.answers["MessageCheck"] = ai.MessageCheck(insult=True, heated=True, calmer="Could we talk about the noise?",
                                                     calmer_translation="Boleh kita bincang tentang bunyi itu?", translation="...")
    for keep in (False, True):
        r = client.post("/api/messages", json={"from_unit_id": "T-12", "to_unit_id": "T-11", "body": "You people are hopeless", "keep_tone": keep})
        assert r.status_code == 422 and r.json()["detail"]["code"] == "tone"
        assert r.json()["detail"]["suggestion"] == "Could we talk about the noise?"
    assert _items(client, "T-11", "T-12", "message") == []  # nothing was sent
    assert len(claude.calls) == 1  # the same words are judged once
    assert "insult" in claude.calls[0]["system"]  # Claude is asked for that judgement, not only whether it sounds heated
    # The calmer wording itself goes through without a second look.
    assert client.post("/api/messages", json={"from_unit_id": "T-12", "to_unit_id": "T-11", "body": "Could we talk about the noise?"}).status_code == 201
    assert len(claude.calls) == 1


def test_a_calmer_wording_keeps_every_fact_and_question_and_adds_nothing():
    # Seen with the real AI: "Tak reti hormat jiran ke?" dropped, and "sejak tadi" (for a while now) added.
    assert "calmer must keep every fact and every question of the original" in ai.CHAT_SYSTEM
    assert "never add a time, an amount or a reason the original did not have" in ai.CHAT_SYSTEM
    assert "If it cannot do both, calmer is null" in ai.CHAT_SYSTEM


def test_heated_but_not_an_insult_stays_a_suggestion(client, claude):
    claude.answers["MessageCheck"] = ai.MessageCheck(insult=False, heated=True, calmer="Could the drilling start later?",
                                                     calmer_translation="...", translation="...")
    r = client.post("/api/messages", json={"from_unit_id": "T-12", "to_unit_id": "T-11", "body": "Drilling at 7am AGAIN. Unbelievable.", "keep_tone": True})
    assert r.status_code == 201


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
    # Works and Photos say the same work as the chat does, in the reader's language; the owner keeps their words.
    near = client.get("/api/units/T-13/works").json()["nearby"][0]["renovation"]
    assert near["scope"] == "[ta] kitchen" and near["original_scope"] == "Extend kitchen (rear wall)"
    task = next(x for x in client.get("/api/units/T-11/evidence").json()["renovations"] if not x["mine"])
    assert task["renovation"]["scope"] == "[ms] kitchen"
    assert client.get("/api/units/T-12/works").json()["mine"][0]["renovation"]["scope"] == "Extend kitchen (rear wall)"


def test_the_notice_is_saved_and_answered_before_it_is_translated(client, claude, tmp_path):
    import sqlite3

    seen = []

    def translate(text):  # what the database holds at the moment the AI is asked
        db = sqlite3.connect(tmp_path / "test.db")
        seen.append(db.execute("SELECT message, translations FROM intros ORDER BY id DESC LIMIT 1").fetchone())
        db.close()
        return _translations(text)

    claude.answers["NoticeTranslations"] = translate
    sent = client.post("/api/intros", json={"from_unit_id": "T-12", "message": "Hi, we're extending the kitchen.", "lang": "en",
                                            "renovation": RENO})
    assert sent.status_code == 201
    assert seen == [("Hi, we're extending the kitchen.", None)]  # already saved, not yet translated
    assert _items(client, "T-13", "T-12", "intro")[-1]["text"] == "[ta] notice"  # written back once it came


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


ANSWER = {"insult": False, "heated": False, "calmer": None, "calmer_translation": None, "translation": "Selamat pagi!"}


def test_the_request_claude_receives(monkeypatch):
    import json

    seen = []
    _sdk(monkeypatch, lambda request: seen.append(request) or _reply(ANSWER))
    assert ai.check_message("T-12", "Good morning!", "ms").translation == "Selamat pagi!"
    body = json.loads(seen[0].content)
    assert body["model"] == "claude-opus-5-5" and body["output_config"]["effort"] == "low" and body["max_tokens"] == 800
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


def test_a_request_turned_down_for_another_reason_keeps_the_fallback_and_logs_why(monkeypatch, caplog):
    import json

    import httpx2

    monkeypatch.setattr(ai, "_use_fallback", True)
    seen = []

    def network(request):
        seen.append(json.loads(request.content))
        return httpx2.Response(400, json={"type": "error", "error": {"type": "invalid_request_error",
                                                                      "message": "Your credit balance is too low"}})

    _sdk(monkeypatch, network)
    with caplog.at_level("WARNING", logger="keynection.ai"):
        assert ai.check_message("T-12", "Good evening!", "ms") is None
        assert ai.check_message("T-12", "Good night!", "ms") is None
    assert ["fallbacks" in b for b in seen] == [True, False, True, False]  # the option was not the reason: kept
    assert "Your credit balance is too low" in caplog.text and "fallback option was refused" not in caplog.text


def test_other_answers_from_the_api_are_logged_with_their_reason(monkeypatch, caplog):
    import httpx2

    _sdk(monkeypatch, lambda request: httpx2.Response(402, json={"type": "error", "error": {
        "type": "billing_error", "message": "Add credit to continue"}}))
    with caplog.at_level("WARNING", logger="keynection.ai"):
        assert ai.check_message("T-12", "Good afternoon!", "ms") is None
    assert "Claude answered 402" in caplog.text and "Add credit to continue" in caplog.text


def test_a_late_answer_is_dropped_at_the_deadline_and_every_answer_is_logged(monkeypatch, caplog):
    import time

    def slow(request):
        time.sleep(1.5)
        return _reply(ANSWER)

    _sdk(monkeypatch, slow)
    started = time.monotonic()
    with caplog.at_level("WARNING", logger="keynection.ai"):
        assert ai._ask_claude(ai.CHAT_SYSTEM, "Good evening", ai.MessageCheck, effort="low", max_tokens=800, timeout=0.3) is None
    assert time.monotonic() - started < 1.0 and "took longer than 0.3s" in caplog.text
    _sdk(monkeypatch, lambda request: _reply(ANSWER))
    with caplog.at_level("INFO", logger="keynection.ai"):
        assert ai.check_message("T-12", "Good morning, neighbour!", "ms") is not None
    assert "Claude MessageCheck:" in caplog.text and "1 tokens in, 1 out" in caplog.text


def test_no_network_a_refusal_or_a_cut_off_answer_means_no_ai(monkeypatch):
    import httpx2

    def offline(request):
        raise httpx2.ConnectError("offline")

    _sdk(monkeypatch, offline)
    assert ai.check_message("T-12", "Good morning!", "ms") is None
    for stop in ("refusal", "max_tokens"):
        _sdk(monkeypatch, lambda request: _reply(ANSWER, stop_reason=stop))
        assert ai.check_message("T-12", f"Hello ({stop})", "ms") is None


# ---------- Gemini, Google's free tier: the demo only ----------

def test_which_service_answers(monkeypatch):
    for name in ("ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "GEMINI_API_KEY", "KEYNECTION_AI", "KEYNECTION_GEMINI_MODEL"):
        monkeypatch.delenv(name, raising=False)
    assert ai.provider() is None and ai.status() == {"on": False, "model": None, "provider": None}
    monkeypatch.setenv("GEMINI_API_KEY", "test-not-a-real-key")
    assert ai.provider() == "gemini" and ai.model_name() == "gemini-3.5-flash"
    monkeypatch.setenv("KEYNECTION_GEMINI_MODEL", "gemini-3.6-flash")
    assert ai.status() == {"on": True, "model": "gemini-3.6-flash", "provider": "gemini"}
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test-not-a-real-key")
    assert ai.provider() == "anthropic" and ai.model_name() == "claude-opus-5-5"  # Claude first when it has a key
    monkeypatch.delenv("ANTHROPIC_API_KEY")
    monkeypatch.setenv("KEYNECTION_DEMO_MODE", "0")
    assert ai.provider() is None  # a pilot never sends residents' words to a free tier that learns from them
    monkeypatch.setenv("KEYNECTION_DEMO_MODE", "1")
    monkeypatch.setenv("KEYNECTION_AI", "0")
    assert ai.provider() is None


def _gemini_sdk(monkeypatch, handler):
    """Point a real Gemini client at a stand-in network: nothing leaves this computer."""
    import httpx
    from google import genai
    from google.genai import types

    monkeypatch.setenv("GEMINI_API_KEY", "test-not-a-real-key")
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.delenv("ANTHROPIC_AUTH_TOKEN", raising=False)
    client = genai.Client(api_key="test-not-a-real-key",
                          http_options=types.HttpOptions(httpx_client=httpx.Client(transport=httpx.MockTransport(handler))))
    monkeypatch.setattr(ai, "_gemini_client", client)


def _gemini_reply(answer, finish="STOP"):
    import json

    import httpx

    return httpx.Response(200, json={"candidates": [{"content": {"role": "model", "parts": [{"text": json.dumps(answer)}]},
                                                     "finishReason": finish}]})


def test_the_request_gemini_receives(monkeypatch):
    import json

    seen = []
    _gemini_sdk(monkeypatch, lambda request: seen.append(request) or _gemini_reply(ANSWER))
    assert ai.check_message("T-12", "Good morning, Gemini!", "ms").translation == "Selamat pagi!"
    assert seen[0].url.path.endswith("/models/gemini-3.5-flash:generateContent")
    body = json.loads(seen[0].content)
    config = body["generationConfig"]
    assert config["responseMimeType"] == "application/json" and config["responseSchema"]["title"] == "MessageCheck"
    assert config["thinkingConfig"] == {"thinking_level": "LOW"} and config["maxOutputTokens"] == 800
    assert "systemInstruction" in body and "Good morning, Gemini!" in body["contents"][0]["parts"][0]["text"]
    assert "T-12" not in json.dumps(body)  # the words only: never the home


def test_with_gemini_a_failure_still_means_no_ai(monkeypatch, caplog):
    import httpx

    def limit(request):
        return httpx.Response(429, json={"error": {"code": 429, "message": "Quota exceeded for the free tier",
                                                   "status": "RESOURCE_EXHAUSTED"}})

    def offline(request):
        raise httpx.ConnectError("offline")

    _gemini_sdk(monkeypatch, limit)
    with caplog.at_level("WARNING", logger="keynection.ai"):
        assert ai.check_message("T-12", "Hello (limit)", "ms") is None
    assert "Gemini answered 429" in caplog.text and "Quota exceeded" in caplog.text
    _gemini_sdk(monkeypatch, offline)
    assert ai.check_message("T-12", "Hello (offline)", "ms") is None
    for finish in ("SAFETY", "MAX_TOKENS"):
        _gemini_sdk(monkeypatch, lambda request: _gemini_reply(ANSWER, finish=finish))
        assert ai.check_message("T-12", f"Hello ({finish})", "ms") is None
    _gemini_sdk(monkeypatch, lambda request: _gemini_reply({"not": "the right shape"}))
    assert ai.check_message("T-12", "Hello (wrong shape)", "ms") is None


def test_with_gemini_a_busy_moment_is_tried_once_more(monkeypatch, caplog):
    """The free tier answers 503 ("high demand") now and then and is fine a moment later: one more try, then as before."""
    import httpx

    monkeypatch.setattr(ai, "GEMINI_RETRY_WAIT", 0)
    seen = []

    def busy_once(request):
        seen.append(request)
        if len(seen) == 1:
            return httpx.Response(503, json={"error": {"code": 503, "status": "UNAVAILABLE",
                                                       "message": "This model is currently experiencing high demand."}})
        return _gemini_reply(ANSWER)

    _gemini_sdk(monkeypatch, busy_once)
    with caplog.at_level("WARNING", logger="keynection.ai"):
        assert ai.check_message("T-12", "Morning! Is the lane clear today?", "ms").translation == "Selamat pagi!"
    assert len(seen) == 2 and "trying once more" in caplog.text


def test_with_gemini_two_busy_answers_mean_no_ai(monkeypatch):
    import httpx

    monkeypatch.setattr(ai, "GEMINI_RETRY_WAIT", 0)
    seen = []
    _gemini_sdk(monkeypatch, lambda request: seen.append(request) or httpx.Response(503, json={"error": {
        "code": 503, "status": "UNAVAILABLE", "message": "This model is currently experiencing high demand."}}))
    assert ai.check_message("T-12", "Morning! Is the lane still blocked?", "ms") is None
    assert len(seen) == 2  # one retry, not a loop: a person is waiting


def test_the_demo_with_gemini_shows_the_notice_that_names_google(client, monkeypatch):
    from app.seed import CONSENT_VERSION_AI_GEMINI

    monkeypatch.setenv("GEMINI_API_KEY", "test-not-a-real-key")
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    assert client.get("/api/ai").json() == {"on": True, "model": "gemini-3.5-flash", "provider": "gemini", "listen": False, "speak": False}
    token = client.post("/api/units/T-23/join-code").json()["token"]
    assert client.post("/api/join/lookup", json={"token": token}).json()["consent_version"] == CONSENT_VERSION_AI_GEMINI


# ---------- through DuoCode's LLM gateway (ANTHROPIC_BASE_URL) ----------

GATEWAY = "https://llm.gateway.invalid"


def test_through_the_gateway_each_kind_of_call_names_its_group(monkeypatch):
    for name in ("ANTHROPIC_BASE_URL", "KEYNECTION_AI_MODEL", *(env for env, _ in ai.GATEWAY_MODELS.values())):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setattr(ai, "provider", lambda: "anthropic")
    assert ai.model_name("chat-check") == ai.DEFAULT_MODEL, "Anthropic's own API: the model, as before"
    monkeypatch.setenv("ANTHROPIC_BASE_URL", "https://api.anthropic.com")
    assert not ai.through_gateway() and ai.model_name("notice") == ai.DEFAULT_MODEL
    monkeypatch.setenv("ANTHROPIC_BASE_URL", GATEWAY)
    assert ai.through_gateway()
    assert {p: ai.model_name(p) for p in ai.GATEWAY_MODELS} == {
        "notice": "keynection/notice", "chat-check": "keynection/chat-check",
        "translate": "keynection/translate", "assistant": "keynection/assistant"}
    monkeypatch.setenv("KEYNECTION_AI_MODEL_TRANSLATE", "keynection/other")
    assert ai.model_name("translate") == "keynection/other"
    assert ai.status()["model"] == "keynection/notice"


def test_every_call_names_its_purpose(client, claude, monkeypatch):
    seen = []
    real = claude.__call__

    def recording(system, text, schema, **options):
        seen.append((schema.__name__, options.get("purpose")))
        return real(system, text, schema, **options)

    monkeypatch.setattr(ai, "_ask", recording)
    ai.check_message("T-12", "Good morning", "ms")
    ai.translate_texts("T-12", ["Hello"], {"ms"}, what="bio")
    want = {"MessageCheck": "chat-check", "TextTranslations": "translate"}
    assert seen and all(want.get(s, p) == p for s, p in seen) and {s for s, _ in seen} >= set(want), seen
    import inspect
    source = inspect.getsource(ai)
    for purpose in ai.GATEWAY_MODELS:
        assert f'purpose="{purpose}"' in source, f"no call names {purpose}"


def test_the_request_through_the_gateway_names_the_group_and_asks_no_fallback_beta(monkeypatch):
    import json

    sent = []

    def handler(request):
        sent.append({"body": json.loads(request.content), "beta": request.headers.get("anthropic-beta", "")})
        return _reply(ANSWER)

    monkeypatch.setenv("ANTHROPIC_BASE_URL", GATEWAY)
    monkeypatch.setattr(ai, "provider", lambda: "anthropic")
    monkeypatch.setattr(ai, "_use_fallback", True)
    _sdk(monkeypatch, handler)
    assert ai._ask_claude(ai.CHAT_SYSTEM, "Good evening", ai.MessageCheck, effort="low", max_tokens=800, timeout=10,
                          purpose="chat-check") is not None
    assert sent and sent[0]["body"]["model"] == "keynection/chat-check"
    assert "server-side-fallback" not in sent[0]["beta"], "the gateway's group does the falling back"


# ---------- through the gateway: the group, never the model id (review of 2026-11-16) ----------

def test_gateway_mode_names_the_group_even_when_production_names_a_model(monkeypatch):
    # Production sets KEYNECTION_AI_MODEL=claude-sonnet-5-5. Through the gateway the key allows only keynection/*, so
    # sending that model id would be refused and every AI call would quietly come back empty.
    monkeypatch.setenv("ANTHROPIC_BASE_URL", "https://llm.example.test")
    monkeypatch.setenv("KEYNECTION_AI_MODEL", "claude-sonnet-5-5")
    for purpose in ("notice", "chat-check", "translate", "assistant"):
        assert ai.model_name(purpose) == f"keynection/{purpose}"
    monkeypatch.delenv("ANTHROPIC_BASE_URL")
    assert ai.model_name("chat-check") == "claude-sonnet-5-5"


@pytest.mark.parametrize("base, gateway", [
    ("https://api.anthropic.com", False), ("https://api.anthropic.com/v1", False), ("https://API.anthropic.com/", False),
    ("https://llm.sunflowerstech.weiliu.me", True), ("https://api.anthropic.com.example.test", True), ("", False)])
def test_only_anthropics_own_host_is_direct(monkeypatch, base, gateway):
    monkeypatch.setenv("ANTHROPIC_BASE_URL", base)
    assert ai.through_gateway() is gateway


# ---------- each home's daily allowance: calls and dollars, kept across a restart ----------

def test_a_call_is_counted_at_its_worst_case(monkeypatch):
    # Every byte sent counts as a token, and the whole output allowance as written, at the answering model's price.
    monkeypatch.setenv("ANTHROPIC_BASE_URL", "https://llm.example.test")
    assert ai.worst_usd("ab", 10, "chat-check") == pytest.approx((2 * 2.0 + 10 * 10.0) / 1e6)  # Sonnet 5.5
    assert ai.worst_usd("你好", 0, "chat-check") == pytest.approx(6 * 2.0 / 1e6)  # six bytes of UTF-8
    monkeypatch.delenv("ANTHROPIC_BASE_URL")
    monkeypatch.setenv("KEYNECTION_AI_MODEL", "claude-opus-5-5")
    assert ai.worst_usd("ab", 10, "notice") == pytest.approx((2 * 4.0 + 10 * 20.0) / 1e6)
    monkeypatch.setenv("KEYNECTION_AI_MODEL", "claude-fable-5-1")  # no price here: counted at the dearest
    assert ai.worst_usd("ab", 10, "notice") == pytest.approx((2 * 5.0 + 10 * 25.0) / 1e6)


def test_a_home_is_held_to_its_daily_dollars(client, claude, monkeypatch):
    claude.answers["RenovationDraft"] = _draft()
    monkeypatch.setenv("KEYNECTION_AI_HOME_DAILY_USD", str(ai.renovation_usd("bathroom") * 1.5))
    assert client.post("/api/ai/renovation-draft", json={"unit_id": "T-12", "text": "bathroom"}).status_code == 200
    # It has calls left, but a second would take it past its dollars.
    assert client.post("/api/ai/renovation-draft", json={"unit_id": "T-12", "text": "bathroom"}).status_code == 429
    assert client.post("/api/ai/renovation-draft", json={"unit_id": "T-11", "text": "bathroom"}).status_code == 200


def test_the_allowance_outlives_a_restart(client, claude, monkeypatch):
    monkeypatch.setattr(ai, "CALLS_PER_HOME_PER_DAY", 1)
    claude.answers["RenovationDraft"] = _draft()
    assert client.post("/api/ai/renovation-draft", json={"unit_id": "T-12", "text": "bathroom"}).status_code == 200
    assert client.post("/api/ai/renovation-draft", json={"unit_id": "T-12", "text": "bathroom"}).status_code == 429
    ai.reset()  # what a restart forgets: everything held in memory
    from app.main import app

    with TestClient(app) as again:  # the same database, the server started afresh
        assert again.post("/api/ai/renovation-draft", json={"unit_id": "T-12", "text": "bathroom"}).status_code == 429
        assert again.post("/api/ai/renovation-draft", json={"unit_id": "T-11", "text": "bathroom"}).status_code == 200


# ---------- a fall-back to the word list is heard about, not silent ----------

@pytest.fixture()
def relay(monkeypatch):
    """A stand-in for the ntfy relay on this computer: what the site would push, nothing leaves it."""
    import http.server
    import json
    import threading

    got: list[dict] = []

    class Handler(http.server.BaseHTTPRequestHandler):
        def do_POST(self):
            got.append({"auth": self.headers.get("Authorization"),
                        "body": json.loads(self.rfile.read(int(self.headers["Content-Length"])))})
            self.send_response(200)
            self.end_headers()

        def log_message(self, *args):
            pass

    server = http.server.HTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    monkeypatch.setenv("KEYNECTION_DEMO_MODE", "0")
    monkeypatch.setenv("KEYNECTION_ALERT_URL", f"http://127.0.0.1:{server.server_port}/")
    monkeypatch.setenv("KEYNECTION_ALERT_TOKEN", "test-relay-token")
    yield got
    server.shutdown()


def _settle(got, n):
    import time

    deadline = time.monotonic() + 5
    while len(got) < n and time.monotonic() < deadline:
        time.sleep(0.02)
    time.sleep(0.3)  # and long enough for a push that should not have been sent to arrive
    return got


def test_an_ai_that_cannot_be_reached_alerts_once_an_hour(monkeypatch, relay):
    import httpx2

    def unreachable(request):
        raise httpx2.ConnectError("no route to the AI")

    _sdk(monkeypatch, unreachable)
    assert ai.check_message("T-12", "Good morning!", "ms") is None
    assert ai.check_message("T-12", "Good evening!", "ms") is None  # the same outage: no second push
    assert len(_settle(relay, 1)) == 1
    assert relay[0]["auth"] == "Bearer test-relay-token"
    assert "not answering" in relay[0]["body"]["title"] and "word list only" in relay[0]["body"]["message"]


def test_a_home_past_its_allowance_alerts_once_a_day(monkeypatch, relay):
    monkeypatch.setattr(ai, "CALLS_PER_HOME_PER_DAY", 1)
    assert ai.spend("T-12", 0.001) is True
    assert ai.spend("T-12", 0.001) is False
    assert ai.spend("T-12", 0.001) is False
    assert len(_settle(relay, 1)) == 1 and "T-12" in relay[0]["body"]["title"]
    assert ai.spend("T-11", 1000.0) is False  # past its dollars on the first call: its own alert
    assert len(_settle(relay, 2)) == 2 and "T-11" in relay[1]["body"]["title"]


def test_without_relay_settings_an_alert_is_only_logged(monkeypatch, caplog):
    import logging

    from app import opsalert

    monkeypatch.setenv("KEYNECTION_DEMO_MODE", "0")
    with caplog.at_level(logging.WARNING, logger="keynection.alert"):
        assert opsalert.notify("ai_unavailable", "Keynection: the AI is not answering", "test") is None
    assert "ALERT ai_unavailable" in caplog.text


def test_a_message_checked_by_the_word_list_only_says_so_in_the_log(client, claude, caplog):
    import logging

    claude.answers["MessageCheck"] = None
    with caplog.at_level(logging.WARNING, logger="keynection"):
        assert client.post("/api/messages", json={"from_unit_id": "T-12", "to_unit_id": "T-11", "body": "Hi there"}).status_code == 201
    assert "checked by the word list only" in caplog.text
