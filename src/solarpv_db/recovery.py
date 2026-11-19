"""Whole-instance recovery packages. No restore operation replaces an active store."""
from contextlib import closing
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import sqlite3
from uuid import uuid4

from solarpv_db.database import _get_migrations


class RecoveryError(ValueError):
    pass


def _json(path, value):
    with path.open('x', encoding='utf-8') as stream:
        json.dump(value, stream, indent=2, sort_keys=True)
        stream.flush()
        os.fsync(stream.fileno())


def _file(root, key):
    """Reject traversal, absolute paths, links and Windows alternate streams."""
    if not isinstance(key, str) or not key or '\\' in key or ':' in key:
        raise RecoveryError('Invalid recovery file path.')
    parts = PurePosixPath(key).parts
    if key.startswith('/') or any(p in ('', '..', '.') for p in key.split('/')) or not parts:
        raise RecoveryError('Invalid recovery file path.')
    path = root
    for part in parts:
        path = path / part
        if path.is_symlink() or (hasattr(path, 'is_junction') and path.is_junction()):
            raise RecoveryError('Linked recovery files or directories are not supported.')
    if not path.resolve().is_relative_to(root.resolve()):
        raise RecoveryError('Recovery file escapes its private directory.')
    return path


def _digest(path):
    digest = hashlib.sha256()
    size = 0
    with path.open('rb') as stream:
        while chunk := stream.read(1024 * 1024):
            digest.update(chunk)
            size += len(chunk)
    return {'sha256': digest.hexdigest(), 'size_bytes': size}


def _copy(source, target, expected=None):
    target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    with source.open('rb') as reader, target.open('xb') as writer:
        os.chmod(target, 0o600)
        while chunk := reader.read(1024 * 1024):
            writer.write(chunk)
        writer.flush()
        os.fsync(writer.fileno())
    actual = _digest(target)
    if expected is not None and actual != expected:
        raise RecoveryError(f'Checksum or size mismatch: {target.name}. Original data was not changed.')
    return actual


def _read_database(path):
    if not path.is_file():
        raise RecoveryError('Recovery database is missing.')
    connection = sqlite3.connect(path.resolve().as_uri() + '?mode=ro', uri=True)
    connection.row_factory = sqlite3.Row
    return connection


def _schema(connection):
    migrations = _get_migrations()
    version = connection.execute('PRAGMA user_version').fetchone()[0]
    expected = [(v, name, checksum) for v, name, checksum, _ in migrations]
    actual = [tuple(r) for r in connection.execute('SELECT version,name,checksum FROM schema_migrations ORDER BY version')]
    if version != migrations[-1][0] or actual != expected:
        raise RecoveryError('Unsupported or altered database schema. Use the matching SOLARIS release; no migration was attempted.')
    if connection.execute('PRAGMA integrity_check').fetchall()[0][0] != 'ok':
        raise RecoveryError('Database integrity check failed.')
    if connection.execute('PRAGMA foreign_key_check').fetchall():
        raise RecoveryError('Database relationship check failed.')
    return {'version': version, 'migrations': [list(r) for r in actual]}


def _references(connection, storage):
    """Inventory committed immutable files, including report-linked JSONL details."""
    refs = {}

    def add(key, checksum, size=None):
        if not key or not checksum:
            raise RecoveryError('A committed source/artifact lacks recovery checksum evidence.')
        path = _file(storage, key)
        measured = _digest(path)
        if measured['sha256'] != checksum or (size is not None and measured['size_bytes'] != size):
            raise RecoveryError(f'Source/artifact checksum mismatch: {key}. Repair the source store before backup.')
        if key in refs and refs[key] != measured:
            raise RecoveryError('Conflicting source/artifact references.')
        refs[key] = measured

    for row in connection.execute("SELECT storage_key,sha256,size_bytes,state FROM source_files f WHERE state <> 'deleted' OR EXISTS (SELECT 1 FROM dataset_sources ds WHERE ds.source_file_id=f.source_file_id) OR EXISTS(SELECT 1 FROM inspection_attachment_references r WHERE r.source_file_id=f.source_file_id AND r.workspace_id=f.workspace_id)"):
        add(row['storage_key'], row['sha256'], row['size_bytes'])
    for row in connection.execute('SELECT storage_key,checksum FROM extraction_artifacts'):
        add(row['storage_key'], row['checksum'])
    for row in connection.execute('SELECT result_key,result_checksum FROM validation_runs WHERE result_key IS NOT NULL'):
        add(row['result_key'], row['result_checksum'])
        report = json.loads(_file(storage, row['result_key']).read_text(encoding='utf-8'))
        if not isinstance(report, dict):
            raise RecoveryError('Validation report is not a supported object.')
        details = report.get('issue_details') or {}
        if not isinstance(details, dict):
            raise RecoveryError('Validation detail references are invalid.')
        if details.get('available'):
            add(details.get('storage_key'), details.get('sha256'), details.get('size_bytes'))
    for row in connection.execute('SELECT artifact_key FROM dataset_versions WHERE artifact_key IS NOT NULL'):
        if row['artifact_key'] not in refs:
            raise RecoveryError('A dataset references an unaccounted recovery artifact.')
    return refs


