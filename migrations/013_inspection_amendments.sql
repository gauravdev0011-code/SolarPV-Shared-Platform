-- One stable visit; complete immutable revisions. Legacy records are untouched.
CREATE TABLE inspection_revisions (
 revision_id TEXT PRIMARY KEY,
 workspace_id TEXT NOT NULL,
 inspection_id INTEGER NOT NULL,
 revision_number INTEGER NOT NULL CHECK(revision_number>=0),
 inspected_at TEXT NOT NULL,
 inspection_method TEXT,
 data_source TEXT,
 status TEXT NOT NULL CHECK(status IN ('planned','in_progress','completed','cancelled')),
 notes TEXT,
 reason TEXT NOT NULL CHECK(length(trim(reason))>0),
 observation_ids_json TEXT NOT NULL CHECK(json_valid(observation_ids_json) AND json_type(observation_ids_json)='array'),
 observation_inputs_json TEXT NOT NULL CHECK(json_valid(observation_inputs_json) AND json_type(observation_inputs_json)='array'),
 attachment_ids_json TEXT NOT NULL CHECK(json_valid(attachment_ids_json) AND json_type(attachment_ids_json)='array'),
 recorded_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 UNIQUE(workspace_id,inspection_id,revision_number),
 FOREIGN KEY(workspace_id,inspection_id) REFERENCES inspections(workspace_id,inspection_id) ON DELETE RESTRICT
);
CREATE INDEX idx_inspection_revision_head ON inspection_revisions(workspace_id,inspection_id,revision_number DESC);
CREATE TRIGGER inspection_revision_immutable_update BEFORE UPDATE ON inspection_revisions
BEGIN SELECT RAISE(ABORT,'Visit revisions are immutable.'); END;
CREATE TRIGGER inspection_revision_immutable_delete BEFORE DELETE ON inspection_revisions
BEGIN SELECT RAISE(ABORT,'Visit revisions are immutable.'); END;
CREATE TRIGGER inspection_revision_ownership BEFORE INSERT ON inspection_revisions
BEGIN
 SELECT CASE WHEN EXISTS(SELECT 1 FROM json_each(NEW.observation_ids_json) j WHERE NOT EXISTS(
   SELECT 1 FROM observations o WHERE o.workspace_id=NEW.workspace_id AND o.inspection_id=NEW.inspection_id AND o.observation_id=j.value))
 THEN RAISE(ABORT,'Observation ownership mismatch.') END;
 SELECT CASE WHEN EXISTS(SELECT 1 FROM json_each(NEW.attachment_ids_json) j WHERE NOT EXISTS(
   SELECT 1 FROM source_files s WHERE s.workspace_id=NEW.workspace_id AND s.source_file_id=j.value AND s.state<>'deleted'))
 THEN RAISE(ABORT,'Attachment ownership mismatch.') END;
END;
CREATE TRIGGER recorded_visit_no_update BEFORE UPDATE ON inspections
WHEN EXISTS(SELECT 1 FROM inspection_revisions r WHERE r.workspace_id=OLD.workspace_id AND r.inspection_id=OLD.inspection_id)
BEGIN SELECT RAISE(ABORT,'Use an immutable amendment to correct this visit.'); END;
CREATE TRIGGER recorded_visit_no_delete BEFORE DELETE ON inspections
WHEN EXISTS(SELECT 1 FROM inspection_revisions r WHERE r.workspace_id=OLD.workspace_id AND r.inspection_id=OLD.inspection_id)
BEGIN SELECT RAISE(ABORT,'Original visits cannot be deleted.'); END;
CREATE TRIGGER recorded_observation_no_update BEFORE UPDATE ON observations
WHEN EXISTS(SELECT 1 FROM inspection_revisions r,json_each(r.observation_ids_json) j WHERE r.workspace_id=OLD.workspace_id AND j.value=OLD.observation_id)
BEGIN SELECT RAISE(ABORT,'Original observation evidence is immutable.'); END;
CREATE TRIGGER recorded_observation_no_delete BEFORE DELETE ON observations
WHEN EXISTS(SELECT 1 FROM inspection_revisions r,json_each(r.observation_ids_json) j WHERE r.workspace_id=OLD.workspace_id AND j.value=OLD.observation_id)
BEGIN SELECT RAISE(ABORT,'Original observation evidence cannot be deleted.'); END;
CREATE VIEW inspection_attachment_references AS
 SELECT r.workspace_id,r.inspection_id,r.revision_id,j.value AS source_file_id
 FROM inspection_revisions r,json_each(r.attachment_ids_json) j;
CREATE TRIGGER visit_original_source_guard BEFORE UPDATE ON source_files
WHEN EXISTS(SELECT 1 FROM inspection_attachment_references r WHERE r.workspace_id=OLD.workspace_id AND r.source_file_id=OLD.source_file_id)
 AND (NEW.state='deleted' OR NEW.workspace_id IS NOT OLD.workspace_id OR NEW.source_file_id IS NOT OLD.source_file_id OR NEW.original_name IS NOT OLD.original_name OR NEW.storage_key IS NOT OLD.storage_key OR NEW.sha256 IS NOT OLD.sha256 OR NEW.size_bytes IS NOT OLD.size_bytes OR NEW.media_type IS NOT OLD.media_type)
BEGIN SELECT RAISE(ABORT,'Historical visit photographs must retain original evidence.'); END;
CREATE TRIGGER visit_original_source_no_delete BEFORE DELETE ON source_files
WHEN EXISTS(SELECT 1 FROM inspection_attachment_references r WHERE r.workspace_id=OLD.workspace_id AND r.source_file_id=OLD.source_file_id)
BEGIN SELECT RAISE(ABORT,'Historical visit photographs cannot be deleted.'); END;
CREATE VIEW inspections_current AS
 SELECT i.inspection_id,i.workspace_id,i.asset_id,
 CASE WHEN r.revision_id IS NULL THEN i.inspected_at ELSE r.inspected_at END AS inspected_at,
 CASE WHEN r.revision_id IS NULL THEN i.inspection_method ELSE r.inspection_method END AS inspection_method,
 CASE WHEN r.revision_id IS NULL THEN i.data_source ELSE r.data_source END AS data_source,
 i.data_origin,COALESCE(r.status,i.status) AS status,
 CASE WHEN r.revision_id IS NULL THEN i.notes ELSE r.notes END AS notes,i.created_at,
 r.revision_id AS current_revision_id
 FROM inspections i LEFT JOIN inspection_revisions r ON r.workspace_id=i.workspace_id AND r.inspection_id=i.inspection_id
 AND r.revision_number=(SELECT MAX(h.revision_number) FROM inspection_revisions h WHERE h.workspace_id=i.workspace_id AND h.inspection_id=i.inspection_id);
CREATE VIEW observations_current AS
 SELECT o.* FROM observations o JOIN inspections_current i ON i.workspace_id=o.workspace_id AND i.inspection_id=o.inspection_id
 WHERE i.current_revision_id IS NULL OR EXISTS(SELECT 1 FROM inspection_revisions r,json_each(r.observation_ids_json) j
 WHERE r.revision_id=i.current_revision_id AND j.value=o.observation_id);
