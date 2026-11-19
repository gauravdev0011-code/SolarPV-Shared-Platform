"""Check the workbook-derived IDs and the isolated demo-to-API path."""

from collections import Counter
from base64 import b64decode
import os
from uuid import uuid4

from fastapi.testclient import TestClient
import pytest

from solarpv_api.app import create_app
from solarpv_api.config import Settings
from solarpv_db.assets import create_asset
from solarpv_db.dashboard import DashboardService
from solarpv_db.database import get_connection
from solarpv_db.inspections import create_inspection
from solarpv_db.observations import create_observation
from solarpv_db.panel_demo import DEMO_LABEL, demo_database, seed


def excel_column(index):
    letters = ""
    while index:
        index, digit = divmod(index - 1, 26)
        letters = chr(ord("A") + digit) + letters
    return letters


def test_invalid_workbook_is_reported(tmp_path, monkeypatch):
    workbook = tmp_path / "invalid.xlsx"
    workbook.write_bytes(b"not an Excel workbook")
    monkeypatch.setenv("SOLARPV_PANEL_WORKBOOK", str(workbook))
    app = create_app(Settings(tmp_path / "live.sqlite3", tmp_path / "storage"))
    with TestClient(app, base_url="http://localhost", client=("127.0.0.1", 51000)) as client:
        assert client.get("/api/v1/panel-inspection/layout").status_code == 422
        monkeypatch.delenv("SOLARPV_PANEL_WORKBOOK")
        assert client.get("/api/v1/panel-inspection/layout").status_code == 503


