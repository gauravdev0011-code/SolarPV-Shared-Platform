"""Task 6: stable visits, immutable corrections and private original evidence."""
import base64
import shutil
import sqlite3
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from solarpv_api.app import create_app
from solarpv_api.config import Settings
from solarpv_api.visit_routes import VisitInput
from solarpv_db import database, recovery
from solarpv_db.assets import create_asset
from solarpv_db.database import get_connection, initialize_database
from solarpv_db.inspections import create_inspection
from solarpv_db.observations import create_observation, get_observation
from solarpv_db.visits import VisitService

BASE='/api/v1/workspaces/default/visits'
PNG=base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aF9sAAAAASUVORK5CYII=')


@pytest.fixture
def system(tmp_path):
    settings=Settings(database_path=tmp_path/'visits.sqlite3',storage_path=tmp_path/'private')
    with TestClient(create_app(settings),base_url='http://localhost',client=('127.0.0.1',12345)) as client:
        asset=create_asset('panel','Fictional capture panel',database_path=settings.database_path)
        yield client,settings,asset


def reading(**changes):return {'observation_type':'surface_temperature','value':'0034.50','quantity':'temperature','unit':'degC','data_quality':'good','source_reference':'Fictional source row',**changes}
def body(asset,**changes):return {'asset_id':asset,'inspected_at':'2026-09-01T10:00:00+02:00','inspection_method':'Fictional visual visit','data_source':'Fictional field sheet','observations':[reading()],**changes}
def post(client,payload,key='capture-request-0001',visit=None):return client.post(BASE+(f'/{visit}/amendments' if visit else ''),json=payload,headers={'Idempotency-Key':key})


def test_atomic_capture_repeat_amend_original_history_and_coverage(system):
    client,settings,asset=system
    one=post(client,body(asset));assert one.status_code==201,one.text
    original=one.json();visit=original['inspection_id']
    assert post(client,body(asset)).json()==original
    two=post(client,body(asset,inspected_at='2026-10-01T08:00:00Z'),key='repeat-visit-key001').json()
    assert two['inspection_id']!=visit
    amendment=body(asset,inspected_at='2026-09-02T08:00:00Z',observations=[reading(value='0035.00')],expected_revision=original['revision_id'],reason='Fictional documented transcription correction')
    updated=post(client,amendment,key='amendment-key-0001',visit=visit)
    assert updated.status_code==201,updated.text
    assert updated.json()['inspection_id']==visit
    assert post(client,amendment,key='amendment-key-0001',visit=visit).json()==updated.json()
    latest=client.get(f'{BASE}/{visit}').json();first=client.get(f'{BASE}/{visit}',params={'revision':'original'}).json()
    assert latest['observations']['items'][0]['source_value']=='0035.00'
    assert first['observations']['items'][0]['source_value']=='0034.50'
    assert get_observation(first['observations']['items'][0]['observation_id'],settings.database_path)['value']==34.5
    with pytest.raises(ValueError,match='amendment'):
        create_observation(visit,'unlinked reading',1,'W',database_path=settings.database_path)
    assert first['visit']['inspected_at']=='2026-09-01T08:00:00Z'
    assert latest['visit']['inspected_at']=='2026-09-02T08:00:00Z'
    history=client.get('/api/v1/workspaces/default/inspections').json()
    assert history['total']==2 and history['items'][1]['inspected_at']=='2026-09-02T08:00:00Z'
    overview=client.get('/api/v1/workspaces/default/dashboard/overview').json()['metrics']
    assert overview['inspection_count']['value']==2 and overview['observation_count']['value']==2
    assert overview['inspection_coverage']['value']==1
    trends=client.get(f'/api/v1/workspaces/default/assets/{asset}/trends',params={'metric':'surface_temperature'}).json()
    assert trends['total']==2 and [r['value'] for r in trends['items']]==[35,34.5]
    assert client.get(f'/api/v1/workspaces/default/inspections/{visit}').json()['observations'][0]['value']==35
    with get_connection(settings.database_path) as connection:
        assert connection.execute('SELECT value FROM observations ORDER BY observation_id LIMIT 1').fetchone()[0]==34.5
        assert connection.execute('SELECT inspected_at FROM inspections WHERE inspection_id=?',(visit,)).fetchone()[0]=='2026-09-01T08:00:00Z'
    for query in ['UPDATE inspections SET notes=\'overwrite\'','DELETE FROM inspection_revisions','UPDATE observations SET value=99']:
        with pytest.raises(sqlite3.IntegrityError),get_connection(settings.database_path) as connection:connection.execute(query)
    with TestClient(create_app(settings),base_url='http://localhost',client=('127.0.0.1',12345)) as reloaded:
        assert reloaded.get(f'{BASE}/{visit}').json()['head_revision']==updated.json()['revision_id']
        assert reloaded.get(f"{BASE}/{two['inspection_id']}").json()['observations']['items'][0]['value']==34.5


