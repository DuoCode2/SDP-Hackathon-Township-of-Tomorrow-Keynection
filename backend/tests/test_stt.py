"""Speech to text for browsers that cannot listen: the recording goes to the LLM gateway (Deepgram's Nova-3) and only
the words come back. Every test uses a stand-in for the gateway; none reaches the network."""
import logging

import httpx
import pytest
from fastapi.testclient import TestClient

from app import stt

KEY = "sk-test-gateway-key-not-real"
WEBM = b"\x1a\x45\xdf\xa3" + b"\x00" * 2000  # starts the way a WebM recording does (Chrome, Edge)
OGG = b"OggS" + b"\x00" * 2000  # Firefox


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

    def __call__(self, url, *, headers, data, files, timeout):
        self.sent.append({"url": url, "headers": headers, "data": data, "files": files, "timeout": timeout})
        if self.error:
            raise self.error
        return httpx.Response(self.status, json=self.body, request=httpx.Request("POST", url))


@pytest.fixture()
def gateway(monkeypatch):
    monkeypatch.setenv("KEYNECTION_STT_KEY", KEY)
    stand_in = Gateway()
    monkeypatch.setattr(stt.httpx, "post", stand_in)
    return stand_in


def _say(client, audio=WEBM, kind="audio/webm;codecs=opus", unit="T-12", lang="en", duration="3.2"):
    return client.post("/api/assistant/transcribe", data={"unit_id": unit, "lang": lang, "duration": duration},
                       files={"file": ("speech", audio, kind)})


def test_off_without_a_key_and_the_app_is_told(client):
    assert client.get("/api/ai").json()["stt"] is False
    r = _say(client)
    assert r.status_code == 501 and r.json()["detail"]["code"] == "stt_off"


def test_the_words_come_back_and_only_the_recording_and_language_go(client, gateway):
    assert client.get("/api/ai").json()["stt"] is True
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


def test_the_gateway_address_and_model_can_be_changed(client, gateway, monkeypatch):
    monkeypatch.setenv("KEYNECTION_STT_URL", "https://llm-backup.example/v1/")
    monkeypatch.setenv("KEYNECTION_STT_MODEL", "deepgram/nova-3-general")
    assert _say(client).status_code == 200
    assert gateway.sent[-1]["url"] == "https://llm-backup.example/v1/audio/transcriptions"
    assert gateway.sent[-1]["data"]["model"] == "deepgram/nova-3-general"


@pytest.mark.parametrize("audio, kind, status", [
    (WEBM, "text/plain", 415),  # not audio at all
    (b"<html>" + b"\x00" * 2000, "audio/webm", 415),  # says audio, isn't
    (OGG, "audio/webm", 415),  # one format claiming to be another
    (b"\x1a\x45\xdf\xa3", "audio/webm", 400),  # empty
    (b"\x1a\x45\xdf\xa3" + b"\x00" * stt.MAX_BYTES, "audio/webm", 413),  # longer than one sentence
])
def test_only_a_short_real_recording_is_passed_on(client, gateway, audio, kind, status):
    assert _say(client, audio=audio, kind=kind).status_code == status
    assert gateway.sent == []  # refused before anything reaches the gateway


def test_a_clip_longer_than_one_sentence_is_refused(client, gateway):
    assert _say(client, duration=str(stt.MAX_SECONDS + 1)).status_code == 422
    assert gateway.sent == []


def test_each_home_has_a_daily_allowance_and_others_keep_theirs(client, gateway):
    for _ in range(stt.CLIPS_PER_HOME_PER_DAY):
        assert _say(client).status_code == 200
    r = _say(client)
    assert r.status_code == 429 and "Typing works" in r.json()["detail"]
    assert len(gateway.sent) == stt.CLIPS_PER_HOME_PER_DAY  # the refused one never reached the gateway
    assert _say(client, unit="T-13").status_code == 200


def test_a_refused_clip_does_not_use_up_the_allowance(client, gateway):
    for _ in range(stt.CLIPS_PER_HOME_PER_DAY + 5):
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
    with caplog.at_level(logging.WARNING, logger="keynection.stt"):
        r = _say(client)
    assert r.status_code == 424 and r.json()["detail"]["code"] == "stt_busy"
    if logged:
        assert logged in caplog.text
    else:
        assert caplog.text == ""
    assert KEY not in caplog.text


def test_a_pilot_never_sends_speech_out_and_its_checklist_says_so(tmp_path, monkeypatch, gateway):
    monkeypatch.setenv("KEYNECTION_DB_PATH", str(tmp_path / "pilot.db"))
    monkeypatch.setenv("KEYNECTION_DEMO_MODE", "0")
    from app import db
    from app.main import _pilot_checks, app

    assert stt.enabled() is False
    with TestClient(app) as c:
        assert c.get("/api/ai").json()["stt"] is False
    conn = db.connect(str(tmp_path / "pilot.db"))
    try:
        assert any("KEYNECTION_STT_KEY is not used in a pilot" in line for line in _pilot_checks(conn))
    finally:
        conn.close()
    assert gateway.sent == []
