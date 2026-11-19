"""Bounded hypothetical scale previews; no decisions, mappings or values written."""
import hashlib
import json
from solarpv_ingestion.datasets import DatasetError, DatasetConflict
from solarpv_ingestion.intelligence import recognize,normalize_cell,RULE_VERSION
from solarpv_ingestion.validation import read_records,MAX_VALIDATION_ROWS,MAX_VALIDATION_CELLS


def preview_resolution(service,workspace,dataset,version,field,action):
    if action not in {'ratio_0_1','percent_0_100'}:
        raise DatasetError('No approved transformation exists for this action. Invalid-to-missing, interpolation and bulk fixes are not authorized.')
    current=service.get_version(dataset,version,workspace_id=workspace)
    source=service._source_for_version(version,workspace)
    if not service.storage.matches(source['storage_key'],sha256=source['sha256'],size_bytes=source['size_bytes']):
        raise DatasetError('Original source failed checksum verification.')
    headers,records=read_records(service.storage,source['storage_key'],source['original_name'],max_json_bytes=service.max_json_bytes)
    counts={'records':0,'affected_records':0,'unchanged_records':0,'missing_records':0,'invalid_records':0}
    examples=[]
    try:
        candidate=next((item for item in recognize(headers,[])['fields'] if item['source_column']==field and item['target_field']=='power_factor' and item['measurement_unit']=='%'),None)
        if candidate is None:
            raise DatasetError('Scale preview is available only for an explicitly percentage-labelled power-factor source field.')
        for row,record in records:
            counts['records']+=1
            if counts['records']>MAX_VALIDATION_ROWS or counts['records']*len(headers)>MAX_VALIDATION_CELLS:
                raise DatasetError('Resolution preview exceeds bounded source limits. No partial preview is accepted.')
            before=normalize_cell(record.get(field),candidate)
            proposed=normalize_cell(record.get(field),{**candidate,'value_scale':action})
            state=proposed['status']
            if tuple(before.get(key) for key in ('value','unit','status'))!=tuple(proposed.get(key) for key in ('value','unit','status')):counts['affected_records']+=1
            else:counts['unchanged_records']+=1
            if state=='missing':counts['missing_records']+=1
            if state=='invalid':counts['invalid_records']+=1
            if len(examples)<10:
                original=record.get(field);text=getattr(original,'source_literal',str(original)) if original is not None else None
                value=proposed.get('value');rendered=str(value) if value is not None else None
                examples.append({'source_row':row,'original':text[:200] if text is not None else None,
                    'proposed':rendered[:200] if rendered is not None else None,'display_truncated':bool(text and len(text)>200 or rendered and len(rendered)>200),
                    'unit':proposed.get('unit'),'status':state,'rules':proposed['rules']})
    finally:
        records.close()
    if not service.storage.matches(source['storage_key'],sha256=source['sha256'],size_bytes=source['size_bytes']):
        raise DatasetConflict('Original source changed during preview. Restore integrity before recomputing.')
    latest=service.get_version(dataset,version,workspace_id=workspace)
    if (latest['mapping_revision_id'],latest['current_validation_run_id'])!=(current['mapping_revision_id'],current['current_validation_run_id']):
        raise DatasetConflict('Mapping or validation changed. Recompute the preview before reviewing an interpretation.')
    result={'mode':'hypothetical_preview','action':action,'field':field,'rule_version':RULE_VERSION,
            'can_apply':False,'requires_documented_confirmation':True,'original_preserved':True,
            'source_sha256':source['sha256'],'dataset_version_id':version,'mapping_revision_id':current['mapping_revision_id'],
            'validation_run_id':current['current_validation_run_id'],'counts':counts,'examples':examples,
            'validation_consequences':'Not a validation run. Out-of-scale values remain invalid. Confirm only from instrument documentation in mapping review, then revalidate; unrelated findings remain.',
            'reason':'Preview is not scientific approval. No mapping, source, approval or dataset state was changed.'}
    result['preview_revision']=hashlib.sha256(json.dumps(result,sort_keys=True).encode()).hexdigest()
    return result
