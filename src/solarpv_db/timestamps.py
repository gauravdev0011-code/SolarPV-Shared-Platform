"""Inspection time policy. Never assign a timezone to a source-clock reading."""
from datetime import datetime, timezone
import re

POLICY = "Aware times use UTC; naive/date-only times retain source clock. Mixed domains cannot be chronologically compared."
_ISO = re.compile(r"^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,6})?)?(?:Z|[+-]\d{2}:\d{2})?)?$")


def parse_timestamp(value):
    if not isinstance(value, str) or not _ISO.fullmatch(value.strip()):
        raise ValueError("Inspection timestamp must be a valid ISO 8601 date or datetime (optional Z or ±HH:MM offset).")
    text = value.strip()
    try:
        # Python accepts offsets such as +01:60; reject those explicitly.
        if re.search(r"[+-]\d{2}:\d{2}$", text) and (int(text[-5:-3]) > 23 or int(text[-2:]) > 59):
            raise ValueError()
        parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
        if parsed.tzinfo is not None:
            parsed = parsed.astimezone(timezone.utc)
        return parsed
    except (ValueError, OverflowError) as error:
        raise ValueError("Inspection timestamp must be a valid ISO 8601 date or datetime.") from error


def normalize_timestamp(value):
    parsed = parse_timestamp(value)
    if len(value.strip()) == 10:
        return parsed.date().isoformat()
    return parsed.isoformat().replace("+00:00", "Z")


def timestamp_kind(value):
    try:
        return "aware" if parse_timestamp(value).tzinfo is not None else "naive"
    except ValueError:
        return "invalid"


def timestamp_key(value):
    try:
        return parse_timestamp(value).replace(tzinfo=None).isoformat(timespec="microseconds")
    except ValueError:
        return None


def require_comparable(rows):
    kinds = set()
    for row in rows:
        kind = timestamp_kind(row["inspected_at"])
        if kind == "invalid":
            raise ValueError(f"Inspection {row['inspection_id']} has an invalid historical timestamp; review the original record. No records were changed.")
        kinds.add(kind)
    if len(kinds) > 1:
        raise ValueError("Inspection history mixes timezone-aware and naive source-clock timestamps; chronological comparison requires an explicit source timezone. No timezone was inferred.")
