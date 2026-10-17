"""Verification only: runs the Keynection server with a stand-in for Claude, so the AI screens can be checked in a
browser without a key. Every stand-in answer is marked [stand-in] so it can't be mistaken for Claude's."""
import os
import re
import sys
from datetime import date, timedelta
from pathlib import Path

BACKEND = Path(sys.argv[1]).resolve()
sys.path.insert(0, str(BACKEND))
os.environ.setdefault("KEYNECTION_DB_PATH", str(Path(os.environ["TEMP"]) / "keynection-ai-standin" / "app.db"))

from app import ai  # noqa: E402

LANG_TAG = {"en": "EN", "ms": "MS", "zh": "中文", "ta": "தமிழ்"}


def _owner(text: str) -> str:
    m = re.search(r"<owner>\n(.*)\n</owner>", text, re.S)
    return m.group(1) if m else text


def _language(said: str) -> str:
    if re.search(r"[一-鿿]", said):
        return "zh"
    if re.search(r"[஀-௿]", said):
        return "ta"
    if re.search(r"\b(mulai|minggu|bilik air|jubin|isnin|hari bekerja)\b", said, re.I):
        return "ms"
    return "en"


def fake(system, text, schema, **_):
    if schema is ai.RenovationDraft:
        said = _owner(text)
        low = said.lower()
        works = ("structural" if re.search(r"extend|extension|扩建|sambung", low) else
                 "wet" if re.search(r"bath|toilet|kitchen|浴室|厕所|bilik air|tandas", low) else
                 "hacking" if re.search(r"hack|demolish|break|拆|pecah", low) else "light")
        monday = date.today() + timedelta(days=(7 - date.today().weekday()) or 7)
        return ai.RenovationDraft(
            language=_language(said), works_type=works, scope="[stand-in] " + said[:60], start=monday.isoformat(),
            end=(monday + timedelta(days=13)).isoformat(), noisy_from="09:00", noisy_to="17:00", weekdays_only=True,
            contractor="ABC Renovation" if "abc" in low else None,
            why=f"[stand-in] {works} work: who is told follows from this.",
            missing=[] if "abc" in low else ["[stand-in] Who the contractor is"])
    if schema is ai.MessageCheck:
        reader = re.search(r"The reader's language: (.*)", text).group(1)
        lang = next(k for k, v in ai.LANG_FOR_AI.items() if v == reader)
        msg = re.search(r"<message>\n(.*)\n</message>", text, re.S).group(1)
        heated = msg.count("!") >= 2 or bool(re.search(r"macam kilang|ridiculous|AGAIN", msg))
        calmer = "[stand-in calmer] Hi, the noise has been hard for us. Could we agree on quieter hours?" if heated else None
        return ai.MessageCheck(heated=heated, calmer=calmer,
                               calmer_translation=f"[stand-in → {LANG_TAG[lang]}] {calmer}" if calmer else None,
                               translation=f"[stand-in → {LANG_TAG[lang]}] {msg}")
    if schema is ai.NoticeTranslations:
        wanted = re.findall(r"\b(en|ms|zh|ta) \(", text.split("\n")[0])
        msg = re.search(r"<message>\n(.*)\n</message>", text, re.S).group(1)
        work = re.search(r"<work>\n(.*)\n</work>", text, re.S)
        return ai.NoticeTranslations(translations=[
            ai.NoticeTranslation(lang=lang, message=f"[stand-in → {LANG_TAG[lang]}] {msg}",
                                 scope=f"[{LANG_TAG[lang]}] {work.group(1)}" if work else None) for lang in wanted])
    return None


ai._ask = fake
ai.provider = lambda: "anthropic"  # status() reads the provider, so the guide says AI is on
ai.enabled = lambda: True
ai.model_name = lambda: "stand-in (no key)"

import uvicorn  # noqa: E402

from app.main import app  # noqa: E402

uvicorn.run(app, host="127.0.0.1", port=int(sys.argv[2]))
