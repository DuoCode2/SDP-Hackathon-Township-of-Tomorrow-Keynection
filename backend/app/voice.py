"""The assistant's voice on the server, through DuoCode's LLM gateway: listening (speech to text) for a browser that
cannot listen by itself (Firefox, some phones), and speaking (text to speech) the assistant's replies.

The wake word "Hello Neighbour" never comes here: it is heard on the device (frontend/wake-engine), and nothing is
recorded before it. After it, what is said normally becomes words in the browser; only a browser without its own
listening sends the recording here, and it is passed on and dropped, never kept.

One gateway key (KEYNECTION_VOICE_KEY), a LiteLLM virtual key with its own spending cap and model list:
- Listening: Deepgram's Nova-3 (English, Malay, Chinese; Tamil is heard as English for now, see LANGS).
- Speaking: Deepgram's Aura-2, which has English voices only; a reply in Malay, Chinese or Tamil is spoken by the
  browser's own voices instead (the app decides, see SPOKEN_LANGS). Replies are cut to MAX_SPOKEN_CHARS and the same
  words are spoken from memory, not bought twice.

Optional, like the AI: with no key, no network or no answer in time, typing, the browser's own listening and reading
work as before. Demo mode only, until the privacy notice residents accept names Deepgram.
"""
from __future__ import annotations

import logging
import re
import threading
from collections import OrderedDict
from datetime import date

import httpx

from .settings import demo_mode, setting

log = logging.getLogger("keynection.voice")

DEFAULT_URL = "https://llm.duocodetech.com/v1"  # DuoCode's LLM gateway (LiteLLM), OpenAI-style audio endpoints
STT_MODEL = "deepgram/nova-3"
TTS_MODEL = "deepgram/aura-2"
TTS_VOICE = "aura-2-thalia-en"
CLIPS_PER_HOME_PER_DAY = 30  # one clip is one question; past it, typing still works
REPLIES_SPOKEN_PER_HOME_PER_DAY = 60  # past it, replies are read on screen (or by the browser's voices)
MAX_SECONDS = 15  # one sentence to the assistant; the recorder stops itself here
MAX_BYTES = 600_000  # 15 s is about 60 KB as Opus and 480 KB as 16 kHz WAV
MAX_SPOKEN_CHARS = 400  # Aura-2 is $0.00003 a character: a spoken reply costs at most $0.012
SPOKEN_CACHE = 100  # replies kept as audio (about 40 KB each)
TIMEOUT = 12.0  # seconds a person waits
# How each reading language is asked for. The gateway (LiteLLM 1.105.1) accepts `language` but never passes it on to
# Deepgram, so every clip was heard as English and Malay or Chinese came back empty (measured 20 Oct 2026). Deepgram's
# own `detect_language`, limited to one language, does get through and heard both. Tamil is not among the languages
# Deepgram can detect (it refuses `detect_language=ta`), so Tamil is heard as English here until the gateway passes
# `language` on; a browser that listens by itself still hears Tamil. English is Deepgram's default.
LANGS = {"ms": "ms", "zh": "zh"}
SPOKEN_LANGS = {"en"}  # Aura-2's voices; the others are the browser's to speak


def _key() -> str | None:
    return setting("VOICE_KEY")


def listening() -> bool:
    """The server can turn speech into words: a gateway key, in demo mode only."""
    return bool(_key()) and demo_mode()


def speaking() -> bool:
    """The server can speak replies: the same key, in demo mode only."""
    return bool(_key()) and demo_mode()


def _url(path: str) -> str:
    return (setting("VOICE_URL") or DEFAULT_URL).rstrip("/") + path


# ---------- allowance and memory ----------

_lock = threading.Lock()
_used: dict[tuple[str, str, str], int] = {}
_spoken: OrderedDict[str, bytes] = OrderedDict()
LIMITS = {"listen": CLIPS_PER_HOME_PER_DAY, "speak": REPLIES_SPOKEN_PER_HOME_PER_DAY}


def reset() -> None:
    with _lock:
        _used.clear()
        _spoken.clear()


def spend(home: str, kind: str = "listen") -> bool:
    """Count one use against this home's daily allowance for listening or speaking; False when it is used up."""
    today = date.today().isoformat()
    with _lock:
        for k in [k for k in _used if k[2] != today]:
            del _used[k]
        used = _used.get((kind, home, today), 0)
        if used >= LIMITS[kind]:
            return False
        _used[(kind, home, today)] = used + 1
        return True


# ---------- the only places that talk to the gateway ----------

def transcribe(audio: bytes, content_type: str, lang: str | None) -> str | None:
    """The words in the recording, or None when there are none to use: the caller says so and typing still works."""
    data = {"model": setting("STT_MODEL") or STT_MODEL}
    if lang in LANGS:
        data["detect_language"] = LANGS[lang]
    try:
        r = httpx.post(_url("/audio/transcriptions"), headers={"Authorization": f"Bearer {_key()}"}, data=data,
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


def spoken_text(text: str) -> str:
    """What is said aloud: the reply up to MAX_SPOKEN_CHARS, cut at the last sentence (or word) that fits."""
    text = re.sub(r"\s+", " ", text).strip()
    if len(text) <= MAX_SPOKEN_CHARS:
        return text
    cut = text[:MAX_SPOKEN_CHARS]
    end = max(cut.rfind(". "), cut.rfind("! "), cut.rfind("? "))
    return cut[: end + 1] if end > MAX_SPOKEN_CHARS // 2 else cut.rsplit(" ", 1)[0] + "…"


def remembered(text: str) -> bytes | None:
    with _lock:
        audio = _spoken.get(text)
        if audio is not None:
            _spoken.move_to_end(text)
        return audio


def speak(text: str) -> bytes | None:
    """The reply as MP3 (English), or None when there is none: the app reads it on screen instead."""
    body = {"model": setting("TTS_MODEL") or TTS_MODEL, "input": text, "voice": setting("TTS_VOICE") or TTS_VOICE,
            "response_format": "mp3"}
    try:
        r = httpx.post(_url("/audio/speech"), headers={"Authorization": f"Bearer {_key()}"}, json=body, timeout=TIMEOUT)
    except httpx.HTTPError as e:
        log.warning("text to speech could not be reached (%s); carrying on without it", type(e).__name__)
        return None
    if r.status_code != 200 or not r.headers.get("content-type", "").startswith("audio/") or len(r.content) < 200:
        log.warning("text to speech answered %s (%s); carrying on without it", r.status_code, _why(r))
        return None
    with _lock:
        _spoken[text] = r.content
        while len(_spoken) > SPOKEN_CACHE:
            _spoken.popitem(last=False)
    return r.content


def _why(r: httpx.Response) -> str:
    """The gateway's own reason, for the server log (a key over its budget, a format it refused...)."""
    try:
        error = r.json().get("error")
    except ValueError:
        return r.text[:200]
    if isinstance(error, dict) and error.get("message"):
        return str(error["message"])[:300]
    return str(error)[:300]
