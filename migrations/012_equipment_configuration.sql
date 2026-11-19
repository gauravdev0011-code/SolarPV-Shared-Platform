-- Approved containment-only model. No legacy rows are backfilled or rewritten.
CREATE TABLE equipment_configurations (
    configuration_id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    asset_id INTEGER NOT NULL,
    effective_from TEXT NOT NULL,
    recorded_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    equipment_kind TEXT NOT NULL CHECK(equipment_kind IN ('unknown','array','inverter','string','panel','other')),
    parent_asset_id INTEGER,
    site_id TEXT,
    specifications_json TEXT NOT NULL CHECK(json_valid(specifications_json) AND json_type(specifications_json)='array'),
    source_reference TEXT NOT NULL CHECK(length(trim(source_reference)) BETWEEN 1 AND 2000),
    CHECK(parent_asset_id IS NULL OR parent_asset_id <> asset_id),
    UNIQUE(workspace_id,asset_id,effective_from),
    FOREIGN KEY(workspace_id,asset_id) REFERENCES assets(workspace_id,asset_id) ON DELETE RESTRICT,
    FOREIGN KEY(workspace_id,parent_asset_id) REFERENCES assets(workspace_id,asset_id) ON DELETE RESTRICT,
    FOREIGN KEY(workspace_id,site_id) REFERENCES sites(workspace_id,site_id) ON DELETE RESTRICT
);
CREATE INDEX idx_equipment_configuration_history ON equipment_configurations(workspace_id,asset_id,effective_from);
CREATE TRIGGER equipment_configuration_no_update BEFORE UPDATE ON equipment_configurations
BEGIN SELECT RAISE(ABORT,'Equipment configuration history is append-only.'); END;
CREATE TRIGGER equipment_configuration_no_delete BEFORE DELETE ON equipment_configurations
BEGIN SELECT RAISE(ABORT,'Equipment configuration history is append-only.'); END;
CREATE TRIGGER equipment_configuration_forward_only BEFORE INSERT ON equipment_configurations
WHEN EXISTS(SELECT 1 FROM equipment_configurations c WHERE c.workspace_id=NEW.workspace_id AND c.asset_id=NEW.asset_id AND c.effective_from>=NEW.effective_from)
BEGIN SELECT RAISE(ABORT,'Configuration effective times must advance.'); END;
CREATE TRIGGER equipment_site_history_guard BEFORE UPDATE OF site_id ON assets
WHEN NEW.site_id IS NOT OLD.site_id AND EXISTS(SELECT 1 FROM equipment_configurations c WHERE c.workspace_id=OLD.workspace_id AND c.asset_id=OLD.asset_id)
BEGIN SELECT RAISE(ABORT,'Use a documented configuration revision to change this site.'); END;

-- Current site is derived, including scheduled revisions. Legacy site remains
-- untouched and does not become an invented effective-dated assertion.
CREATE VIEW assets_current AS
SELECT a.asset_id,a.workspace_id,
 CASE WHEN EXISTS(SELECT 1 FROM equipment_configurations c WHERE c.workspace_id=a.workspace_id AND c.asset_id=a.asset_id)
 THEN (SELECT c.site_id FROM equipment_configurations c WHERE c.workspace_id=a.workspace_id AND c.asset_id=a.asset_id
       AND c.effective_from<=strftime('%Y-%m-%dT%H:%M:%f','now')||'000Z' ORDER BY c.effective_from DESC LIMIT 1)
 ELSE a.site_id END AS site_id,
 a.external_id,a.asset_type,a.name,a.description,a.location,a.data_origin,a.created_at,a.updated_at
FROM assets a;
