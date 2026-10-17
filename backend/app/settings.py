"""Server settings, read from the environment."""
import os


def setting(name: str, default: str | None = None) -> str | None:
    """A server setting, KEYNECTION_<name>. A server set up under the project's first name (JIRAN_<name>) keeps
    working: the old name is still read when the new one isn't set."""
    for prefix in ("KEYNECTION_", "JIRAN_"):
        value = os.environ.get(prefix + name)
        if value is not None:
            return value
    return default


def demo_mode() -> bool:
    """Demo-only endpoints (reset, sample photos) are on for local runs and off when KEYNECTION_DEMO_MODE=0."""
    return setting("DEMO_MODE", "1") == "1"
