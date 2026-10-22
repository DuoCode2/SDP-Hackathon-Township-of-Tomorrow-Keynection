"""Everything a household is shown about its neighbourhood arrives in its own reading language: the estate office's
notices (in Chats and in the WhatsApp preview) and the one-line bios on the neighbour cards. The demo cast's wording
is the team's; what the estate team or a resident types later is translated by the AI, through a stand-in here."""
import re

import pytest
from fastapi.testclient import TestClient

from app import ai

TAMIL = re.compile(r"[஀-௿]")


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("KEYNECTION_DB_PATH", str(tmp_path / "test.db"))
    monkeypatch.setenv("KEYNECTION_DEMO_MODE", "1")
    monkeypatch.delenv("KEYNECTION_SITE_PASSWORD", raising=False)
    from app.main import app

    with TestClient(app) as c:
        yield c


class StandIn:
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


def _texts(*pairs):
    return ai.TextTranslations(translations=[ai.TextsIn(lang=lang, texts=list(texts)) for lang, texts in pairs])


def _neighbour(client, me, other):
    return next(n for n in client.get(f"/api/units/{me}/card").json()["neighbours"] if n["id"] == other)


# ---------- estate notices ----------

def test_demo_notices_reach_each_reader_in_their_language(client):
    kumar = client.get("/api/units/T-13/notices").json()  # reads Tamil
    assert kumar and all(n["translated"] and not n["by_ai"] and TAMIL.search(n["title"]) and TAMIL.search(n["body"]) for n in kumar)
    assert all(n["original"]["title"] and not TAMIL.search(n["original"]["title"]) for n in kumar)  # the English record comes along
    siti = client.get("/api/units/T-11/notices").json()  # reads Malay
    assert any(n["title"] == "Waktu ubah suai di Taman Demo" for n in siti)
    aiman = client.get("/api/units/T-12/notices").json()  # reads English: the record itself, nothing marked
    assert all(n["translated"] is False and "original" not in n for n in aiman)
    assert any(n["title"] == "Renovation hours in Taman Demo" for n in aiman)
    # The WhatsApp preview says the same, with no English body under a Tamil heading.
    alerts = [m for m in client.get("/api/units/T-13/whatsapp").json()["messages"] if m["kind"] == "notice"]
    assert alerts and all(TAMIL.search(m["text"]) for m in alerts)
    assert all("Drain clearing" not in m["text"] and "Noisy renovation" not in m["text"] for m in alerts)
    # And the estate office account in Chats.
    assert all(TAMIL.search(n["title"]) for n in client.get("/api/units/T-13/official").json()["notices"])


def test_a_notice_the_estate_team_posts_is_translated_after_it_is_saved(client, claude):
    claude.answers["TextTranslations"] = _texts(("ms", ["[ms] tajuk", "[ms] isi"]), ("zh", ["[zh] 标题", "[zh] 内容"]),
                                                ("ta", ["[ta] தலைப்பு", "[ta] உள்ளடக்கம்"]))
    r = client.post("/api/notices", json={"audience": "street:Jalan Demo 1", "title": "Lift servicing",
                                          "body": "Lift B is off on Monday morning."})
    assert r.status_code == 201 and r.json()["title"] == "Lift servicing" and r.json()["translated"] is False
    assert len(claude.calls) == 1 and "Lift servicing" in claude.calls[0]["text"] and "Lift B is off" in claude.calls[0]["text"]
    siti = client.get("/api/units/T-11/notices").json()[0]
    assert siti["title"] == "[ms] tajuk" and siti["body"] == "[ms] isi" and siti["translated"] and siti["by_ai"]
    assert siti["original"] == {"title": "Lift servicing", "body": "Lift B is off on Monday morning."}
    assert client.get("/api/units/T-12/notices").json()[0]["title"] == "Lift servicing"  # an English reader: the record
    assert client.get("/api/notices").json()[0]["title"] == "Lift servicing"  # the estate team: the record
    assert "translations" not in client.get("/api/notices").json()[0]
    kumar = next(m for m in client.get("/api/units/T-13/whatsapp").json()["messages"] if "[ta] தலைப்பு" in m["text"])
    assert "[ta] உள்ளடக்கம்" in kumar["text"]


def test_without_the_ai_a_new_notice_shows_its_english_record(client):
    client.post("/api/notices", json={"audience": "phase", "title": "Gate works", "body": "The side gate is closed this week."})
    n = client.get("/api/units/T-13/notices").json()[0]
    assert n["title"] == "Gate works" and n["body"] == "The side gate is closed this week." and n["translated"] is False


