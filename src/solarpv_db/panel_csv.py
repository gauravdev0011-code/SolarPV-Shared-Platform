"""Preview and commit panel inspection CSVs using the visit and audit tables."""

import csv
import hashlib
import io
import json
from uuid import NAMESPACE_URL, uuid5

from solarpv_db.inspections import create_inspection
from solarpv_db.timestamps import normalize_timestamp, timestamp_kind
from solarpv_db.visits import QUANTITY_UNITS, VisitService, numeric
from solarpv_db.asset_registration import RegistrationError


COLUMNS = ("panel_id", "inspected_at", "data_source", "measurement", "quantity", "value", "unit", "finding")
VISIT_COLUMNS = ("panel_id", "visit_timestamp", "visit_origin", "inspection_method", "measurement", "value",
                 "unit", "measurement_status", "notes")
ORIGINS = {"synthetic": "synthetic", "demo": "synthetic", "simulated": "synthetic", "synthetic demo": "synthetic",
           "real": "real", "field": "real", "actual": "real", "live": "real"}
STATUS_QUALITIES = {"valid": "good", "good": "good", "suspect": "suspect", "invalid": "invalid"}
MAX_BYTES = 1024 * 1024
MAX_ROWS = 1000
IMPORT_ACTION = "panel.csv.import"


def quantity_for_unit(name, unit):
    if name in {"module_temperature", "ambient_temperature", "reference_temperature", "delta_t"}:
        return "temperature"
    choices = [quantity for quantity, units in QUANTITY_UNITS.items() if unit in units]
    if not choices and unit:
        raise ValueError(f"Unsupported measurement unit {unit!r}.")
    return choices[0] if len(choices) == 1 else None


def preview_csv(content, filename, assets, workbook_ids, clocks, origin, selected_panel=None):
    preview = {"filename": filename, "digest": hashlib.sha256(content).hexdigest(), "rows": [],
               "errors": [], "inspection_count": 0}
    visits = {}

    def error(line, message):
        preview["errors"].append({"line": line, "message": message})

    try:
        reader = csv.reader(io.StringIO(content.decode("utf-8-sig"), newline=""), strict=True)
        headers = [field.strip() for field in next(reader, [])]
        if {"timestamp", "voltage_v", "current_a"}.issubset(field.lower() for field in headers):
            error(1, "This is an I-V curve CSV. Use Upload File → CSV evidence to keep the curve with an inspection. For Measurements, use a visit CSV with panel_id, visit_timestamp, and one row per named reading.")
            return preview, visits
        visit_format = len(headers) == len(VISIT_COLUMNS) and set(headers) == set(VISIT_COLUMNS)
        if not visit_format and (len(headers) != len(COLUMNS) or set(headers) != set(COLUMNS)):
            error(1, "Use the visit CSV columns or the eight-column measurement format listed under CSV format.")
            return preview, visits
        preview["columns"] = list(headers)
        count = 0
        while True:
            line = reader.line_num + 1
            values = next(reader, None)
            if values is None:
                break
            if not values:
                continue
            count += 1
            if count > MAX_ROWS:
                error(line, f"Limit each import to {MAX_ROWS} data rows.")
                break
            if len(values) != len(headers):
                error(line, f"Expected {len(headers)} columns. Quote values that contain commas.")
                continue
            row = dict(zip(headers, values, strict=True))
            preview["rows"].append({"line": line, **row})
            try:
                if any("\x00" in value or len(value) > (2000 if name in {"value", "finding", "notes"} else 200)
                       for name, value in row.items()):
                    raise ValueError("Fields contain invalid characters or exceed their length limit.")
                panel = row["panel_id"].strip()
                if selected_panel and panel != selected_panel:
                    raise ValueError(f"CSV panel {panel or '(blank)'} does not match selected panel {selected_panel}.")
                if panel not in workbook_ids:
                    raise ValueError("Panel ID is absent from the SOLAR FARM workbook. Use the full ID, such as H-04-T.")
                if panel not in assets:
                    raise ValueError("Register this workbook panel in the configured site before importing.")
                timestamp = row["visit_timestamp"] if visit_format else row["inspected_at"]
                inspected_at = normalize_timestamp(timestamp)
                asset = assets[panel]
                kind = timestamp_kind(inspected_at)
                if clocks.get(asset, {kind}) != {kind}:
                    raise ValueError("Timestamp clock does not match this panel’s history. Use its documented timezone policy.")
                name, unit = row["measurement"].strip(), row["unit"].strip() or None
                if not name:
                    raise ValueError("Measurement is required.")
                original = row["value"] if row["value"].strip() else None
                method, status, quality = "Inspection CSV import", None, "unknown"
                if visit_format:
                    source, method = f"Inspection CSV: {filename}"[:200], row["inspection_method"].strip()
                    if not method:
                        raise ValueError("Inspection method is required.")
                    if ORIGINS.get(row["visit_origin"].strip().lower()) != origin:
                        raise ValueError(f"Visit origin must be {'synthetic in the demo' if origin == 'synthetic' else 'real in the live workspace'}.")
                    status, finding = row["measurement_status"].strip(), row["notes"].strip()
                    normalized = status.lower()
                    if not normalized:
                        raise ValueError("Measurement status is required. Use missing for a blank value.")
                    if (normalized == "missing") != (original is None):
                        raise ValueError("A missing measurement must have a blank value. Other statuses need a numeric value.")
                    quality = STATUS_QUALITIES.get(normalized, "unknown")
                    quantity = quantity_for_unit(name, unit)
                    if original is not None and not unit:
                        raise ValueError("Provide the original measurement unit for a numeric value.")
                else:
                    source, quantity, finding = (row[field].strip() for field in ("data_source", "quantity", "finding"))
                    if not source:
                        raise ValueError("Data source is required.")
                    if quantity not in QUANTITY_UNITS or not unit:
                        raise ValueError("Provide a supported quantity and its original measurement unit.")
                    if original is None and not finding:
                        raise ValueError("Leave value blank and supply a finding to record a missing measurement.")
                if quantity is None and unit and original is not None:
                    # An explicitly supplied supported unit can belong to multiple quantities.
                    validation_quantity = next(kind for kind, units in QUANTITY_UNITS.items() if unit in units)
                else:
                    validation_quantity = quantity
                value = numeric(original.strip() if original is not None else None, unit, validation_quantity, name)
                key = (asset, inspected_at)
                visit = visits.setdefault(key, {"panel": panel, "source": source, "method": method, "readings": {}})
                if (visit["source"], visit["method"]) != (source, method):
                    raise ValueError("Rows for this panel and timestamp must agree on data source and inspection method.")
                if name in visit["readings"]:
                    raise ValueError("This measurement is repeated for the same panel and timestamp.")
                visit["readings"][name] = (value, {
                    "observation_type": name, "value": original, "quantity": quantity, "unit": unit,
                    "finding": finding or None, "data_quality": quality,
                    "measurement_status": status,
                    "source_reference": f"{filename}, row {line}; source timestamp {timestamp}",
                })
                clocks.setdefault(asset, {kind})
            except (ValueError, RegistrationError) as failure:
                error(line, str(failure))
    except UnicodeDecodeError:
        error(1, "Save the file as UTF-8 CSV.")
    except csv.Error:
        error(reader.line_num or 1, "CSV quoting is invalid or a field is too large.")
    if not preview["rows"] and not preview["errors"]:
        error(2, "Add at least one inspection measurement row.")
    preview["inspection_count"] = len(visits)
    return preview, visits