def _new_directory(path):
    if path.exists():
        raise RecoveryError('Destination already exists. Choose a new directory; nothing was overwritten.')
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    path.mkdir(mode=0o700)
    _json(path / '.incomplete', {'state': 'incomplete', 'instruction': 'Not a verified recovery package. Choose a new destination to retry.'})


def _clean_path(value):
    path = Path(value).expanduser().absolute()
    for part in [path, *path.parents]:
        if part.is_symlink() or (hasattr(part, 'is_junction') and part.is_junction()):
            raise RecoveryError('Recovery paths must not contain symbolic links or junctions.')
    return path.resolve()


def _separate(destination, database, storage):
    destination, database, storage = destination.resolve(), database.resolve(), storage.resolve()
    if destination == database or database.is_relative_to(destination) or destination.is_relative_to(storage) or storage.is_relative_to(destination):
        raise RecoveryError('Recovery destination must be separate from the active database and private storage.')


def create_package(database, storage, destination):
    database, storage, destination = _clean_path(database), _clean_path(storage), _clean_path(destination)
    _separate(destination, database, storage)
    if not database.is_file() or not storage.is_dir():
        raise RecoveryError('Select the existing database and its matching private storage directory.')
    # Reserve output exclusively. Interrupted operations retain .incomplete and can never verify.
    _new_directory(destination)
    try:
        with closing(sqlite3.connect(database, timeout=5)) as barrier:
            barrier.row_factory = sqlite3.Row
            barrier.execute('BEGIN IMMEDIATE')
            if barrier.execute("SELECT 1 FROM intake_uploads WHERE state IN ('receiving','staged') LIMIT 1").fetchone():
                raise RecoveryError('An upload is still receiving/publishing bytes. Wait for it to finish and retry backup in a new directory.')
            with closing(_read_database(database)) as reader, closing(sqlite3.connect(destination / 'database.sqlite3')) as snapshot:
                reader.backup(snapshot)
            barrier.rollback()
        # Published, committed source/artifact keys are immutable. Read the closure
        # from the snapshot, not the advancing live DB; allow workers to commit
        # while copying those keys. Deletion/corruption aborts verification safely.
        with closing(_read_database(destination / 'database.sqlite3')) as snapshot:
            schema = _schema(snapshot)
            refs = _references(snapshot, storage)
        files = {'database.sqlite3': _digest(destination / 'database.sqlite3')}
        for key, expected in sorted(refs.items()):
            files['private-storage/' + key] = _copy(_file(storage, key), _file(destination, 'private-storage/' + key), expected)
        (destination / 'private-storage').mkdir(exist_ok=True, mode=0o700)
        manifest = {'format': 'solaris-recovery', 'format_version': 1, 'package_id': uuid4().hex,
                    'created_at': datetime.now(timezone.utc).isoformat(), 'schema': schema,
                    'scope': 'entire instance; all workspaces', 'files': files,
                    'snapshot_policy': 'SQLite snapshot under short write barrier; immutable committed file closure copied after writers resume. Incomplete uploads must finish. In-flight jobs retain leases and use normal expired-lease recovery.'}
        _json(destination / 'manifest.json', manifest)
        # Validate before marking complete; publication is the last step.
        _verify(destination, allow_incomplete=True)
        (destination / '.incomplete').unlink()
        return {'package_id': manifest['package_id'], 'files': len(files), 'schema_version': schema['version'], 'state': 'verified'}
    except (OSError, sqlite3.Error, ValueError, KeyError, TypeError) as error:
        raise RecoveryError(f'Backup did not complete: {error}. Incomplete output is retained; original data is unchanged.') from error


