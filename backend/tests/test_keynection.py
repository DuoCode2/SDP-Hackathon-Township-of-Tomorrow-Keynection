"""The project is now called Keynection, and Tamil joins English, Malay and Chinese for everything a resident
receives: quick replies, WhatsApp alerts and renovation notices. The screens themselves stay in three languages."""
import re
import string

import pytest
from fastapi.testclient import TestClient

from app import talk

TAMIL = re.compile(r"[஀-௿]")
RENO = {"scope": "Extend kitchen (rear wall)", "start": "2026-10-15", "end": "2026-10-30", "works_type": "structural",
        "council_permit": "approved"}


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("KEYNECTION_DB_PATH", str(tmp_path / "test.db"))
    monkeypatch.setenv("KEYNECTION_DEMO_MODE", "1")
    monkeypatch.delenv("KEYNECTION_SITE_PASSWORD", raising=False)
    from app.main import app

    with TestClient(app) as c:
        yield c


def _fields(text: str) -> set[str]:
    return {name for _, name, _, _ in string.Formatter().parse(text) if name}


# ---------- the new name ----------

def test_alerts_carry_the_new_name():
    texts = [t for table in (talk.WA_TEMPLATES, talk.WA_BUTTONS) for langs in table.values() for t in langs.values()]
    assert all("Jiran5" not in t for t in texts)
    assert talk.wa_button("open", "en") == "Open Keynection"
    assert "Keynection" in talk.wa_text("message", "en", name="Siti", label="No. 11")


def test_notice_alert_names_the_contractor_only_when_the_owner_gave_one():
    fields = dict(name="Aiman", label="No. 12", scope="Retiling the bathroom", start="19 Oct 2026", end="1 Nov 2026",
                  hours="weekdays 11:00–17:00", quiet="")
    named = talk.wa_text("reno", "en", contractor=talk.contractor_note("ABC Renovation", "en"), **fields)
    unnamed = talk.wa_text("reno", "en", contractor=talk.contractor_note(None, "en"), **fields)
    assert "Noisy work: weekdays 11:00–17:00. Contractor: ABC Renovation. Please photograph" in named
    assert "Noisy work: weekdays 11:00–17:00. Please photograph" in unnamed and "Contractor" not in unnamed
    for lang, word in (("ms", "Kontraktor"), ("zh", "承包商"), ("ta", "ஒப்பந்ததாரர்")):
        assert talk.contractor_note(None, lang) == "" and talk.contractor_note("  ", lang) == ""
        assert f"{word}: ABC Renovation" in talk.wa_text("reno", lang, contractor=talk.contractor_note("ABC Renovation", lang), **fields).replace("：", ": ")
        assert word not in talk.wa_text("reno", lang, contractor=talk.contractor_note(None, lang), **fields)


def test_password_page_and_whatsapp_account_use_the_new_name(client, monkeypatch):
    monkeypatch.setenv("KEYNECTION_SITE_PASSWORD", "local-test-only")
    page = client.get("/", headers={"Accept": "text/html"}).text
    shown = re.sub(r"<[^>]+>", "", page)  # what people read: the logo was "Jiran<span>5</span>", split by a tag
    assert "Keynection" in shown and "Jiran5" not in shown and "Jiran5" not in page
    monkeypatch.delenv("KEYNECTION_SITE_PASSWORD")
    client.post("/api/intros", json={"from_unit_id": "T-12", "message": "Works soon", "lang": "en", "renovation": RENO})
    assert client.get("/api/units/T-11/whatsapp").json()["business_name"] == "Keynection · Taman Demo"


def test_my_data_file_and_refusals_use_the_new_name(client):
    r = client.get("/api/units/T-12/export")
    assert 'filename="keynection-' in r.headers["content-disposition"] and "Jiran5" not in r.text
    token = client.post("/api/units/T-23/join-code").json()["token"]
    refused = client.post("/api/join", json={"token": token, "display_name": "Mei Ling", "lang": "zh", "consent": False})
    assert refused.status_code == 422 and "Keynection" in refused.text


