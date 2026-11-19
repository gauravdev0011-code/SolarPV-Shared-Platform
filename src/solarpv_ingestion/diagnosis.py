"""Evidence-only diagnosis categories, with exact union counts across fields/rules."""
from collections import defaultdict
import hashlib
import json
import math
import re

CATEGORIES = {
 "missing": ({"optional_value_missing","optional_null_marker","required_value_missing","required_null_marker"}, "Missing source measurements", "Source readings are missing or use recognized missing markers.", "Missing values remain explicit; no zero or interpolation was inserted."),
 "numeric": ({"invalid_number","invalid_integer"}, "Invalid numeric readings", "Source values do not match the saved numeric parser and mapping.", "Original text retained; unusable numeric values are excluded from analysis."),
 "temporal": ({"invalid_datetime","invalid_date","timestamp_duplicate","timestamp_out_of_order","timestamp_timezone_mixed","timezone_missing","missing_expected_interval"}, "Timestamp irregularities", "Source timestamps conflict with parsing, ordering, uniqueness or documented cadence checks.", "Source order and timestamps retained; unsafe chart connections are broken."),
 "interpretation": ({"power_factor_percent_scale_review"}, "Scientific interpretation required", "A percentage header does not establish the instrument's value scale.", "No scientific scale was selected automatically."),
 "counter": ({"energy_counter_decrease"}, "Cumulative meter decrease", "A cumulative reading decreased from its preceding source reading.", "Counter values retained; no production total inferred across the decrease."),
 "units": ({"measurement_unit_missing","measurement_unit_unrecognized"}, "Measurement units need review", "A saved measurement unit is missing or incompatible with the mapped field.", "No undocumented unit conversion was performed."),
 "semantics": ({"frequency_semantic_review","soc_representation_range","power_factor_outside_confirmed_scale","equipment_limit_review"}, "Measurement consistency concerns", "Readings conflict with explicit representation rules or supplied equipment context.", "Original readings and rule evidence retained; no guessed correction applied."),
 "mapping": ({"unmapped_column","mapping_not_defined","source_column_missing"}, "Source mapping coverage", "Some source fields lack a usable mapping.", "Unknown source fields remain preserved."),
}

def category_for(code):
    return next((name for name,(codes,*_) in CATEGORIES.items() if code in codes), "integrity")


def representation_note(issue):
    value=issue.get("observed_value_preview")
    if value is None:return "No source value sample is available."
    if issue.get("observed_value_truncated"):return "Sample is shortened; inspect the complete source before interpreting the format."
    text=str(value).strip()
    if text.casefold() in {"nan","inf","infinity","-inf","-infinity"}:return "A non-finite numeric literal is not accepted as a measurement."
    if re.fullmatch(r"[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?",text):
        try:
            if not math.isfinite(float(text)):return "Numeric syntax is present, but the literal exceeds the parser's supported finite range."
        except ValueError:pass
        if issue["code"]=="invalid_integer":return "Numeric syntax is present, but it does not use the saved integer representation."
    if any(c in text for c in {",","_"}):return "Separators are not supported by the saved strict numeric parser; locale or grouping interpretation is unverified."
    return "Text does not match the saved numeric parser. A mapping mismatch, unsupported format or source issue remains possible."


def build_diagnoses(issues, validation_id, mappings):
    required={m["source_column"]:bool(m.get("is_required")) for m in mappings}
    groups={}
    for issue in issues:
        category=category_for(issue["code"])
        g=groups.setdefault(category,{"rows":set(),"fields":{},"rules":set(),"examples":[],"count":0,"errors":0,"warnings":0})
        g["count"]+=1;g["rules"].add(issue["code"]);g["errors" if issue["severity"]=="error" else "warnings"]+=1
        row=issue.get("row"); field=issue.get("field")
        if row is not None:g["rows"].add(row)
        if field:
            f=g["fields"].setdefault(field,{"rows":set(),"count":0,"required":required.get(field,False)})
            f["count"]+=1
            if row is not None:f["rows"].add(row)
        if len(g["examples"])<4 and not any(e.get("field")==field and e.get("observed_value_preview")==issue.get("observed_value_preview") and e.get("code")==issue["code"] for e in g["examples"]):
            example={k:v for k,v in issue.items() if k in {"row","field","code","message","observed_value_preview","observed_value_truncated"}}
            if category=="numeric":example["representation_note"]=representation_note(issue)
            g["examples"].append(example)
    result=[]
    for category,g in groups.items():
        _,title,observed,handling=CATEGORIES.get(category,(set(),"Source integrity problem","Validation detected a source integrity problem.","Original source retained; registration remains blocked."))
        review=category=="interpretation"
        blocks=bool(g["errors"] or review)
        impact="blocking_integrity" if g["errors"] else "review_required" if review else "informational" if category=="mapping" else "nonblocking_quality"
        rules=sorted(g["rules"])
        fields=[{"field":f,"finding_count":v["count"],"distinct_affected_rows":len(v["rows"]),"required":v["required"]} for f,v in sorted(g["fields"].items())]
        identity=hashlib.sha256(json.dumps([validation_id,category,rules],separators=(",",":")).encode()).hexdigest()[:20]
        result.append({"diagnosis_id":identity,"category":category,"diagnosis_code":rules[0],"supporting_rules":rules,
            "title":title,"explanation":observed,"observed_condition":observed,
            "supported_explanation":"Established by the saved mapping and the listed validation rules; not a physical root-cause diagnosis.",
            "unverified_hypothesis":"Cause remains undetermined. Inspect source values, parser settings and mapping before attributing a source fault.",
            "scientific_impact":"Unusable values cannot support quantitative analysis." if category=="numeric" else "Impact depends on the intended analysis and documented quality policy.",
            "severity":"error" if g["errors"] else "warning","impact":impact,"fields":fields,
            "field":fields[0]["field"] if len(fields)==1 else None,
            "finding_count":g["count"],"distinct_affected_rows":len(g["rows"]),"examples":g["examples"],
            "handling_status":"preserved_and_flagged","handling_explanation":handling,
            "action_required":blocks,"blocks_registration":blocks,
            "researcher_action":"Confirm the instrument representation from documentation." if review else "Inspect representative source rows and the saved mapping." if blocks else "No action required; retain quality flags for analysis.",
            "validation_run_id":validation_id,"rule_reference":rules[0],"cause_status":"undetermined"})
    return sorted(result,key=lambda d:(not d["action_required"],d["category"]!="interpretation",not d["blocks_registration"],-d["distinct_affected_rows"],d["category"]))


def eligibility(version, report, diagnoses, approval):
    pending=[d for d in diagnoses if d["impact"]=="review_required"]
    errors=int((report or {}).get("error_count",0))
    if approval and approval["state"]=="approved":state,action="approved","registered"
    elif approval and approval["state"]=="pending":state,action="awaiting_approval","approve"
    elif pending:state,action="review_required","review_interpretation"
    elif errors:state,action="blocked","inspect_integrity"
    elif report and version["state"]=="valid":state,action="eligible","submit_review"
    else:state,action="draft","validate"
    return {"state":state,"primary_action":action,"can_submit":state=="eligible","can_approve":state=="awaiting_approval",
            "registered":state=="approved","blocking_error_findings":errors,"pending_decisions":len(pending),
            "policy":"Errors block review; optional missing readings and nonblocking warnings do not. Scientific ambiguities require a persisted decision."}
