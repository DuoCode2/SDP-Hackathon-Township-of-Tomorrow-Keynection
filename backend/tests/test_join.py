import sqlite3

import pytest
from fastapi.testclient import TestClient

RENO = {"scope": "Extend kitchen (rear wall)", "start": "2026-10-15", "end": "2026-10-30", "works_type": "structural",
        "council_permit": "approved"}


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("KEYNECTION_DB_PATH", str(tmp_path / "test.db"))
    monkeypatch.setenv("KEYNECTION_DEMO_MODE", "1")
    from app.main import app

    with TestClient(app) as c:
        c.db_path = str(tmp_path / "test.db")
        yield c


def _code(client, unit="T-23"):
    return client.post(f"/api/units/{unit}/join-code").json()["token"]


def _join(client, token, **extra):
    body = {"token": token, "display_name": "Mei Ling", "lang": "zh", "consent": True, "whatsapp_alerts": True, **extra}
    return client.post("/api/join", json=body)


# ---------- a household that hasn't joined stays private ----------

def test_neighbours_see_a_unit_number_until_the_household_joins(client):
    card = {n["id"]: n for n in client.get("/api/units/T-12/directory").json()["circle"]}
    assert card["T-23"]["joined"] is False and card["T-23"]["resident_name"] == "No. 23"
    assert card["T-23"]["lang"] is None and card["T-23"]["bio"] == ""
    assert "Mei Ling" not in client.get("/api/units/T-12/directory").text
    assert "T-23" not in {c["id"] for c in client.get("/api/units/T-12/conversations").json()}


def test_nobody_can_message_or_wave_at_a_household_that_hasnt_joined(client):
    r = client.post("/api/messages", json={"from_unit_id": "T-12", "to_unit_id": "T-23", "body": "Hi"})
    assert r.status_code == 409 and r.json()["detail"]["code"] == "not_joined"
    assert client.post("/api/waves", json={"from_unit_id": "T-12", "to_unit_id": "T-23"}).status_code == 409
    # ...and it can't act either
    assert client.post("/api/messages", json={"from_unit_id": "T-23", "to_unit_id": "T-12", "body": "Hi"}).status_code == 409
    assert client.put("/api/units/T-23/profile", json={"bio": "hello"}).status_code == 409


def test_hello_skips_them_but_a_renovation_notice_goes_on_paper(client):
    hello = client.post("/api/intros", json={"from_unit_id": "T-12", "message": "Hi all", "lang": "en"}).json()
    assert "T-23" not in hello["recipients"]
    reno = client.post("/api/intros", json={"from_unit_id": "T-12", "message": "Works soon", "lang": "en", "renovation": RENO}).json()
    assert "T-23" in reno["recipients"] and reno["paper_notices"] == ["T-23"]
    desk = client.get("/api/estate/frontdesk").json()
    notice = desk["paper_notices"][0]
    assert notice["unit_label"] == "No. 23" and notice["status"] == "to_print" and notice["renovation"]["scope"] == RENO["scope"]
    client.post(f"/api/paper-notices/{notice['id']}/printed", json={"staff_name": "Aishah"})
    done = client.post(f"/api/paper-notices/{notice['id']}/delivered", json={"staff_name": "Aishah"}).json()
    assert done["status"] == "delivered" and done["delivered_by"] == "Estate office (Aishah)"
    owner_log = [e["type"] for e in client.get("/api/units/T-12/history").json()["events"]]
    assert "notice_delivered_on_paper" in owner_log
    assert client.post(f"/api/paper-notices/{notice['id']}/delivered", json={"staff_name": "Aishah"}).status_code == 409


# ---------- joining with the handover code ----------

def test_join_code_flow_with_consent(client):
    token = _code(client)
    info = client.post("/api/join/lookup", json={"token": token}).json()
    assert info["label"] == "No. 23" and info["suggested_name"] == "Mei Ling" and info["circle_size"] == 5
    assert _join(client, token, consent=False).status_code == 422
    assert _join(client, token, display_name="Call 0123456789").json()["detail"]["code"] == "private"
    assert _join(client, token, display_name="SDP Estate Office").json()["detail"]["code"] == "official"
    joined = _join(client, token, easy_mode=True).json()
    assert joined["joined"] is True and joined["resident_name"] == "Mei Ling" and joined["lang"] == "zh"
    card = {n["id"]: n for n in client.get("/api/units/T-12/directory").json()["circle"]}
    assert card["T-23"]["resident_name"] == "Mei Ling" and card["T-23"]["joined"] is True
    assert client.get("/api/units/T-23/profile").json()["easy_mode"] is True
    events = client.get("/api/units/T-23/history").json()["events"]
    assert events[-1]["type"] == "joined" and "Mei Ling" not in str(events[-1]["payload"])
    # single use, and a joined household can't be re-issued a code (no takeover)
    assert client.post("/api/join/lookup", json={"token": token}).status_code == 404
    assert client.post("/api/units/T-23/join-code").status_code == 409


def test_new_code_cancels_the_old_one_and_codes_expire(client):
    first = _code(client)
    second = _code(client)
    assert client.post("/api/join/lookup", json={"token": first}).status_code == 404
    with sqlite3.connect(client.db_path) as db:
        db.execute("UPDATE join_codes SET expires_at = '2000-01-01T00:00:00+00:00'")
    assert client.post("/api/join/lookup", json={"token": second}).status_code == 404


