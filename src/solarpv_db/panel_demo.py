"""Seed the isolated Panel Inspection demo using the normal SOLARIS importer."""

import json
import os
from pathlib import Path
from tempfile import NamedTemporaryFile

from solarpv_db.database import initialize_database
from solarpv_db.importer import import_data
from solarpv_db.panel_layout import read_layout

DEMO_LABEL = "DEMO DATA — NOT REAL DRONE MEASUREMENTS"
DEMO_PANELS = ("H-04-T", "H-04-B", "A-01-T", "E-82-B", "F-82-T", "M-17-T", "P-81-B")


def demo_database(root):
    return Path(root).resolve() / "panel-inspection-demo.sqlite3"


def seed(workbook, root):
    layout = read_layout(workbook)
    identities = {panel["id"] for panel in layout["panels"]}
    if not set(DEMO_PANELS) <= identities:
        raise ValueError("The workbook does not contain every demonstration panel.")
    database = demo_database(root)
    configured = os.environ.get("SOLARPV_DB_PATH")
    if configured and database == Path(configured).resolve():
        raise ValueError("The demo database must be separate from the application database.")
    dataset = {"assets": [], "inspections": [], "observations": [], "maintenance": []}
    for panel in layout["panels"]:
        dataset["assets"].append(dict(external_id=panel["id"], asset_type="panel", name=panel["id"]))
    for index, panel_id in enumerate(DEMO_PANELS):
        dates = ("2026-10-14", "2026-10-28", "2026-11-12") if index < 4 else ("2026-10-28", "2026-11-12")
        for visit, day in enumerate(dates):
            key = f"{panel_id}-{day}"
            dataset["inspections"].append(dict(
                inspection_key=key, asset_external_id=panel_id, inspected_at=f"{day}T16:24:00Z",
                inspection_method="Simulated RGB and thermal", data_source=DEMO_LABEL,
                data_origin="synthetic", status="completed",
            ))
            values = {
                "module_temperature": round(34.5 + index * 0.6 + visit * 1.1, 1),
                "delta_t": round(0.3 + visit * 0.4, 1),
            }
            if (index, visit) == (0, 1):
                values.clear()
            for quantity, value in values.items():
                dataset["observations"].append(dict(
                    inspection_key=key, observation_type=quantity, value=value, unit="°C",
                    data_quality="unknown", source_reference=DEMO_LABEL,
                ))
    dataset["maintenance"].append(dict(
        asset_external_id=DEMO_PANELS[0], performed_at="2026-10-30T16:00:00Z",
        maintenance_type="Simulated cleaning log",
        description=f"{DEMO_LABEL}. Example record for a scheduled surface cleaning.",
        data_origin="synthetic",
    ))
    database.parent.mkdir(parents=True, exist_ok=True)
    initialize_database(database)
    with NamedTemporaryFile(mode="w", dir=database.parent, suffix=".json", encoding="utf-8",
                            delete=False) as temporary:
        source = Path(temporary.name)
        json.dump(dataset, temporary, sort_keys=True)
    try:
        return import_data(source, database)
    finally:
        source.unlink()


if __name__ == "__main__":
    print(seed(os.environ["SOLARPV_PANEL_WORKBOOK"], os.environ["SOLARPV_PANEL_DEMO_DIR"]))