@pytest.mark.parametrize('changes',[{'inspected_at':'invalid'},{'observations':[reading(value='abc')]},{'observations':[reading(value='1,234')]},{'observations':[reading(value='1e999')]},{'observations':[reading(value=True)]},{'observations':[reading(unit='Hz')]},{'observations':[reading(value=None,finding=None)]}])
def test_invalid_capture_leaves_no_partial_rows(system,changes):
    client,settings,asset=system
    response=post(client,body(asset,**changes));assert response.status_code==422,response.text
    with get_connection(settings.database_path) as connection:
        assert connection.execute('SELECT COUNT(*) FROM inspections').fetchone()[0]==0
        assert connection.execute('SELECT COUNT(*) FROM observations').fetchone()[0]==0


def test_missing_zero_invalid_flags_and_pagination(system):
    client,_,asset=system
    observations=[reading(value=None,finding='No reading in source'),reading(value='0'),reading(value='99',data_quality='invalid')]+[reading(value=str(i)) for i in range(101)]
    visit=post(client,body(asset,observations=observations)).json()['inspection_id']
    first=client.get(f'{BASE}/{visit}',params={'limit':100}).json()
    last=client.get(f'{BASE}/{visit}',params={'limit':100,'offset':100}).json()
    assert first['observations']['total']==104 and len(last['observations']['items'])==4
    assert first['observations']['items'][0]['value'] is None
    assert first['observations']['items'][1]['value']==0
    trend=client.get(f'/api/v1/workspaces/default/assets/{asset}/trends',params={'metric':'surface_temperature'}).json()
    assert trend['chart']['excluded_count']==2 and trend['chart']['valid_count']==102
    assert client.get(f'{BASE}/{visit}',params={'offset':-1}).status_code==422
    assert post(client,body(asset,observations=[reading(value=None,finding='Absent',unit='Hz')]),key='missing-bad-unit01').status_code==422


def test_legacy_amendment_preserves_original_without_invented_historical_date(system):
    client,settings,asset=system
    visit=create_inspection(asset,'2026-09-01 09:00:00',notes='Original legacy note',database_path=settings.database_path)
    identifier=create_observation(visit,'surface_temperature',22,'C',source_reference='Legacy source',database_path=settings.database_path)
    response=post(client,body(asset,inspection_method=None,data_source=None,expected_revision=None,reason='Corrected time with documented offset'),key='legacy-amend-key01',visit=visit)
    assert response.status_code==201,response.text
    original=client.get(f'{BASE}/{visit}',params={'revision':'original'}).json()
    assert original['visit']['inspected_at']=='2026-09-01T09:00:00'
    assert original['observations']['items'][0]['observation_id']==identifier
    assert original['visit']['revision_number']==0 and 'unknown' in original['visit']['reason']
    assert client.get(f'{BASE}/{visit}').json()['visit']['data_source'] is None


