ALTER TABLE maintenance_records ADD COLUMN status TEXT CHECK (status IN ('planned','completed'));
ALTER TABLE maintenance_records ADD COLUMN related_inspection_id INTEGER REFERENCES inspections(inspection_id);
ALTER TABLE maintenance_records ADD COLUMN panel_request_id TEXT;
CREATE UNIQUE INDEX maintenance_panel_requests ON maintenance_records(workspace_id, panel_request_id);

CREATE TABLE visit_source_labels (
    source_file_id TEXT PRIMARY KEY REFERENCES source_files(source_file_id) ON DELETE RESTRICT,
    kind TEXT NOT NULL CHECK (kind IN ('rgb','thermal','pdf','csv','json'))
);
