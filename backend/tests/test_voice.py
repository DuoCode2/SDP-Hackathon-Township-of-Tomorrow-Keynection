"""The assistant's voice on the server, through the LLM gateway: listening for a browser that cannot (the recording goes
to Deepgram's Nova-3 and only the words come back) and speaking the assistant's English replies (Deepgram's Aura-2).
Every test uses a stand-in for the gateway; none reaches the network."""
import logging

import httpx
import pytest
from fastapi.testclient import TestClient

from app import voice

KEY = "sk-test-gateway-key-not-real"
WEBM = b"\x1a\x45\xdf\xa3" + b"\x00" * 2000  # starts the way a WebM recording does (Chrome, Edge)
OGG = b"OggS" + b"\x00" * 2000  # Firefox
MP3 = b"ID3" + b"\x00" * 3000  # what the gateway sends back for speech


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("KEYNECTION_DB_PATH", str(tmp_path / "test.db"))
    monkeypatch.setenv("KEYNECTION_DEMO_MODE", "1")
    from app.main import app

    with TestClient(app) as c:
        yield c


class Gateway:
    """Answers in place of the gateway, and keeps what was sent to it."""

    def __init__(self) -> None:
        self.sent: list[dict] = []
        self.status, self.body, self.error = 200, {"text": " retiling the bathroom next monday "}, None
        self.speech_status, self.speech_type, self.speech = 200, "audio/mpeg", MP3

    def __call__(self, url, *, headers, timeout, data=None, files=None, json=None):
        self.sent.append({"url": url, "headers": headers, "data": data, "files": files, "json": json, "timeout": timeout})
        if self.error:
            raise self.error
        request = httpx.Request("POST", url)
        if url.endswith("/audio/speech"):
            return httpx.Response(self.speech_status, content=self.speech, headers={"content-type": self.speech_type}, request=request)
        return httpx.Response(self.status, json=self.body, request=request)


@pytest.fixture()
def gateway(monkeypatch):
    monkeypatch.setenv("KEYNECTION_VOICE_KEY", KEY)
    stand_in = Gateway()
    monkeypatch.setattr(voice.httpx, "post", stand_in)
    return stand_in


def _say(client, audio=WEBM, kind="audio/webm;codecs=opus", unit="T-12", lang="en", duration="3.2"):
    return client.post("/api/assistant/transcribe", data={"unit_id": unit, "lang": lang, "duration": duration},
                       files={"file": ("speech", audio, kind)})


def _speak(client, text="Your renovation notice reached five homes.", lang="en", unit="T-12"):
    return client.post("/api/assistant/speak", json={"unit_id": unit, "text": text, "lang": lang})


# ---------- listening ----------

def test_off_without_a_key_and_the_app_is_told(client):
    status = client.get("/api/ai").json()
    assert status["listen"] is False and status["speak"] is False
    r = _say(client)
    assert r.status_code == 501 and r.json()["detail"]["code"] == "stt_off"
    r = _speak(client)
    assert r.status_code == 501 and r.json()["detail"]["code"] == "tts_off"


def test_the_words_come_back_and_only_the_recording_and_language_go(client, gateway):
    status = client.get("/api/ai").json()
    assert status["listen"] is True and status["speak"] is True
    r = _say(client, lang="ms")
    assert r.status_code == 200 and r.json() == {"text": "retiling the bathroom next monday"}
    (sent,) = gateway.sent
    assert sent["url"] == "https://llm.duocodetech.com/v1/audio/transcriptions"
    assert sent["headers"] == {"Authorization": f"Bearer {KEY}"}
    # Model and language only: the gateway's Deepgram route refuses a prompt (400), and no names or homes go.
    assert sent["data"] == {"model": "deepgram/nova-3", "detect_language": "ms"}
    assert sent["files"]["file"] == ("speech", WEBM, "audio/webm")


@pytest.mark.parametrize("lang, code", [("ms", "ms"), ("zh", "zh"), ("en", None), ("ta", None), (None, None), ("xx", None)])
def test_each_reading_language_reaches_deepgram_the_way_the_gateway_passes_on(client, gateway, lang, code):
    """`language` would be dropped by the gateway, so it is never sent; Malay and Chinese go as Deepgram's own
    detect_language, limited to that one language. English is Deepgram's default; Tamil it cannot be told."""
    data = {"unit_id": "T-12", "duration": "2"} | ({"lang": lang} if lang else {})
    assert client.post("/api/assistant/transcribe", data=data, files={"file": ("speech", OGG, "audio/ogg")}).status_code == 200
    sent = gateway.sent[-1]["data"]
    assert "language" not in sent
    assert sent.get("detect_language") == code