def test_a_language_whose_answer_does_not_line_up_is_left_out(client, claude):
    claude.answers["TextTranslations"] = _texts(("ms", ["only one line"]), ("zh", ["[zh] 标题", "[zh] 内容"]))
    client.post("/api/notices", json={"audience": "phase", "title": "Gate works", "body": "The side gate is closed this week."})
    assert client.get("/api/units/T-11/notices").json()[0]["title"] == "Gate works"  # Malay: dropped, the record instead
    assert client.get("/api/units/T-14/notices").json()[0]["title"] == "[zh] 标题"  # Wei Jie reads Chinese
    assert client.get("/api/units/T-13/notices").json()[0]["title"] == "Gate works"  # Tamil: not answered


def test_the_screens_language_can_ask_for_the_notices_in_it(client):
    # Aiman reads English; with the interface switched to Chinese his screens ask for the Chinese wording.
    zh = client.get("/api/units/T-12/notices", params={"lang": "zh"}).json()
    assert any(n["title"] == "Taman Demo 装修时段" and n["translated"] and n["original"]["title"] == "Renovation hours in Taman Demo" for n in zh)
    assert client.get("/api/units/T-12/official", params={"lang": "ms"}).json()["notices"][0]["title"].startswith(("Waktu", "Pembersihan"))
    assert client.get("/api/units/T-12/notices", params={"lang": "fr"}).status_code == 422
    # What WhatsApp sends stays in the household's own reading language whatever the screens show.
    assert all("Taman Demo 装修时段" not in m["text"] for m in client.get("/api/units/T-12/whatsapp").json()["messages"])


# ---------- bios ----------

def test_bios_come_in_every_reading_language_and_say_where_they_came_from(client):
    siti = _neighbour(client, "T-12", "T-11")  # writes Malay
    assert siti["bio"].startswith("Dua orang anak") and siti["bio_lang"] == "ms" and siti["bio_by_ai"] is False
    assert siti["bio_in"]["en"] == "Two kids and a cat. Say hi if you see us at the playground!"
    assert set(siti["bio_in"]) == {"en", "zh", "ta"}
    kumar = _neighbour(client, "T-12", "T-13")  # writes Tamil
    assert TAMIL.search(kumar["bio"]) and kumar["bio_lang"] == "ta" and kumar["bio_in"]["en"] == "Gardener. Ask me about mango trees."
    aiman = _neighbour(client, "T-11", "T-12")  # writes English
    assert aiman["bio_lang"] == "en" and set(aiman["bio_in"]) == {"ms", "zh", "ta"}
    not_joined = _neighbour(client, "T-12", "T-23")
    assert not_joined["bio"] == "" and not_joined["bio_in"] == {} and not_joined["bio_lang"] is None


def test_a_typed_bio_is_translated_and_new_words_start_over(client, claude):
    claude.answers["TextTranslations"] = lambda text: _texts(*((lang, [f"[{lang}] bio"]) for lang in ("ms", "zh", "ta")))
    client.put("/api/units/T-12/profile", json={"bio": "New here, ask me about fibre internet."})
    seen = _neighbour(client, "T-11", "T-12")
    assert seen["bio"] == "New here, ask me about fibre internet." and seen["bio_lang"] == "en"
    assert seen["bio_in"] == {"ms": "[ms] bio", "zh": "[zh] bio", "ta": "[ta] bio"} and seen["bio_by_ai"] is True
    assert "fibre internet" in claude.calls[-1]["text"] and "Tamil" in claude.calls[-1]["text"]
    claude.answers["TextTranslations"] = None  # no answer this time: the words as written, nothing stale kept
    client.put("/api/units/T-12/profile", json={"bio": "Changed my mind."})
    again = _neighbour(client, "T-11", "T-12")
    assert again["bio"] == "Changed my mind." and again["bio_in"] == {} and again["bio_by_ai"] is False
    asked = len(claude.calls)
    client.put("/api/units/T-12/profile", json={"bio": ""})
    assert len(claude.calls) == asked and _neighbour(client, "T-11", "T-12")["bio_lang"] is None  # an empty bio asks nothing


def test_the_bio_keeps_the_language_it_was_written_in(client):
    client.put("/api/units/T-11/profile", json={"lang": "en"})  # Siti switches her reading language later
    assert _neighbour(client, "T-12", "T-11")["bio_lang"] == "ms"  # her bio is still the Malay she wrote
