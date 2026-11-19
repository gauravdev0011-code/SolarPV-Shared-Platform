CREATE TABLE panel_note_revisions (
    note_id TEXT NOT NULL,
    revision INTEGER NOT NULL CHECK (revision > 0),
    asset_id INTEGER NOT NULL REFERENCES assets(asset_id),
    body TEXT NOT NULL CHECK (length(trim(body)) BETWEEN 1 AND 2000),
    author TEXT NOT NULL CHECK (length(trim(author)) BETWEEN 1 AND 120),
    recorded_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    PRIMARY KEY (note_id, revision)
);

CREATE INDEX panel_note_revisions_asset ON panel_note_revisions(asset_id, note_id, revision);

CREATE TRIGGER panel_note_revisions_immutable_update BEFORE UPDATE ON panel_note_revisions
BEGIN
    SELECT RAISE(ABORT, 'Panel note revisions are immutable');
END;

CREATE TRIGGER panel_note_revisions_immutable_delete BEFORE DELETE ON panel_note_revisions
BEGIN
    SELECT RAISE(ABORT, 'Panel note revisions are immutable');
END;
