"""Explicit whole-instance operator capability, separate from workspace access."""
from datetime import datetime, timezone
import hmac
import ipaddress
import json
from pathlib import Path
import re
from uuid import uuid4

from fastapi import APIRouter, Header, HTTPException, Request
from solarpv_db.recovery import create_package, restore_package, verify_package, RecoveryError, _json, _separate, _clean_path

router = APIRouter(prefix='/api/v1/recovery', tags=['Operator recovery'])


def _local(request):
    try:
        address = ipaddress.ip_address(request.client.host)
        return address.is_loopback or bool(getattr(address, 'ipv4_mapped', None) and address.ipv4_mapped.is_loopback)
    except (ValueError, AttributeError):
        return False


def _operator(request, authorization):
    settings = request.app.state.settings
    if not _local(request):
        raise HTTPException(403, 'Recovery is restricted to a local operator connection.')
    if not settings.recovery_root or not settings.recovery_token or len(settings.recovery_token) < 32:
        raise HTTPException(503, 'Recovery controls are disabled. An operator must configure a private recovery root and a token of at least 32 characters.')
    supplied = authorization or ''
    if not hmac.compare_digest(supplied.encode(), ('Bearer ' + settings.recovery_token).encode()):
        raise HTTPException(403, 'A valid recovery operator token is required. Workspace access does not grant whole-instance recovery access.')
    try:
        _separate(_clean_path(settings.recovery_root), settings.database_path, settings.storage_path)
    except RecoveryError as error:
        raise HTTPException(503, str(error)) from error
    return settings


def _path(root, group, identity):
    if not re.fullmatch('[a-f0-9]{32}', identity):
        raise HTTPException(422, 'Invalid recovery package identifier.')
    path = Path(root) / group / identity
    if path.is_symlink() or any(p.is_symlink() or (hasattr(p, 'is_junction') and p.is_junction()) for p in [path, *path.parents]):
        raise HTTPException(422, 'Recovery paths must not contain links.')
    return path


def _event(root, operation, identity, outcome, **details):
    audit = Path(root) / 'audit'
    audit.mkdir(parents=True, exist_ok=True, mode=0o700)
    _json(audit / f'{uuid4().hex}.json', {'at': datetime.now(timezone.utc).isoformat(), 'actor': 'recovery_operator_capability', 'operation': operation, 'target': identity, 'outcome': outcome, **details})


def _perform(settings, operation, identity, action):
    try:
        _event(settings.recovery_root, operation, identity, 'started')
        result = action()
        _event(settings.recovery_root, operation, identity, 'succeeded')
        return result
    except (RecoveryError, OSError) as error:
        try:
            _event(settings.recovery_root, operation, identity, 'failed', reason=str(error)[:500])
        except OSError:
            pass
        raise HTTPException(409, str(error)) from error


@router.get('/status')
def status(request: Request):
    settings = request.app.state.settings
    return {'enabled': bool(_local(request) and settings.recovery_root and settings.recovery_token and len(settings.recovery_token) >= 32), 'scope': 'Whole instance, including all workspaces. Local operator credential required.'}


@router.get('/backups')
def list_backups(request: Request, authorization: str | None = Header(default=None)):
    settings = _operator(request, authorization)
    directory = Path(settings.recovery_root) / 'packages'
    items = []
    if directory.is_dir():
        for path in sorted(directory.iterdir(), reverse=True):
            if re.fullmatch('[a-f0-9]{32}', path.name):
                _path(settings.recovery_root, 'packages', path.name)
                complete = (path / 'manifest.json').is_file() and not (path / '.incomplete').exists()
                items.append({'backup_id': path.name, 'state': 'ready_to_verify' if complete else 'incomplete'})
    return {'items': items, 'note': 'A listed package must be verified before restore; listing is not checksum verification.'}


@router.post('/backups', status_code=201)
def backup(request: Request, authorization: str | None = Header(default=None)):
    settings = _operator(request, authorization)
    identity = uuid4().hex
    path = _path(settings.recovery_root, 'packages', identity)
    return _perform(settings, 'backup', identity, lambda: {**create_package(settings.database_path, settings.storage_path, path), 'backup_id': identity, 'package_path': str(path)})


@router.post('/backups/{identity}/verify')
def verify(identity: str, request: Request, authorization: str | None = Header(default=None)):
    settings = _operator(request, authorization)
    path = _path(settings.recovery_root, 'packages', identity)
    return _perform(settings, 'verify', identity, lambda: verify_package(path))


@router.post('/backups/{identity}/restore', status_code=201)
def restore(identity: str, request: Request, authorization: str | None = Header(default=None)):
    settings = _operator(request, authorization)
    package = _path(settings.recovery_root, 'packages', identity)
    destination = _path(settings.recovery_root, 'restores', uuid4().hex)
    return _perform(settings, 'restore', identity, lambda: restore_package(package, destination, active_database=settings.database_path, active_storage=settings.storage_path))
