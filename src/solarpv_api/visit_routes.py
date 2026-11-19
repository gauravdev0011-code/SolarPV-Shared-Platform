"""Trusted-local capture, correction and private photograph access."""
from typing import Literal
import csv
import io
import json
import os
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import FileResponse
from pydantic import BaseModel, ConfigDict, Field, StrictFloat, StrictStr
from solarpv_api.asset_routes import AssetRoute, RetryKey, execute, trusted_local
from solarpv_api.schemas import AssetText, AssetNote
from solarpv_db.asset_registration import AssetRegistration, RegistrationError
from solarpv_db.database import get_connection
from solarpv_db.panel_demo import DEMO_LABEL, demo_database
from solarpv_db.visits import VisitService, IMAGE_TYPES, QUANTITY_UNITS
from solarpv_ingestion.intake import FileIntakeService, UnsafeUploadError
from solarpv_ingestion.storage import LocalArtifactStorage, UploadTooLargeError


class ReadingInput(BaseModel):
    model_config=ConfigDict(extra='forbid')
    observation_type: AssetText
    value: StrictStr | StrictFloat | None = None
    quantity: AssetText | None = None
    unit: StrictStr | None = Field(default=None,min_length=1,max_length=200)
    finding: AssetNote | None = None
    data_quality: Literal['good','suspect','invalid','unknown']='unknown'
    source_reference: AssetNote | None = None
    measurement_status: AssetText | None = None


class VisitInput(BaseModel):
    model_config=ConfigDict(extra='forbid')
    asset_id: int = Field(gt=0,strict=True)
    inspected_at: AssetText
    inspection_method: AssetText | None = None
    data_source: AssetText | None = None
    data_origin: Literal['real','synthetic','unknown']='unknown'
    status: Literal['planned','in_progress','completed','cancelled']='completed'
    notes: AssetNote | None = None
    expected_revision: AssetText | None = None
    reason: AssetNote=''
    observations: list[ReadingInput] = Field(default_factory=list,max_length=500)
    attachment_ids: list[AssetText] = Field(default_factory=list,max_length=20)
    attachments_only: bool = False


router=APIRouter(prefix='/api/v1/workspaces/{workspace_id}/visits',dependencies=[Depends(trusted_local)],route_class=AssetRoute)
demo_router=APIRouter(prefix='/api/v1/panel-demo/visits',dependencies=[Depends(trusted_local)],route_class=AssetRoute)
EvidenceKind = Literal['rgb', 'thermal', 'pdf', 'csv', 'json']


def service(request):return VisitService(request.app.state.settings.database_path,request.app.state.storage)


def demo_service(request):
    root = os.environ.get("SOLARPV_PANEL_DEMO_DIR")
    database = demo_database(root) if root else None
    if not database or not database.is_file() or database == request.app.state.settings.database_path.resolve():
        raise HTTPException(503, "Seed the isolated panel demo database.")
    return VisitService(database, LocalArtifactStorage(database.parent / "visit-files"))


def save(request,workspace,body,key,visit=None):
    return save_with(service(request), workspace, body.model_dump(), key, visit)


def save_with(visits,workspace,body,key,visit=None):
    try:return visits.save(workspace,body,key,visit)
    except ValueError as error:
        if isinstance(error,RegistrationError):raise HTTPException(error.status,str(error)) from error
        raise HTTPException(422,str(error)) from error


@router.get('/units')
@demo_router.get('/units')
def units():return {'quantities':{key:sorted(value) for key,value in QUANTITY_UNITS.items()},'policy':'Explicit source quantities and units; no automatic conversion.'}


@router.post('',status_code=201)
def create(workspace_id:str,body:VisitInput,request:Request,idempotency_key:RetryKey):return save(request,workspace_id,body,idempotency_key)


@router.post('/{visit_id}/amendments',status_code=201)
def amend(workspace_id:str,visit_id:int,body:VisitInput,request:Request,idempotency_key:RetryKey):return save(request,workspace_id,body,idempotency_key,visit_id)


@router.get('/{visit_id}')
def read(workspace_id:str,visit_id:int,request:Request,revision:str|None=None,offset:int=0,limit:int=50):
    return execute(lambda:service(request).read(workspace_id,visit_id,revision,offset,limit))


@router.post('/attachments',status_code=201)
async def photograph(workspace_id:str,request:Request,kind:EvidenceKind|None=None):
    return await upload_evidence(service(request), workspace_id, request, kind)


