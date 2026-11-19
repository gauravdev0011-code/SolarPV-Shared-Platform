import type { ExplorerResponse, IntelligenceResponse } from "./importTypes";
import type {HistoricalTrend} from './types';
import { requestBlob, requestJson, apiDownloadUrl } from "./client";
import type { DatasetVersionRecord, LiveAssetRecord, LiveDashboardOverview, LiveInspectionRecord, MaintenanceRecord, PageResult, SiteRecord, UploadResponse, WorkspaceRecord } from "./types";

export type Workspace = WorkspaceRecord;
export interface ScalePreview {mode:'hypothetical_preview';can_apply:false;field:string;action:string;rule_version:string;reason:string;original_preserved:boolean;validation_consequences:string;counts:{records:number;affected_records:number;unchanged_records:number;missing_records:number;invalid_records:number};examples:{source_row:number;original:string|null;proposed:string|null;unit?:string;status:string;rules:string[];display_truncated:boolean}[];preview_revision:string}
export interface IssueGroup {severity:'error'|'warning';field:string|null;code:string;category:string;message:string;count:number;affected_record_count:number;blocks_registration:boolean;recommended_action:string;examples:{row?:number;observed_value_preview?:unknown;observed_value_truncated?:boolean}[]}
export type AssociationColumns = {external_id:string|null;asset_id:string|null;name:string|null;asset_type:string|null};
export interface AssociationPreview {mode:'preview_only';can_commit:false;can_promote:false;preview_revision:string;blocked_reason:string;total:number;offset:number;limit:number;provenance:Record<string,string|null>;scientific_warnings:{code:string;message:string}[];items:{source_row:number;identifiers:Record<string,unknown>;association_status:string;reason:string;committed:false;candidates:{asset_id:number;external_id:string|null;name:string;asset_type:string;data_origin:string}[];candidates_truncated:boolean;original:Record<string,unknown>;normalized:Record<string,unknown>;status:string}[]}
export interface AssetDraft {name:string;asset_type:string;external_id:string|null;description:string;location:string;site_id:string|null;data_origin:'unknown'|'real'|'synthetic'}
export interface RegisteredAsset extends AssetDraft {asset_id:number;revision:string;configuration_managed?:boolean}
export interface EquipmentDraft {effective_from:string;expected_revision:string|null;equipment_kind:string;parent_asset_id:number|null;site_id:string|null;source_reference:string;specifications:{name:string;value:string|null;unit:string|null}[]}
export interface EquipmentRevision extends EquipmentDraft {configuration_id:string;recorded_at:string;effective_to?:string|null}
export interface EquipmentHistory {asset:RegisteredAsset;as_of:string;current:EquipmentRevision|null;latest:EquipmentRevision|null;parent:RegisteredAsset|null;head_revision:string|null;legacy_site_id:string|null;history:{items:EquipmentRevision[];total:number;offset:number;limit:number};children:{items:{asset_id:number;name:string;external_id:string|null}[];total:number;offset:number;limit:number}}
export interface VisitReading {observation_type:string;value:string|number|null;quantity:string|null;unit:string|null;finding:string|null;data_quality:'good'|'suspect'|'invalid'|'unknown';source_reference:string|null;observation_id?:number;measurement_status?:string|null;source_value?:string|number|null}
export interface VisitDraft {asset_id:number;inspected_at:string;inspection_method:string|null;data_source:string|null;data_origin:'real'|'synthetic'|'unknown';status:'planned'|'in_progress'|'completed'|'cancelled';notes:string|null;reason:string;expected_revision:string|null;observations:VisitReading[];attachment_ids:string[];attachments_only?:boolean}
export type VisitFileKind = "rgb" | "thermal" | "pdf" | "csv" | "json";
export interface VisitFile {kind?:VisitFileKind|null;source_file_id:string;original_name:string;sha256:string;size_bytes:number;media_type:string}
export interface VisitDetail {visit:VisitDraft&{inspection_id:number;revision_id?:string;reason?:string;recorded_at?:string};head_revision:string|null;observations:{items:VisitReading[];total:number;offset:number;limit:number};attachments:VisitFile[];revisions:{items:{revision_id:string;revision_number:number;reason:string;recorded_at:string}[];total:number;offset:number;limit:number}}
export interface AssetPreview {preview_revision:string;can_commit:boolean;rows:{row:number;external_id:string;action:'create'|'unchanged'|'conflict';proposed:AssetDraft;existing:RegisteredAsset|null}[]}

