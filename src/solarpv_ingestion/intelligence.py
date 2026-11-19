"""Deterministic, reproducible views over preserved source data; no source mutations."""
from __future__ import annotations

import hashlib
import json
import math
import re
from collections import Counter
from datetime import datetime
from decimal import Decimal, DecimalException, localcontext

RULE_VERSION = "solaris.normalization-v3"
NULL_MARKERS = {"", "null", "none", "na", "n/a", "<null>"}
# Aliases identify semantics only when the explicit unit is compatible.
ALIASES = {
    "datetime": ("timestamp", "datetime", None), "timestamp": ("timestamp", "datetime", None),
    "datetimeutc": ("timestamp", "datetime", None),
    "consumptiontotal": ("energy_consumption", "number", "energy"),
    "acenergyaccumulated": ("accumulated_ac_energy", "number", "energy"),
    "energyaccumulated": ("energy_accumulated", "number", "energy"),
    "apparentpower": ("apparent_power", "number", "apparent"),
    "reactivepower": ("reactive_power", "number", "reactive"),
    "powerfactor": ("power_factor", "number", "factor"),
    "powerfrequency": ("frequency", "number", "frequency"), "frequency": ("frequency", "number", "frequency"),
    "powertruekw": ("total_real_power", "number", "power"),
    "powertruekwa": ("phase_a_power", "number", "power"),
    "powertruekwb": ("phase_b_power", "number", "power"),
    "powertruekwc": ("phase_c_power", "number", "power"),
    "voltage": ("voltage", "number", "voltage"), "current": ("current", "number", "current"),
    "stateofcharge": ("state_of_charge", "number", "factor"), "soc": ("state_of_charge", "number", "factor"),
}
UNITS = {"energy": {"Wh", "kWh", "MWh"}, "power": {"W", "kW", "MW"},
         "apparent": {"VA", "kVA", "MVA"}, "reactive": {"var", "kvar", "Mvar"},
         "factor": {"%", "ratio"}, "frequency": {"Hz", "kHz"},
         "voltage": {"V", "kV"}, "current": {"A", "mA"}}
FORMATS = [(r"\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}", "%Y-%m-%d %H:%M:%S"),
           (r"[A-Z][a-z]{2} \d{1,2}, \d{4} \d{2}:\d{2}:\d{2}", "%b %d, %Y %H:%M:%S")]


def recognize(headers, sample_rows):
    candidates = []
    for header in headers:
        name = re.sub(r"^meter\s*:\s*", "", header.strip(), flags=re.I)
        match = re.search(r"\(([^()]*)\)\s*$", name)
        unit = match.group(1).strip() if match else None
        if match:
            name = name[:match.start()]
        alias = ALIASES.get(re.sub(r"[^a-z0-9]", "", name.casefold()))
        if not alias:
            continue
        target, kind, family = alias
        verified_unit = unit if unit in UNITS.get(family, ()) else None
        item = {"source_column": header, "target_field": target, "expected_type": kind,
                "measurement_unit": verified_unit, "is_required": False,
                "evidence": "Exact supported alias and compatible explicit unit", "automatic": True}
        if kind == "number" and not verified_unit:
            item.update(automatic=False, evidence="Measurement alias found; source unit requires confirmation")
        if target == "power_factor" and verified_unit == "%":
            item.update(automatic=False, evidence="Percentage header does not establish the value scale")
        if kind == "datetime":
            values = [row.get(header).strip() if isinstance(row.get(header),str) else row.get(header) for row in sample_rows if row.get(header) is not None and str(row.get(header)).strip()]
            fmt = next((fmt for pattern, fmt in FORMATS if values and all(isinstance(v, str) and re.fullmatch(pattern, v) for v in values)), None)
            if fmt:
                item["timestamp_format"] = fmt
            else:
                try:
                    if not values:
                        raise ValueError()
                    for value in values:
                        datetime.fromisoformat(str(value).replace("Z", "+00:00"))
                except ValueError:
                    item.update(automatic=False, evidence="Timestamp format requires confirmation")
        candidates.append(item)
    counts = Counter(c["target_field"] for c in candidates)
    for item in candidates:
        if counts[item["target_field"]] > 1:
            item.update(automatic=False, evidence="Multiple source columns match the same measurement")
    fingerprint = hashlib.sha256(json.dumps(headers, ensure_ascii=False, separators=(",", ":")).encode()).hexdigest()
    return {"schema_fingerprint": fingerprint, "fields": candidates, "rule_version": RULE_VERSION}


def scientific_warnings(headers, mappings):
    """Expose existing unresolved source-unit decisions to every explorer client.

    A source percentage label alone does not establish PF scale. This uses the
    same recognition and explicit saved-scale contract as dataset intelligence.
    It does not create findings, reinterpret values or approve a mapping.
    """
    saved = {item['source_column']: item for item in mappings}
    return [{"code": "power_factor_percent_scale_review", "field": item['source_column'],
             "source_unit": "%", "state": "unresolved", "automatic_choice": None,
             "message": "Power-factor scale is unresolved. Source label and values are retained; confirm meter documentation before ratio or percentage analysis."}
            for item in recognize(headers, [])['fields']
            if item['target_field']=='power_factor' and item.get('measurement_unit')=='%'
            and not saved.get(item['source_column'], {}).get('value_scale')]


