export type DataOrigin = "real" | "synthetic" | "unknown";

export interface HistoricalReading {
  observation_id:number;inspection_id:number;timestamp:string;metric:string;
  value:number|null;unit:string|null;reading_status:string;data_quality:string;source_reference:string|null;
  plot_seconds:number;break_before:boolean;flags:string[];
}
export interface HistoricalTrend {
  items:Omit<HistoricalReading, "plot_seconds"|"break_before"|"flags">[];total:number;offset:number;limit:number;has_more:boolean;truncated:boolean;timestamp_policy:string;provenance:string;
  chart:{points:HistoricalReading[];available:boolean;unit:string|null;units:(string|null)[];unavailable_reason:string|null;
    source_count:number;valid_count:number;excluded_count:number;source_time_range:[string,string]|null;plotted_time_range:[string,string]|null;
    time_basis:string|null;sampling:string;returned_points:number;downsampled:boolean};
}

export type InspectionStatus =
  | "planned"
  | "in_progress"
  | "completed"
  | "cancelled";

export type DataQuality = "good" | "suspect" | "invalid" | "unknown";

export interface Asset {
  asset_id: number;
  external_id: string | null;
  asset_type: string;
  name: string;
  description: string | null;
  location: string | null;
  created_at: string;
  updated_at: string;
}

export interface Inspection {
  inspection_id: number;
  asset_id: number;
  inspected_at: string;
  inspection_method: string | null;
  data_source: string | null;
  data_origin: DataOrigin;
  status: InspectionStatus;
  notes: string | null;
  created_at: string;
}

export interface Observation {
  observation_id: number;
  inspection_id: number;
  observation_type: string;
  value: number | null;
  unit: string | null;
  finding: string | null;
  data_quality: DataQuality;
  source_reference: string | null;
  recorded_at: string;
}

export interface MaintenanceRecord {
  maintenance_id: number;
  asset_id: number;
  performed_at: string | null;
  maintenance_type: string;
  description: string;
  performed_by: string | null;
  data_origin: DataOrigin;
  created_at: string;
}

export interface PageResult<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

export interface WorkspaceRecord {
  workspace_id: string;
  name: string;
  description: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface SiteRecord {
  site_id: string;
  workspace_id: string;
  name: string;
  location_text: string | null;
  latitude: number | null;
  longitude: number | null;
  asset_count?: number;
}

export interface LiveAssetRecord extends Asset {
  workspace_id: string;
  site_id: string | null;
  site_name: string | null;
  inspection_count?: number;
}

export interface LiveInspectionRecord extends Inspection {
  workspace_id: string;
  external_id: string | null;
  asset_name: string;
  asset_type: string;
  observations?: Observation[];
}

export interface DashboardMetric<T = number | string | null> {
  value: T;
  denominator: number | null;
  unit: string | null;
  definition: string;
  reason?: string;
}

export interface LiveDashboardOverview {
  workspace_id: string;
  data_mode: "live";
  date_window: { start: string | null; end: string };
  metrics: Record<string, DashboardMetric>;
  provenance: Record<string, unknown>;
}

export interface UploadResponse {
  source: {
    source_file_id: string;
    workspace_id: string;
    original_name: string;
    media_type: string | null;
    size_bytes: number;
    sha256: string;
    state: string;
    duplicate?: boolean;
  };
  job_id: string;
  job_state: string;
  job_reused: boolean;
}

export interface DatasetVersionRecord {
  dataset_id: string;
  dataset_version_id: string;
  workspace_id: string;
  name: string;
  version_number: number;
  state: string;
  source_file_id: string | null;
  source_job_id: string;
  source_artifact_id: string;
  source_sha256: string;
  row_count: number | null;
  schema_version: string;
  mapping_revision_id: string | null;
  current_validation_run_id: string | null;
  profile: Record<string, unknown> | null;
  created_at: string;
}
