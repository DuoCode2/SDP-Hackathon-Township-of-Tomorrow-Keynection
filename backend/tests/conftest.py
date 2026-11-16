import os

import pytest


@pytest.fixture(autouse=True)
def no_real_ai(monkeypatch):
    """No test talks to the real Claude, Gemini or the voice gateway. Without a key these features are off, as on a
    laptop that has none; tests that need them swap in a stand-in (see test_ai.py, test_voice.py)."""
    # ANTHROPIC_BASE_URL too: a developer's shell may point the SDK somewhere (an agent's own proxy), and with it set
    # the calls name gateway groups, so every expected model name would change.
    for name in ("ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_BASE_URL", "GEMINI_API_KEY", "KEYNECTION_AI",
                 "KEYNECTION_AI_MODEL", "KEYNECTION_AI_MODEL_NOTICE", "KEYNECTION_AI_MODEL_CHAT_CHECK",
                 "KEYNECTION_AI_MODEL_TRANSLATE", "KEYNECTION_AI_MODEL_ASSISTANT", "KEYNECTION_GEMINI_MODEL",
                 "KEYNECTION_ORIGIN"):
        monkeypatch.delenv(name, raising=False)
    # Server settings, under both names (the old JIRAN_ ones are still read): each test sets what it needs.
    for name in ("DB_PATH", "DEMO_MODE", "SITE_PASSWORD", "MOVED_TO", "STATIC_DIR", "ALLOWED_ORIGINS", "VOICE_KEY",
                 "VOICE_URL", "STT_MODEL", "TTS_MODEL", "TTS_VOICE", "ALERT_URL", "ALERT_TOKEN", "AI_HOME_DAILY_USD"):
        for prefix in ("KEYNECTION_", "JIRAN_"):
            monkeypatch.delenv(prefix + name, raising=False)
    from app import ai, opsalert, voice

    ai.reset()
    voice.reset()
    opsalert.reset()


@pytest.fixture()
def sign_in():
    """Pilot mode: sign the test client in as a household ("T-12") or as a new staff member ("staff:Farah"), the way
    a passkey sign-in would leave it (test_signin.py runs the real passkey ceremony)."""
    def _sign_in(client, who: str) -> None:
        from app import auth, db

        conn = db.connect(os.environ["KEYNECTION_DB_PATH"])
        try:
            if who.startswith("staff:"):
                staff_id, _, _ = auth.add_staff(conn, who[6:], "estate")
                subject = f"staff:{staff_id}"
            else:
                subject = auth.unit_subject(who)
            client.cookies.set(auth.SESSION_COOKIE, auth.new_session(conn, subject))
        finally:
            conn.close()

    return _sign_in