def test_the_gateway_address_and_models_can_be_changed(client, gateway, monkeypatch):
    monkeypatch.setenv("KEYNECTION_VOICE_URL", "https://llm-backup.example/v1/")
    monkeypatch.setenv("KEYNECTION_STT_MODEL", "deepgram/nova-3-general")
    monkeypatch.setenv("KEYNECTION_TTS_MODEL", "deepgram/aura-2-gb")
    monkeypatch.setenv("KEYNECTION_TTS_VOICE", "aura-2-draco-en")
    assert _say(client).status_code == 200
    assert gateway.sent[-1]["url"] == "https://llm-backup.example/v1/audio/transcriptions"
    assert gateway.sent[-1]["data"]["model"] == "deepgram/nova-3-general"
    assert _speak(client).status_code == 200
    assert gateway.sent[-1]["url"] == "https://llm-backup.example/v1/audio/speech"
    assert gateway.sent[-1]["json"]["model"] == "deepgram/aura-2-gb" and gateway.sent[-1]["json"]["voice"] == "aura-2-draco-en"


@pytest.mark.parametrize("audio, kind, status", [
    (WEBM, "text/plain", 415),  # not audio at all
    (b"<html>" + b"\x00" * 2000, "audio/webm", 415),  # says audio, isn't
    (OGG, "audio/webm", 415),  # one format claiming to be another
    (b"\x1a\x45\xdf\xa3", "audio/webm", 400),  # empty
    (b"\x1a\x45\xdf\xa3" + b"\x00" * voice.MAX_BYTES, "audio/webm", 413),  # longer than one sentence
])
def test_only_a_short_real_recording_is_passed_on(client, gateway, audio, kind, status):
    assert _say(client, audio=audio, kind=kind).status_code == status
    assert gateway.sent == []  # refused before anything reaches the gateway


def test_a_clip_longer_than_one_sentence_is_refused(client, gateway):
    assert _say(client, duration=str(voice.MAX_SECONDS + 1)).status_code == 422
    assert gateway.sent == []


def test_each_home_has_a_daily_allowance_and_others_keep_theirs(client, gateway):
    for _ in range(voice.CLIPS_PER_HOME_PER_DAY):
        assert _say(client).status_code == 200
    r = _say(client)
    assert r.status_code == 429 and "Typing works" in r.json()["detail"]
    assert len(gateway.sent) == voice.CLIPS_PER_HOME_PER_DAY  # the refused one never reached the gateway
    assert _say(client, unit="T-13").status_code == 200


def test_a_refused_clip_does_not_use_up_the_allowance(client, gateway):
    for _ in range(voice.CLIPS_PER_HOME_PER_DAY + 5):
        assert _say(client, kind="text/plain").status_code == 415
    assert _say(client).status_code == 200


@pytest.mark.parametrize("status, body, error, logged", [
    (401, {"error": {"message": "Authentication Error, Invalid proxy server token passed"}}, None, "401 (Authentication Error"),
    (400, {"error": {"message": "budget exceeded for key"}}, None, "400 (budget exceeded"),
    (200, {"text": "   "}, None, None),  # nothing heard
    (200, {"words": []}, None, None),  # no text in the answer
    (200, None, httpx.ConnectTimeout("timed out"), "could not be reached (ConnectTimeout)"),
])
def test_no_answer_says_so_and_the_log_says_why_without_the_key(client, gateway, caplog, status, body, error, logged):
    gateway.status, gateway.body, gateway.error = status, body, error
    with caplog.at_level(logging.WARNING, logger="keynection.voice"):
        r = _say(client)
    assert r.status_code == 424 and r.json()["detail"]["code"] == "stt_busy"
    if logged:
        assert logged in caplog.text
    else:
        assert caplog.text == ""
    assert KEY not in caplog.text


# ---------- speaking ----------

