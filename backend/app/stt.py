"""Speech to text on the server, for browsers that cannot listen by themselves (Firefox, some phones).

What a resident says to the assistant, after "Hello Neighbour" or while holding the mic, normally becomes text in the
browser. Where the browser has no speech recognition, the recording comes here instead and goes to Deepgram's Nova-3
through DuoCode's LLM gateway, which holds the Deepgram account and a spending cap for this key. The recording is not
kept: it is passed on and dropped, and only the words come back to the chat.

The wake word itself never comes here: it is heard on the device, and nothing is recorded before it.

Optional, like the AI: with no key, no network or no answer in time, the browser's own listening and typing work as
before. Demo mode only, until the privacy notice residents accept names Deepgram.
"""
from __future__ import annotations

import logging
import threading
from datetime import date

import httpx

from .settings import demo_mode, setting

log = logging.getLogger("keynection.stt")

DEFAULT_URL = "https://llm.duocodetech.com/v1"  # DuoCode's LLM gateway (LiteLLM), OpenAI-style audio endpoint
DEFAULT_MODEL = "deepgram/nova-3"
CLIPS_PER_HOME_PER_DAY = 30  # one clip is one question; past it, typing still works
MAX_SECONDS = 15  # one sentence to the assistant; the recorder stops itself here
MAX_BYTES = 600_000  # 15 s is about 60 KB as Opus and 480 KB as 16 kHz WAV
TIMEOUT = 12.0  # seconds a person waits for their words
# How each reading language is asked for. The gateway (LiteLLM 1.105.1) accepts `language` but never passes it on to
# Deepgram, so every clip was heard as English and Malay or Chinese came back empty (measured 20 Oct 2026). Deepgram's
# own `detect_language`, limited to one language, does get through and heard both. Tamil is not among the languages
# Deepgram can detect (it refuses `detect_language=ta`), so Tamil is heard as English here until the gateway passes
# `language` on; a browser that listens by itself still hears Tamil. English is Deepgram's default.
LANGS = {"ms": "ms", "zh": "zh"}


def enabled() -> bool:
    """On when the server has a gateway key for it, in demo mode only."""
    return bool(setting("STT_KEY")) and demo_mode()


# ---------- allowance ----------

_lock = threading.Lock()
_clips: dict[tuple[str, str], int] = {}


def reset() -> None:
    with _lock:
        _clips.clear()


def spend(home: str) -> bool:
    """Count one clip against this home's daily allowance; False when it is used up."""
    today = date.today().isoformat()
    with _lock:
        for key in [k for k in _clips if k[1] != today]:
            del _clips[key]
        used = _clips.get((home, today), 0)
        if used >= CLIPS_PER_HOME_PER_DAY:
            return False
        _clips[(home, today)] = used + 1
        return True


# ---------- the one place that talks to the gateway ----------

def transcribe(audio: bytes, content_type: str, lang: str | None) -> str | None:
    """The words in the recording, or None when there are none to use: the caller says so and typing still works."""
    url = (setting("STT_URL") or DEFAULT_URL).rstrip("/") + "/audio/transcriptions"
    data = {"model": setting("STT_MODEL") or DEFAULT_MODEL}
    if lang in LANGS:
        data["detect_language"] = LANGS[lang]
    try:
        r = httpx.post(url, headers={"Authorization": f"Bearer {setting('STT_KEY')}"}, data=data,
                       files={"file": ("speech", audio, content_type)}, timeout=TIMEOUT)
    except httpx.HTTPError as e:
        log.warning("speech to text could not be reached (%s); carrying on without it", type(e).__name__)
        return None
    if r.status_code != 200:
        log.warning("speech to text answered %s (%s); carrying on without it", r.status_code, _why(r))
        return None
    try:
        text = r.json().get("text")
    except ValueError:
        log.warning("speech to text answer could not be read; carrying on without it")
        return None
    return text.strip() if isinstance(text, str) and text.strip() else None


def _why(r: httpx.Response) -> str:
    """The gateway's own reason, for the server log (a key over its budget, a format it refused...)."""
    try:
        error = r.json().get("error")
    except ValueError:
        return r.text[:200]
    if isinstance(error, dict) and error.get("message"):
        return str(error["message"])[:300]
    return str(error)[:300]
