CREATE TABLE maintenance_status_history (
    maintenance_id INTEGER NOT NULL REFERENCES maintenance_records(maintenance_id),
    revision INTEGER NOT NULL CHECK (revision > 0),
    status TEXT NOT NULL CHECK (status IN ('planned','completed')),
    notes TEXT NOT NULL CHECK (length(trim(notes)) BETWEEN 1 AND 2000),
    recorded_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    PRIMARY KEY (maintenance_id, revision)
);
CREATE TRIGGER maintenance_status_history_immutable_update BEFORE UPDATE ON maintenance_status_history
BEGIN
    SELECT RAISE(ABORT, 'Maintenance status history is immutable');
END;
CREATE TRIGGER maintenance_status_history_immutable_delete BEFORE DELETE ON maintenance_status_history
BEGIN
    SELECT RAISE(ABORT, 'Maintenance status history is immutable');
END;