def test_workbook_and_seeded_panel_evidence(tmp_path, monkeypatch):
    workbook = os.environ.get("SOLARPV_PANEL_WORKBOOK")
    if not workbook:
        pytest.skip("Set SOLARPV_PANEL_WORKBOOK to validate the original workbook.")
    demo = tmp_path / "demo"
    monkeypatch.setenv("SOLARPV_PANEL_DEMO_DIR", str(demo))
    assert seed(workbook, demo)["status"] == "imported"
    assert seed(workbook, demo)["status"] == "skipped"
    with get_connection(demo_database(demo)) as connection:
        assert connection.execute("SELECT count(*) FROM assets WHERE asset_type='panel'").fetchone()[0] == 2540
        assert connection.execute("SELECT count(*) FROM inspections").fetchone()[0] == 18
        assert connection.execute("SELECT count(DISTINCT asset_id) FROM inspections").fetchone()[0] == 7

    app = create_app(Settings(tmp_path / "live.sqlite3", tmp_path / "storage"))
    with TestClient(app, base_url="http://localhost", client=("127.0.0.1", 51000)) as client:
        base = "/api/v1/panel-inspection"
        response = client.get(f"{base}/layout")
        assert response.status_code == 200
        panels = response.json()["panels"]
        lengths = dict(zip("ABCDEFGHIJKLMNOP", [108] * 5 + [82] + [54] * 6 + [81] * 4))
        assert {item["id"] for item in panels} == {
            f"{row}-{position:02d}-{layer}"
            for row, length in lengths.items() for position in range(1, length + 1) for layer in "TB"
        }
        assert len(panels) == 2540
        assert len({(p["column"], p["sheet_row"]) for p in panels}) == 2540
        for top, bottom in zip(panels[::2], panels[1::2], strict=True):
            row = top["row"]
            position = top["position"]
            assert (bottom["row"], bottom["position"]) == (row, position)
            assert (top["layer"], bottom["layer"]) == ("T", "B")
            first_column, first_row = (3, "A") if row <= "F" else (231, "G")
            column = excel_column(first_column + 2 * (position - 1))
            top_row = 7 + 8 * (ord(row) - ord(first_row))
            assert (top["cell"], bottom["cell"]) == (f"{column}{top_row}", f"{column}{top_row + 4}")
            assert top["x"] == bottom["x"] and top["width"] == bottom["width"]
            assert top["y"] + top["height"] < top["number_y"] == bottom["number_y"] < bottom["y"]
        named = {p["id"]: p for p in panels}
        assert named["A-01-T"]["y"] == named["G-01-T"]["y"]
        assert named["A-108-T"]["x"] + named["A-108-T"]["width"] < named["G-01-T"]["x"]
        assert named["M-81-T"]["x"] > named["L-54-T"]["x"]
        assert Counter(p["layer"] for p in panels) == {"T": 1270, "B": 1270}
        if workbook == "synthetic-demo":
            assert not any(p["source_mark"] for p in panels)
        assert {p["id"] for p in panels if p["inferred_number"]} == {"E-82-T", "E-82-B"}

        response = client.get(f"{base}/panels/H-04-T")
        assert response.status_code == 200
        detail = response.json()
        assert detail["panel"]["cell"] == "IC15"
        assert [item["inspected_at"][:10] for item in detail["inspections"]] == [
            "2026-11-12", "2026-10-28", "2026-10-14"
        ]
        assert not detail["inspections"][1]["measurements"]
        assert detail["inspections"][0]["data_source"] == DEMO_LABEL
        assert len(detail["maintenance"]) == 1
        assert client.get(f"{base}/coverage").json() == {"with_inspections": 7, "without_inspections": 2533}
        notes = f"{base}/panels/H-04-T/notes"
        note_url = f"{notes}/{uuid4()}"
        entry = {"body": "Illustrative note", "author": "Demo test", "expected_revision": 0}
        assert client.post(note_url, json=entry).status_code == 201
        assert len(client.post(note_url, json=entry).json()) == 1
        assert client.post(note_url, json={**entry, "body": "New text", "expected_revision": 1}).status_code == 201
        assert client.post(note_url, json={**entry, "body": "Stale edit"}).status_code == 409
        assert client.post(note_url, json={**entry, "body": "  "}).status_code == 422
        assert {note["body"] for note in client.get(notes).json()} == {"Illustrative note", "New text"}
        assert client.get(f"{base}/panels/H-04-B/notes").json() == []
        assert client.post(note_url.replace("H-04-T", "H-04-B"), json=entry).status_code == 404
        assert client.get(f"{base}/panels/H-04-T?mode=live").json()["inspections"] == []
        assert client.get(f"{base}/panels/H-55-T").status_code == 404
        assert client.get(f"{base}/panels/H-04-T?mode=wrong").status_code == 422

        database = app.state.settings.database_path
        site = DashboardService(database).create_site(
            "default", name="Workbook site fixture", location_text=None, latitude=None, longitude=None,
        )
        monkeypatch.setenv("SOLARPV_PANEL_LIVE_SITE", site["site_id"])
        asset = create_asset("panel", "Workbook fixture", "H-04-T", database_path=database,
                             data_origin="real", site_id=site["site_id"])
        visit = create_inspection(asset, "2026-11-01T12:00:00Z", data_origin="real", database_path=database)
        create_observation(visit, "module_temperature", 35, "°C", database_path=database)
        create_observation(visit, "power_kw", 10, "kW", database_path=database)
        live = client.get(f"{base}/panels/H-04-T?mode=live&workspace=default").json()
        assert [item["data_origin"] for item in live["inspections"]] == ["real"]
        assert [item["observation_type"] for item in live["inspections"][0]["measurements"]] == ["module_temperature"]
        assert client.get(f"{base}/panels/H-04-T?mode=live&workspace=other").json()["inspections"] == []
        assert len(client.get(f"{base}/panels/H-04-T").json()["inspections"]) == 3

        demo_visits = "/api/v1/panel-demo/visits"
        fixture = {"asset_id": detail["asset_id"], "inspected_at": "2026-11-13T12:00:00Z",
                   "data_origin": "real", "data_source": "Synthetic test worksheet"}
        demo_key = {"Idempotency-Key": "isolated-panel-capture-0001"}
        assert client.post(demo_visits, json=fixture, headers=demo_key).status_code == 422
        fixture["data_origin"] = "synthetic"
        uploaded = client.post(f"{demo_visits}/attachments?kind=csv",
                               files={"file": ("readings.csv", b"metric,value\ntemperature,35\n", "text/csv")})
        assert uploaded.status_code == 201, uploaded.text
        fixture["attachment_ids"] = [uploaded.json()["source_file_id"]]
        created = client.post(demo_visits, json=fixture, headers=demo_key)
        assert created.status_code == 201, created.text
        demo_visit = created.json()["inspection_id"]
        assert client.post(demo_visits, json=fixture, headers=demo_key).json() == created.json()
        download = client.get(f"{demo_visits}/{demo_visit}/attachments/{fixture['attachment_ids'][0]}")
        assert download.content == b"metric,value\ntemperature,35\n"
        assert len(client.get(f"{base}/panels/H-04-T?mode=live&workspace=default").json()["inspections"]) == 1
        seeded_visit = detail["inspections"][0]["inspection_id"]
        before = client.get(f"{demo_visits}/{seeded_visit}").json()
        evidence_only = {**fixture, "attachments_only": True, "reason": "Attach the source worksheet"}
        amendment = client.post(f"{demo_visits}/{seeded_visit}/amendments", json=evidence_only,
                                headers={"Idempotency-Key": "demo-legacy-attachment-0001"})
        assert amendment.status_code == 201, amendment.text
        after = client.get(f"{demo_visits}/{seeded_visit}").json()
        assert after["visit"]["inspected_at"] == before["visit"]["inspected_at"]
        assert after["visit"]["data_source"] == before["visit"]["data_source"]
        assert [row["observation_id"] for row in after["observations"]["items"]] == [
            row["observation_id"] for row in before["observations"]["items"]
        ]
        assert after["attachments"][0]["source_file_id"] == fixture["attachment_ids"][0]

        maintenance = {"request_id": str(uuid4()), "performed_at": "2026-11-14",
                       "work": "Synthetic cleaning", "status": "planned", "related_inspection_id": demo_visit}
        maintenance_path = f"{base}/panels/H-04-T/maintenance"
        assert client.post(maintenance_path.replace("H-04-T", "H-04-B"), json=maintenance).status_code == 422
        saved = client.post(maintenance_path, json=maintenance)
        assert saved.status_code == 201, saved.text
        assert client.post(maintenance_path, json=maintenance).json() == saved.json()
        record_id = saved.json()["maintenance_id"]
        status_path = f"{maintenance_path}/{record_id}/status"
        status = {"expected_revision": 0, "status": "completed", "notes": "Synthetic work performed"}
        assert client.post(status_path, json=status).json() == {"revision": 1}
        assert client.post(status_path, json=status).json() == {"revision": 1}
        assert client.post(status_path, json={**status, "notes": "Stale change"}).status_code == 409
        record = next(item for item in client.get(f"{base}/panels/H-04-T").json()["maintenance"]
                      if item["maintenance_id"] == record_id)
        assert record["status"] == "planned"
        assert record["status_history"][0]["status"] == "completed"
        assert record["status_history"][0]["notes"] == "Synthetic work performed"

        visits = "/api/v1/workspaces/default/visits"
        png = b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aF9sAAAAASUVORK5CYII=")
        upload = client.post(f"{visits}/attachments", files={"file": ("fixture.png", png, "image/png")})
        assert upload.status_code == 201, upload.text
        payload = {"asset_id": live["asset_id"], "inspected_at": "2026-11-02T12:00:00Z",
                   "data_origin": "real", "data_source": "Disposable isolated test",
                   "attachment_ids": [upload.json()["source_file_id"]],
                   "observations": [{"observation_type": "module_temperature", "value": "36.25",
                                     "quantity": "temperature", "unit": "Hz"}]}
        headers = {"Idempotency-Key": "panel-visit-test-0001"}
        assert client.post(visits, json=payload, headers=headers).status_code == 422
        payload["observations"][0]["unit"] = "°C"
        capture = client.post(visits, json=payload, headers=headers)
        assert capture.status_code == 201, capture.text
        assert client.post(visits, json=payload, headers=headers).json() == capture.json()
        options = "?mode=live&workspace=default"
        inspections = client.get(f"{base}/panels/H-04-T{options}").json()["inspections"]
        assert len(inspections) == 2
        assert inspections[0]["inspection_id"] == capture.json()["inspection_id"]
        assert inspections[0]["measurements"][0]["value"] == 36.25
        assert client.get("/api/v1" + inspections[0]["attachments"][0]["path"]).content == png
        assert client.get(f"{base}/panels/H-04-B{options}").json()["inspections"] == []
        assert client.get(f"{base}/coverage{options}").json()["with_inspections"] == 1