def test_photographs_ownership_checksums_original_revisions_and_recovery(system,tmp_path):
    client,settings,asset=system
    upload=client.post(BASE+'/attachments',files={'file':('original.png',PNG,'image/png')})
    assert upload.status_code==201,upload.text
    source=upload.json()['source_file_id']
    duplicate=client.post(BASE+'/attachments',files={'file':('same.png',PNG,'image/png')}).json()
    assert duplicate['source_file_id']==source
    assert client.post(BASE+'/attachments',files={'file':('fake.png',b'not an image','image/png')}).status_code==415
    saved=post(client,body(asset,attachment_ids=[source])).json();visit=saved['inspection_id']
    assert client.get(f'{BASE}/{visit}/attachments/{source}').content==PNG
    assert 'attachment' in client.get(f'{BASE}/{visit}/attachments/{source}').headers['content-disposition']
    amended=post(client,body(asset,attachment_ids=[],expected_revision=saved['revision_id'],reason='Photograph excluded from latest interpretation'),key='photo-amend-key01',visit=visit)
    assert amended.status_code==201
    assert client.get(f'{BASE}/{visit}').json()['attachments']==[]
    assert client.get(f'{BASE}/{visit}',params={'revision':'original'}).json()['attachments'][0]['source_file_id']==source
    package=tmp_path/'package';recovery.create_package(settings.database_path,settings.storage_path,package)
    copied=recovery.restore_package(package,tmp_path/'restored',active_database=settings.database_path,active_storage=settings.storage_path)
    from solarpv_ingestion.storage import LocalArtifactStorage
    restored=VisitService(Path(copied['database_path']),LocalArtifactStorage(copied['storage_path']))
    assert restored.download('default',visit,source)[1].read_bytes()==PNG
    with get_connection(settings.database_path) as connection:
        key=connection.execute('SELECT storage_key FROM source_files WHERE source_file_id=?',(source,)).fetchone()[0]
    with pytest.raises(sqlite3.IntegrityError),get_connection(settings.database_path) as connection:connection.execute("UPDATE source_files SET state='deleted' WHERE source_file_id=?",(source,))
    target=client.app.state.storage._resolve_key(key);target.write_bytes(b'altered original')
    assert client.get(f'{BASE}/{visit}/attachments/{source}').status_code==409
    assert post(client,body(asset,attachment_ids=[source]),key='corrupt-photo-key1').status_code==409
    with pytest.raises(recovery.RecoveryError):recovery.create_package(settings.database_path,settings.storage_path,tmp_path/'bad-package')
    target.unlink()
    assert client.get(f'{BASE}/{visit}/attachments/{source}').status_code==409


def test_cross_workspace_remote_denial_stale_retries_and_identity(system):
    client,settings,asset=system
    one=post(client,body(asset)).json();visit=one['inspection_id']
    assert post(client,body(asset,notes='changed key body')).status_code==409
    assert post(client,body(asset,reason='Stale',expected_revision=None),key='stale-amend-key01',visit=visit).status_code==409
    assert post(client,body(asset,expected_revision=one['revision_id']),key='empty-reason-key1',visit=visit).status_code==422
    other=client.post('/api/v1/workspaces',json={'name':'Fictional other'}).json()['workspace_id']
    foreign=BASE.replace('/default/',f'/{other}/')
    assert client.get(f'{foreign}/{visit}').status_code==404
    assert client.post(foreign,json=body(asset),headers={'Idempotency-Key':'foreign-key-00001'}).status_code==404
    photo=client.post(foreign+'/attachments',files={'file':('foreign.png',PNG,'image/png')}).json()['source_file_id']
    assert post(client,body(asset,attachment_ids=[photo]),key='foreign-photo-001').status_code==404
    assert client.get(f'{BASE}/{visit}/attachments/{photo}').status_code==404
    assert client.post(BASE,json=body(asset),headers={'Idempotency-Key':'remote-origin-001','Origin':'https://untrusted.example'}).status_code==403
    with TestClient(create_app(settings),base_url='http://localhost',client=('203.0.113.1',12345)) as remote:
        assert remote.get(f'{BASE}/{visit}').status_code==403
        assert remote.post(BASE+'/attachments',files={'file':('private.png',PNG,'image/png')}).status_code==403


def test_concurrent_capture_and_interrupted_amendment_are_atomic(system,monkeypatch):
    client,settings,asset=system
    service=VisitService(settings.database_path,client.app.state.storage);payload=VisitInput(**body(asset)).model_dump()
    with ThreadPoolExecutor(max_workers=3) as pool:results=list(pool.map(lambda _:service.save('default',payload,'concurrent-visit1'),range(3)))
    assert len({r['inspection_id'] for r in results})==1
    visit=results[0]['inspection_id']
    import solarpv_db.visits as module
    original=module.create_observation
    def fail(*args,**kwargs):raise OSError('Injected before commit')
    amend=VisitInput(**body(asset,expected_revision=results[0]['revision_id'],reason='Fictional correction')).model_dump()
    with monkeypatch.context() as patch:
        patch.setattr(module,'create_observation',fail)
        with pytest.raises(OSError):service.save('default',amend,'interrupted-visit1',visit)
    assert service.read('default',visit)['head_revision']==results[0]['revision_id']
    assert service.save('default',amend,'interrupted-visit1',visit)['revision_number']==2
    with get_connection(settings.database_path) as connection:assert connection.execute('SELECT COUNT(*) FROM inspections').fetchone()[0]==1
    calls=0
    def fail_after_first(*args,**kwargs):
        nonlocal calls
        calls+=1
        if calls==2:raise OSError('Injected after one persisted observation')
        return original(*args,**kwargs)
    new_visit=VisitInput(**body(asset,observations=[reading(),reading(observation_type='second sensor')])).model_dump()
    with monkeypatch.context() as patch:
        patch.setattr(module,'create_observation',fail_after_first)
        with pytest.raises(OSError):service.save('default',new_visit,'partial-capture01')
    with get_connection(settings.database_path) as connection:
        assert connection.execute('SELECT COUNT(*) FROM inspections').fetchone()[0]==1
        assert connection.execute('SELECT COUNT(*) FROM observations').fetchone()[0]==2
    assert service.save('default',new_visit,'partial-capture01')['observation_count']==2


