"""CSV preview, explicit confirmation and transactional writes against the workbook."""

import os

import pytest
from fastapi.testclient import TestClient

from solarpv_api.app import create_app
from solarpv_api.config import Settings
from solarpv_db.assets import create_asset
from solarpv_db.dashboard import DashboardService
from solarpv_db.database import get_connection
from solarpv_db.panel_demo import demo_database, seed


HEADER = "panel_id,inspected_at,data_source,measurement,quantity,value,unit,finding\n"
BASE = "/api/v1/panel-inspection"
IMPORTS = f"{BASE}/csv-imports"


def test_inspection_csv(tmp_path, monkeypatch):
    workbook = os.environ.get("SOLARPV_PANEL_WORKBOOK")
    if not workbook:
        pytest.skip("Set SOLARPV_PANEL_WORKBOOK to verify the real panel registry.")
    root = tmp_path / "demo"
    monkeypatch.setenv("SOLARPV_PANEL_DEMO_DIR", str(root))
    database = tmp_path / "live.sqlite3"
    seed(workbook, root)
    with TestClient(create_app(Settings(database, tmp_path / "files")), base_url="http://localhost",
                    client=("127.0.0.1", 51000)) as client:
        def submit(content, operation="preview", digest="", name="field-log.csv", query="", selected=""):
            return client.post(f"{IMPORTS}/{operation}{query}",
                               files={"file": (name, content.encode(), "text/csv")},
                               data={"confirmed_digest": digest, "selected_panel": selected})

        assert submit("x" * (1200 * 1024)).status_code == 413
        curve = submit("timestamp,voltage_V,current_A\n2026-09-01T09:00:00+00:00,0.00,9.500\n",
                       selected="J-24-B").json()["preview"]
        assert curve["errors"][0]["line"] == 1 and "I-V curve CSV" in curve["errors"][0]["message"]
        invalid = HEADER + (
            "H-99-T,2026-11-14T10:00:00Z,Lab,module_temperature,temperature,35,degC,\n"
            "H-04-T,2026-02-30,Lab,module_temperature,temperature,35,degC,\n"
            "H-04-T,2026-11-14T10:00:00Z,Lab,module_temperature,temperature,NaN,degC,\n"
            "H-04-T,2026-11-14T10:00:00Z,Lab,module_temperature,temperature,35,Hz,\n"
            "H-04-T,2026-11-14T10:00:00Z,Lab,module_temperature,temperature,,degC,\n"
            "H-04-T,2026-11-14T10:00:00Z,,module_temperature,temperature,35,degC,\n"
        )
        bad = submit(invalid).json()["preview"]
        assert [item["line"] for item in bad["errors"]] == list(range(2, 8))
        assert not submit(invalid, "commit", bad["confirmation"]).json()["receipt"]
        valid = HEADER + (
            "H-04-T,2026-11-14T10:00:00Z,Lab,module_temperature,temperature,35.250,degC,\n"
            "H-04-T,2026-11-14T10:00:00Z,Lab,ambient_temperature,temperature,,degC,Sensor unavailable\n"
        )
        preview = submit(valid).json()["preview"]
        assert preview["errors"] == [] and preview["inspection_count"] == 1
        assert client.get(IMPORTS).json() == {"imports": []}
        assert submit(valid, "commit").status_code == 409
        assert submit(valid.replace("35.250", "35.251"), "commit", preview["confirmation"]).status_code == 409
        with get_connection(demo_database(root)) as connection:
            connection.execute("CREATE TRIGGER fail_csv BEFORE INSERT ON observations "
                               "WHEN NEW.observation_type='ambient_temperature' "
                               "BEGIN SELECT RAISE(ABORT, 'forced failure'); END")
        assert submit(valid, "commit", preview["confirmation"]).status_code == 409
        assert client.get(IMPORTS).json() == {"imports": []}
        assert len(client.get(f"{BASE}/panels/H-04-T").json()["inspections"]) == 3
        with get_connection(demo_database(root)) as connection:
            connection.execute("DROP TRIGGER fail_csv")

        saved = submit(valid, "commit", preview["confirmation"]).json()["receipt"]
        assert not saved["duplicate"] and saved["measurement_count"] == 2
        repeated = submit(valid, "commit", preview["confirmation"], name="renamed.csv").json()["receipt"]
        assert repeated["duplicate"] and repeated["filename"] == "field-log.csv"
        assert len(client.get(IMPORTS).json()["imports"]) == 1
        history = client.get(f"{BASE}/panels/H-04-T").json()["inspections"]
        visit = history[0]
        assert len(history) == 4 and visit["data_origin"] == "synthetic"
        assert visit["attachments"] == []
        assert {item["observation_type"]: item["value"] for item in visit["measurements"]} == {
            "module_temperature": 35.25, "ambient_temperature": None,
        }
        evidence = client.get(f"/api/v1/panel-demo/visits/{visit['inspection_id']}").json()
        assert evidence["observations"]["items"][0]["source_value"] == "35.250"
        assert "field-log.csv, row 2" in evidence["observations"]["items"][0]["source_reference"]
        assert len(client.get(f"{BASE}/panels/H-04-B").json()["inspections"]) == 3

        site = DashboardService(database).create_site(
            "default", name="Test field site", location_text=None, latitude=None, longitude=None,
        )
        monkeypatch.setenv("SOLARPV_PANEL_LIVE_SITE", site["site_id"])
        query = "?mode=live&workspace=default"
        assert submit(valid, query=query).json()["preview"]["errors"][0]["line"] == 2
        create_asset("panel", "Test field panel", "H-04-T", database_path=database,
                     data_origin="real", site_id=site["site_id"])
        assert submit(valid, "commit", preview["confirmation"], query=query).status_code == 409
        live_preview = submit(valid, query=query).json()["preview"]
        live = submit(valid, "commit", live_preview["confirmation"], query=query).json()["receipt"]
        assert live["origin"] == "real" and live["import_id"] != saved["import_id"]
        assert client.get(f"{BASE}/panels/H-04-T{query}").json()["inspections"][0]["data_origin"] == "real"

        visit_csv = "panel_id,visit_timestamp,visit_origin,inspection_method,measurement,value,unit,measurement_status,notes\n" + (
            "J-24-B,2026-11-18T10:30:00Z,synthetic,Handheld meter,module_temperature,31.250,degC,measured,Stabilized reading\n"
            "J-24-B,2026-11-18T10:30:00Z,synthetic,Handheld meter,dc_voltage,37.20,V,suspect,Verify calibration\n"
            "J-24-B,2026-11-18T10:30:00Z,synthetic,Handheld meter,ambient_temperature,,,missing,Sensor offline\n"
        )
        mismatch = submit(visit_csv, selected="J-24-T").json()["preview"]
        assert [item["line"] for item in mismatch["errors"]] == [2, 3, 4]
        assert "does not match selected panel J-24-T" in mismatch["errors"][0]["message"]
        wrong_origin = submit(visit_csv.replace(",synthetic,", ",real,"), selected="J-24-B").json()["preview"]
        assert "synthetic in the demo" in wrong_origin["errors"][0]["message"]
        preview = submit(visit_csv, selected="J-24-B").json()["preview"]
        assert preview["errors"] == [] and preview["inspection_count"] == 1
        saved = submit(visit_csv, "commit", preview["confirmation"], selected="J-24-B").json()["receipt"]
        assert saved["measurement_count"] == 3 and len(saved["inspections"]) == 1
        assert submit(visit_csv, "commit", preview["confirmation"], selected="J-24-B").json()["receipt"]["duplicate"]
        def panel_history():
            return client.get(f"{BASE}/panels/J-24-B").json()["inspections"]
        history = panel_history()
        from_csv = history[0]
        assert from_csv["inspection_method"] == "Handheld meter"
        assert from_csv["data_origin"] == "synthetic"
        assert [row["data_quality"] for row in from_csv["measurements"]] == ["unknown", "suspect", "unknown"]
        assert [(row["measurement_status"], row["value"], row["unit"], row["finding"])
                for row in from_csv["measurements"]] == [
            ("measured", 31.25, "degC", "Stabilized reading"),
            ("suspect", 37.2, "V", "Verify calibration"),
            ("missing", None, None, "Sensor offline"),
        ]
        bad_value = visit_csv.replace("31.250", "invalid numeric text")
        bad = submit(bad_value, selected="J-24-B").json()["preview"]
        assert bad["errors"][0]["line"] == 2
        assert not submit(bad_value, "commit", bad["confirmation"], selected="J-24-B").json()["receipt"]
        assert panel_history() == history