def save_csv(connection, workspace, scope, origin, preview, visits):
    receipt = uuid5(NAMESPACE_URL, f"solaris:panel-csv:{workspace}:{scope}:{preview['digest']}").hex
    prior = connection.execute("SELECT metadata_json FROM audit_events WHERE audit_event_id=?", (receipt,)).fetchone()
    if prior:
        return {**json.loads(prior[0]), "duplicate": True}
    result = {"import_id": receipt, "filename": preview["filename"], "digest": preview["digest"],
              "inspections": [], "measurement_count": len(preview["rows"]), "scope": scope, "origin": origin}
    for (asset, inspected_at), visit in visits.items():
        header = {"inspected_at": inspected_at, "inspection_method": visit["method"],
                  "data_source": visit["source"], "status": "completed"}
        inspection = create_inspection(asset, data_origin=origin, workspace_id=workspace, connection=connection, **header)
        revision = uuid5(NAMESPACE_URL, f"{receipt}:{inspection}").hex
        inputs = [reading for _, reading in visit["readings"].values()]
        values = [value for value, _ in visit["readings"].values()]
        VisitService.record_readings(connection, workspace, inspection, revision, 1, header, inputs,
                                     values, [], f"Imported from {preview['filename']}")
        result["inspections"].append({"inspection_id": inspection, "panel_id": visit["panel"], "inspected_at": inspected_at})
    connection.execute(
        "INSERT INTO audit_events(audit_event_id,workspace_id,action,target_type,target_id,outcome,metadata_json) "
        "VALUES(?,?,?,?,?,'succeeded',?)", (receipt, workspace, IMPORT_ACTION, "panel_inspection_csv", scope, json.dumps(result)),
    )
    return {**result, "duplicate": False}
