"""Bounded deterministic validation for registered CSV and JSON datasets."""

from __future__ import annotations

import csv
import io
import json
import math
import re
from datetime import date, datetime
from decimal import Decimal
from typing import Callable, Iterator
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from solarpv_ingestion.processing import InvalidInputError, _reject_constant, csv_delimiter, SourceNumber, source_json_value, preview_value
from solarpv_ingestion.storage import LocalArtifactStorage

# Migration 009's database guards pin the first persisted rule-set identity.
# Scale clarification extends the existing checks without changing that contract.
VALIDATION_RULE_SET = "solarpv.dataset-rules-v1"
TELEMETRY_RULE_VERSION = "solaris.telemetry-v2"
MAX_VALIDATION_ROWS = 1_000_000
MAX_VALIDATION_COLUMNS = 500
MAX_VALIDATION_CELL_CHARS = 1_000_000
MAX_ERROR_DETAILS = 1_000
MAX_RESULT_BYTES = 1_000_000
MAX_VALIDATION_CELLS = 10_000_000
MAX_ISSUE_ARTIFACT_BYTES = 50 * 1024 * 1024
MAX_ISSUE_COUNT = 100_000
_TEXT_NULL_MARKERS = {"null", "none", "na", "n/a", "<null>"}
EXPECTED_UNITS = {
    "reactive_power": {"var", "kvar", "Mvar"},
    "voltage": {"V", "kV"},
    "current": {"A", "mA"},
    "state_of_charge": {"%", "ratio"},
    "energy_consumption": {"Wh", "kWh", "MWh"},
    "accumulated_ac_energy": {"Wh", "kWh", "MWh"},
    "energy_accumulated": {"Wh", "kWh", "MWh"},
    "apparent_power": {"VA", "kVA", "MVA"},
    "power_factor": {"ratio", "%"},
    "frequency": {"Hz", "kHz"},
    "total_real_power": {"W", "kW", "MW"},
    "phase_a_power": {"W", "kW", "MW"},
    "phase_b_power": {"W", "kW", "MW"},
    "phase_c_power": {"W", "kW", "MW"},
}


def read_records(
    storage: LocalArtifactStorage,
    storage_key: str,
    filename: str,
    *,
    max_json_bytes: int,
    max_rows: int = MAX_VALIDATION_ROWS,
    max_columns: int = MAX_VALIDATION_COLUMNS,
    max_cell_chars: int = MAX_VALIDATION_CELL_CHARS,
) -> tuple[list[str], Iterator[tuple[int, dict[str, object]]]]:
    """Return headers and a streaming record iterator; JSON is byte bounded."""
    suffix = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    if suffix == "csv":
        raw = storage.open_read(storage_key)
        text = io.TextIOWrapper(raw, encoding="utf-8-sig", errors="strict", newline="")
        try:
            reader = csv.reader(text, delimiter=csv_delimiter(text), strict=True)
            headers = next(reader, None)
            if not headers:
                text.close()
                raise InvalidInputError("CSV must include a header row.")
            _validate_headers(headers, max_columns)
        except (UnicodeDecodeError, csv.Error, StopIteration) as error:
            text.close()
            raise InvalidInputError("CSV header is malformed or is not valid UTF-8.") from error

        def csv_rows() -> Iterator[tuple[int, dict[str, object]]]:
            try:
                for record_number, row in enumerate(reader, start=1):
                    number = reader.line_num
                    if record_number > max_rows:
                        raise InvalidInputError(f"Dataset exceeds the {max_rows}-row validation limit.")
                    if len(row) != len(headers):
                        raise InvalidInputError(
                            f"CSV row {number} has {len(row)} fields; expected {len(headers)}."
                        )
                    if any(len(value) > max_cell_chars for value in row):
                        raise InvalidInputError(f"CSV row {number} contains a field exceeding the size limit.")
                    yield number, dict(zip(headers, row, strict=True))
            except (UnicodeDecodeError, csv.Error) as error:
                raise InvalidInputError(f"Malformed CSV: {error}") from error
            finally:
                text.close()

        return headers, csv_rows()

    if suffix != "json":
        raise InvalidInputError("Only CSV and JSON datasets are supported.")
    try:
        with storage.open_read(storage_key) as stream:
            content = stream.read(max_json_bytes + 1)
        if len(content) > max_json_bytes:
            raise InvalidInputError(f"JSON exceeds the {max_json_bytes}-byte validation limit.")
        document = json.loads(content.decode("utf-8-sig"), parse_constant=_reject_constant, parse_float=SourceNumber)
    except (OSError, UnicodeDecodeError, json.JSONDecodeError, ValueError) as error:
        if isinstance(error, InvalidInputError):
            raise
        raise InvalidInputError(f"Malformed JSON: {error}") from error

    records = document if isinstance(document, list) else (
        document["records"] if isinstance(document, dict) and isinstance(document.get("records"), list)
        else [document]
    )
    if not all(isinstance(record, dict) for record in records):
        raise InvalidInputError("JSON dataset records must be objects.")
    if len(records) > max_rows:
        raise InvalidInputError(f"Dataset exceeds the {max_rows}-row validation limit.")
    headers: list[str] = []
    for record in records:
        for key in record:
            if not isinstance(key, str):
                raise InvalidInputError("JSON record field names must be strings.")
            if key not in headers:
                headers.append(key)
                if len(headers) > max_columns:
                    raise InvalidInputError(f"Dataset exceeds the {max_columns}-column validation limit.")
    _validate_headers(headers, max_columns)

    def json_rows() -> Iterator[tuple[int, dict[str, object]]]:
        for index, record in enumerate(records, start=1):
            yield index, record

    return headers, json_rows()