def validate_evidence(content, kind):
    if kind in {None, 'rgb', 'thermal'}:
        if not content.startswith((b'\x89PNG\r\n\x1a\n',b'\xff\xd8\xff',b'II*\x00',b'MM\x00*')):
            raise HTTPException(415, 'Select a PNG, JPEG or TIFF original.')
        return IMAGE_TYPES
    if kind == 'pdf':
        if not content.startswith(b'%PDF-') or not content.rstrip().endswith(b'%%EOF'):
            raise HTTPException(415, 'Select a PDF with a PDF header and end marker.')
        return {'application/pdf'}
    try:
        decoded = content.decode('utf-8')
        if kind == 'json':
            def reject_constants(value):
                raise ValueError("JSON numbers must be finite.")
            if not isinstance(json.loads(decoded, parse_constant=reject_constants), (list, dict)):
                raise ValueError("JSON evidence must be an object or array.")
            return {'application/json'}
        rows = csv.reader(io.StringIO(decoded, newline=""), strict=True)
        first = next(rows, [])
        if '\x00' in decoded or len(first) < 2 or not all(field.strip() for field in first):
            raise ValueError("CSV evidence needs at least two named columns.")
        count = 0
        for row in rows:
            if not row:
                continue
            if len(row) != len(first):
                raise ValueError("CSV records must match the header width.")
            count += 1
        if count == 0:
            raise ValueError("CSV evidence needs at least one data row.")
        return {'text/plain'}
    except (ValueError, csv.Error, RecursionError) as error:
        raise HTTPException(422, 'Select valid UTF-8 structured evidence matching the file type.') from error


async def upload_evidence(visits, workspace_id, request, kind):
    with get_connection(visits.database_path) as connection:
        execute(lambda:AssetRegistration.workspace(connection,workspace_id))
    form=await request.form(max_files=1,max_fields=0)
    upload=form.get('file')
    if len(form.multi_items())!=1 or upload is None or not hasattr(upload,'file'):
        raise HTTPException(422,'Select exactly one evidence file.')
    try:
        limit = min(request.app.state.settings.max_file_bytes, 20*1024*1024)
        content = upload.file.read(limit + 1)
        upload.file.seek(0)
        if len(content) > limit:
            raise HTTPException(413, 'File exceeds the visit evidence size limit.')
        allowed = validate_evidence(content, kind)
        intake=FileIntakeService(database_path=visits.database_path,storage=visits.storage,max_file_bytes=limit)
        result=intake.accept(upload.file,workspace_id=workspace_id,original_filename=upload.filename or '')
        source=result.source_file
        if source.media_type not in allowed:raise HTTPException(415,'Detected content does not match the selected file type.')
        if kind:
            with get_connection(visits.database_path) as connection:
                connection.execute("BEGIN IMMEDIATE")
                connection.execute("INSERT OR IGNORE INTO visit_source_labels VALUES (?,?)", (source.source_file_id, kind))
                label = connection.execute("SELECT kind FROM visit_source_labels WHERE source_file_id=?", (source.source_file_id,)).fetchone()
                if label["kind"] != kind:
                    raise HTTPException(409, "This original already has a different recorded file type.")
        return {'source_file_id':source.source_file_id,'original_name':source.original_name,'sha256':source.sha256,'size_bytes':source.size_bytes,'media_type':source.media_type,'duplicate':result.duplicate,'attached':False,'kind':kind}
    except UploadTooLargeError as error:raise HTTPException(413,str(error)) from error
    except (UnsafeUploadError,ValueError) as error:raise HTTPException(422,str(error)) from error
    finally:await upload.close()


@router.get('/{visit_id}/attachments/{source_id}')
def download(workspace_id:str,visit_id:int,source_id:str,request:Request):
    return evidence_download(service(request), workspace_id, visit_id, source_id)


def evidence_download(visits, workspace_id, visit_id, source_id):
    row,path=execute(lambda:visits.download(workspace_id,visit_id,source_id))
    return FileResponse(path,filename=row['original_name'],media_type='application/octet-stream',headers={'X-Content-Type-Options':'nosniff','Cache-Control':'no-store'})


def save_demo(request, body, key, visit_id=None):
    visits = demo_service(request)
    with get_connection(visits.database_path) as connection:
        if not connection.execute(
            "SELECT 1 FROM assets WHERE workspace_id='default' AND asset_id=? AND asset_type='panel'", (body.asset_id,),
        ).fetchone():
            raise HTTPException(404, "Demo panel was not found.")
    payload = body.model_dump()
    if payload["data_origin"] != "synthetic":
        raise HTTPException(422, "The demo accepts synthetic visits only.")
    payload["data_source"] = payload["data_source"] or DEMO_LABEL
    return save_with(visits, "default", payload, key, visit_id)


@demo_router.post('', status_code=201)
def create_demo(body: VisitInput, request: Request, idempotency_key: RetryKey):
    return save_demo(request, body, idempotency_key)


@demo_router.post('/{visit_id}/amendments', status_code=201)
def amend_demo(visit_id: int, body: VisitInput, request: Request, idempotency_key: RetryKey):
    return save_demo(request, body, idempotency_key, visit_id)


@demo_router.get('/{visit_id}')
def read_demo(visit_id: int, request: Request, revision: str | None = None, offset: int = 0, limit: int = 50):
    return execute(lambda: demo_service(request).read("default", visit_id, revision, offset, limit))


@demo_router.post('/attachments', status_code=201)
async def demo_upload(request: Request, kind: EvidenceKind | None = None):
    return await upload_evidence(demo_service(request), "default", request, kind)


@demo_router.get('/{visit_id}/attachments/{source_id}')
def demo_download(visit_id: int, source_id: str, request: Request):
    return evidence_download(demo_service(request), "default", visit_id, source_id)
