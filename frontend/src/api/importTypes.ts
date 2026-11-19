/** Contracts for evidence-backed import views. All numeric source values remain unknown until typed by normalization. */
export interface RegistrationEligibility {
  validation_current?:boolean;
  state: "draft" | "review_required" | "blocked" | "eligible" | "awaiting_approval" | "approved";
  primary_action: "validate" | "review_interpretation" | "inspect_integrity" | "submit_review" | "approve" | "registered";
  can_submit: boolean; can_approve: boolean; registered: boolean;
  blocking_error_findings: number; pending_decisions: number; policy: string;
}
export interface NormalizedCell { value: unknown; status: string; rules: string[]; display_truncated?:boolean; unit?: string; parameters?: {source_unit:string;output_unit:string;factor:string}; }
export interface ExplorerItem { source_row:number; original:Record<string,unknown>; original_literals?:Record<string,string>; original_truncated?:string[]; normalized:Record<string,NormalizedCell>; status:string; }
export interface ChartPoint { source_row:number; timestamp:string|null; plot_seconds?:number|null; value:number|null; status?:string; flags:string[]; break_before?:boolean; }
export interface ExplorerResponse {
 columns:string[];items:ExplorerItem[];total:number;offset:number;limit:number;
 chart:{ points:ChartPoint[];latest_reading?:ChartPoint&{value_text:string;value_text_truncated:boolean}|null; unit:string|null; excluded_count:number; missing_count:number; downsampled:boolean; source_count:number; returned_points:number; sampling:string; scope:string; source_time_range:[string,string]|null;plotted_time_range:[string,string]|null;selected_time_range:[string,string]|null;observed_cadence:{most_common_seconds:number|null;matching_intervals:number;positive_intervals:number;basis:string}; validation_run_id:string|null;timestamp_field:string|null;truncated:boolean; };
 provenance:{source_sha256:string;source_file_id:string;mapping_revision_id:string|null;rule_version:string};
}
export interface DiagnosisRecord {
 diagnosis_id:string;category:string;diagnosis_code:string;supporting_rules:string[];title:string;explanation:string;
 severity:"error"|"warning";impact:string;finding_count:number;distinct_affected_rows:number;blocks_registration:boolean;action_required:boolean;
 fields:{field:string;finding_count:number;distinct_affected_rows:number;required:boolean}[];
 field:string|null;examples:Record<string,unknown>[];handling_explanation:string;researcher_action:string;validation_run_id:string;
 supported_explanation:string;unverified_hypothesis:string;scientific_impact:string;
}
export interface IntelligenceResponse {
 dataset_id:string;dataset_version_id:string;filename:string;source_size_bytes:number;
 diagnoses:DiagnosisRecord[];eligibility:RegistrationEligibility;automatic_handling:string[];
 approval:Record<string,unknown>|null;validation:Record<string,unknown>|null;pending_decisions:number;registration_allowed:boolean;
 scientific_decisions:Record<string,unknown>[];recognition:Record<string,unknown>;normalization:Record<string,unknown>;
 schema_changed:boolean|null;previous_approved_schema_fingerprint:string|null;processing_complete:boolean;
}