def preview_records(
    storage: LocalArtifactStorage,
    storage_key: str,
    filename: str,
    *,
    limit: int,
    max_json_bytes: int,
    bounded: bool = True,
) -> dict:
    if not 1 <= limit <= 100:
        raise ValueError("Preview limit must be between 1 and 100.")
    headers, rows = read_records(
        storage, storage_key, filename, max_json_bytes=max_json_bytes,
        max_rows=MAX_VALIDATION_ROWS,
    )
    samples = []; source_rows = []; truncated_cells = []; budget=[200_000]
    try:
        for source_row, record in rows:
            sample={}
            for name,value in source_json_value(record).items():
                sample[name],cut=preview_value(value,budget) if bounded else (value,False)
                if cut:truncated_cells.append({"source_row":source_row,"field":name})
            samples.append(sample);source_rows.append(source_row)
            if len(samples) == limit:
                break
    finally:
        close = getattr(rows, "close", None)
        if close is not None:
            close()
    return {"columns": headers, "rows": samples, "source_rows":source_rows, "truncated_cells":truncated_cells, "returned_rows": len(samples), "limit": limit}


def validate_records(
    storage: LocalArtifactStorage,
    storage_key: str,
    filename: str,
    mappings: list[dict],
    *,
    max_json_bytes: int,
    issue_sink: Callable[[dict], None] | None = None,
    policy: dict | None = None,
) -> dict:
    policy = validate_policy(policy)
    headers, rows = read_records(
        storage, storage_key, filename, max_json_bytes=max_json_bytes,
    )
    errors: list[dict] = []
    warnings: list[dict] = []
    error_count = 0
    warning_count = 0
    affected_record_count = 0
    affected_columns: set[str] = set()
    current_row_has_issue = False

    def add(target: list, kind: str, row: int | None, field: str | None, code: str, message: str,
            observed: object = None) -> None:
        nonlocal error_count, warning_count, current_row_has_issue
        issue = {"severity": kind, "row": row, "field": field, "code": code, "message": message}
        if observed is not None:
            value_text = str(observed)
            issue["observed_value_preview"] = value_text[:200]
            issue["observed_value_truncated"] = len(value_text) > 200
        if issue_sink is not None:
            issue_sink(issue)
        if row is not None:
            current_row_has_issue = True
        if field:
            affected_columns.add(field)
        if kind == "error":
            error_count += 1
            if len(errors) < MAX_ERROR_DETAILS:
                errors.append({"row": row, "field": field, "code": code, "message": message})
        else:
            warning_count += 1
            if len(warnings) < MAX_ERROR_DETAILS:
                warnings.append({"row": row, "field": field, "code": code, "message": message})

    if not mappings:
        add(warnings, "warning", None, None, "mapping_not_defined",
            "No column mapping is defined; the dataset was checked for readable structure only.")
    mapped = {item["source_column"] for item in mappings}
    ambiguous_power_factor_headers = [
        name for name in headers if name not in mapped and _is_percent_power_factor_header(name)
    ]
    for mapping in mappings:
        allowed_units = EXPECTED_UNITS.get(mapping["target_field"])
        if allowed_units is not None:
            unit = mapping.get("measurement_unit")
            if not unit:
                required_unit = bool(mapping.get("is_required"))
                add(errors if required_unit else warnings, "error" if required_unit else "warning", None, mapping["source_column"], "measurement_unit_missing",
                    "A measurement unit is not recorded for this mapped field.")
            elif unit not in allowed_units:
                add(errors, "error", None, mapping["source_column"], "measurement_unit_unrecognized",
                    "The recorded unit is not in the supported unit list for this field.")
            elif (mapping["target_field"] == "power_factor" and unit == "%"
                  and mapping.get("value_scale") is None):
                add(warnings, "warning", None, mapping["source_column"], "power_factor_percent_scale_review",
                    "Power factor is labeled as a percentage. Confirm whether values use 0–1 or 0–100 scale; no conversion is applied.")
        if mapping["source_column"] not in headers:
            add(errors, "error", None, mapping["source_column"], "source_column_missing",
                "Mapped source column does not exist in the dataset.")
    for name in headers:
        if name not in mapped:
            if name in ambiguous_power_factor_headers:
                add(warnings, "warning", None, name, "power_factor_percent_scale_review",
                    "Power factor is labeled as a percentage. Confirm whether values use 0–1 or 0–100 scale; no conversion is applied.")
            else:
                add(warnings, "warning", None, name, "unmapped_column", "Source column has no target mapping.")

    row_count = 0
    previous_timestamps = {}
    seen_timestamps = {}
    previous_counters = {}
    try:
        for row_number, record in rows:
            row_count += 1
            if row_count > MAX_VALIDATION_ROWS:
                raise InvalidInputError(f"Dataset exceeds the {MAX_VALIDATION_ROWS}-row validation limit.")
            if row_count * max(1, len(mappings)) > MAX_VALIDATION_CELLS:
                raise ValidationResourceLimitError(
                    f"Validation exceeds the {MAX_VALIDATION_CELLS:,}-cell processing limit."
                )
            current_row_has_issue = False
            for mapping in mappings:
                field = mapping["source_column"]
                # An absent JSON key is a missing reading, including required fields.
                value = record.get(field)
                empty = value is None or isinstance(value,str) and not value.strip()
                null_marker = isinstance(value, str) and value.strip().casefold() in _TEXT_NULL_MARKERS
                if (empty or null_marker) and mapping["is_required"]:
                    code = "required_null_marker" if null_marker else "required_value_missing"
                    message = "Required value uses a textual null marker." if null_marker else "Required value is empty or missing."
                    add(errors, "error", row_number, field, code, message, value)
                    continue
                if empty or null_marker:
                    code = "optional_null_marker" if null_marker else "optional_value_missing"
                    message = "A textual null marker is present for this optional reading." if null_marker else "A reading is missing for this optional mapped field."
                    add(warnings, "warning", row_number, field, code, message, value)
                    continue
                issue = _type_issue(value, mapping)
                if issue:
                    add(errors, "error", row_number, field, issue,
                        f"Value does not match expected type '{mapping['expected_type']}'.", value)
                elif mapping.get("target_field") == "timestamp" and mapping["expected_type"] in {"datetime", "date"}:
                    parsed = datetime.strptime(str(value).strip(), mapping["timestamp_format"]) if mapping.get("timestamp_format") else datetime.fromisoformat(str(value).strip().replace("Z", "+00:00"))
                    seen = seen_timestamps.setdefault(field, set())
                    if parsed in seen:
                        add(warnings, "warning", row_number, field, "timestamp_duplicate",
                            "A timestamp repeats an earlier source timestamp. Both rows are preserved.", value)
                    previous = previous_timestamps.get(field)
                    if previous is not None:
                        try:
                            expected = policy.get("expected_interval_seconds")
                            elapsed = (parsed - previous).total_seconds()
                            if expected and elapsed > expected:
                                add(warnings, "warning", row_number, field, "missing_expected_interval",
                                    f"Timestamp interval is {elapsed:g} seconds; the documented expected interval is {expected:g} seconds. No readings were interpolated.", value)
                            if parsed < previous:
                                add(warnings, "warning", row_number, field, "timestamp_out_of_order",
                                    "This timestamp precedes the previous source row. Source order is preserved.", value)
                        except TypeError:
                            add(warnings, "warning", row_number, field, "timestamp_timezone_mixed",
                                "Timestamp timezone representations are inconsistent; no timezone was inferred.", value)
                    seen.add(parsed)
                    previous_timestamps[field] = parsed
                elif mapping.get("target_field") in {"energy_accumulated", "accumulated_ac_energy"} and mapping["expected_type"] in {"number", "integer"}:
                    current = Decimal(getattr(value, "source_literal", str(value)))
                    if field in previous_counters and current < previous_counters[field]:
                        add(warnings, "warning", row_number, field, "energy_counter_decrease",
                            "A cumulative reading decreased. A reset, rollover, or source correction is possible; no production total was inferred.", value)
                    previous_counters[field] = current
                elif mapping.get("target_field") == "frequency" and mapping["expected_type"] in {"number", "integer"} and mapping.get("measurement_unit") == "Hz" and 700 <= abs(float(value)) <= 900:
                    add(warnings, "warning", row_number, field, "frequency_semantic_review",
                        "Frequency-labelled readings are near 800 Hz. Confirm source semantics and equipment context; this is a hypothesis for review, not a physical fault diagnosis.", value)
                elif mapping.get("target_field") == "state_of_charge" and mapping["expected_type"] in {"number", "integer"} and mapping.get("measurement_unit") in {"%", "ratio"}:
                    bound = 100 if mapping["measurement_unit"] == "%" else 1
                    if not 0 <= float(value) <= bound:
                        add(warnings, "warning", row_number, field, "soc_representation_range",
                            "State of charge is outside its mapped representation range. Verify source semantics; values were preserved.", value)
                elif mapping.get("target_field") == "power_factor" and (mapping.get("value_scale") or mapping.get("measurement_unit") == "ratio") and mapping["expected_type"] in {"number", "integer"}:
                    scale_limit = 1 if mapping.get("value_scale") == "ratio_0_1" or mapping.get("measurement_unit") == "ratio" else 100
                    if abs(Decimal(getattr(value,"source_literal",str(value)))) > scale_limit:
                        add(errors, "error", row_number, field, "power_factor_outside_confirmed_scale",
                            f"Value is outside the confirmed power-factor scale (±{scale_limit}).", value)
                limit = policy.get("equipment_limits", {}).get(field)
                if limit and mapping.get("measurement_unit") == limit["unit"] and not issue and not empty and not null_marker and mapping["expected_type"] in {"number", "integer"}:
                    measured = Decimal(getattr(value,"source_literal",str(value)))
                    if ("min" in limit and measured < Decimal(str(limit["min"]))) or ("max" in limit and measured > Decimal(str(limit["max"]))):
                        blocking = limit.get("blocking", False)
                        add(errors if blocking else warnings, "error" if blocking else "warning", row_number, field, "equipment_limit_review",
                            "Reading is outside the explicitly supplied equipment limits. Verify equipment context; the source value was preserved.", value)
            for field in ambiguous_power_factor_headers:
                value = record.get(field)
                if value is None or isinstance(value,str) and not value.strip():
                    add(warnings, "warning", row_number, field, "optional_value_missing",
                        "A reading is missing for this optional mapped field.", value)
                elif isinstance(value, str) and value.strip().casefold() in _TEXT_NULL_MARKERS:
                    add(warnings, "warning", row_number, field, "optional_null_marker",
                        "A textual null marker is present for this optional reading.", value)
                elif _type_issue(value, {"expected_type": "number"}) == "invalid_number":
                    add(errors, "error", row_number, field, "invalid_number",
                        "Value does not match expected type 'number'.", value)
            if current_row_has_issue:
                affected_record_count += 1
    except ValidationResourceLimitError:
        raise
    except InvalidInputError as error:
        add(errors, "error", None, None, "malformed_dataset", str(error)[:300])
    finally:
        close = getattr(rows, "close", None)
        if close is not None:
            close()

    outcome = "failed" if error_count else "warnings" if warning_count else "passed"
    return {
        "rule_set_version": VALIDATION_RULE_SET,
        "telemetry_rule_version": TELEMETRY_RULE_VERSION,
        "policy": policy,
        "outcome": outcome,
        "row_count": row_count,
        "error_count": error_count,
        "warning_count": warning_count,
        "affected_record_count": affected_record_count,
        "affected_column_count": len(affected_columns),
        "error_details_truncated": error_count > len(errors),
        "warning_details_truncated": warning_count > len(warnings),
        "errors": errors,
        "warnings": warnings,
        "limits": {
            "max_rows": MAX_VALIDATION_ROWS,
            "max_columns": MAX_VALIDATION_COLUMNS,
            "max_cell_chars": MAX_VALIDATION_CELL_CHARS,
            "max_error_details": MAX_ERROR_DETAILS,
            "max_validation_cells": MAX_VALIDATION_CELLS,
            "max_issue_artifact_bytes": MAX_ISSUE_ARTIFACT_BYTES,
        },
    }