def test_additive_upgrade_does_not_rewrite_legacy_evidence(tmp_path,monkeypatch):
    old=tmp_path/'migrations';old.mkdir()
    for file in database.MIGRATIONS_DIR.glob('*.sql'):
        if int(file.name.split('_')[0])<=12:shutil.copyfile(file,old/file.name)
    target=tmp_path/'legacy.sqlite3'
    with monkeypatch.context() as patch:patch.setattr(database,'MIGRATIONS_DIR',old);initialize_database(target)
    asset=create_asset('panel','Legacy fixture',database_path=target)
    visit=create_inspection(asset,'2026-09-01T00:00:00Z',database_path=target)
    create_observation(visit,'power',0,'W',source_reference='Exact legacy source',database_path=target)
    with get_connection(target) as connection:before=[tuple(row) for row in connection.execute('SELECT * FROM observations')]
    initialize_database(target);initialize_database(target)
    with get_connection(target) as connection:
        assert [tuple(row) for row in connection.execute('SELECT * FROM observations')]==before
        assert connection.execute('SELECT COUNT(*) FROM inspection_revisions').fetchone()[0]==0
        assert not connection.execute('PRAGMA foreign_key_check').fetchall()
        assert connection.execute('PRAGMA integrity_check').fetchone()[0]=='ok'


def test_photograph_bounds_invalid_metadata_and_unlinked_private_download(system):
    client,settings,asset=system
    assert client.post(BASE+'/attachments',files={'file':('../escape.png',PNG,'image/png')}).status_code==422
    assert client.post(BASE+'/attachments',files=[('file',('one.png',PNG,'image/png')),('file',('two.png',PNG,'image/png'))]).status_code==400
    photo=client.post(BASE+'/attachments',files={'file':('unlinked.png',PNG,'image/png')}).json()['source_file_id']
    visit=post(client,body(asset)).json()['inspection_id']
    assert client.get(f'{BASE}/{visit}/attachments/{photo}').status_code==404
    with TestClient(create_app(Settings(database_path=settings.database_path,storage_path=settings.storage_path,max_file_bytes=8)),base_url='http://localhost',client=('127.0.0.1',12345)) as bounded:
        assert bounded.post(BASE+'/attachments',files={'file':('too-large.png',PNG,'image/png')}).status_code==413


def test_failed_additive_migration_rolls_back_without_partial_history(tmp_path,monkeypatch):
    staged=tmp_path/'staged-migrations';staged.mkdir()
    for file in database.MIGRATIONS_DIR.glob('*.sql'):
        if int(file.name.split('_')[0])<=12:shutil.copyfile(file,staged/file.name)
    target=tmp_path/'rollback.sqlite3'
    with monkeypatch.context() as patch:patch.setattr(database,'MIGRATIONS_DIR',staged);initialize_database(target)
    asset=create_asset('panel','Fictional rollback fixture',database_path=target)
    visit=create_inspection(asset,'2026-09-01T00:00:00Z',database_path=target)
    create_observation(visit,'power',5,'W',database_path=target)
    migration=database.MIGRATIONS_DIR/'013_inspection_amendments.sql'
    (staged/migration.name).write_text(migration.read_text(encoding='utf-8')+'\nINVALID SQL FOR ROLLBACK;\n',encoding='utf-8')
    with monkeypatch.context() as patch:
        patch.setattr(database,'MIGRATIONS_DIR',staged)
        with pytest.raises(sqlite3.OperationalError):initialize_database(target)
    with get_connection(target) as connection:
        assert connection.execute('PRAGMA user_version').fetchone()[0]==12
        assert connection.execute("SELECT 1 FROM sqlite_master WHERE name='inspection_revisions'").fetchone() is None
        assert connection.execute('SELECT COUNT(*) FROM observations').fetchone()[0]==1
    initialize_database(target)
    with get_connection(target) as connection:assert connection.execute('PRAGMA user_version').fetchone()[0]==17
