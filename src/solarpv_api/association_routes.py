"""Trusted-local preview only; deliberately no association commit endpoint."""
from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field, StrictStr
from solarpv_api.asset_routes import trusted_local
from solarpv_api.dataset_routes import _raise_dataset_error
from solarpv_ingestion.association_preview import preview_associations


class IdentifierColumns(BaseModel):
    model_config = ConfigDict(extra='forbid')
    external_id: StrictStr | None = Field(default=None, min_length=1, max_length=500)
    asset_id: StrictStr | None = Field(default=None, min_length=1, max_length=500)
    name: StrictStr | None = Field(default=None, min_length=1, max_length=500)
    asset_type: StrictStr | None = Field(default=None, min_length=1, max_length=500)


class PreviewInput(BaseModel):
    model_config = ConfigDict(extra='forbid')
    columns: IdentifierColumns
    offset: int = Field(default=0, ge=0, strict=True)
    limit: int = Field(default=25, ge=1, le=100, strict=True)


class ResolutionInput(BaseModel):
    model_config=ConfigDict(extra='forbid')
    field: StrictStr = Field(min_length=1,max_length=500)
    action: StrictStr = Field(min_length=1,max_length=100)


router = APIRouter(prefix='/api/v1/workspaces/{workspace_id}', dependencies=[Depends(trusted_local)])


@router.post('/datasets/{dataset_id}/versions/{version_id}/resolution-preview')
def resolution_preview(workspace_id: str,dataset_id: str,version_id: str,body: ResolutionInput,request: Request):
    from solarpv_ingestion.resolution_preview import preview_resolution
    try:
        return preview_resolution(request.app.state.datasets,workspace_id,dataset_id,version_id,body.field,body.action)
    except Exception as error:
        _raise_dataset_error(error)


@router.get('/datasets/{dataset_id}/versions/{version_id}/selection-export')
def export_selection(workspace_id: str, dataset_id: str, version_id: str, request: Request,
                     offset: int = 0, limit: int = 25, search: str = '', field: str | None = None,
                     start: str | None = None, end: str | None = None, quality: str = '',
                     sort: str = 'source', source_row: int | None = None):
    try:
        if not 1 <= limit <= 100:
            from solarpv_ingestion.datasets import DatasetError
            raise DatasetError('Export at most 100 source rows per selection.')
        view = request.app.state.datasets.explore(dataset_id, version_id, workspace_id=workspace_id,
            offset=offset,limit=limit,search=search,field=field,start=start,end=end,quality=quality,
            sort=sort,source_row=source_row,include_chart=False)
        return JSONResponse({'format':'solaris.source-selection-v1','workspace_id':workspace_id,
            'dataset_id':dataset_id,'dataset_version_id':version_id,'scope':'Bounded current table selection; values may have display truncation flags. Not a whole-dataset export or approval.',
            'selection':{'offset':offset,'limit':limit,'search':search,'field':field,'start':start,'end':end,'quality':quality,'sort':sort,'source_row':source_row},
            **view},headers={'Content-Disposition':'attachment; filename="solaris-selection.json"','X-Content-Type-Options':'nosniff','Cache-Control':'no-store'})
    except Exception as error:
        _raise_dataset_error(error)


@router.post('/datasets/{dataset_id}/versions/{version_id}/association-preview')
def preview(workspace_id: str, dataset_id: str, version_id: str, body: PreviewInput, request: Request):
    try:
        return preview_associations(request.app.state.datasets, workspace_id, dataset_id, version_id,
                                    body.columns.model_dump(), body.offset, body.limit)
    except Exception as error:
        _raise_dataset_error(error)
