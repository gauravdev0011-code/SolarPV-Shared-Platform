"""Transactional asset registration, exact-match preview and durable retry receipts.

No name-based identity inference or bulk updates. All writes and their before/after
evidence share one transaction. The actor is the trusted local capability, not a
claimed authenticated person. Existing import provenance is never overwritten.
"""
import hashlib
import json
import sqlite3
from uuid import NAMESPACE_URL, uuid5

from solarpv_db.assets import create_asset, update_asset
from solarpv_db.database import get_connection


class RegistrationError(ValueError):
    def __init__(self, message, status=422):
        super().__init__(message)
        self.status = status


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=True).encode()).hexdigest()


def asset_record(row):
    value = dict(row)
    return {**value, 'revision': digest(value)}


class AssetRegistration:
    def __init__(self, database_path):
        self.database_path = database_path

    @staticmethod
    def workspace(connection, workspace):
        if not connection.execute('SELECT 1 FROM workspaces WHERE workspace_id=?', (workspace,)).fetchone():
            raise RegistrationError('Workspace not found.', 404)

    @staticmethod
    def site(connection, workspace, values):
        if values.get('site_id') and not connection.execute('SELECT 1 FROM sites WHERE workspace_id=? AND site_id=?', (workspace, values['site_id'])).fetchone():
            raise RegistrationError('Site not found in this workspace.', 404)

    @staticmethod
    def get(connection, workspace, identifier):
        row = connection.execute('SELECT * FROM assets WHERE workspace_id=? AND asset_id=?', (workspace, identifier)).fetchone()
        if row is None:
            raise RegistrationError('Asset not found in this workspace.', 404)
        result=asset_record(row)
        from solarpv_db.equipment import EquipmentService
        head=EquipmentService.head(connection,workspace,identifier)
        if head:
            effective=connection.execute('SELECT site_id FROM assets_current WHERE workspace_id=? AND asset_id=?',(workspace,identifier)).fetchone()[0]
            result.update(site_id=effective,configuration_managed=True,revision=digest({'asset':dict(row),'configuration':head,'site':effective}))
        return result

    def preview(self, workspace, rows):
        with get_connection(self.database_path) as connection:
            connection.execute('BEGIN')
            self.workspace(connection, workspace)
            return self._preview(connection, workspace, rows)

    def _preview(self, connection, workspace, rows):
        seen, plan = set(), []
        for index, values in enumerate(rows):
            self.site(connection, workspace, values)
            external = values.get('external_id')
            if not external or external in seen:
                raise RegistrationError(f'Row {index+1}: bulk rows require distinct, nonempty external IDs.')
            seen.add(external)
            row = connection.execute('SELECT * FROM assets WHERE workspace_id=? AND external_id=?', (workspace, external)).fetchone()
            existing = dict(row) if row else None
            # Optional blank text is equivalent to legacy NULL, without rewriting it.
            equal = existing is not None and all((existing.get(key) or '') == (value or '') for key, value in values.items())
            action = 'create' if existing is None else 'unchanged' if equal else 'conflict'
            plan.append({'row': index+1, 'external_id': external, 'action': action,
                         'proposed': values, 'existing': asset_record(row) if row else None})
        return {'rows': plan, 'can_commit': all(row['action'] != 'conflict' for row in plan),
                'preview_revision': digest({'workspace': workspace, 'plan': plan})}

    def write(self, workspace, key, operation, values, identifier=None, expected=None, preview=None):
        request = {'operation': operation, 'values': values, 'asset_id': identifier, 'expected': expected, 'preview': preview}
        fingerprint = digest(request)
        receipt = uuid5(NAMESPACE_URL, f'solaris:asset-write:{workspace}:{key}').hex
        try:
            with get_connection(self.database_path) as connection:
                connection.execute('BEGIN IMMEDIATE')
                self.workspace(connection, workspace)
                previous = connection.execute('SELECT metadata_json FROM audit_events WHERE audit_event_id=? AND workspace_id=?', (receipt, workspace)).fetchone()
                if previous:
                    metadata = json.loads(previous['metadata_json'])
                    if metadata['request_hash'] != fingerprint:
                        raise RegistrationError('This retry key was already used for a different request.', 409)
                    return metadata['response']
                before = []
                if operation == 'bulk':
                    plan = self._preview(connection, workspace, values)
                    if plan['preview_revision'] != preview:
                        raise RegistrationError('Inventory changed after preview. Preview again before saving.', 409)
                    if not plan['can_commit']:
                        raise RegistrationError('Conflicting matches require individual review; no rows were saved.', 409)
                    ids = []
                    for item in plan['rows']:
                        if item['existing']:
                            ids.append(item['existing']['asset_id'])
                        else:
                            ids.append(create_asset(**item['proposed'], workspace_id=workspace, connection=connection))
                    response = {'items': [self.get(connection, workspace, item) for item in ids]}
                    before = [item['existing'] for item in plan['rows']]
                else:
                    self.site(connection, workspace, values)
                    if operation == 'update':
                        current = self.get(connection, workspace, identifier)
                        if current['revision'] != expected:
                            raise RegistrationError('This asset changed. Reload it before saving your edit.', 409)
                        if current['data_origin'] != values['data_origin']:
                            raise RegistrationError('Origin is provenance and cannot be changed through asset editing.')
                        before = [current]
                        if current.get('configuration_managed'):
                            if values['site_id']!=current['site_id']:
                                raise RegistrationError('Use a documented configuration revision to change the site.',409)
                            values={k:v for k,v in values.items() if k!='site_id'}
                        update_asset(identifier, workspace_id=workspace, connection=connection, **values)
                    else:
                        identifier = create_asset(**values, workspace_id=workspace, connection=connection)
                    response = self.get(connection, workspace, identifier)
                metadata = {'actor': 'trusted-local', 'request_hash': fingerprint, 'before': before, 'response': response}
                connection.execute('INSERT INTO audit_events(audit_event_id,workspace_id,action,target_type,target_id,outcome,metadata_json) VALUES (?,?,?,?,?,?,?)',
                                   (receipt, workspace, f'asset.{operation}', 'asset', str(identifier or 'bulk'), 'succeeded', json.dumps(metadata)))
                return response
        except sqlite3.IntegrityError as error:
            raise RegistrationError('External ID already exists in this workspace, or an asset relationship conflicts. No changes were saved.', 409) from error
        except sqlite3.OperationalError as error:
            if 'locked' in str(error).lower() or 'busy' in str(error).lower():
                raise RegistrationError('The database is busy. Retry the unchanged request with the same retry key.', 503) from error
            raise
