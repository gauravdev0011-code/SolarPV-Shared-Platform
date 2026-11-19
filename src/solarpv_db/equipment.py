"""Append-only physical containment configurations; never electrical topology."""
import json
import sqlite3
from datetime import datetime, timezone
from uuid import NAMESPACE_URL, uuid5

from solarpv_db.asset_registration import AssetRegistration, RegistrationError, digest
from solarpv_db.database import get_connection
from solarpv_db.timestamps import parse_timestamp


def instant(value):
    try:
        stamp = parse_timestamp(value)
    except ValueError as error:
        raise RegistrationError('Effective time must be a valid ISO datetime with an explicit timezone offset.') from error
    if stamp.tzinfo is None:
        raise RegistrationError('Effective time requires an explicit timezone offset; no source timezone is guessed.')
    return stamp.astimezone(timezone.utc).isoformat(timespec='microseconds').replace('+00:00', 'Z')


def serialize(row):
    result = dict(row)
    result['specifications'] = json.loads(result.pop('specifications_json'))
    return result


class EquipmentService:
    def __init__(self, database_path):
        self.database_path = database_path

    @staticmethod
    def head(connection, workspace, asset):
        row = connection.execute('SELECT configuration_id FROM equipment_configurations WHERE workspace_id=? AND asset_id=? ORDER BY effective_from DESC LIMIT 1',(workspace,asset)).fetchone()
        return row[0] if row else None

    @staticmethod
    def at(connection, workspace, asset, as_of):
        row = connection.execute('SELECT * FROM equipment_configurations WHERE workspace_id=? AND asset_id=? AND effective_from<=? ORDER BY effective_from DESC LIMIT 1',(workspace,asset,as_of)).fetchone()
        return serialize(row) if row else None

    def read(self, workspace, asset, *, as_of=None, offset=0, limit=50):
        if not 0 <= offset <= 10000000 or not 1 <= limit <= 100:
            raise RegistrationError('Configuration page bounds are invalid.')
        selected = instant(as_of) if as_of else datetime.now(timezone.utc).isoformat(timespec='microseconds').replace('+00:00','Z')
        with get_connection(self.database_path) as connection:
            connection.execute('BEGIN')
            original = AssetRegistration.get(connection,workspace,asset)
            current = self.at(connection,workspace,asset,selected)
            total = connection.execute('SELECT COUNT(*) FROM equipment_configurations WHERE workspace_id=? AND asset_id=?',(workspace,asset)).fetchone()[0]
            history = connection.execute('SELECT *, LEAD(effective_from) OVER(ORDER BY effective_from) AS effective_to FROM equipment_configurations WHERE workspace_id=? AND asset_id=? ORDER BY effective_from DESC LIMIT ? OFFSET ?',(workspace,asset,limit,offset)).fetchall()
            # Children are evaluated at the same instant, not today's relationship.
            children = connection.execute('''SELECT a.asset_id,a.external_id,a.name FROM assets a JOIN equipment_configurations c
              ON c.workspace_id=a.workspace_id AND c.asset_id=a.asset_id WHERE c.workspace_id=? AND c.parent_asset_id=? AND c.effective_from<=?
              AND NOT EXISTS(SELECT 1 FROM equipment_configurations n WHERE n.workspace_id=c.workspace_id AND n.asset_id=c.asset_id AND n.effective_from>c.effective_from AND n.effective_from<=?)
              ORDER BY a.asset_id LIMIT ? OFFSET ?''',(workspace,asset,selected,selected,limit,offset)).fetchall()
            child_total = connection.execute('''SELECT COUNT(*) FROM equipment_configurations c WHERE c.workspace_id=? AND c.parent_asset_id=? AND c.effective_from<=?
              AND NOT EXISTS(SELECT 1 FROM equipment_configurations n WHERE n.workspace_id=c.workspace_id AND n.asset_id=c.asset_id AND n.effective_from>c.effective_from AND n.effective_from<=?)''',(workspace,asset,selected,selected)).fetchone()[0]
            parent = AssetRegistration.get(connection,workspace,current['parent_asset_id']) if current and current['parent_asset_id'] else None
            latest=connection.execute('SELECT * FROM equipment_configurations WHERE workspace_id=? AND asset_id=? ORDER BY effective_from DESC LIMIT 1',(workspace,asset)).fetchone()
            legacy_site=connection.execute('SELECT site_id FROM assets WHERE workspace_id=? AND asset_id=?',(workspace,asset)).fetchone()[0]
            return {'asset':original,'as_of':selected,'current':current,'latest':serialize(latest) if latest else None,'parent':parent,'head_revision':self.head(connection,workspace,asset),
                    'legacy_site_id':legacy_site,'legacy_effective_time':'unknown',
                    'history':{'items':[serialize(row) for row in history],'total':total,'offset':offset,'limit':limit},
                    'children':{'items':[dict(row) for row in children],'total':child_total,'offset':offset,'limit':limit}}

    @staticmethod
    def validate_graph(connection, workspace):
        # A later parent revision can invalidate an already scheduled child.
        # Check every graph boundary, not just the inserted instant or latest graph.
        rows = connection.execute('SELECT asset_id,parent_asset_id,site_id,effective_from FROM equipment_configurations WHERE workspace_id=? ORDER BY effective_from,asset_id',(workspace,)).fetchall()
        graph = {}
        index = 0
        while index < len(rows):
            boundary = rows[index]['effective_from']
            while index < len(rows) and rows[index]['effective_from']==boundary:
                row=rows[index]; graph[row['asset_id']]=(row['parent_asset_id'],row['site_id']); index+=1
            for child,(parent,site) in graph.items():
                seen={child}; known_site=site
                while parent is not None:
                    if parent in seen:
                        raise RegistrationError('The proposed configuration creates a containment cycle in its effective history.',409)
                    seen.add(parent)
                    parent_state=graph.get(parent)
                    if parent_state is None:
                        break  # Parent's configuration is explicitly unknown at this instant.
                    parent,parent_site=parent_state
                    if known_site is not None and parent_site is not None and known_site!=parent_site:
                        raise RegistrationError('Child and ancestor have conflicting documented sites in their effective history.',409)
                    known_site=known_site or parent_site

    def append(self, workspace, asset, values, key):
        values={**values,'effective_from':instant(values['effective_from'])}
        fingerprint=digest({'asset':asset,'values':values})
        receipt=uuid5(NAMESPACE_URL,f'solaris:configuration:{workspace}:{key}').hex
        try:
            with get_connection(self.database_path) as connection:
                connection.execute('BEGIN IMMEDIATE')
                AssetRegistration.get(connection,workspace,asset)
                previous=connection.execute('SELECT metadata_json FROM audit_events WHERE audit_event_id=?',(receipt,)).fetchone()
                if previous:
                    metadata=json.loads(previous[0])
                    if metadata['request_hash']!=fingerprint:
                        raise RegistrationError('This retry key was used for a different configuration.',409)
                    return metadata['response']
                if self.head(connection,workspace,asset)!=values['expected_revision']:
                    raise RegistrationError('Configuration changed. Reload before saving a new revision.',409)
                if values['parent_asset_id'] is not None:
                    AssetRegistration.get(connection,workspace,values['parent_asset_id'])
                AssetRegistration.site(connection,workspace,values)
                latest=connection.execute('SELECT effective_from FROM equipment_configurations WHERE workspace_id=? AND asset_id=? ORDER BY effective_from DESC LIMIT 1',(workspace,asset)).fetchone()
                if latest and values['effective_from']<=latest[0]:
                    raise RegistrationError('Effective time must be later than the latest revision. Existing history cannot be overwritten.',409)
                names=[item['name'] for item in values['specifications']]
                if len(set(names))!=len(names):
                    raise RegistrationError('Specification names must be unique within a revision.')
                connection.execute('''INSERT INTO equipment_configurations(configuration_id,workspace_id,asset_id,effective_from,equipment_kind,parent_asset_id,site_id,specifications_json,source_reference)
                  VALUES(?,?,?,?,?,?,?,?,?)''',(receipt,workspace,asset,values['effective_from'],values['equipment_kind'],values['parent_asset_id'],values['site_id'],json.dumps(values['specifications']),values['source_reference']))
                self.validate_graph(connection,workspace)
                response=self.at(connection,workspace,asset,values['effective_from'])
                connection.execute('INSERT INTO audit_events(audit_event_id,workspace_id,action,target_type,target_id,outcome,metadata_json) VALUES(?,?,?,?,?,?,?)',
                                   (receipt,workspace,'equipment.append','asset',str(asset),'succeeded',json.dumps({'actor':'trusted-local','request_hash':fingerprint,'response':response})))
                return response
        except sqlite3.IntegrityError as error:
            raise RegistrationError('Configuration violates a workspace, identity or append-only history constraint.',409) from error
        except sqlite3.OperationalError as error:
            if 'locked' in str(error).lower() or 'busy' in str(error).lower():
                raise RegistrationError('Database busy. Retry with the same configuration retry key.',503) from error
            raise
