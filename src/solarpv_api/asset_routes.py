"""Asset writes restricted to the trusted local host until T12 identity exists."""
import ipaddress
from urllib.parse import urlsplit
from typing import Annotated

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.routing import APIRoute
from solarpv_api.schemas import AssetInput, AssetEdit, AssetBulk, AssetBulkCommit, EquipmentConfiguration
from solarpv_db.equipment import EquipmentService
from solarpv_db.asset_registration import AssetRegistration, RegistrationError
from solarpv_db.database import get_connection


def loopback(host):
    if host == 'localhost':
        return True
    try:
        return ipaddress.ip_address(host).is_loopback
    except ValueError:
        return False


def trusted_local(request: Request):
    # Forwarded headers and client-supplied roles do not grant access.
    if not request.client or not loopback(request.client.host) or not loopback(request.url.hostname):
        raise HTTPException(403, 'Asset registration is restricted to a trusted local connection until authenticated roles are available.')
    origin = request.headers.get('origin')
    if origin:
        try:
            parsed = urlsplit(origin)
            accepted = parsed.scheme in ('http', 'https') and loopback(parsed.hostname)
        except ValueError:
            accepted = False
        if not accepted:
            raise HTTPException(403, 'Asset registration rejects non-local browser origins.')


class AssetRoute(APIRoute):
    def get_route_handler(self):
        handler = super().get_route_handler()
        async def validated(request):
            try:
                return await handler(request)
            except RequestValidationError as error:
                details = ['.'.join(str(part) for part in item['loc']) + ': ' + item['msg'] for item in error.errors()[:10]]
                raise HTTPException(422, 'Correct the asset request: ' + '; '.join(details)) from error
        return validated


router = APIRouter(prefix='/api/v1/workspaces/{workspace_id}/assets', dependencies=[Depends(trusted_local)], route_class=AssetRoute)


def service(request):
    return AssetRegistration(request.app.state.settings.database_path)


def execute(operation):
    try:
        return operation()
    except RegistrationError as error:
        raise HTTPException(error.status, str(error)) from error


RetryKey = Annotated[str, Header(alias='Idempotency-Key', min_length=16, max_length=100, pattern=r'^[A-Za-z0-9_-]+$')]


@router.post('', status_code=201)
def create(workspace_id: str, body: AssetInput, request: Request, idempotency_key: RetryKey):
    return execute(lambda: service(request).write(workspace_id, idempotency_key, 'create', body.model_dump()))


@router.post('/bulk/preview')
def preview(workspace_id: str, body: AssetBulk, request: Request):
    return execute(lambda: service(request).preview(workspace_id, [item.model_dump() for item in body.rows]))


@router.post('/bulk/commit')
def commit(workspace_id: str, body: AssetBulkCommit, request: Request, idempotency_key: RetryKey):
    return execute(lambda: service(request).write(workspace_id, idempotency_key, 'bulk', [item.model_dump() for item in body.rows], preview=body.preview_revision))


@router.get('/{asset_id}/registration')
def edit_details(workspace_id: str, asset_id: int, request: Request):
    def load():
        with get_connection(request.app.state.settings.database_path) as connection:
            return service(request).get(connection, workspace_id, asset_id)
    return execute(load)


@router.put('/{asset_id}')
def update(workspace_id: str, asset_id: int, body: AssetEdit, request: Request, idempotency_key: RetryKey):
    return execute(lambda: service(request).write(workspace_id, idempotency_key, 'update', body.model_dump(exclude={'expected_revision'}), identifier=asset_id, expected=body.expected_revision))


@router.get('/{asset_id}/configurations')
def configurations(workspace_id: str, asset_id: int, request: Request, as_of: str | None = None, offset: int = 0, limit: int = 50):
    return execute(lambda: EquipmentService(request.app.state.settings.database_path).read(workspace_id,asset_id,as_of=as_of,offset=offset,limit=limit))


@router.post('/{asset_id}/configurations', status_code=201)
def append_configuration(workspace_id: str, asset_id: int, body: EquipmentConfiguration, request: Request, idempotency_key: RetryKey):
    return execute(lambda: EquipmentService(request.app.state.settings.database_path).append(workspace_id,asset_id,body.model_dump(),idempotency_key))
