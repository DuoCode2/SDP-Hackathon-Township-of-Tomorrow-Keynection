"""Alerts for the people who run the site, not for residents (push.py is residents' phones).

Sent when the AI stops answering, so that typed messages are checked by the word list alone, notices go out
untranslated and the assistant falls back to key words; and when one home uses up its AI allowance for the day. A
fall-back nobody sees is a safety check turning off unseen (review of the gateway change, 2026-11-16).

Each alert is a JSON push to an ntfy relay: KEYNECTION_ALERT_URL, with KEYNECTION_ALERT_TOKEN as a bearer token.
Without both, and in the demo, it is only logged. A kind of alert is sent at most once per cooldown (an hour unless
the caller says otherwise), so an outage is one push, not one per message. Nothing waits for the push."""

from __future__ import annotations

import json
import logging
import threading
import time
import urllib.request

from .settings import demo_mode, setting

log = logging.getLogger("keynection.alert")

COOLDOWN_S = 3600.0
TIMEOUT_S = 10.0

_lock = threading.Lock()
_sent: dict[str, float] = {}


def reset() -> None:
    with _lock:
        _sent.clear()


def notify(kind: str, title: str, message: str, *, key: str | None = None,
           cooldown: float = COOLDOWN_S) -> threading.Thread | None:
    """Log the alert, and push it unless the same kind (and key) was pushed within the cooldown. Returns the thread
    sending it, or None when nothing is sent."""
    ident = kind if key is None else f"{kind}|{key}"
    log.warning("ALERT %s: %s. %s", ident, title, message)
    now = time.monotonic()
    with _lock:
        last = _sent.get(ident)
        if last is not None and now - last < cooldown:
            return None
        _sent[ident] = now
    url, token = setting("ALERT_URL"), setting("ALERT_TOKEN")
    if demo_mode() or not (url and token):
        return None
    sender = threading.Thread(target=_post, args=(url, token, title, message), daemon=True, name="keynection-alert")
    sender.start()
    return sender


def _post(url: str, token: str, title: str, message: str) -> None:
    body = json.dumps({"title": title, "message": message, "tags": ["keynection", "warning"], "priority": 4},
                      ensure_ascii=False).encode()
    request = urllib.request.Request(url, data=body, method="POST",
                                     headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(request, timeout=TIMEOUT_S) as response:
            log.info("alert sent (%s)", response.status)
    except Exception as e:  # noqa: BLE001 - a relay that is down must never break a request
        log.warning("the alert could not be sent (%s)", type(e).__name__)
