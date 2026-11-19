"""Read-only panel layout and inspection evidence for the Array Explorer."""

import os
import hashlib
import json
import sqlite3
from uuid import UUID, uuid4
from typing import Literal
from xml.etree.ElementTree import ParseError
from zipfile import BadZipFile

from fastapi import APIRouter, Depends, Form, HTTPException, Request, UploadFile
from pydantic import BaseModel, StringConstraints
from typing import Annotated
from collections import defaultdict

from solarpv_db.database import get_connection
from solarpv_db.equipment import EquipmentService
from solarpv_db.inspections import list_inspections
from solarpv_db.maintenance import list_maintenance_records
from solarpv_db.observations import list_observations
from solarpv_db.panel_demo import demo_database
from solarpv_db.panel_layout import read_layout
from solarpv_db.visits import VisitService
from solarpv_db.timestamps import normalize_timestamp, timestamp_kind
from solarpv_api.visit_routes import demo_service
from solarpv_api.asset_routes import trusted_local
from solarpv_db.panel_csv import IMPORT_ACTION, MAX_BYTES, preview_csv, save_csv

router = APIRouter(prefix="/panel-inspection", tags=["panel-inspection"])


class Panel(BaseModel):
    id: str
    row: str
    position: int
    layer: Literal["T", "B"]
    block: Literal["left", "right"]
    cell: str
    column: int
    sheet_row: int
    source_mark: bool
    inferred_number: bool
    x: float
    y: float
    width: float
    height: float
    number_y: float


class Layout(BaseModel):
    sheet: str
    source: str
    panels: list[Panel]


class Measurement(BaseModel):
    observation_type: str
    value: float | None
    unit: str | None
    data_quality: str
    source_reference: str | None = None
    recorded_at: str | None = None
    finding: str | None = None
    measurement_status: str | None = None


class Attachment(BaseModel):
    kind: str | None = None
    original_name: str
    path: str
    media_type: str


class Inspection(BaseModel):
    inspection_id: int
    inspected_at: str
    data_source: str | None
    data_origin: str
    inspection_method: str | None = None
    measurements: list[Measurement]
    attachments: list[Attachment]


class MaintenanceStatus(BaseModel):
    revision: int
    status: str
    notes: str
    recorded_at: str


class Maintenance(BaseModel):
    maintenance_id: int
    status_history: list[MaintenanceStatus] = []
    status: str | None = None
    related_inspection_id: int | None = None
    performed_at: str | None
    maintenance_type: str
    description: str
    data_origin: str


class PanelEvidence(BaseModel):
    panel: Panel
    inspections: list[Inspection]
    maintenance: list[Maintenance]
    module_model: str | None = None
    serial_number: str | None = None
    equipment_source: str | None = None
    manufacturer: str | None = None
    asset_id: int | None = None
    inverter: str | None = None
    string: str | None = None
    combiner: str | None = None


@router.get("/layout", response_model=Layout)
def layout():
    workbook = os.environ.get("SOLARPV_PANEL_WORKBOOK")
    if not workbook:
        raise HTTPException(503, "Configure SOLARPV_PANEL_WORKBOOK with the original array workbook.")
    try:
        return read_layout(workbook)
    except (BadZipFile, OSError, ParseError, ValueError, KeyError, TypeError, IndexError) as error:
        raise HTTPException(422, "The configured workbook does not match the verified SOLAR FARM layout.") from error


def evidence_scope(request, mode, workspace):
    settings = request.app.state.settings
    site = os.environ.get("SOLARPV_PANEL_LIVE_SITE")
    if mode == "demo":
        root = os.environ.get("SOLARPV_PANEL_DEMO_DIR")
        if not root:
            raise HTTPException(503, "Configure and seed the isolated Panel Inspection demo database.")
        database = demo_database(root)
        if database == settings.database_path.resolve() or not database.is_file():
            raise HTTPException(503, "Seed a separate Panel Inspection demo database.")
        workspace = "default"
        scope = "AND site_id IS NULL"
        parameters = ()
    else:
        if not site or not workspace:
            return None
        database = settings.database_path
        scope = "AND site_id = ? AND data_origin = 'real'"
        parameters = (site,)
    return database, workspace, scope, parameters


