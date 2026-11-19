CREATE TABLE inverter_configuration_imports (
    asset_id INTEGER PRIMARY KEY REFERENCES assets(asset_id) ON DELETE RESTRICT,
    source_reference TEXT NOT NULL,
    source_json TEXT NOT NULL CHECK (json_valid(source_json)),
    endpoint_ip TEXT NOT NULL,
    imported_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE inverter_plan_confirmations (
    asset_id INTEGER PRIMARY KEY REFERENCES inverter_configuration_imports(asset_id) ON DELETE RESTRICT,
    plan_label TEXT NOT NULL,
    evidence TEXT NOT NULL CHECK (length(trim(evidence)) > 0),
    confirmed_by TEXT NOT NULL CHECK (length(trim(confirmed_by)) > 0),
    confirmed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