def normalize_cell(value, mapping):
    """Explicit invalid/missing states; exact decimal representation avoids precision loss."""
    from solarpv_ingestion.processing import source_json_value
    result = {"value": getattr(value, "source_literal", source_json_value(value)), "status": "unmapped" if mapping is None else "valid", "rules": []}
    if mapping is None:
        return result
    text = value.strip() if isinstance(value, str) else value
    if value is None or isinstance(text, str) and text.casefold() in NULL_MARKERS:
        return {"value": None, "status": "missing", "rules": ["missing-marker-v1"]}
    if isinstance(value, str) and text != value:
        result["rules"].append("trim-v1")
    kind = mapping["expected_type"]
    if mapping.get("measurement_unit"):
        result["unit"] = mapping["measurement_unit"]
    try:
        if kind in {"number", "integer"}:
            if isinstance(text, bool) or not isinstance(text, (str, int, float, Decimal)):
                raise ValueError()
            if isinstance(text, str) and not re.fullmatch(r"[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?", text):
                raise ValueError()
            if kind == "integer" and not (isinstance(text, int) and not isinstance(text, bool) or isinstance(text, str) and re.fullmatch(r"[+-]?\d+", text)):
                raise ValueError()
            if hasattr(value, "source_literal") and not math.isfinite(value):
                raise ValueError()
            number = Decimal(getattr(value, "source_literal", str(text)))
            if not number.is_finite() or kind == "integer" and number != number.to_integral_value():
                raise ValueError()
            # Decimal strings are the normalized representation; browser plots are approximate.
            result["value"] = str(number)
            result["rules"].append("decimal-parse-v1")
            # Validation's existing catalog is authoritative for recognized
            # quantities. A known SI prefix on an incompatible quantity must
            # not produce a valid-looking converted reading in the explorer.
            from solarpv_ingestion.validation import EXPECTED_UNITS
            allowed_units = EXPECTED_UNITS.get(mapping.get('target_field'))
            source_unit = mapping.get('measurement_unit')
            if source_unit and allowed_units is not None and source_unit not in allowed_units:
                result['status'] = 'unresolved'
                result['rules'].append('measurement-unit-review-v1')
                return result
            # Exact SI prefix conversions only. The source unit stays in the saved mapping.
            conversions = {"W": ("kW", "0.001"), "MW": ("kW", "1000"),
                           "Wh": ("kWh", "0.001"), "MWh": ("kWh", "1000"),
                           "VA": ("kVA", "0.001"), "MVA": ("kVA", "1000"),
                           "kHz": ("Hz", "1000"), "kV": ("V", "1000"), "mA": ("A", "0.001")}
            if mapping.get("measurement_unit") in conversions:
                output_unit, factor = conversions[mapping["measurement_unit"]]
                with localcontext() as ctx:
                    ctx.prec = max(28, len(number.as_tuple().digits) + len(factor) + 10)
                    converted = str(number * Decimal(factor))
                result.update(value=converted, unit=output_unit,
                              parameters={"source_unit": mapping["measurement_unit"], "output_unit": output_unit, "factor": factor})
                result["rules"].append("si-prefix-conversion-v1")
            if mapping.get("target_field") == "power_factor":
                if mapping.get("measurement_unit") == "%" and not mapping.get("value_scale"):
                    result["status"] = "unresolved"
                elif mapping.get("value_scale") or mapping.get("measurement_unit") == "ratio":
                    scale = mapping.get("value_scale") or "ratio_0_1"
                    bound = 1 if scale == "ratio_0_1" else 100
                    if abs(number) > bound:
                        result.update(value=None, status="invalid")
                    else:
                        factor = "1" if scale == "ratio_0_1" else "0.01"
                        with localcontext() as ctx:
                            ctx.prec=max(28,len(number.as_tuple().digits)+10)
                            result["value"]=str(number*Decimal(factor))
                        result["unit"]="ratio"
                        result["parameters"]={"source_unit":mapping.get("measurement_unit"),"output_unit":"ratio","factor":factor,"approved_value_scale":scale}
                        result["rules"].append("power-factor-scale-v1")
        elif kind in {"date", "datetime"}:
            parsed = datetime.strptime(str(text), mapping["timestamp_format"]) if mapping.get("timestamp_format") else datetime.fromisoformat(str(text).replace("Z", "+00:00"))
            result["value"] = parsed.date().isoformat() if kind == "date" else parsed.isoformat()
            result["rules"].append("timestamp-iso-v1")
            if kind == "datetime" and parsed.tzinfo is None:
                result["timezone_status"] = "unspecified"
        elif kind == "boolean":
            if isinstance(text, bool):
                result["value"] = text
            elif isinstance(text, str) and text.casefold() in {"true", "false"}:
                result["value"] = text.casefold() == "true"
            else:
                raise ValueError()
            result["rules"].append("boolean-parse-v1")
        elif kind == "string":
            if not isinstance(text, str):
                raise ValueError()
            result["value"] = text
    except (ValueError, TypeError, DecimalException, OverflowError):
        result.update(value=None, status="invalid")
    return result