def scoped_asset(connection, scoped, panel_id):
    _, workspace, scope, parameters = scoped
    return connection.execute(
        "SELECT asset_id FROM assets_current WHERE workspace_id = ? AND external_id = ? "
        "AND asset_type = 'panel' " + scope, (workspace, panel_id, *parameters),
    ).fetchone()


def csv_scope(request, mode, workspace):
    scoped = evidence_scope(request, mode, workspace)
    if not scoped:
        raise HTTPException(409, "Choose a workspace and configure its live panel site before importing.")
    return scoped


@router.get("/csv-imports", dependencies=[Depends(trusted_local)])
def csv_history(request: Request, mode: Literal["demo", "live"] = "demo", workspace: str = ""):
    database, workspace, _, parameters = csv_scope(request, mode, workspace)
    scope = parameters[0] if parameters else "demo"
    with get_connection(database) as connection:
        rows = connection.execute(
            "SELECT created_at, metadata_json FROM audit_events WHERE workspace_id=? AND action=? AND target_id=? "
            "ORDER BY created_at DESC, rowid DESC LIMIT 20", (workspace, IMPORT_ACTION, scope),
        )
        return {"imports": [{**json.loads(row["metadata_json"]), "created_at": row["created_at"]} for row in rows]}


@router.post("/csv-imports/{operation}", dependencies=[Depends(trusted_local)])
def csv_import(operation: Literal["preview", "commit"], request: Request, file: UploadFile,
               mode: Literal["demo", "live"] = "demo", workspace: str = "",
               confirmed_digest: Annotated[str | None, Form()] = None,
               selected_panel: Annotated[str | None, Form(max_length=12)] = None):
    filename = (file.filename or "").replace("\\", "/").rsplit("/", 1)[-1]
    if not filename.lower().endswith(".csv") or len(filename) > 200 or any(ord(c) < 32 for c in filename):
        raise HTTPException(422, "Choose a CSV file with a valid filename.")
    content = file.file.read(min(MAX_BYTES, request.app.state.settings.max_file_bytes) + 1)
    if len(content) > min(MAX_BYTES, request.app.state.settings.max_file_bytes):
        raise HTTPException(413, "The inspection CSV exceeds the file size limit.")
    database, workspace, predicate, parameters = csv_scope(request, mode, workspace)
    workbook_ids = {panel["id"] for panel in layout()["panels"]}
    try:
        with get_connection(database) as connection:
            if operation == "commit":
                connection.execute("BEGIN IMMEDIATE")
            assets = dict(connection.execute(
                "SELECT external_id, asset_id FROM assets_current WHERE workspace_id=? AND asset_type='panel' "
                + predicate, (workspace, *parameters),
            ).fetchall())
            clocks = defaultdict(set)
            for row in connection.execute(
                "SELECT asset_id, inspected_at FROM inspections_current WHERE asset_id IN "
                "(SELECT asset_id FROM assets_current WHERE workspace_id=? AND asset_type='panel' "
                + predicate + ")", (workspace, *parameters),
            ):
                clocks[row["asset_id"]].add(timestamp_kind(row["inspected_at"]))
            origin = "synthetic" if mode == "demo" else "real"
            preview, visits = preview_csv(content, filename, assets, workbook_ids, clocks, origin, selected_panel)
            scope = parameters[0] if parameters else "demo"
            confirmation = hashlib.sha256(
                json.dumps([mode, workspace, scope, selected_panel, preview["digest"]]).encode()
            ).hexdigest()
            preview["confirmation"] = confirmation
            if operation == "preview" or preview["errors"]:
                return {"preview": preview, "receipt": None}
            if confirmed_digest != confirmation:
                raise HTTPException(409, "Preview and confirm this exact CSV before importing.")
            receipt = save_csv(connection, workspace, scope, origin, preview, visits)
            return {"preview": preview, "receipt": receipt}
    except sqlite3.IntegrityError as failure:
        raise HTTPException(409, "The file could not be saved. The import was rolled back.") from failure


