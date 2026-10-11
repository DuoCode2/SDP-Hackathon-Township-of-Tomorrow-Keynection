"""Pilot: warranty tickets go to SDP's defect system (Procore). Staff download new tickets as a punch list with
their photos, put them into Procore with the punch-list template of their own project, and write Procore's item
number back on the ticket. A pilot never invents a Procore number; the demo still shows a simulated one."""
import csv
import io
import re
import zipfile
from datetime import date

import pytest
from fastapi.testclient import TestClient

HEADER = ["Item Name", "Description", "Location", "Trade", "Assigned To", "Due Date", "Priority", "Reference", "Status",
          "Reported On", "Days Left", "Procore Item", "Photos"]


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("JIRAN_DB_PATH", str(tmp_path / "test.db"))
    monkeypatch.setenv("JIRAN_DEMO_MODE", "1")  # seed the fictional phase, then switch to pilot mode
    monkeypatch.delenv("JIRAN_SITE_PASSWORD", raising=False)
    from app.main import app

    with TestClient(app) as c:
        monkeypatch.setenv("JIRAN_DEMO_MODE", "0")
        yield c


@pytest.fixture()
def ticket(client, monkeypatch, sign_in):
    from test_layers_2_4 import _warranty_ticket

    monkeypatch.setenv("JIRAN_DEMO_MODE", "1")
    made = _warranty_ticket(client)
    monkeypatch.setenv("JIRAN_DEMO_MODE", "0")
    sign_in(client, "staff:Farah")
    return made


def _export(client, which="new"):
    return client.post("/api/warranty/export", json={"which": which})


def _rows(response) -> tuple[zipfile.ZipFile, list[dict]]:
    pack = zipfile.ZipFile(io.BytesIO(response.content))
    text = pack.read("punch-list.csv").decode("utf-8-sig")
    rows = list(csv.reader(io.StringIO(text)))
    assert rows[0] == HEADER
    return pack, [dict(zip(HEADER, r)) for r in rows[1:]]


def test_staff_download_new_tickets_as_a_punch_list_with_photos(client, ticket):
    r = _export(client)
    assert r.status_code == 200 and r.headers["content-type"] == "application/zip"
    pack, rows = _rows(r)
    assert len(rows) == 1
    row = rows[0]
    assert row["Reference"] == f"KN-{ticket['id']}" and row["Location"] == "Taman Demo > Jalan Demo 1 > No. 11"
    assert "Shared wall with No. 12" in row["Item Name"]
    due = date.fromisoformat(ticket["clock"]["repair_due"])
    assert row["Due Date"] == due.strftime("%m/%d/%Y")  # Procore reads MM/DD/YYYY, with the zeros
    assert row["Priority"] in ("High", "Medium") and row["Status"] == "Open"
    names = pack.namelist()
    assert f"photos/KN-{ticket['id']}-defect.jpg" in names and f"photos/KN-{ticket['id']}-before.jpg" in names
    assert "README.txt" in names
    assert "Siti" not in pack.read("punch-list.csv").decode("utf-8-sig")  # homes by unit, never by name


def test_an_export_marks_tickets_so_the_next_one_has_only_new_ones(client, ticket):
    assert _export(client).status_code == 200
    again = _export(client)
    assert again.status_code == 409 and "Nothing new" in again.json()["detail"]
    _, rows = _rows(_export(client, "open"))
    assert len(rows) == 1  # still open: it can be downloaded again on purpose


def test_staff_write_procores_item_number_back_on_the_ticket(client, ticket):
    url = f"/api/warranty/{ticket['id']}/procore"
    assert client.post(url, json={"ref": "<script>", "staff_name": "Farah"}).status_code == 422
    assert client.post(url, json={"ref": "PI-0457", "staff_name": "Farah"}).status_code == 200
    queue = {t["id"]: t for t in client.get("/api/warranty").json()}
    assert queue[ticket["id"]]["procore_ref"] == "PI-0457"
    _, rows = _rows(_export(client, "open"))
    assert rows[0]["Procore Item"] == "PI-0457"
    from app import db
    import os

    conn = db.connect(os.environ["JIRAN_DB_PATH"])
    last = conn.execute("SELECT type, payload FROM events WHERE unit_id = 'T-11' ORDER BY id DESC LIMIT 1").fetchone()
    assert last["type"] == "procore_linked" and "PI-0457" in last["payload"]  # the owner can see SDP logged it
    conn.close()


def test_a_pilot_never_invents_a_procore_number(client, ticket):
    from app.main import DEMO_PHOTO_DIR

    photo = (DEMO_PHOTO_DIR / "wall_repair_good.jpg").read_bytes()
    done = client.post(f"/api/warranty/{ticket['id']}/repair", data={"subcontractor": "Jaya Plaster Sdn Bhd"},
                       files={"file": ("repair.jpg", photo, "image/jpeg")}).json()
    assert done["procore_ref"] is None
    _, rows = _rows(_export(client, "all"))
    assert rows[0]["Assigned To"] == "Jaya Plaster Sdn Bhd" and rows[0]["Status"] == "Repair submitted"
    assert re.search(rf"KN-{ticket['id']}-repair\.jpg", rows[0]["Photos"])


def test_the_demo_still_shows_a_simulated_procore_number(client, monkeypatch):
    from test_layers_2_4 import _warranty_ticket

    monkeypatch.setenv("JIRAN_DEMO_MODE", "1")
    made = _warranty_ticket(client)
    done = client.post(f"/api/warranty/{made['id']}/repair/demo", json={"name": "wall_repair_good", "subcontractor": "Jaya Plaster Sdn Bhd"})
    assert done.json()["procore_ref"] == f"PC-{2000 + made['id']}"
