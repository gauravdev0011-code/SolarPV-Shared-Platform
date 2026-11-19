"""Read imported inverter configuration and drawing markers; no device I/O."""

import json
from uuid import UUID

from fastapi import APIRouter, HTTPException, Request

from solarpv_api.panel_routes import NoteEdit, note_history, store_note
from solarpv_db.database import get_connection

from solarpv_db.maintenance import list_maintenance_records

PLAN_SOURCE = "Illustrative equipment marker locations"
PLAN_POINTS = [(700, 70), (700, 230), (700, 390), (700, 550),
               (1250, 70), (1250, 230), (1250, 390), (1250, 550)]

router = APIRouter(prefix="/api/v1/workspaces/{workspace}/inverters", tags=["inverters"])


def imported_asset(connection, workspace, asset_id):
    if not connection.execute(
        """SELECT 1 FROM assets a JOIN inverter_configuration_imports c USING (asset_id)
           WHERE a.workspace_id=? AND a.asset_id=? AND a.asset_type='inverter'""", (workspace, asset_id),
    ).fetchone():
        raise HTTPException(404, "Imported inverter was not found in this workspace.")


@router.get("")
def inventory(workspace: str, request: Request):
    with get_connection(request.app.state.settings.database_path) as connection:
        rows = connection.execute(
            """SELECT a.asset_id, a.external_id, c.source_json, c.source_reference, c.imported_at,
                      m.plan_label, m.evidence, m.confirmed_by, m.confirmed_at
               FROM assets a JOIN inverter_configuration_imports c USING (asset_id)
               LEFT JOIN inverter_plan_confirmations m USING (asset_id)
               WHERE a.workspace_id=? AND a.asset_type='inverter' ORDER BY a.external_id""", (workspace,),
        ).fetchall()
        items = []
        for row in rows:
            item = dict(row)
            configuration = json.loads(item.pop("source_json"))
            # Explicit response fields keep private endpoint data out of API responses.
            public = {key: configuration[key] for key in (
                "device", "logger_uid", "comm_id", "manufacturer", "model", "tag_mapping",
                "serial_number", "monitored", "polling_interval", "polling_unit", "tag_offset",
                "run_kpis", "port", "protocol", "ac_capacity_kw", "dc_capacity_kw",
                "configured_efficiency_percent",
            )}
            items.append({**item, **public})
    return {"items": items, "plan_source": PLAN_SOURCE,
            "markers": [{"label": f"INV.{i:02d}", "x": x, "y": y, "proposed_device": f"INVT-{i:03d}"}
                        for i, (x, y) in enumerate(PLAN_POINTS, 1)]}


@router.get("/{asset_id}/maintenance")
def maintenance(workspace: str, asset_id: int, request: Request):
    database = request.app.state.settings.database_path
    with get_connection(database) as connection:
        imported_asset(connection, workspace, asset_id)
    return list_maintenance_records(asset_id, database, workspace_id=workspace)


@router.get("/{asset_id}/notes")
def notes(workspace: str, asset_id: int, request: Request):
    with get_connection(request.app.state.settings.database_path) as connection:
        imported_asset(connection, workspace, asset_id)
        return note_history(connection, asset_id)


@router.post("/{asset_id}/notes/{note_id}", status_code=201)
def write_note(workspace: str, asset_id: int, note_id: UUID, body: NoteEdit, request: Request):
    with get_connection(request.app.state.settings.database_path) as connection:
        connection.execute("BEGIN IMMEDIATE")
        imported_asset(connection, workspace, asset_id)
        return store_note(connection, asset_id, note_id, body)