class NoteInput(BaseModel):
    body: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=2000)]
    author: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120)]


class NoteEdit(NoteInput):
    expected_revision: int


class MaintenanceInput(BaseModel):
    request_id: UUID
    performed_at: str
    work: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=2000)]
    notes: Annotated[str, StringConstraints(strip_whitespace=True, max_length=2000)] = ""
    status: Literal["planned", "completed"]
    related_inspection_id: int | None = None


class MaintenanceStatusInput(BaseModel):
    expected_revision: int
    status: Literal["planned", "completed"]
    notes: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=2000)]


def note_scope(request, mode, workspace, panel_id):
    scoped = evidence_scope(request, mode, workspace)
    if scoped is None or not any(panel["id"] == panel_id for panel in layout()["panels"]):
        raise HTTPException(404, "Panel is unavailable in this workspace.")
    return scoped


def note_asset(connection, scoped, panel_id):
    asset = scoped_asset(connection, scoped, panel_id)
    if asset is None:
        raise HTTPException(404, "Register the panel before adding notes.")
    return asset["asset_id"]


@router.post("/panels/{panel_id}/maintenance/{maintenance_id}/status", status_code=201)
def update_maintenance_status(panel_id: str, maintenance_id: int, body: MaintenanceStatusInput, request: Request,
                              mode: Literal["demo", "live"] = "demo", workspace: str = ""):
    scoped = note_scope(request, mode, workspace, panel_id)
    origin = "synthetic" if mode == "demo" else "real"
    with get_connection(scoped[0]) as connection:
        connection.execute("BEGIN IMMEDIATE")
        asset = note_asset(connection, scoped, panel_id)
        record = connection.execute(
            "SELECT status FROM maintenance_records WHERE maintenance_id=? AND asset_id=? AND workspace_id=? AND data_origin=?",
            (maintenance_id, asset, scoped[1], origin),
        ).fetchone()
        if record is None:
            raise HTTPException(404, "This maintenance record is unavailable for the selected panel.")
        current = connection.execute(
            "SELECT revision,status,notes FROM maintenance_status_history WHERE maintenance_id=? ORDER BY revision DESC LIMIT 1",
            (maintenance_id,),
        ).fetchone()
        revision = current["revision"] if current else 0
        if current and revision == body.expected_revision + 1 and (current["status"], current["notes"]) == (body.status, body.notes):
            return {"revision": revision}
        if revision != body.expected_revision:
            raise HTTPException(409, "Status changed. Reload before updating.")
        connection.execute("INSERT INTO maintenance_status_history (maintenance_id,revision,status,notes) VALUES (?,?,?,?)",
                           (maintenance_id, revision + 1, body.status, body.notes))
        return {"revision": revision + 1}


