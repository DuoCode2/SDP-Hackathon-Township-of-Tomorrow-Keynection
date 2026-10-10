import pytest


@pytest.fixture(autouse=True)
def no_real_ai(monkeypatch):
    """No test talks to the real Claude. Without a key the AI features are off, as on a laptop that has none;
    tests that need them swap in a stand-in (see test_ai.py)."""
    for name in ("ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "KEYNECTION_AI", "KEYNECTION_AI_MODEL"):
        monkeypatch.delenv(name, raising=False)
    from app import ai

    ai.reset()