def validate_policy(policy):
    if policy is None:
        return {}
    if not isinstance(policy, dict) or set(policy) - {"expected_interval_seconds", "equipment_limits"}:
        raise InvalidInputError("Validation policy supports expected_interval_seconds and equipment_limits only.")
    interval = policy.get("expected_interval_seconds")
    if interval is not None and (isinstance(interval, bool) or not isinstance(interval, (int, float)) or not math.isfinite(interval) or interval <= 0):
        raise InvalidInputError("Expected interval must be a positive finite number of seconds.")
    limits = policy.get("equipment_limits", {})
    if not isinstance(limits, dict) or len(limits) > 500:
        raise InvalidInputError("Equipment limits must be an object with at most 500 source fields.")
    for field, item in limits.items():
        if not isinstance(field, str) or not isinstance(item, dict) or set(item) - {"unit", "min", "max", "blocking"} or not isinstance(item.get("unit"), str) or not ({"min", "max"} & set(item)):
            raise InvalidInputError("Each equipment limit needs an explicit unit and minimum or maximum.")
        for bound in ("min", "max"):
            if bound in item and (isinstance(item[bound], bool) or not isinstance(item[bound], (int, float)) or not math.isfinite(item[bound])):
                raise InvalidInputError("Equipment bounds must be finite numbers.")
        if "min" in item and "max" in item and item["min"] > item["max"]:
            raise InvalidInputError("Equipment minimum cannot exceed maximum.")
        if not isinstance(item.get("blocking", False), bool):
            raise InvalidInputError("Equipment limit blocking must be a boolean.")
    return policy