@router.post("/panels/{panel_id}/maintenance", status_code=201)
def add_maintenance(panel_id: str, body: MaintenanceInput, request: Request,
                    mode: Literal["demo", "live"] = "demo", workspace: str = ""):
    scoped = note_scope(request, mode, workspace, panel_id)
    database, workspace, _, _ = scoped
    origin = "synthetic" if mode == "demo" else "real"
    try:
        performed_at = normalize_timestamp(body.performed_at)
    except (TypeError, ValueError) as error:
        raise HTTPException(422, "Use a valid maintenance date or timestamp.") from error
    with get_connection(database) as connection:
        connection.execute("BEGIN IMMEDIATE")
        asset = note_asset(connection, scoped, panel_id)
        if body.related_inspection_id is not None and not connection.execute(
            "SELECT 1 FROM inspections WHERE workspace_id=? AND asset_id=? AND inspection_id=? AND data_origin=?",
            (workspace, asset, body.related_inspection_id, origin),
        ).fetchone():
            raise HTTPException(422, "Choose an inspection from this panel.")
        values = (asset, performed_at, body.work, body.notes or body.work, body.status, body.related_inspection_id, origin)
        previous = connection.execute(
            "SELECT maintenance_id, asset_id, performed_at, maintenance_type, description, status, related_inspection_id, data_origin "
            "FROM maintenance_records WHERE workspace_id=? AND panel_request_id=?",
            (workspace, str(body.request_id)),
        ).fetchone()
        if previous:
            if tuple(previous)[1:] != values:
                raise HTTPException(409, "This request already saved a different maintenance record.")
            return {"maintenance_id": previous["maintenance_id"]}
        result = connection.execute(
            "INSERT INTO maintenance_records (asset_id,performed_at,maintenance_type,description,status,"
            "related_inspection_id,data_origin,workspace_id,panel_request_id) VALUES (?,?,?,?,?,?,?,?,?)",
            (*values, workspace, str(body.request_id)),
        )
        return {"maintenance_id": result.lastrowid}


def note_history(connection, asset_id):
    return [dict(row) for row in connection.execute(
        "SELECT note_id, revision, body, author, recorded_at FROM panel_note_revisions "
        "WHERE asset_id = ? ORDER BY recorded_at DESC, note_id, revision DESC", (asset_id,),
    )]


@router.get("/panels/{panel_id}/notes")
def panel_notes(panel_id: str, request: Request, mode: Literal["demo", "live"] = "demo", workspace: str = ""):
    scoped = note_scope(request, mode, workspace, panel_id)
    with get_connection(scoped[0]) as connection:
        return note_history(connection, note_asset(connection, scoped, panel_id))


@router.post("/panels/{panel_id}/notes/{note_id}", status_code=201)
def write_panel_note(panel_id: str, note_id: UUID, body: NoteEdit, request: Request,
                     mode: Literal["demo", "live"] = "demo", workspace: str = ""):
    scoped = note_scope(request, mode, workspace, panel_id)
    with get_connection(scoped[0]) as connection:
        connection.execute("BEGIN IMMEDIATE")
        asset_id = note_asset(connection, scoped, panel_id)
        return store_note(connection, asset_id, note_id, body)


def store_note(connection, asset_id, note_id, body):
    head = connection.execute(
        "SELECT asset_id, revision, body, author FROM panel_note_revisions WHERE note_id = ? "
        "ORDER BY revision DESC LIMIT 1", (str(note_id),),
    ).fetchone()
    if head and head["asset_id"] != asset_id:
        raise HTTPException(404, "Note is unavailable for this panel.")
    revision = head["revision"] if head else 0
    if head and revision == body.expected_revision + 1 and (head["body"], head["author"]) == (body.body, body.author):
        return note_history(connection, asset_id)
    if revision != body.expected_revision:
        raise HTTPException(409, "This note changed. Reload its history before editing.")
    connection.execute(
        "INSERT INTO panel_note_revisions (note_id, revision, asset_id, body, author) VALUES (?, ?, ?, ?, ?)",
        (str(note_id), revision + 1, asset_id, body.body, body.author),
    )
    return note_history(connection, asset_id)



@router.get("/coverage")
def coverage(request: Request, mode: Literal["demo", "live"] = "demo", workspace: str = ""):
    panels = {panel["id"] for panel in layout()["panels"]}
    scoped = evidence_scope(request, mode, workspace)
    if scoped is None:
        return {"with_inspections": None, "without_inspections": None}
    database, workspace, scope, parameters = scoped
    origin = "synthetic" if mode == "demo" else "real"
    with get_connection(database) as connection:
        rows = connection.execute(
            "SELECT external_id FROM assets_current WHERE workspace_id = ? AND asset_type = 'panel' "
            + scope + " AND EXISTS (SELECT 1 FROM inspections_current i WHERE i.asset_id = assets_current.asset_id "
            "AND i.workspace_id = assets_current.workspace_id AND i.data_origin = ?)",
            (workspace, *parameters, origin),
        )
        count = len(panels.intersection(row["external_id"] for row in rows))
    return {"with_inspections": count, "without_inspections": len(panels) - count}