const scope = (workspaceId: string) => `/workspaces/${encodeURIComponent(workspaceId)}`;
const json = (method: string, body?: unknown): RequestInit => ({
  method,
  headers: body === undefined ? undefined : { "Content-Type": "application/json" },
  body: body === undefined ? undefined : JSON.stringify(body),
});

const visitScope = (workspace: string, demo: boolean) => demo ? "/panel-demo/visits" : `${scope(workspace)}/visits`;

export const api = {
  issueGroupPage:(w:string,id:string,params:Record<string,string|number|undefined>,signal?:AbortSignal)=>requestJson<{groups:IssueGroup[];total_groups:number;matching_issues:number}>(`${scope(w)}/validation-runs/${encodeURIComponent(id)}/issue-groups${query(params)}`,{signal}),
  findingsExportUrl:(w:string,id:string,params:Record<string,string|undefined>)=>apiDownloadUrl(`${scope(w)}/validation-runs/${encodeURIComponent(id)}/issues.jsonl${query(params)}`),
  resolutionPreview:(w:string,d:string,v:string,field:string,action:string,signal?:AbortSignal)=>requestJson<ScalePreview>(`${scope(w)}/datasets/${encodeURIComponent(d)}/versions/${encodeURIComponent(v)}/resolution-preview`,{...json('POST',{field,action}),signal}),
  selectionExportUrl:(w:string,d:string,v:string,params:Record<string,string|number|undefined>)=>apiDownloadUrl(`${scope(w)}/datasets/${encodeURIComponent(d)}/versions/${encodeURIComponent(v)}/selection-export${query(params)}`),
  associationPreview:(w:string,d:string,v:string,columns:AssociationColumns,offset:number,signal?:AbortSignal)=>requestJson<AssociationPreview>(`${scope(w)}/datasets/${encodeURIComponent(d)}/versions/${encodeURIComponent(v)}/association-preview`,{...json('POST',{columns,offset,limit:25}),signal}),
  visitUnits:(w:string,signal?:AbortSignal,demo=false)=>requestJson<{quantities:Record<string,string[]>}>(`${visitScope(w,demo)}/units`,{signal}),
  visit:(w:string,id:number,params:Record<string,string|number|undefined>={},signal?:AbortSignal,demo=false)=>requestJson<VisitDetail>(`${visitScope(w,demo)}/${id}${query(params)}`,{signal}),
  saveVisit:(w:string,body:VisitDraft,key:string,id?:number,demo=false)=>requestJson<{inspection_id:number;revision_id:string}>(`${visitScope(w,demo)}${id?`/${id}/amendments`:''}`,{...json('POST',body),headers:{'Content-Type':'application/json','Idempotency-Key':key}}),
  visitPhotograph:async(w:string,file:File,kind?:VisitFileKind,demo=false)=>{const form=new FormData();form.append('file',file);return requestJson<VisitFile>(`${visitScope(w,demo)}/attachments${query({kind})}`,{method:'POST',body:form});},
  visitPhotoUrl:(w:string,id:number,source:string,demo=false)=>apiDownloadUrl(`${visitScope(w,demo)}/${id}/attachments/${encodeURIComponent(source)}`),
  equipmentHistory:(w:string,id:number,params:Record<string,string|number|undefined>,signal?:AbortSignal)=>requestJson<EquipmentHistory>(`${scope(w)}/assets/${id}/configurations${query(params)}`,{signal}),
  appendEquipment:(w:string,id:number,body:EquipmentDraft,key:string)=>requestJson<EquipmentRevision>(`${scope(w)}/assets/${id}/configurations`,{...json('POST',body),headers:{'Content-Type':'application/json','Idempotency-Key':key}}),
  assetRegistration: (w:string,id:number,signal?:AbortSignal)=>requestJson<RegisteredAsset>(`${scope(w)}/assets/${id}/registration`,{signal}),
  saveAsset: (w:string,body:AssetDraft,key:string,id?:number,revision?:string)=>requestJson<RegisteredAsset>(`${scope(w)}/assets${id?`/${id}`:''}`,{...json(id?'PUT':'POST',{...body,...(id?{expected_revision:revision}:{})}),headers:{'Content-Type':'application/json','Idempotency-Key':key}}),
  previewAssets: (w:string,rows:AssetDraft[])=>requestJson<AssetPreview>(`${scope(w)}/assets/bulk/preview`,json('POST',{rows})),
  commitAssets: (w:string,rows:AssetDraft[],preview_revision:string,key:string)=>requestJson<{items:RegisteredAsset[]}>(`${scope(w)}/assets/bulk/commit`,{...json('POST',{rows,preview_revision}),headers:{'Content-Type':'application/json','Idempotency-Key':key}}),
  workspaces: (signal?: AbortSignal) => requestJson<PageResult<Workspace>>("/workspaces?limit=100", { signal }),
  createWorkspace: (name: string, description = "") => requestJson<Workspace>("/workspaces", json("POST", { name, description })),
  renameWorkspace: (id: string, name: string, description?: string) => requestJson<Workspace>(`/workspaces/${encodeURIComponent(id)}`, json("PATCH", { name, ...(description === undefined ? {} : { description }) })),
  overview: (w: string, start?: string, end?: string, signal?: AbortSignal) => requestJson<LiveDashboardOverview>(`${scope(w)}/dashboard/overview${query({ start, end })}`, { signal }),
  sites: (w: string, signal?: AbortSignal) => requestJson<PageResult<SiteRecord>>(`${scope(w)}/sites?limit=100`, { signal }),
  createSite: (w: string, name: string, location_text?: string) => requestJson<SiteRecord>(`${scope(w)}/sites`, json("POST", { name, location_text })),
  assignSite: (w: string, assetId: number, site_id: string | null) => requestJson<any>(`${scope(w)}/assets/${assetId}/site`, json("PUT", { site_id })),
  assets: (w: string, params: Record<string, string | number | undefined>, signal?: AbortSignal) => requestJson<PageResult<LiveAssetRecord>>(`${scope(w)}/assets${query(params)}`, { signal }),
  asset: (w: string, id: number, signal?: AbortSignal) => requestJson<LiveAssetRecord>(`${scope(w)}/assets/${id}`, { signal }),
  assetInspections: (w: string, id: number, signal?: AbortSignal, offset=0) => requestJson<PageResult<LiveInspectionRecord>>(`${scope(w)}/assets/${id}/inspections${query({limit:50,offset})}`, { signal }),
  inspections: (w: string, params: Record<string, string | number | undefined>, signal?: AbortSignal) => requestJson<PageResult<LiveInspectionRecord>>(`${scope(w)}/inspections${query(params)}`, { signal }),
  inspection: (w: string, id: number, signal?: AbortSignal, observationOffset=0) => requestJson<LiveInspectionRecord & {observations_page?:{total:number;offset:number;limit:number;has_more:boolean}}>(`${scope(w)}/inspections/${id}${query({observation_limit:100,observation_offset:observationOffset})}`, { signal }),
  metrics: (w:string,id:number,params:Record<string,string|number|undefined>,signal?:AbortSignal) => requestJson<PageResult<{metric:string;record_count:number}>>(`${scope(w)}/assets/${id}/metrics${query(params)}`,{signal}),
  trend: (w: string, assetId: number, metric: string, signal?: AbortSignal, params:Record<string,string|number|undefined>={}) => requestJson<HistoricalTrend>(`${scope(w)}/assets/${assetId}/trends${query({ metric, limit:50,...params })}`, { signal }),
  maintenance: (w: string, signal?: AbortSignal) => requestJson<PageResult<MaintenanceRecord>>(`${scope(w)}/maintenance?limit=100`, { signal }),
  upload: async (w: string, file: File) => {
    const form = new FormData(); form.append("file", file);
    return requestJson<UploadResponse>(`${scope(w)}/uploads`, { method: "POST", body: form });
  },
  job: (w: string, id: string, signal?: AbortSignal) => requestJson<any>(`${scope(w)}/jobs/${encodeURIComponent(id)}`, { signal }),
  result: (w: string, id: string, signal?: AbortSignal) => requestJson<any>(`${scope(w)}/jobs/${encodeURIComponent(id)}/result`, { signal }),
  jobPreview: (w: string, id: string, limit = 10, signal?: AbortSignal) => requestJson<any>(`${scope(w)}/jobs/${encodeURIComponent(id)}/preview?limit=${limit}`, { signal }),
  cancel: (w: string, id: string) => requestJson<any>(`${scope(w)}/jobs/${encodeURIComponent(id)}/cancel`, json("POST", {})),
  retryJob: (w: string, id: string, key: string) => requestJson<any>(`${scope(w)}/jobs/${encodeURIComponent(id)}/retry`, json("POST", { idempotency_key: key })),
  datasets: (w: string, signal?: AbortSignal,params?:Record<string,string|number|undefined>) => requestJson<PageResult<any>>(`${scope(w)}/datasets${params?query(params):'?limit=100'}`, { signal }),
  createDataset: (w: string, body: unknown) => requestJson<any>(`${scope(w)}/datasets`, json("POST", body)),
  createVersion: (w: string, datasetId: string, body: unknown) => requestJson<any>(`${scope(w)}/datasets/${encodeURIComponent(datasetId)}/versions`, json("POST", body)),
  versions: (w: string, id: string, signal?: AbortSignal) => requestJson<{ items: DatasetVersionRecord[] }>(`${scope(w)}/datasets/${encodeURIComponent(id)}/versions`, { signal }),
  version: (w: string, d: string, v: string, signal?: AbortSignal) => requestJson<any>(`${scope(w)}/datasets/${encodeURIComponent(d)}/versions/${encodeURIComponent(v)}`, { signal }),
  profile: (w: string, d: string, v: string, signal?: AbortSignal) => requestJson<any>(`${scope(w)}/datasets/${encodeURIComponent(d)}/versions/${encodeURIComponent(v)}/profile`, { signal }),
  preview: (w: string, d: string, v: string, signal?: AbortSignal) => requestJson<any>(`${scope(w)}/datasets/${encodeURIComponent(d)}/versions/${encodeURIComponent(v)}/preview?limit=10`, { signal }),
  originalSourceUrl: (w: string, d: string, v: string) => apiDownloadUrl(`${scope(w)}/datasets/${encodeURIComponent(d)}/versions/${encodeURIComponent(v)}/source`),
  sourceProfiles: (w: string, d: string) => requestJson<any>(`${scope(w)}/datasets/${encodeURIComponent(d)}/source-profiles`),
  intelligence: (w: string, d: string, v: string, signal?: AbortSignal) => requestJson<IntelligenceResponse>(`${scope(w)}/datasets/${encodeURIComponent(d)}/versions/${encodeURIComponent(v)}/intelligence`, { signal }),
  prepare: (w: string, d: string, v: string, profile?: string) => requestJson<any>(`${scope(w)}/datasets/${encodeURIComponent(d)}/versions/${encodeURIComponent(v)}/prepare`, json("POST", { source_profile_version_id: profile || undefined })),
  explorer: (w: string, d: string, v: string, params: Record<string, string | number | undefined>, signal?: AbortSignal) => requestJson<ExplorerResponse>(`${scope(w)}/datasets/${encodeURIComponent(d)}/versions/${encodeURIComponent(v)}/explorer${query(params)}`, { signal }),
  saveMapping: (w: string, d: string, v: string, columns: unknown[], key: string, expectedRevision?: string) => requestJson<any>(`${scope(w)}/datasets/${encodeURIComponent(d)}/versions/${encodeURIComponent(v)}/mapping`, json("PUT", { columns, idempotency_key: key, expected_mapping_revision_id: expectedRevision })),
  mapping: (w: string, d: string, v: string, signal?: AbortSignal) => requestJson<any>(`${scope(w)}/datasets/${encodeURIComponent(d)}/versions/${encodeURIComponent(v)}/mapping`, { signal }),
  validate: (w: string, d: string, v: string, key: string) => requestJson<any>(`${scope(w)}/datasets/${encodeURIComponent(d)}/versions/${encodeURIComponent(v)}/validate`, json("POST", { idempotency_key: key })),
  validation: (w: string, id: string, signal?: AbortSignal) => requestJson<any>(`${scope(w)}/validation-runs/${encodeURIComponent(id)}`, { signal }),
  validationIssueGroups: (w: string, id: string, signal?: AbortSignal) => requestJson<any>(`${scope(w)}/validation-runs/${encodeURIComponent(id)}/issue-groups`, { signal }),
  validationIssues: (w: string, id: string, params: Record<string, string | number | undefined>, signal?: AbortSignal) => requestJson<any>(`${scope(w)}/validation-runs/${encodeURIComponent(id)}/issues${query(params)}`, { signal }),
  validationIssuesDownload: (w: string, id: string, params: Record<string, string | undefined>) => requestBlob(`${scope(w)}/validation-runs/${encodeURIComponent(id)}/issues.jsonl${query(params)}`),
  approval: (w: string, d: string, v: string, validation_run_id: string, key: string) => requestJson<any>(`${scope(w)}/datasets/${encodeURIComponent(d)}/versions/${encodeURIComponent(v)}/approvals`, json("POST", { validation_run_id, idempotency_key: key })),
  decide: (w: string, id: string, decision: "approved" | "rejected", reviewer_identity: string) => requestJson<any>(`${scope(w)}/approvals/${encodeURIComponent(id)}/decision`, json("POST", { decision, reviewer_identity })),
  getApproval: (w: string, id: string, signal?: AbortSignal) => requestJson<any>(`${scope(w)}/approvals/${encodeURIComponent(id)}`, { signal }),
};

function query(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value !== undefined && value !== "") search.set(key, String(value));
  const value = search.toString(); return value ? `?${value}` : "";
}