class ValidationResourceLimitError(InvalidInputError):
    """Validation exceeded a deterministic workload or detail-artifact limit."""


def _validate_headers(headers: list[str], maximum: int) -> None:
    if len(headers) > maximum:
        raise InvalidInputError(f"Dataset exceeds the {maximum}-column validation limit.")
    if len(set(headers)) != len(headers) or any(not name.strip() or len(name) > 500 for name in headers):
        raise InvalidInputError("Dataset columns must be unique, non-empty, and at most 500 characters.")


def _is_percent_power_factor_header(value: str) -> bool:
    name = re.sub(r"^meter\s*:\s*", "", value.strip(), flags=re.IGNORECASE)
    unit_match = re.search(r"\(([^()]*)\)\s*$", name)
    if not unit_match or unit_match.group(1).strip() != "%":
        return False
    name = name[:unit_match.start()].strip()
    return re.sub(r"[^a-z0-9]", "", name.casefold()) == "powerfactor"


def _type_issue(value: object, mapping: dict) -> str | None:
    expected = mapping["expected_type"]
    text = str(value).strip() if isinstance(value,str) else str(value)
    if expected == "string":
        return None if isinstance(value, str) else "invalid_type"
    if expected == "integer":
        return None if isinstance(value, int) and not isinstance(value, bool) or (
            isinstance(value, str) and re.fullmatch(r"[+-]?\d+", value.strip())
        ) else "invalid_integer"
    if expected == "number":
        try:
            if not re.fullmatch(r"[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?", text.strip()):
                return "invalid_number"
            number = float(text)
            return None if math.isfinite(number) else "invalid_number"
        except (TypeError, ValueError):
            return "invalid_number"
    if expected == "boolean":
        return None if (isinstance(value, bool) or (isinstance(value, str) and value.strip().lower() in {"true", "false"})) else "invalid_boolean"
    if expected == "date":
        try:
            date.fromisoformat(text)
            return None
        except ValueError:
            return "invalid_date"
    if expected == "datetime":
        try:
            parsed = datetime.strptime(text, mapping["timestamp_format"]) if mapping.get("timestamp_format") else datetime.fromisoformat(text.replace("Z", "+00:00"))
            timezone = mapping.get("timezone")
            if timezone:
                ZoneInfo(timezone)
                if parsed.tzinfo is None:
                    return "timezone_missing"
            return None
        except (ValueError, TypeError, ZoneInfoNotFoundError):
            return "invalid_datetime"
    return "invalid_type_definition"