def _verify(package, allow_incomplete=False):
    if package.is_symlink() or not package.is_dir() or ((package / '.incomplete').exists() and not allow_incomplete):
        raise RecoveryError('Package is missing or incomplete; it cannot be restored.')
    manifest_path = _file(package, 'manifest.json')
    if manifest_path.stat().st_size > 32 * 1024 * 1024:
        raise RecoveryError('Recovery manifest exceeds the supported size.')
    def unique_pairs(pairs):
        result = {}
        for key, value in pairs:
            if key in result:
                raise RecoveryError('Duplicate manifest keys are not supported.')
            result[key] = value
        return result
    manifest = json.loads(manifest_path.read_text(encoding='utf-8'), object_pairs_hook=unique_pairs)
    if not isinstance(manifest, dict):
        raise RecoveryError('Recovery manifest must be an object.')
    if manifest.get('format') != 'solaris-recovery' or type(manifest.get('format_version')) is not int or manifest.get('format_version') != 1:
        raise RecoveryError('Unsupported recovery package format.')
    files = manifest['files']
    if not isinstance(files, dict) or 'database.sqlite3' not in files:
        raise RecoveryError('Recovery manifest is missing its database inventory.')
    for key, expected in files.items():
        if key != 'database.sqlite3' and not key.startswith('private-storage/'):
            raise RecoveryError('Unexpected recovery file path.')
        if _digest(_file(package, key)) != expected:
            raise RecoveryError(f'Recovery file checksum or size mismatch: {key}.')
    with closing(_read_database(_file(package, 'database.sqlite3'))) as connection:
        schema = _schema(connection)
        if schema != manifest['schema']:
            raise RecoveryError('Manifest schema does not match the recovery database.')
        refs = _references(connection, package / 'private-storage')
        required = {'database.sqlite3'} | {'private-storage/' + key for key in refs}
        if required != set(files):
            raise RecoveryError('Manifest does not exactly cover committed source/artifact references.')
        approvals = connection.execute("SELECT COUNT(*) FROM approvals WHERE state='approved'").fetchone()[0]
    return manifest, approvals


def verify_package(package):
    try:
        manifest, approvals = _verify(_clean_path(package))
        return {'state': 'verified', 'package_id': manifest['package_id'], 'files': len(manifest['files']), 'approved_versions': approvals}
    except (OSError, sqlite3.Error, ValueError, KeyError, TypeError) as error:
        raise RecoveryError(f'Recovery verification failed: {error}') from error


def restore_package(package, destination, *, active_database, active_storage):
    package, destination = _clean_path(package), _clean_path(destination)
    _separate(destination, Path(active_database), Path(active_storage))
    if destination.is_relative_to(package) or package.is_relative_to(destination):
        raise RecoveryError('Restore destination must be separate from the recovery package.')
    try:
        manifest, _ = _verify(package)
        _new_directory(destination)
        for key, expected in manifest['files'].items():
            _copy(_file(package, key), _file(destination, key), expected)
        (destination / 'private-storage').mkdir(exist_ok=True, mode=0o700)
        # A restore remains a verifiable package as well as a directly runnable store.
        _json(destination / 'manifest.json', manifest)
        _verify(destination, allow_incomplete=True)
        _json(destination / 'restore-receipt.json', {'package_id': manifest['package_id'], 'verified_at': datetime.now(timezone.utc).isoformat(), 'active_store_replaced': False})
        (destination / '.incomplete').unlink()
        return {'state': 'verified', 'database_path': str(destination / 'database.sqlite3'), 'storage_path': str(destination / 'private-storage'), 'active_store_replaced': False}
    except (OSError, sqlite3.Error, ValueError, KeyError, TypeError) as error:
        raise RecoveryError(f'Restore did not complete: {error}. Active data was not replaced.') from error