@router.get("/panels/{panel_id}", response_model=PanelEvidence)
def panel_evidence(panel_id: str, request: Request, mode: Literal["demo", "live"] = "demo",
                   workspace: str = ""):
    panel = next((entry for entry in layout()["panels"] if entry["id"] == panel_id), None)
    if panel is None:
        raise HTTPException(404, "Panel ID is absent from the verified layout.")
    result = dict(panel=panel, inspections=[], maintenance=[])
    scoped = evidence_scope(request, mode, workspace)
    if scoped is None:
        return result
    database, workspace, scope, parameters = scoped
    with get_connection(database) as connection:
        asset = scoped_asset(connection, scoped, panel_id)
    if asset is None:
        return result
    asset_id = asset["asset_id"]
    origin = "synthetic" if mode == "demo" else "real"
    visits = demo_service(request) if mode == "demo" else VisitService(database, request.app.state.storage)
    result["asset_id"] = asset_id
    visit_base = "/panel-demo/visits" if mode == "demo" else f"/workspaces/{workspace}/visits"
    if mode == "live":
        configuration = EquipmentService(database).read(workspace, asset_id)["current"]
        if configuration and configuration["equipment_kind"] == "panel":
            for field, names in {
                "module_model": {"module model", "model"},
                "serial_number": {"serial number", "module serial number"},
                "manufacturer": {"manufacturer", "module manufacturer"},
                "inverter": {"inverter id", "connected inverter"},
                "string": {"string id", "connected string"},
                "combiner": {"combiner id", "connected combiner"},
            }.items():
                values = {item["value"] for item in configuration["specifications"]
                          if item["name"].lower().replace("_", " ").strip() in names and item["value"]}
                if len(values) == 1:
                    result[field] = values.pop()
                    result["equipment_source"] = configuration["source_reference"]
    try:
        inspections = list_inspections(asset_id, database, workspace_id=workspace)
    except ValueError as error:
        raise HTTPException(422, "The panel inspection timestamps cannot be compared.") from error
    for inspection in inspections:
        if inspection["data_origin"] != origin:
            continue
        identifier = inspection["inspection_id"]
        imported_visit = (inspection["data_source"] or "").startswith("Inspection CSV: ")
        detail = visits.read(workspace, identifier, limit=100 if imported_visit else 50)
        files = detail["attachments"]
        if imported_visit:
            observations = detail["observations"]["items"]
            for offset in range(100, detail["observations"]["total"], 100):
                observations.extend(visits.read(workspace, identifier, offset=offset, limit=100)["observations"]["items"])
        else:
            observations = list_observations(identifier, database, workspace_id=workspace)
        attachments = [
            dict(original_name=file["original_name"], media_type=file["media_type"], kind=file["kind"],
                 path=f"{visit_base}/{identifier}/attachments/{file['source_file_id']}")
            for file in files
        ]
        result["inspections"].append(dict(
            **inspection, attachments=attachments,
            measurements=[entry for entry in observations
                          if imported_visit or inspection["inspection_method"] == "Inspection CSV import"
                          or entry["observation_type"] in {"module_temperature", "delta_t", "ambient_temperature", "reference_temperature"}],
        ))
    result["maintenance"] = [
        record for record in list_maintenance_records(asset_id, database, workspace_id=workspace)
        if record["data_origin"] == origin
    ]
    with get_connection(database) as connection:
        for record in result["maintenance"]:
            record["status_history"] = [dict(revision) for revision in connection.execute(
                "SELECT revision,status,notes,recorded_at FROM maintenance_status_history WHERE maintenance_id=? ORDER BY revision DESC",
                (record["maintenance_id"],),
            )]
    return result