def test_demo_notices_do_not_point_to_the_hidden_contractor_passes():
    # The passes are built but switched off in the demo (estate systems already offer them), so no notice may send
    # residents looking for them.
    from app import seed
    for _, title, body in seed.demo_notices():
        assert "pass" not in f"{title} {body}".lower()


def test_nobody_can_pose_as_the_service():
    assert talk.official_sounding("Keynection team")


# ---------- Tamil for what residents receive ----------

def test_every_message_a_resident_receives_has_a_tamil_version():
    assert "ta" in talk.LANGS and talk.LANG_NAME["ta"] == "தமிழ்"
    tables = {"quick reply": talk.QUICK_REPLIES, "alert": talk.WA_TEMPLATES, "button": talk.WA_BUTTONS,
              "category": talk.CATEGORY_LABELS}
    for kind, table in tables.items():
        for key, langs in table.items():
            ta = langs.get("ta", "")
            assert TAMIL.search(ta), f"{kind} '{key}' has no Tamil text"
            assert _fields(ta) == _fields(langs["en"]), f"{kind} '{key}': Tamil placeholders differ from English"


def test_households_can_choose_tamil(client):
    assert client.put("/api/units/T-12/profile", json={"lang": "ta"}).status_code == 200
    assert client.get("/api/units/T-12/profile").json()["lang"] == "ta"
    token = client.post("/api/units/T-23/join-code").json()["token"]
    joined = client.post("/api/join", json={"token": token, "display_name": "Mei Ling", "lang": "ta", "consent": True})
    assert joined.status_code == 200 and joined.json()["lang"] == "ta"
    body = {"unit_id": "T-20", "staff_name": "Aishah", "owner_signed": True, "message": "Renovation by No. 20", "lang": "ta",
            "renovation": {**RENO, "works_type": "light"}}
    assert client.post("/api/estate/renovations", json=body).status_code == 201


def test_kumar_next_door_gets_aimans_renovation_notice_in_tamil(client):
    # Kumar (No. 13) shares a wall with Aiman (No. 12) and reads Tamil (seed data).
    assert client.get("/api/units/T-13/profile").json()["lang"] == "ta"
    client.post("/api/intros", json={"from_unit_id": "T-12", "message": "Works soon", "lang": "en", "renovation": RENO})
    wa = client.get("/api/units/T-13/whatsapp").json()
    assert wa["lang"] == "ta"
    reno = next(m for m in wa["messages"] if m["kind"] == "reno")
    assert TAMIL.search(reno["text"]) and RENO["scope"] in reno["text"]
    assert reno["buttons"] == [talk.wa_button("open", "ta"), talk.wa_button("concern", "ta")]


def test_alert_dates_and_noisy_hours_are_in_the_readers_language(client):
    client.post("/api/intros", json={"from_unit_id": "T-12", "message": "Works soon", "lang": "en",
                                     "renovation": {**RENO, "noisy_from": "09:00", "noisy_to": "17:00", "weekdays_only": True}})
    alert = lambda unit: next(m for m in client.get(f"/api/units/{unit}/whatsapp").json()["messages"] if m["kind"] == "reno")["text"]
    ta, ms = alert("T-13"), alert("T-11")  # Kumar reads Tamil, Siti reads Malay
    assert "15 அக். 2026" in ta and "வார நாட்களில் 09:00–17:00" in ta
    assert "15 Okt 2026" in ms and "hari bekerja 09:00–17:00" in ms
    for text in (ta, ms):
        assert "2026-10-15" not in text and "weekdays" not in text  # no ISO dates or English inside
    assert talk.date_text("2026-10-15", "zh") == "2026年10月15日" and talk.date_text("2026-10-15", "en") == "15 Oct 2026"
    assert talk.hours_text({"noisy_from": "08:00", "noisy_to": "18:00", "weekdays_only": False}, "zh") == "星期一至六 08:00–18:00"


def test_quick_replies_reach_a_tamil_reader_in_tamil(client):
    sent = client.post("/api/messages", json={"from_unit_id": "T-12", "to_unit_id": "T-13", "quick_key": "thanks_notice"})
    assert sent.status_code == 201
    item = client.get("/api/units/T-13/conversations/T-12").json()["items"][-1]
    assert item["text"] == talk.quick_text("thanks_notice", "ta") and item["translated"] is True