def test_an_english_reply_is_spoken_and_only_the_words_go(client, gateway):
    r = _speak(client)
    assert r.status_code == 200 and r.headers["content-type"] == "audio/mpeg" and r.content == MP3
    (sent,) = gateway.sent
    assert sent["url"] == "https://llm.duocodetech.com/v1/audio/speech"
    assert sent["headers"] == {"Authorization": f"Bearer {KEY}"}
    assert sent["json"] == {"model": "deepgram/aura-2", "input": "Your renovation notice reached five homes.",
                            "voice": "aura-2-thalia-en", "response_format": "mp3"}


@pytest.mark.parametrize("lang", ["ms", "zh", "ta"])
def test_malay_chinese_and_tamil_are_left_to_the_browser(client, gateway, lang):
    r = _speak(client, text="Notis anda sudah sampai.", lang=lang)
    assert r.status_code == 422 and r.json()["detail"]["code"] == "tts_lang"
    assert gateway.sent == []


def test_a_long_reply_is_cut_at_a_sentence_and_never_past_the_limit(client, gateway):
    sentence = "Your renovation notice reached five homes and the estate office printed one more for No. 23. "
    r = _speak(client, text=sentence * 10)
    assert r.status_code == 200
    said = gateway.sent[-1]["json"]["input"]
    assert len(said) <= voice.MAX_SPOKEN_CHARS and said.endswith("No. 23.")
    one_word = "a" * 1500
    assert _speak(client, text=f"{one_word} b").status_code == 200
    assert len(gateway.sent[-1]["json"]["input"]) <= voice.MAX_SPOKEN_CHARS + 1


def test_the_same_reply_is_spoken_from_memory_not_bought_twice(client, gateway):
    assert _speak(client).content == MP3
    assert _speak(client, unit="T-13").content == MP3
    assert len(gateway.sent) == 1


def test_each_home_has_a_daily_allowance_for_spoken_replies(client, gateway):
    for i in range(voice.REPLIES_SPOKEN_PER_HOME_PER_DAY):
        assert _speak(client, text=f"Reply number {i}.").status_code == 200
    r = _speak(client, text="One more.")
    assert r.status_code == 429 and "on screen" in r.json()["detail"]
    assert len(gateway.sent) == voice.REPLIES_SPOKEN_PER_HOME_PER_DAY
    assert _speak(client, text="Reply number 0.").status_code == 200  # already spoken: from memory, free
    assert _speak(client, text="One more.", unit="T-13").status_code == 200


@pytest.mark.parametrize("status, kind, content, error, logged", [
    (401, "application/json", b'{"error": {"message": "key not allowed to access model"}}', None, "401 (key not allowed"),
    (200, "application/json", b'{"ok": true}', None, "200"),  # not audio
    (200, "audio/mpeg", b"ID3", None, "200"),  # too short to be speech
    (200, "audio/mpeg", MP3, httpx.ReadTimeout("slow"), "could not be reached (ReadTimeout)"),
])
def test_no_speech_says_so_and_the_log_says_why_without_the_key(client, gateway, caplog, status, kind, content, error, logged):
    gateway.speech_status, gateway.speech_type, gateway.speech, gateway.error = status, kind, content, error
    with caplog.at_level(logging.WARNING, logger="keynection.voice"):
        r = _speak(client)
    assert r.status_code == 424 and r.json()["detail"]["code"] == "tts_busy"
    assert logged in caplog.text and KEY not in caplog.text
    gateway.error = None
    gateway.speech_status, gateway.speech_type, gateway.speech = 200, "audio/mpeg", MP3
    assert _speak(client).status_code == 200  # a failure is not remembered as the answer


def test_a_pilot_never_sends_voice_out_and_its_checklist_says_so(tmp_path, monkeypatch, gateway):
    monkeypatch.setenv("KEYNECTION_DB_PATH", str(tmp_path / "pilot.db"))
    monkeypatch.setenv("KEYNECTION_DEMO_MODE", "0")
    from app import db
    from app.main import _pilot_checks, app

    assert voice.listening() is False and voice.speaking() is False
    with TestClient(app) as c:
        status = c.get("/api/ai").json()
        assert status["listen"] is False and status["speak"] is False
    conn = db.connect(str(tmp_path / "pilot.db"))
    try:
        assert any("KEYNECTION_VOICE_KEY is not used in a pilot" in line for line in _pilot_checks(conn))
    finally:
        conn.close()
    assert gateway.sent == []
