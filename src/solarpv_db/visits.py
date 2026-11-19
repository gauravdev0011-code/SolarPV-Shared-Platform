"""Atomic visit capture and immutable amendments, backed by original domain rows."""
import hashlib
import json
import math
import re
import sqlite3
from decimal import Decimal, InvalidOperation
from uuid import NAMESPACE_URL, uuid5

from solarpv_db.asset_registration import AssetRegistration, RegistrationError, digest
from solarpv_db.database import get_connection
from solarpv_db.inspections import create_inspection
from solarpv_db.observations import create_observation
from solarpv_db.timestamps import normalize_timestamp
from solarpv_ingestion.intelligence import UNITS
from solarpv_ingestion.validation import EXPECTED_UNITS

QUANTITY_UNITS = {**UNITS, 'temperature': {'C','°C','degC','K','°F','degF'}, 'resistance': {'ohm','Ω','kohm','MΩ'},
                  'irradiance': {'W/m²', 'W/m2', 'W/m^2'}}
IMAGE_TYPES = {'image/png','image/jpeg','image/tiff'}
DOCUMENT_TYPES = {'pdf': 'application/pdf', 'csv': 'text/plain', 'json': 'application/json'}


def numeric(value, unit, quantity, metric):
    if quantity is not None and quantity not in QUANTITY_UNITS:
        raise RegistrationError('Choose a supported explicit quantity; unknown quantities are not inferred.')
    if quantity is not None and unit is not None and unit not in QUANTITY_UNITS[quantity]:
        raise RegistrationError('The source unit is incompatible with the explicitly selected quantity.')
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value,(str,float,int)):
        raise RegistrationError('A reading must be a finite decimal number or explicitly missing.')
    text=str(value)
    if len(text)>2000:raise RegistrationError('Source numeric text exceeds the 2000-character reading limit.')
    if not re.fullmatch(r'[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?',text):
        raise RegistrationError('Use an unambiguous decimal reading; do not supply text, commas or null markers as numbers.')
    try:
        exact=Decimal(text); approximate=float(exact)
    except (InvalidOperation,ValueError,OverflowError) as error:
        raise RegistrationError('Reading is not a supported finite number.') from error
    if not math.isfinite(approximate) or (exact!=0 and approximate==0):
        raise RegistrationError('Reading is outside the supported finite numeric range.')
    allowed=QUANTITY_UNITS.get(quantity) if quantity else EXPECTED_UNITS.get(metric)
    if not allowed or unit not in allowed:
        raise RegistrationError('Choose an explicit supported quantity and compatible source unit; units are never inferred or converted.')
    return approximate