def test_joining_moves_unprinted_paper_notices_into_the_app(client):
    client.post("/api/intros", json={"from_unit_id": "T-12", "message": "Works soon", "lang": "en", "renovation": RENO})
    _join(client, _code(client))
    assert client.get("/api/estate/frontdesk").json()["paper_notices"][0]["status"] == "superseded"
    assert "T-12" in {c["id"] for c in client.get("/api/units/T-23/conversations").json()}


def test_staff_tools_need_staff_sign_in_outside_demo_mode(client, monkeypatch, sign_in):
    monkeypatch.setenv("KEYNECTION_DEMO_MODE", "0")
    assert client.post("/api/units/T-23/join-code").status_code == 401
    assert client.get("/api/estate/frontdesk").status_code == 401
    sign_in(client, "T-12")  # a household can't issue codes or open the front desk
    assert client.post("/api/units/T-23/join-code").status_code == 403
    assert client.get("/api/estate/frontdesk").status_code == 403


# ---------- the estate office registers a renovation for an owner ----------

def test_estate_office_registers_a_renovation_on_record(client):
    body = {"unit_id": "T-20", "staff_name": "Aishah", "owner_signed": True, "message": "Renovation by No. 20", "lang": "zh",
            "renovation": {**RENO, "works_type": "light"}}
    assert client.post("/api/estate/renovations", json={**body, "owner_signed": False}).status_code == 422
    sent = client.post("/api/estate/renovations", json=body).json()
    assert set(sent["recipients"]) == {"T-21"}  # light works: the house sharing a wall (No. 20 is an end lot)
    event = next(e for e in client.get("/api/units/T-20/history").json()["events"] if e["type"] == "renovation_registered")
    assert event["payload"]["acted_by"] == "Estate office (Aishah)"
    r = client.post("/api/estate/renovations", json={**body, "unit_id": "T-23"})
    assert r.status_code == 409 and r.json()["detail"]["code"] == "not_joined"


# ---------- easy mode stays private ----------

def test_easy_mode_is_private_to_the_household(client):
    assert client.get("/api/units/T-20/profile").json()["easy_mode"] is True
    assert "easy_mode" not in client.get("/api/units").text
    assert "easy_mode" not in client.get("/api/units/T-21/directory").text
    client.put("/api/units/T-20/profile", json={"easy_mode": False})
    assert client.get("/api/units/T-20/profile").json()["easy_mode"] is False


# ---------- WhatsApp alerts ----------

def test_whatsapp_alerts_are_in_the_readers_language_without_message_content(client):
    client.post("/api/intros", json={"from_unit_id": "T-12", "message": "Works soon", "lang": "en", "renovation": RENO})
    client.post("/api/messages", json={"from_unit_id": "T-12", "to_unit_id": "T-11", "body": "Secret plans for Saturday"})
    wa = client.get("/api/units/T-11/whatsapp").json()
    assert wa["channel"] == "whatsapp" and wa["lang"] == "ms"
    kinds = [m["kind"] for m in wa["messages"]]
    assert "reno" in kinds and "message" in kinds and "notice" in kinds
    assert all("Secret plans" not in m["text"] for m in wa["messages"])
    assert next(m for m in wa["messages"] if m["kind"] == "reno")["text"].startswith("Notis ubah suai")
    client.put("/api/units/T-11/profile", json={"quiet_mode": True})
    kinds = [m["kind"] for m in client.get("/api/units/T-11/whatsapp").json()["messages"]]
    assert "message" not in kinds and "reno" in kinds  # quiet mode holds chat alerts, never formal notices
    assert client.get("/api/units/T-23/whatsapp").json()["channel"] == "paper"
    client.put("/api/units/T-11/profile", json={"whatsapp_alerts": False})
    assert client.get("/api/units/T-11/whatsapp").json()["channel"] == "app"


# ---------- phase setup ----------

def test_phase_setup_matches_the_live_rules(client):
    r = client.post("/api/planner/preview", json={"lorongs": 1, "houses_per_row": 6, "facing": True,
                                                  "blocks": 1, "floors": 3, "units_per_floor": 3}).json()
    assert r["homes"] == 21 and r["terrace_homes"] == 12 and r["apartment_homes"] == 9
    # terrace: 8 middle houses see 5 homes, 4 end houses see 3; block: corners 2, edges 3, centre 4
    assert r["circle_sizes"] == {"2": 4, "3": 8, "4": 1, "5": 8}
    assert r["notice_zone"]["light"]["max"] == 2 and len(r["units"]) == 21


def test_phase_setup_is_capped(client):
    assert client.post("/api/planner/preview", json={"lorongs": 0, "blocks": 0}).status_code == 422
    assert client.post("/api/planner/preview", json={"blocks": 12, "floors": 60, "units_per_floor": 20}).status_code == 422
    big = client.post("/api/planner/preview", json={"lorongs": 20, "houses_per_row": 40, "blocks": 2, "floors": 60, "units_per_floor": 11}).json()
    assert big["homes"] == 2920 and big["took_ms"] < 2000


def test_dashboard_counts_joined_households_and_paper_notices(client):
    client.post("/api/intros", json={"from_unit_id": "T-12", "message": "Works soon", "lang": "en", "renovation": RENO})
    d = client.get("/api/dashboard").json()
    assert d["households_joined"] == 40 and d["paper_notices_pending"] == 1
