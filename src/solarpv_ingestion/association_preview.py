"""Read-only source/equipment evidence. Never a scientific approval or writer."""
import hashlib
import json

from solarpv_db.database import get_connection
from solarpv_ingestion.datasets import DatasetConflict, DatasetError


def match_record(connection, workspace, identifiers):
    """Exact identifiers support candidates; names alone never establish identity."""
    external, internal = identifiers.get('external_id'), identifiers.get('asset_id')
    name, kind = identifiers.get('name'), identifiers.get('asset_type')
    if any(value is not None and (not isinstance(value, str) or not value or
           value != value.strip() or len(value) > 200) for value in identifiers.values()):
        return 'invalid_identifier', [], False
    if internal is not None and (not internal.isascii() or not internal.isdigit() or
                                 len(internal) > 18 or int(internal) <= 0):
        return 'invalid_identifier', [], False
    candidates = []
    if external is not None or internal is not None:
        # Evaluate both independently, so contradictory references never become a match.
        for column, value in [('external_id', external), ('asset_id', internal)]:
            if value is None:
                continue
            row = connection.execute(f'SELECT asset_id,external_id,name,asset_type,data_origin FROM assets WHERE workspace_id=? AND {column}=?', (workspace, value)).fetchone()
            candidates.append(dict(row) if row else None)
        present = [row for row in candidates if row]
        unique = {row['asset_id']: row for row in present}
        if not present:
            return 'no_match', [], False
        if len(unique) != 1 or any(row is None for row in candidates):
            return 'conflict', list(unique.values()), False
        asset = present[0]
        if (name is not None and name != asset['name']) or (kind is not None and kind != asset['asset_type']):
            return 'conflict', [asset], False
        return 'exact_match', [asset], False
    if name is None:
        return 'invalid_identifier', [], False
    rows = connection.execute('SELECT asset_id,external_id,name,asset_type,data_origin FROM assets WHERE workspace_id=? AND name=? ORDER BY asset_id LIMIT 21', (workspace, name)).fetchall()
    candidates = [dict(row) for row in rows[:20]]
    if len(rows) == 1 and kind is not None and kind != candidates[0]['asset_type']:
        return 'conflict', candidates, False
    return ('ambiguous' if len(rows) > 1 else 'review_required' if rows else 'no_match'), candidates, len(rows) > 20


REASONS = {
    'exact_match': 'One exact workspace identifier match. This is a candidate, not an approved association.',
    'ambiguous': 'Multiple equipment records have this exact name. Supply a documented unique identifier.',
    'review_required': 'A name alone does not establish equipment identity. Supply a documented unique identifier.',
    'no_match': 'No equipment matches the supplied identifiers in this workspace.',
    'invalid_identifier': 'Supply an existing identifier column with nonempty exact text; internal IDs must be positive integers.',
    'conflict': 'The supplied identifiers or equipment details disagree. Review the original evidence.',
}


def preview_associations(datasets, workspace, dataset, version, columns, offset=0, limit=25):
    if not columns or not any(columns.values()):
        raise DatasetError('Select at least one source equipment identifier or name column.')
    view = datasets.explore(dataset, version, workspace_id=workspace, offset=offset, limit=limit, include_chart=False)
    if any(value is not None and value not in view['columns'] for value in columns.values()):
        raise DatasetError('Identifier columns must exist in the original source.')
    # Bounded explorer output is unsuitable as identity evidence if truncated.
    rows = []
    with get_connection(datasets.database_path) as connection:
        connection.execute('BEGIN')
        head = connection.execute('SELECT mapping_revision_id,current_validation_run_id FROM dataset_versions WHERE dataset_version_id=?', (version,)).fetchone()
        if head['mapping_revision_id'] != view['provenance']['mapping_revision_id'] or head['current_validation_run_id'] != view['chart']['validation_run_id']:
            raise DatasetConflict('Source validation changed. Refresh the association preview.')
        for item in view['items']:
            identifiers = {key: item['original'].get(column) for key, column in columns.items() if column}
            status, candidates, truncated = match_record(connection, workspace, identifiers)
            if set(item['original_truncated']).intersection(value for value in columns.values() if value):
                status, candidates, truncated = 'invalid_identifier', [], False
            rows.append({**item, 'identifiers': identifiers, 'association_status': status,
                         'reason': REASONS[status], 'candidates': candidates,
                         'candidates_truncated': truncated, 'committed': False})
        source = datasets._source_for_version(version, workspace)
    result = {'mode': 'preview_only', 'can_commit': False, 'can_promote': False,
              'blocked_reason': 'No associations are saved. Scientific meaning, visit identity and overlap policies require separate approval before promotion.',
              'workspace_id': workspace, 'dataset_id': dataset, 'dataset_version_id': version,
              'columns': columns, 'offset': offset, 'limit': limit, 'total': view['total'], 'items': rows,
              'provenance': {**view['provenance'], 'validation_run_id': view['chart']['validation_run_id'],
                             'original_name': source['original_name']},
              'scientific_warnings': view['scientific_warnings']}
    result['preview_revision'] = hashlib.sha256(json.dumps(result, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
    return result