class VisitService:
    def __init__(self,database_path,storage):
        self.database_path=database_path
        self.storage=storage

    @staticmethod
    def original(connection,workspace,visit):
        row=connection.execute('SELECT * FROM inspections WHERE workspace_id=? AND inspection_id=?',(workspace,visit)).fetchone()
        if not row:
            raise RegistrationError('Visit not found in this workspace.',404)
        return dict(row)

    @staticmethod
    def head(connection,workspace,visit):
        return connection.execute('SELECT * FROM inspection_revisions WHERE workspace_id=? AND inspection_id=? ORDER BY revision_number DESC LIMIT 1',(workspace,visit)).fetchone()

    def attachment(self,connection,workspace,source_id):
        row=connection.execute("SELECT f.*, l.kind FROM source_files f LEFT JOIN visit_source_labels l USING (source_file_id) "
                               "WHERE f.workspace_id=? AND f.source_file_id=? AND f.state<>'deleted'",(workspace,source_id)).fetchone()
        if row is None or (row['media_type'] not in IMAGE_TYPES and DOCUMENT_TYPES.get(row['kind']) != row['media_type']):
            raise RegistrationError('Evidence not found in this workspace or format is unsupported.',404)
        # Verify bytes before linking or serving, not merely the database hash.
        path=self.storage._resolve_key(row['storage_key'])
        try:
            hashed=hashlib.sha256(); size=0
            with path.open('rb') as stream:
                while chunk:=stream.read(1024*1024):hashed.update(chunk);size+=len(chunk)
        except OSError as error:
            raise RegistrationError('Original photograph is unavailable. Verify or restore the original bytes before continuing.',409) from error
        if hashed.hexdigest()!=row['sha256'] or size!=row['size_bytes']:
            raise RegistrationError('Original photograph checksum does not match. Restore verified bytes before continuing.',409)
        return dict(row),path

    @staticmethod
    def _revision(connection,workspace,visit,revision_id,number,header,ids,inputs,attachments,reason):
        connection.execute('''INSERT INTO inspection_revisions(revision_id,workspace_id,inspection_id,revision_number,inspected_at,inspection_method,data_source,status,notes,reason,observation_ids_json,observation_inputs_json,attachment_ids_json)
          VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)''',(revision_id,workspace,visit,number,header['inspected_at'],header.get('inspection_method'),header.get('data_source'),header['status'],header.get('notes'),reason,json.dumps(ids),json.dumps(inputs),json.dumps(attachments)))

    @classmethod
    def record_readings(cls, connection, workspace, visit, revision, number, header, inputs, values, attachments, reason):
        ids = [create_observation(visit, item['observation_type'], value, item['unit'], item['finding'],
                                  item['data_quality'], item['source_reference'], workspace_id=workspace,
                                  connection=connection)
               for item, value in zip(inputs, values, strict=True)]
        cls._revision(connection, workspace, visit, revision, number, header, ids, inputs, attachments, reason)

    def save(self,workspace,body,key,visit=None):
        body={**body,'inspected_at':normalize_timestamp(body['inspected_at'])}
        body['observations'] = [
            {key: value for key, value in item.items() if key != 'measurement_status' or value is not None}
            for item in body['observations']
        ]
        files_only = body.get("attachments_only", False)
        if not files_only:
            body.pop("attachments_only", None)
        if files_only and (visit is None or body['observations']):
            raise RegistrationError('An attachment-only amendment requires an existing visit and no submitted readings.')
        fingerprint=digest({'visit':visit,'body':body})
        receipt=uuid5(NAMESPACE_URL,f'solaris:visit:{workspace}:{key}').hex
        try:
            with get_connection(self.database_path) as connection:
                connection.execute('BEGIN IMMEDIATE')
                AssetRegistration.get(connection,workspace,body['asset_id'])
                previous=connection.execute('SELECT metadata_json FROM audit_events WHERE audit_event_id=?',(receipt,)).fetchone()
                if previous:
                    evidence=json.loads(previous[0])
                    if evidence['request_hash']!=fingerprint:raise RegistrationError('Retry key already used for a different visit request.',409)
                    return evidence['response']
                values=[]
                for item in body['observations']:
                    value=numeric(item['value'],item['unit'],item.get('quantity'),item['observation_type'])
                    if value is None and not (item.get('finding') or '').strip():
                        raise RegistrationError('A missing reading needs an explicit finding or missing-value reason.')
                    values.append(value)
                attachments=body['attachment_ids']
                if len(set(attachments))!=len(attachments):raise RegistrationError('Do not attach the same photograph twice.')
                for source in attachments:self.attachment(connection,workspace,source)
                if visit is not None:
                    original=self.original(connection,workspace,visit)
                    if original['asset_id']!=body['asset_id'] or original['data_origin']!=body['data_origin']:
                        raise RegistrationError('Amendments preserve visit identity, asset and original origin.')
                    if not body['reason'].strip():raise RegistrationError('An amendment requires a correction reason.')
                    head=self.head(connection,workspace,visit)
                    if (head['revision_id'] if head else None)!=body['expected_revision']:
                        raise RegistrationError('Visit changed. Reload its latest revision before amending.',409)
                    if not head:
                        rows=connection.execute('SELECT * FROM observations WHERE workspace_id=? AND inspection_id=? ORDER BY observation_id LIMIT 501',(workspace,visit)).fetchall()
                        if len(rows)>500:raise RegistrationError('This legacy visit exceeds the 500-reading amendment limit. Original evidence remains unchanged.')
                        baseline=uuid5(NAMESPACE_URL,f'solaris:original:{workspace}:{visit}').hex
                        self._revision(connection,workspace,visit,baseline,0,original,[r['observation_id'] for r in rows],[dict(r) for r in rows],[],'Legacy original evidence preserved; historical revision date unknown.')
                        number=1
                    else:number=head['revision_number']+1
                    if files_only:
                        head = self.head(connection,workspace,visit)
                        header = dict(head)
                        ids = json.loads(head['observation_ids_json'])
                        inputs = json.loads(head['observation_inputs_json'])
                else:
                    if body['expected_revision'] is not None:raise RegistrationError('A new visit cannot specify an existing revision.')
                    visit=create_inspection(body['asset_id'],body['inspected_at'],inspection_method=body['inspection_method'],data_source=body['data_source'],data_origin=body['data_origin'],status=body['status'],notes=body['notes'],workspace_id=workspace,connection=connection)
                    number=1
                reason = body['reason'] or 'Initial visit capture'
                if files_only:
                    self._revision(connection,workspace,visit,receipt,number,header,ids,inputs,attachments,reason)
                    count = len(ids)
                else:
                    self.record_readings(connection,workspace,visit,receipt,number,body,body['observations'],values,attachments,reason)
                    count = len(values)
                response={'inspection_id':visit,'revision_id':receipt,'revision_number':number,'observation_count':count,'attachment_count':len(attachments)}
                connection.execute('INSERT INTO audit_events(audit_event_id,workspace_id,action,target_type,target_id,outcome,metadata_json) VALUES(?,?,?,?,?,?,?)',
                  (receipt,workspace,'visit.amend' if number>1 or body['reason'] else 'visit.capture','inspection',str(visit),'succeeded',json.dumps({'actor':'trusted-local','request_hash':fingerprint,'response':response})))
                return response
        except sqlite3.IntegrityError as error:
            raise RegistrationError('Visit violates an ownership or immutable-evidence constraint; no partial visit was saved.',409) from error
        except sqlite3.OperationalError as error:
            if 'locked' in str(error).lower() or 'busy' in str(error).lower():raise RegistrationError('Database busy; retry the unchanged visit with the same key.',503) from error
            raise

    def read(self,workspace,visit,revision=None,offset=0,limit=50):
        if not 1<=limit<=100 or not 0<=offset<=10000000:raise RegistrationError('Visit page bounds are invalid.')
        with get_connection(self.database_path) as connection:
            connection.execute('BEGIN')
            original=self.original(connection,workspace,visit)
            head=self.head(connection,workspace,visit)
            if revision=='original':
                selected=connection.execute('SELECT * FROM inspection_revisions WHERE workspace_id=? AND inspection_id=? ORDER BY revision_number LIMIT 1',(workspace,visit)).fetchone()
            elif revision:
                selected=connection.execute('SELECT * FROM inspection_revisions WHERE workspace_id=? AND inspection_id=? AND revision_id=?',(workspace,visit,revision)).fetchone()
                if selected is None:raise RegistrationError('Revision not found for this visit.',404)
            else:selected=head
            if selected:
                header={**original,**dict(selected)}
                ids=json.loads(header.pop('observation_ids_json'));inputs=json.loads(header.pop('observation_inputs_json'));sources=json.loads(header.pop('attachment_ids_json'))
                rows=[]
                for index,identifier in enumerate(ids[offset:offset+limit],start=offset):
                    row=dict(connection.execute('SELECT * FROM observations WHERE workspace_id=? AND observation_id=?',(workspace,identifier)).fetchone())
                    raw=inputs[index];row['source_value']=raw.get('value');row['quantity']=raw.get('quantity')
                    row['measurement_status']=raw.get('measurement_status');rows.append(row)
                total=len(ids)
            else:
                header=original;sources=[]
                rows=[dict(r) for r in connection.execute('SELECT * FROM observations WHERE workspace_id=? AND inspection_id=? ORDER BY observation_id LIMIT ? OFFSET ?',(workspace,visit,limit,offset))]
                total=connection.execute('SELECT COUNT(*) FROM observations WHERE workspace_id=? AND inspection_id=?',(workspace,visit)).fetchone()[0]
            files=[]
            for source in sources:
                row=connection.execute('SELECT source_file_id,original_name,media_type,sha256,size_bytes,kind FROM source_files LEFT JOIN visit_source_labels USING (source_file_id) WHERE workspace_id=? AND source_file_id=?',(workspace,source)).fetchone()
                if row is None:raise RegistrationError('Historical photograph metadata is missing.',409)
                files.append(dict(row))
            history=[dict(row) for row in connection.execute('SELECT revision_id,revision_number,reason,recorded_at FROM inspection_revisions WHERE workspace_id=? AND inspection_id=? ORDER BY revision_number DESC LIMIT ? OFFSET ?',(workspace,visit,limit,offset))]
            count=connection.execute('SELECT COUNT(*) FROM inspection_revisions WHERE workspace_id=? AND inspection_id=?',(workspace,visit)).fetchone()[0]
            return {'visit':header,'head_revision':head['revision_id'] if head else None,'observations':{'items':rows,'total':total,'offset':offset,'limit':limit},'attachments':files,'revisions':{'items':history,'total':count,'offset':offset,'limit':limit},'original_evidence_available':True}

    def download(self,workspace,visit,source):
        with get_connection(self.database_path) as connection:
            self.original(connection,workspace,visit)
            if not connection.execute('SELECT 1 FROM inspection_attachment_references WHERE workspace_id=? AND inspection_id=? AND source_file_id=?',(workspace,visit,source)).fetchone():
                raise RegistrationError('Photograph is not attached to this visit.',404)
            return self.attachment(connection,workspace,source)
