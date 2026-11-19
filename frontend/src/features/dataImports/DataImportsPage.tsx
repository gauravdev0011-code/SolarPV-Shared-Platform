import { useEffect, useRef, useState } from "react";
import ImportWorkspace from "./ImportWorkspace";
import RecentImports from "./RecentImports";
import './importDashboard.css';
import './referenceRefinement.css';
import { api } from "../../api/solaris";
import { ApiError } from "../../api/client";

type Obj = Record<string, any>;
type MappingDraft = { target: string; type: string; unit: string; required: boolean; timestampFormat?: string; valueScale?: "ratio_0_1" | "percent_0_100" };
type HeaderRule = { target: string; label: string; type: string; unit: string | null };
type HeaderParts = { key: string; unit: string | null; rawUnit: string | null };
const HEADER_RULES: Record<string, HeaderRule> = {
  datetime: { target: "timestamp", label: "Date & Time", type: "datetime", unit: null },
  timestamp: { target: "timestamp", label: "Date & Time", type: "datetime", unit: null },
  datetimeutc: { target: "timestamp", label: "Date & Time", type: "datetime", unit: null },
  consumptiontotal: { target: "energy_consumption", label: "Energy Consumption", type: "number", unit: null },
  acenergyaccumulated: { target: "accumulated_ac_energy", label: "Accumulated AC Energy", type: "number", unit: null },
  apparentpower: { target: "apparent_power", label: "Apparent Power", type: "number", unit: null },
  energyaccumulated: { target: "energy_accumulated", label: "Energy (Accumulated)", type: "number", unit: null },
  powerfactor: { target: "power_factor", label: "Power Factor", type: "number", unit: null },
  powerfrequency: { target: "frequency", label: "Frequency", type: "number", unit: null },
  powertruekw: { target: "total_real_power", label: "Total Real Power", type: "number", unit: "kW" },
  powertruekwa: { target: "phase_a_power", label: "Phase A Power", type: "number", unit: "kW" },
  powertruekwb: { target: "phase_b_power", label: "Phase B Power", type: "number", unit: "kW" },
  powertruekwc: { target: "phase_c_power", label: "Phase C Power", type: "number", unit: "kW" },
};
const UNIT_ALIASES: Record<string, string> = {
  w: "W", kw: "kW", mw: "MW", va: "VA", kva: "kVA", mva: "MVA",
  wh: "Wh", kwh: "kWh", mwh: "MWh", hz: "Hz", khz: "kHz", ratio: "ratio", "%": "%",
};
const TARGET_UNITS: Record<string, string[]> = {
  energy_consumption: ["Wh", "kWh", "MWh"], accumulated_ac_energy: ["Wh", "kWh", "MWh"],
  energy_accumulated: ["Wh", "kWh", "MWh"], apparent_power: ["VA", "kVA", "MVA"],
  frequency: ["Hz", "kHz"], power_factor: ["ratio", "%"], total_real_power: ["W", "kW", "MW"],
  phase_a_power: ["W", "kW", "MW"], phase_b_power: ["W", "kW", "MW"], phase_c_power: ["W", "kW", "MW"],
};
function headerParts(value: string): HeaderParts {
  let name = value.trim().replace(/^meter\s*:\s*/i, "");
  const unitMatch = name.match(/\(([^()]*)\)\s*$/);
  const rawUnit = unitMatch?.[1]?.trim() ?? null;
  if (unitMatch) name = name.slice(0, unitMatch.index).trim();
  const unit = rawUnit && Object.values(UNIT_ALIASES).includes(rawUnit) ? rawUnit : null;
  return { key: name.toLowerCase().replace(/[^a-z0-9]/g, ""), unit, rawUnit };
}
const normalizeHeader = (value: string) => headerParts(value).key;
const key = () => `ui-${crypto.randomUUID()}`;
function idempotencyKey(workspaceId: string, operation: string): string {
  const storageKey = `solaris:${workspaceId}:idempotency:${operation}`;
  const existing = sessionStorage.getItem(storageKey);
  if (existing) return existing;
  const created = key();
  sessionStorage.setItem(storageKey, created);
  return created;
}
function mappingIdempotencyKey(workspaceId:string, operation:string, columns:unknown[]):string {
  const slot=`solaris:${workspaceId}:idempotency-payload:${operation}`;
  const fingerprint=JSON.stringify(columns);
  try { const prior=JSON.parse(sessionStorage.getItem(slot) ?? "null"); if(prior?.fingerprint===fingerprint && typeof prior.key==="string") return prior.key; } catch { /* Replace an invalid cached request identity. */ }
  const next=key();sessionStorage.setItem(slot,JSON.stringify({fingerprint,key:next}));return next;
}
function userFacingImportError(error: unknown): string {
  if (error instanceof ApiError && error.status !== null) {
    if (error.status >= 500) return `SOLARIS could not complete that step because of a server error (HTTP ${error.status}). Your uploaded file and previously saved steps are safe. Retry or refresh the page.`;
    if (error.status === 404) return "That dataset or processing record could not be found in the selected workspace. Refresh the page or start a new import.";
    const detail = error.message.replace(/^The API request to .*? failed with status \d+\.\s*/i, "");
    return detail || `SOLARIS could not complete that step (HTTP ${error.status}). Check the information and try again.`;
  }
  return error instanceof Error ? error.message : "SOLARIS could not complete that step. Try again.";
}
function clearIdempotencyKey(workspaceId: string, operation: string): void {
  sessionStorage.removeItem(`solaris:${workspaceId}:idempotency:${operation}`);
  sessionStorage.removeItem(`solaris:${workspaceId}:idempotency-payload:${operation}`);
}
function saved<T>(workspaceId: string, name: string, fallback: T): T {
  try { const value = sessionStorage.getItem(`solaris:${workspaceId}:${name}`); return value ? JSON.parse(value) as T : fallback; } catch { return fallback; }
}

function displayValue(value: unknown): string {
  if (value === null || value === undefined) return "Missing";
  if (value === "") return "Empty string";
  if (Array.isArray(value)) return `Array (${value.length} item${value.length === 1 ? "" : "s"})`;
  if (typeof value === "object") {
    const count = Object.keys(value).length;
    return `Object (${count} field${count === 1 ? "" : "s"})`;
  }
  return String(value);
}

function normalizePreview(value: unknown): Obj | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Obj;
  const nested = candidate.preview && typeof candidate.preview === "object" ? candidate.preview as Obj : candidate;
  if (!Array.isArray(nested.rows)) return null;
  const rows = nested.rows.filter((row: unknown) => row !== null && typeof row === "object" && !Array.isArray(row));
  const columns = Array.isArray(nested.columns)
    ? nested.columns.filter((column: unknown): column is string => typeof column === "string")
    : [...new Set(rows.flatMap((row: Obj) => Object.keys(row)))];
  if (!columns.length && !rows.length) return null;
  return { ...nested, columns, rows };
}

function previewType(values: unknown[]): string {
  const present = values.filter((value) => value !== null && value !== undefined && value !== "");
  if (!present.length) return "No values in preview";
  const kinds = new Set(present.map((value) => {
    if (typeof value === "boolean") return "boolean";
    if (typeof value === "number") return Number.isInteger(value) ? "integer" : "number";
    return "text";
  }));
  return kinds.size === 1 ? [...kinds][0] : "Mixed in preview";
}

function columnEvidence(columnName: string, profileColumns: Obj[], rows: unknown[]) {
  const profileColumn = profileColumns.find((column) => column.name === columnName || column.column_name === columnName);
  const observed = profileColumn?.observed_types as Record<string, number> | undefined;
  const previewValues = rows.map((row) => row && typeof row === "object" ? (row as Obj)[columnName] : undefined);
  if (observed && Object.keys(observed).length) {
    const summary = Object.entries(observed).map(([type, count]) => `${type}: ${count}`).join(" · ");
    const nonEmptyTypes = Object.keys(observed).filter((type) => !["empty", "null_marker"].includes(type));
    let suggestion: string | null = null;
    if (nonEmptyTypes.length === 1 && ["integer", "number", "text"].includes(nonEmptyTypes[0])) suggestion = nonEmptyTypes[0] === "text" ? "string" : nonEmptyTypes[0];
    else if (nonEmptyTypes.length && nonEmptyTypes.every((type) => type === "integer" || type === "number")) suggestion = "number";
    return { summary, suggestion };
  }
  const evidence = previewType(previewValues);
  const suggestion = ["integer", "number", "boolean"].includes(evidence) ? evidence : evidence === "text" ? "string" : null;
  return { summary: `${evidence} (bounded preview)`, suggestion };
}

function headerRule(columnName: string): HeaderRule | null {
  const parts = headerParts(columnName);
  const rule = HEADER_RULES[parts.key] ?? null;
  if (!rule) return null;
  if (parts.rawUnit !== null) {
    const allowed = TARGET_UNITS[rule.target] ?? [];
    return { ...rule, unit: parts.unit && allowed.includes(parts.unit) ? parts.unit : null };
  }
  return rule;
}

function percentPowerFactorNeedsReview(columnName: string): boolean {
  return normalizeHeader(columnName) === "powerfactor" && headerParts(columnName).unit === "%";
}

function sourceUnitNeedsReview(columnName: string, selectedUnit = "", valueScale?: MappingDraft["valueScale"]): boolean {
  const rule = headerRule(columnName);
  if (!rule || rule.type !== "number") return false;
  const parts = headerParts(columnName);
      if (percentPowerFactorNeedsReview(columnName)) return !valueScale;
  if (parts.rawUnit !== null) return !rule.unit && !(TARGET_UNITS[rule.target] ?? []).includes(selectedUnit.trim());
  return percentPowerFactorNeedsReview(columnName) || (!rule.unit && !selectedUnit.trim());
}

function timestampFormat(columnName: string, rows: unknown[]): string | undefined {
  if (!headerRule(columnName) || headerRule(columnName)?.type !== "datetime") return undefined;
  const samples = rows.map((row) => row && typeof row === "object" ? (row as Obj)[columnName] : null)
    .filter((value) => typeof value === "string" && value.trim()).slice(0, 10) as string[];
  const formats: Array<[RegExp, string]> = [
    [/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d+)?$/, "%Y-%m-%d %H:%M:%S"],
    [/^[A-Z][a-z]{2} \d{1,2}, \d{4} \d{2}:\d{2}:\d{2}$/, "%b %d, %Y %H:%M:%S"],
    [/^\d{1,2}\/\d{1,2}\/\d{4} \d{2}:\d{2}:\d{2}$/, "%m/%d/%Y %H:%M:%S"],
  ];
  const match = formats.find(([pattern]) => samples.length > 0 && samples.every((sample) => pattern.test(sample)));
  return match?.[1];
}

function suggestedMapping(field: string, profileColumns: Obj[], rows: unknown[], draft: Record<string, MappingDraft>) {
  const rule = headerRule(field);
  const evidence = columnEvidence(field, profileColumns, rows);
  const current = draft[field];
  return {
    source_column: field,
    target_field: current?.target ?? rule?.target ?? field,
    expected_type: current?.type ?? rule?.type ?? evidence.suggestion ?? "string",
    is_required: current?.required ?? false,
    measurement_unit: current?.unit.trim() || rule?.unit || null,
    timestamp_format: current?.timestampFormat ?? timestampFormat(field, rows) ?? null,
    value_scale: current?.valueScale ?? null,
  };
}

function automaticMappingFields(fields: string[]): string[] {
  const recognized = fields.filter((field) => {
    const rule = headerRule(field);
    const parts = headerParts(field);
    return rule && !percentPowerFactorNeedsReview(field)
      && (parts.rawUnit === null || (rule.type === "number" && rule.unit !== null));
  });
  const targetCounts = new Map<string, number>();
  for (const field of recognized) {
    const target = headerRule(field)!.target;
    targetCounts.set(target, (targetCounts.get(target) ?? 0) + 1);
  }
  return recognized.filter((field) => targetCounts.get(headerRule(field)!.target) === 1);
}

function mappingPayload(fields: string[], profileColumns: Obj[], rows: unknown[], draft: Record<string, MappingDraft>, automaticOnly = false) {
  const selectedFields = automaticOnly ? automaticMappingFields(fields) : fields;
  return selectedFields.map((field) => suggestedMapping(field, profileColumns, rows, draft));
}

function numericReading(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string" || !value.trim() || !/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(value.trim())) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function timeReading(value: unknown): number | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function previewInterval(rows: unknown[], mapping: Obj | null): string | null {
  const timestampField = mapping?.columns?.find((column: Obj) => column.target_field === "timestamp")?.source_column;
  if (!timestampField || rows.length < 2) return null;
  const times = rows.map((row) => row && typeof row === "object" ? timeReading((row as Obj)[timestampField]) : null);
  if (times.some((time) => time === null)) return null;
  const intervals = times.slice(1).map((time, index) => (time! - times[index]!) / 1000);
  if (intervals.some((interval) => interval <= 0) || new Set(intervals).size !== 1) return null;
  const seconds = intervals[0];
  return seconds % 60 === 0 ? `${seconds / 60} min · preview` : `${seconds} sec · preview`;
}

export function PreviewMeasurementCards({ preview, mapping }: { preview: Obj | null; mapping: Obj | null }) {
  const rows: Obj[] = Array.isArray(preview?.rows) ? preview.rows.filter((row: unknown): row is Obj => Boolean(row) && typeof row === "object" && !Array.isArray(row)) : [];
  const columns: Obj[] = Array.isArray(mapping?.columns) ? mapping.columns : [];
  const timestamp = columns.find((column) => column.target_field === "timestamp")?.source_column;
  const power = columns.find((column) => column.target_field === "total_real_power");
  const powerPoints = power && timestamp ? rows.flatMap((row) => {
    const value = numericReading(row[power.source_column]);
    const time = timeReading(row[timestamp]);
    return value === null || time === null ? [] : [{ value, time }];
  }) : [];
  const reliablePower = Boolean(power?.measurement_unit) && powerPoints.length === rows.length && powerPoints.every((point, index) => index === 0 || point.time > powerPoints[index - 1].time);
  const meanPower = reliablePower && powerPoints.length ? powerPoints.reduce((sum, point) => sum + point.value, 0) / powerPoints.length : null;
  const energy = columns.find((column) => column.target_field === "energy_accumulated" || column.target_field === "accumulated_ac_energy")
    ?? columns.find((column) => column.target_field === "energy_consumption");
  const energyValues = energy ? rows.flatMap((row) => {
    const value = numericReading(row[energy.source_column]);
    const time = timestamp ? timeReading(row[timestamp]) : null;
    return value === null || (timestamp && time === null) ? [] : [{ value, time }];
  }) : [];
  const cumulative = energy?.target_field === "energy_accumulated" || energy?.target_field === "accumulated_ac_energy";
  const orderedEnergy = Boolean(timestamp) && energyValues.length === rows.length && energyValues.every((point, index) =>
    point.time !== null && (index === 0 || point.time > (energyValues[index - 1].time ?? Infinity))
    && (!cumulative || index === 0 || point.value >= energyValues[index - 1].value));
  const energyValue = energyValues.length > 1 && orderedEnergy
    ? cumulative && energyValues.at(-1)!.value >= energyValues[0].value
      ? energyValues.at(-1)!.value - energyValues[0].value
      : null
    : null;
  const unit = energy?.measurement_unit ?? "";
  const points = powerPoints.map(({ value }, index) => {
    const low = Math.min(...powerPoints.map((point) => point.value));
    const high = Math.max(...powerPoints.map((point) => point.value));
    const y = high === low ? 27 : 46 - ((value - low) / (high - low)) * 38;
    const duration = powerPoints.at(-1)!.time - powerPoints[0].time;
    const x = duration > 0 ? ((powerPoints[index].time - powerPoints[0].time) / duration) * 100 : 50;
    return `${x},${y}`;
  }).join(" ");

  return <div className="preview-chart-grid" aria-label="Preview measurement summaries">
    <section className="preview-chart-card" aria-label="Power summary">
      <div><strong>Power{power?.measurement_unit ? ` (${power.measurement_unit})` : ""}</strong><small>{meanPower === null ? "No verified time-series readings in preview" : `Mean of ${powerPoints.length} preview rows`}</small></div>
      {meanPower !== null && powerPoints.length >= 2
        ? <><b>{meanPower.toLocaleString(undefined, { maximumFractionDigits: 2 })}</b><svg viewBox="0 0 100 54" preserveAspectRatio="none" role="img" aria-label={`Power trend across ${powerPoints.length} preview rows`}><polyline points={points} /></svg><small className="preview-chart-extents">Preview rows in source order · first {powerPoints.length} valid readings</small></>
        : <p className="preview-chart-empty">A power trend requires mapped units, timestamps, and at least two numeric readings.</p>}
    </section>
    <section className="preview-chart-card" aria-label="Energy summary">
      <div><strong>{cumulative ? "Cumulative energy change" : "Energy in preview"}{unit ? ` (${unit})` : ""}</strong><small>{energyValue === null ? "No defensible energy summary available" : cumulative ? `First-to-last change · ${energyValues.length} readings` : `Sum of ${energyValues.length} mapped preview readings`}</small></div>
      {energyValue === null
        ? <p className="preview-chart-empty">Energy is not aggregated unless interval or cumulative semantics are mapped and supported.</p>
        : <><b>{energyValue.toLocaleString(undefined, { maximumFractionDigits: 2 })}</b><small className="preview-chart-extents">Calculated only from the displayed source rows; not a dataset total.</small></>}
    </section>
  </div>;
}

export function ProfilePreviewSection({ profile, preview, result, job, source, selectedVersion, datasetVersionSelected, mapping, mappingDraft, validation, recognizedCount }: {
  profile: Obj | null; preview: Obj | null; result: Obj | null; job: Obj | null; source: Obj | null; selectedVersion: Obj | undefined;
  datasetVersionSelected: boolean; mapping: Obj | null; mappingDraft: Record<string, MappingDraft>; validation: Obj | null; recognizedCount: number;
}) {
  const profileData = profile?.profile ?? {};
  const profileColumns: Obj[] = profileData.columns ?? profileData.fields ?? [];
  const rows: unknown[] = Array.isArray(preview?.rows) ? preview.rows : [];
  const previewColumns: string[] = Array.isArray(preview?.columns) ? preview.columns : [];
  const columns = profileColumns.map((column) => column.name ?? column.column_name).filter(Boolean);
  const visibleColumns = previewColumns.length ? previewColumns : columns;
  const rowCount = profileData.row_count ?? profileData.record_count;
  const columnCount = profileData.column_count ?? (columns.length || visibleColumns.length);
  const currentSourceMatches = datasetVersionSelected
    ? Boolean(selectedVersion?.source_file_id && source?.source_file_id === selectedVersion.source_file_id)
    : Boolean(result?.source_file_id && source?.source_file_id === result.source_file_id);
  const currentJobMatches = datasetVersionSelected
    ? Boolean(selectedVersion?.source_job_id && job?.job_id === selectedVersion.source_job_id)
    : Boolean(job?.job_id && job.job_id === result?.job_id);
  const fileType = currentSourceMatches
    ? result?.result?.format ?? source?.original_name?.split(".").pop()?.toLowerCase() ?? "Not reported"
    : "Not reported";
  const processingStatus = currentJobMatches ? job?.state ?? "Not available" : "Not available";

  return <section className="panel-card import-step dataset-profile-section" aria-labelledby="dataset-profile-heading">
    <div className="import-section-heading"><div><h3 id="dataset-profile-heading">Dataset Overview</h3><p>Results come from the processing job; preview is limited to the first {preview?.limit ?? 10} original records.</p></div></div>
    <dl className="dataset-summary-grid">
      <div><dt>Records</dt><dd>{rowCount == null ? "Not reported" : Number(rowCount).toLocaleString()}</dd></div>
      <div><dt>Columns</dt><dd>{columnCount == null ? "Not reported" : Number(columnCount).toLocaleString()}</dd></div>
      <div><dt>Mapped</dt><dd>{mapping?.columns?.length ?? "Not saved"}</dd></div>
      <div><dt>Errors</dt><dd>{validation ? Number(validation.error_count ?? 0).toLocaleString() : "Not checked"}</dd></div>
      <div><dt>Warnings</dt><dd>{validation ? Number(validation.warning_count ?? 0).toLocaleString() : "Not checked"}</dd></div>
    </dl>
    <PreviewMeasurementCards preview={preview} mapping={mapping} />
    <details className="column-details">
      <summary>Column details · {profileColumns.length || columnCount || 0} columns</summary>
      <div className="profile-table-wrap">
      {profileColumns.length ? <table className="operations-table profile-table" aria-label="Column profile"><thead><tr><th scope="col">Source column</th><th scope="col">Detected types</th><th scope="col">Available profile metadata</th></tr></thead><tbody>
        {profileColumns.map((column, index) => {
          const name = String(column.name ?? column.column_name ?? visibleColumns[index] ?? `Column ${index + 1}`);
          const observed = column.observed_types as Record<string, number> | undefined;
          const metadata = Object.entries(column).filter(([keyName]) => !["name", "column_name", "observed_types"].includes(keyName));
          return <tr key={`${name}-${index}`}><th scope="row">{name}</th><td>{observed && Object.keys(observed).length ? Object.entries(observed).map(([kind, count]) => `${kind} (${count})`).join(" · ") : "Not supplied by parser"}</td><td>{metadata.length ? metadata.map(([keyName, value]) => `${keyName}: ${displayValue(value)}`).join(" · ") : "—"}</td></tr>;
        })}
      </tbody></table> : <p className="profile-note">The parser returned structural JSON metadata without full-file column type statistics. Types below are based only on the bounded preview.</p>}
      </div>
    </details>
    <div className="preview-table-wrap">
      <div className="preview-heading"><h4>Data Preview</h4><span>First {preview?.returned_rows ?? rows.length} of {rowCount == null ? "an unreported number of" : Number(rowCount).toLocaleString()} records</span></div>
      {visibleColumns.length && rows.length ? <div className="spreadsheet-scroll"><table className="operations-table spreadsheet-preview" aria-label="Record preview"><thead><tr><th scope="col" className="row-number-heading">#</th>{visibleColumns.map((column) => {
        const mapped = (mapping?.columns ?? []).find((item: Obj) => item.source_column === column);
        return <th scope="col" key={column}><span>{column}</span>{mapped?.measurement_unit && <small>{mapped.measurement_unit} · verified mapping</small>}</th>;
      })}</tr></thead><tbody>{rows.map((rawRow, rowIndex) => {
        const record = rawRow && typeof rawRow === "object" && !Array.isArray(rawRow) ? rawRow as Obj : {};
        return <tr key={rowIndex}><th scope="row" className="row-number-cell">{rowIndex + 1}</th>{visibleColumns.map((column) => {
          const value = Object.prototype.hasOwnProperty.call(record, column) ? record[column] : undefined;
          const missing = value === null || value === undefined;
          return <td key={column} className={missing ? "preview-missing" : undefined} aria-label={missing ? `${column}, missing value` : undefined}>{displayValue(value)}</td>;
        })}</tr>;
      })}</tbody></table></div> : <p className="module-empty-state">No preview rows or column headers were returned.</p>}
    </div>
    <details className="technical-details"><summary>Technical details and provenance</summary><dl className="technical-meta"><div><dt>Dataset version</dt><dd>{selectedVersion?.dataset_version_id ?? "Not registered"}</dd></div><div><dt>Source file</dt><dd>{preview?.source_file_id ?? selectedVersion?.source_file_id ?? source?.source_file_id ?? "Not reported"}</dd></div><div><dt>Source SHA-256</dt><dd>{preview?.source_sha256 ?? selectedVersion?.source_sha256 ?? source?.sha256 ?? "Not reported"}</dd></div><div><dt>Processing job</dt><dd>{selectedVersion?.source_job_id ?? job?.job_id ?? "Not reported"}</dd></div><div><dt>Processing result checksum</dt><dd>{result?.checksum ?? "Not available in the current response"}</dd></div>{profileData.encoding && <div><dt>Text encoding</dt><dd>{profileData.encoding}</dd></div>}<div><dt>File type</dt><dd>{String(fileType).toUpperCase()}</dd></div><div><dt>Processing state</dt><dd>{processingStatus}</dd></div></dl><pre>{JSON.stringify({ profile: profile?.profile ?? null, preview, processing_result: result?.result ?? null }, null, 2)}</pre></details>
  </section>;
}

function MappingTable({ fields, profileColumns, rows, draft, savedColumns, editable, reviewRequest, onChange, onConfirmScale }: {
  fields: string[]; profileColumns: Obj[]; rows: unknown[]; draft: Record<string, MappingDraft>;
  savedColumns: Obj[]; editable: boolean; reviewRequest: number;
  onChange: (field: string, updates: Partial<MappingDraft>) => void;
  onConfirmScale: (field: string) => void;
}) {
  const [reviewingScale, setReviewingScale] = useState<string | null>(null);
  useEffect(() => {
    if (reviewRequest) setReviewingScale(fields.find((field) => percentPowerFactorNeedsReview(field) && !savedColumns.find((column) => column.source_column===field)?.value_scale) ?? null);
  },[reviewRequest]);
  return <div className={`mapping-table-wrap ${editable ? "is-editing" : "is-compact"}`}><table className="operations-table mapping-table"><thead><tr>{editable ? <><th scope="col">Source column</th><th scope="col">Target field</th><th scope="col">Expected type</th><th scope="col">Unit</th><th scope="col">Required</th></> : <><th scope="col">Source column</th><th scope="col">SOLARIS measurement</th><th scope="col">Verified unit</th><th scope="col">Status</th></>}</tr></thead><tbody>
    {fields.map((field) => {
      const evidence = columnEvidence(field, profileColumns, rows);
      const rule = headerRule(field);
      const selection = draft[field] ?? { target: field, type: "string", unit: "", required: false };
      const parts = headerParts(field);
      const unsupportedUnit = Boolean(rule && parts.rawUnit !== null && !rule.unit);
      const mapped = savedColumns.find((column) => column.source_column === field);
      const needsScale = percentPowerFactorNeedsReview(field) && !mapped?.value_scale;
      const unitLabel = mapped?.target_field === "power_factor" && mapped?.value_scale ? "ratio" : mapped?.measurement_unit ?? (rule?.unit ?? parts.rawUnit ?? "—");
      const measurementLabel = mapped?.target_field === rule?.target ? rule?.label : mapped?.target_field ?? rule?.label ?? "Not mapped";
      if (!editable) return <tr key={field} className={needsScale ? "mapping-row-needs-review" : ""}>
        <th scope="row"><span>{field}</span>{!rule && <small>Unknown source field · retained</small>}</th>
        <td>{measurementLabel}</td>
        <td>{unitLabel}{needsScale && <small className="mapping-format-note">Source unit retained: %</small>}</td>
        <td>{percentPowerFactorNeedsReview(field) ? <div className="power-factor-scale-control">{needsScale ? <><span className="mapping-status needs-review">Clarification required</span>{reviewingScale === field ? <><label>How are the readings scaled?<select aria-label="Power-factor reading scale" value={selection.valueScale ?? ""} onChange={(event) => onChange(field, { valueScale: (event.target.value || undefined) as MappingDraft["valueScale"] })}><option value="">Choose scale</option><option value="ratio_0_1">0–1 ratio</option><option value="percent_0_100">0–100 percent</option></select></label><button type="button" className="text-action" disabled={!selection.valueScale} onClick={() => onConfirmScale(field)}>Confirm scale & validate</button></> : <button type="button" className="text-action scale-review-button" onClick={() => setReviewingScale(field)}>Review scale</button>}</> : <span className="mapping-status is-mapped">✓ Scale saved</span>}</div> : mapped ? <span className="mapping-status is-mapped">✓ Mapped</span> : <span className="mapping-status is-pending">{rule ? "Mapping pending" : "Unmapped · retained"}</span>}</td>
      </tr>;
      return <tr key={field}><th scope="row"><span>{field}</span><small>{rule ? `${rule.label} · recognized header` : "No verified measurement alias"}</small><small>{evidence.summary}</small></th><td><input aria-label={`Target field for ${field}`} value={selection.target} onChange={(event) => onChange(field, { target: event.target.value })} /></td><td><div className="mapping-type-control"><select aria-label={`Expected type for ${field}`} value={selection.type} onChange={(event) => onChange(field, { type: event.target.value })}>{["string", "integer", "number", "boolean", "date", "datetime"].map((type) => <option key={type}>{type}</option>)}</select>{evidence.suggestion && evidence.suggestion !== selection.type && <button type="button" className="suggestion-button" aria-label={`Use ${evidence.suggestion} type suggestion for ${field}`} onClick={() => onChange(field, { type: evidence.suggestion! })}>Use {evidence.suggestion}</button>}</div>{selection.timestampFormat && <small className="mapping-format-note">Format recognized from preview</small>}</td><td><input aria-label={`Unit for ${field}`} value={selection.unit} placeholder={rule && !rule.unit ? "Not stated" : "Optional"} onChange={(event) => onChange(field, { unit: event.target.value })} />{percentPowerFactorNeedsReview(field) ? <><small className="mapping-format-note">Source unit: %; select the confirmed value scale.</small><select aria-label={`Power-factor reading scale for ${field}`} value={selection.valueScale ?? ""} onChange={(event) => onChange(field, { valueScale: (event.target.value || undefined) as MappingDraft["valueScale"] })}><option value="">Choose scale</option><option value="ratio_0_1">0–1 ratio</option><option value="percent_0_100">0–100 percent</option></select></> : unsupportedUnit ? <small className="mapping-format-note">Unrecognized source unit; choose a supported unit.</small> : rule && !rule.unit && <small className="mapping-format-note">Confirm source unit</small>}</td><td className="mapping-required-cell"><input aria-label={`Required field ${field}`} type="checkbox" checked={selection.required} onChange={(event) => onChange(field, { required: event.target.checked })} /></td></tr>;
    })}
  </tbody></table></div>;
}

export function ValidationChecks({ validation, workspaceId, mapping, unitReviewCount }: { validation: Obj | null; workspaceId: string; mapping: Obj | null; unitReviewCount: number }) {
  const [groups, setGroups] = useState<Obj[] | null>(null);
  useEffect(() => {
    setGroups(null);
    if (!validation?.validation_run_id) return;
    let active = true;
    api.validationIssueGroups(workspaceId, validation.validation_run_id)
      .then((report) => { if (active && Array.isArray(report.groups)) setGroups(report.groups); })
      .catch(() => { /* Do not report category success without the complete findings summary. */ });
    return () => { active = false; };
  }, [workspaceId, validation?.validation_run_id]);
  const columns: Obj[] = mapping?.columns ?? [];
  const checks = [
    { label: "Data types", supported: columns.length > 0, pattern: /^invalid_(number|integer|boolean|string|date|datetime)$/ },
    { label: "Units", supported: columns.some((column) => TARGET_UNITS[column.target_field]), pattern: /measurement_unit|power_factor_percent_scale_review/ },
    { label: "Timestamps", supported: columns.some((column) => column.expected_type === "datetime" || column.expected_type === "date"), pattern: /^invalid_(date|datetime)$/ },
    { label: "Missing data", supported: columns.length > 0, pattern: /value_missing|null_marker|source_column_missing/ },
    { label: "Value ranges", supported: columns.some((column) => column.target_field === "power_factor" && column.value_scale), pattern: /outside_confirmed_scale/ },
  ];
  return <>{checks.map((check) => {
    const findings = groups?.filter((group) => check.pattern.test(group.code ?? "")) ?? [];
    const errors = findings.filter((group) => group.severity === "error").reduce((sum, group) => sum + Number(group.count), 0);
    const warnings = findings.filter((group) => group.severity === "warning").reduce((sum, group) => sum + Number(group.count), 0);
    const text = check.label === "Units" && unitReviewCount ? `${unitReviewCount} need review`
      : !validation ? "Not checked" : !check.supported ? "Not verified"
      : !groups ? "Summary unavailable" : errors || warnings ? `${errors} errors ? ${warnings} warnings`
      : check.label === "Value ranges" ? "Power-factor scale checked" : "No reported issues";
    return <div className="validation-indicator" key={check.label}><strong>{check.label}</strong><span>{text}</span></div>;
  })}</>;
}

function ValidationFindings({ validation, workspaceId, expandSignal, initialFilter }: { validation: Obj; workspaceId: string; expandSignal?: number; initialFilter?: Obj | null }) {
  const [open, setOpen] = useState(false);
  const [groups, setGroups] = useState<Obj[]>([]);
  const [items, setItems] = useState<Obj[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [severity, setSeverity] = useState("");
  const [field, setField] = useState("");
  const [code, setCode] = useState("");
  const [category, setCategory] = useState("");
  const [search, setSearch] = useState("");
  const [groupSort, setGroupSort] = useState("count");
  const [groupOffset, setGroupOffset] = useState(0);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const runId = String(validation.validation_run_id ?? "");
  useEffect(() => {
    if (!initialFilter) return;
    setCategory(initialFilter.category ?? "");
    setField(initialFilter.field ?? ""); setCode(initialFilter.supporting_rules?.length === 1 ? initialFilter.supporting_rules[0] : initialFilter.supporting_rules ? "" : initialFilter.diagnosis_code ?? "");
    setSeverity(initialFilter.supporting_rules ? "" : initialFilter.severity ?? ""); setOffset(0); setOpen(true);
  }, [initialFilter]);
  const groupFields = [...new Set(groups.map((item) => String(item.field ?? "")).filter(Boolean))];
  useEffect(() => { if (expandSignal && expandSignal > 0) setOpen(true); }, [expandSignal]);
  useEffect(() => {
    if (!open || !runId) return;
    let active = true;
    setBusy(true); setProblem("");
    api.validationIssueGroups(workspaceId, runId).then((result) => {
      if (active) setGroups(Array.isArray(result.groups) ? result.groups : []);
    }).catch(() => { if (active) setProblem("Detailed findings could not be loaded. The validation summary remains available; retry to inspect details."); })
      .finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [open, runId, workspaceId]);
  useEffect(() => {
    if (!open || !runId) return;
    let active = true;
    setBusy(true); setProblem("");
    api.validationIssues(workspaceId, runId, { severity: severity || undefined, field: field || undefined, code: code || undefined, category: category || undefined, search: search || undefined, offset, limit: 25 })
      .then((result) => { if (active) { setItems(Array.isArray(result.items) ? result.items : []); setTotal(Number(result.total ?? 0)); } })
      .catch(() => { if (active) setProblem("Findings could not be loaded. Check the connection and try again."); })
      .finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [open, runId, workspaceId, severity, field, code, category, search, offset]);
  async function download() {
    try {
      const blob = await api.validationIssuesDownload(workspaceId, runId, { severity: severity || undefined, field: field || undefined, code: code || undefined, category: category || undefined, search: search || undefined });
      const url = URL.createObjectURL(blob); const anchor = document.createElement("a");
      anchor.href = url; anchor.download = `validation-${runId}-issues.jsonl`; anchor.click(); URL.revokeObjectURL(url);
    } catch { setProblem("The detailed findings download is unavailable. Try again after checking the connection."); }
  }
  const sortedGroups = [...groups].sort((left, right) => groupSort === "field"
    ? String(left.field ?? "").localeCompare(String(right.field ?? "")) || String(left.code).localeCompare(String(right.code))
    : groupSort === "severity"
      ? String(left.severity).localeCompare(String(right.severity)) || Number(right.count) - Number(left.count)
      : Number(right.count) - Number(left.count));
  const groupPage = sortedGroups.slice(groupOffset, groupOffset + 10);
  return <div className="validation-findings">
    <div className="validation-summary-line" aria-label="Validation summary">
      <span><strong>{Number(validation.row_count ?? 0).toLocaleString()}</strong> records analyzed</span>
      <span className="has-errors"><strong>{Number(validation.error_count ?? 0).toLocaleString()}</strong> errors</span>
      <span className="has-warnings"><strong>{Number(validation.warning_count ?? 0).toLocaleString()}</strong> warnings</span>
      <span><strong>{Number(validation.affected_record_count ?? 0).toLocaleString()}</strong> affected records</span>
      <span><strong>{Number(validation.affected_column_count ?? 0).toLocaleString()}</strong> affected columns</span>
      <span><strong>{validation.outcome === "failed" ? "Action required" : validation.outcome === "warnings" ? "Review recommended" : "No issues"}</strong></span>
    </div>
    <button type="button" className="text-action findings-toggle" aria-expanded={open} onClick={() => setOpen((value) => !value)}>{open ? "Hide detailed findings" : `Inspect all findings (${(Number(validation.error_count ?? 0) + Number(validation.warning_count ?? 0)).toLocaleString()})`}</button>
    {open && <section className="findings-browser" aria-label="Validation findings">
      {category && <p>Diagnosis category: {category.replaceAll("_"," ")} <button type="button" onClick={() => { setCategory(""); setField(""); setCode(""); setSeverity(""); setOffset(0); }}>Clear diagnosis filter</button></p>}
      {problem && <p role="alert" className="findings-error">{problem}</p>}
      <div className="findings-toolbar">
        <label>Severity<select aria-label="Filter findings by severity" value={severity} onChange={(event) => { setSeverity(event.target.value); setOffset(0); }}><option value="">All</option><option value="error">Errors</option><option value="warning">Warnings</option></select></label>
        <label>Field<select aria-label="Filter findings by field" value={field} onChange={(event) => { setField(event.target.value); setOffset(0); setCode(""); }}><option value="">All fields</option>{groupFields.map((item) => <option key={item}>{item}</option>)}</select></label>
        <label>Search<input aria-label="Search validation findings" value={search} onChange={(event) => { setSearch(event.target.value); setOffset(0); }} placeholder="Rule, message, or observed value" /></label>
        <label>Group order<select aria-label="Sort validation groups" value={groupSort} onChange={(event) => { setGroupSort(event.target.value); setGroupOffset(0); }}><option value="count">Most findings</option><option value="field">Field name</option><option value="severity">Severity</option></select></label>
        <button type="button" className="secondary-button" onClick={() => void download()}>Download matching JSONL</button>
      </div>
      <h3>Grouped by field and validation rule</h3>
      {busy && !groups.length && <p role="status">Loading validation findings…</p>}
      {groups.length > 0 ? <div className="finding-groups" role="list">{groupPage.map((group) => <article className="finding-group" key={`${group.severity}:${group.field}:${group.code}`} role="listitem">
        <div><span className={`finding-severity ${group.severity}`}>{group.severity === "error" ? "Blocking error" : "Warning"}</span><strong>{group.field || "Dataset"} · {String(group.code).replaceAll("_", " ")}</strong><span>{Number(group.count).toLocaleString()} findings · {Number(group.affected_record_count ?? 0).toLocaleString()} affected records</span></div>
        <p>{group.message}</p>
        <small>Recommended action: {group.recommended_action}</small>
        {Array.isArray(group.examples) && group.examples.length > 0 && <small>Example{group.examples.length > 1 ? "s" : ""}: {group.examples.map((example: Obj) => `row ${example.row ?? "—"}${example.observed_value_preview !== undefined ? ` · value “${example.observed_value_preview}${example.observed_value_truncated ? "…" : ""}”` : ""}`).join("; ")}</small>}
        <button type="button" className="text-action" onClick={() => { setSeverity(group.severity); setField(group.field ?? ""); setCode(group.code); setOffset(0); }}>Inspect matching records</button>
      </article>)}</div> : !busy && <p>No stored issue details are available for this validation result.</p>}
      {groups.length > 10 && <div className="findings-pagination"><button type="button" className="secondary-button" disabled={groupOffset === 0} onClick={() => setGroupOffset(Math.max(0, groupOffset - 10))}>Previous groups</button><span>{groupOffset + 1}–{Math.min(groupOffset + 10, groups.length)} of {groups.length} groups</span><button type="button" className="secondary-button" disabled={groupOffset + 10 >= groups.length} onClick={() => setGroupOffset(groupOffset + 10)}>Next groups</button></div>}
      <h3>Finding records {total ? `(${total.toLocaleString()} match${total === 1 ? "" : "es"})` : ""}</h3>
      <div className="finding-records" aria-live="polite">{items.map((item, index) => <article key={`${item.row}:${item.field}:${item.code}:${index}`}><span className={`finding-severity ${item.severity}`}>{item.severity}</span><strong>{item.field || "Dataset"} · row {item.row ?? "—"}</strong><p>{item.message}</p>{item.observed_value_preview !== undefined && <small>Observed source value: “{item.observed_value_preview}{item.observed_value_truncated ? "… (display shortened)" : ""}”</small>}</article>)}{!items.length && !busy && <p>No findings match these filters.</p>}</div>
      <div className="findings-pagination"><button type="button" className="secondary-button" disabled={offset === 0 || busy} onClick={() => setOffset(Math.max(0, offset - 25))}>Previous</button><span>{total ? `${offset + 1}–${Math.min(offset + 25, total)} of ${total.toLocaleString()}` : "0 results"}</span><button type="button" className="secondary-button" disabled={offset + 25 >= total || busy} onClick={() => setOffset(offset + 25)}>Next</button></div>
      <p className="findings-provenance">Findings are retained in validation order with source row and field references. Download includes every matching finding.</p>
    </section>}
  </div>;
}

export default function DataImportsPage({ workspaceId }: { workspaceId: string }) {
  const [file, setFile] = useState<File | null>(null); const [busy, setBusy] = useState(false); const [upload, setUpload] = useState<Obj | null>(() => saved(workspaceId, "upload", null));
  const [job, setJob] = useState<Obj | null>(() => saved(workspaceId, "job", null)); const [result, setResult] = useState<Obj | null>(() => saved(workspaceId, "result", null));
  const [jobVerified, setJobVerified] = useState(false);
  const [datasetUnavailable, setDatasetUnavailable] = useState(false);
  const [recoveryAttempt, setRecoveryAttempt] = useState(0);
  const [datasets, setDatasets] = useState<Obj[]>([]); const [dataset, setDataset] = useState(() => saved(workspaceId, "dataset", "")); const [versions, setVersions] = useState<Obj[]>([]); const [version, setVersion] = useState(() => saved(workspaceId, "version", ""));
  const [coverage,setCoverage]=useState<{scope:string;range:[string,string];timezone:string}|null>(null);
  const [profile, setProfile] = useState<Obj | null>(null); const [preview, setPreview] = useState<Obj | null>(null); const [mapping, setMapping] = useState<Obj | null>(null); const [validation, setValidation] = useState<Obj | null>(null); const [approval, setApproval] = useState<Obj | null>(null);
  const [message, setMessage] = useState(""); const [error, setError] = useState(""); const [datasetName, setDatasetName] = useState(() => saved(workspaceId, "datasetName", "")); const [reviewer, setReviewer] = useState("");
  const [sourceProfiles, setSourceProfiles] = useState<Obj[]>([]);
  const [sourceProfileId, setSourceProfileId] = useState("");
  const [destinationDatasetId, setDestinationDatasetId] = useState(() => saved(workspaceId, "destinationDatasetId", ""));
  useEffect(() => {
    let active=true; setSourceProfiles([]); setSourceProfileId("");
    if (destinationDatasetId) api.sourceProfiles(workspaceId,destinationDatasetId).then((v) => { if(active) setSourceProfiles(v.profiles ?? []); }).catch(() => { if(active) setError("Approved source profiles could not load; a new interpretation can still be reviewed."); });
    return () => {active=false;};
  },[workspaceId,destinationDatasetId]);
  const [datasetSetupState, setDatasetSetupState] = useState<"waiting" | "setting_up" | "ready" | "needs_scale" | "failed">("waiting");
  const [editingMapping, setEditingMapping] = useState(false);
  const [scaleReviewRequest, setScaleReviewRequest] = useState(0);
  const [serverIntelligence, setServerIntelligence] = useState<Obj | null>(null);
  useEffect(() => setServerIntelligence(null), [dataset,version,mapping?.mapping_revision_id,validation?.validation_run_id,approval?.state]);
  const [viewFilename, setViewFilename] = useState("");
  useEffect(() => setViewFilename(""), [dataset,version]);
  const [normalizationVerified, setNormalizationVerified] = useState(false);
  const [findingsFilter, setFindingsFilter] = useState<Obj | null>(null);
  useEffect(() => setNormalizationVerified(false), [dataset, version, mapping?.mapping_revision_id]);
  const actionEpoch = useRef(0);
  useEffect(() => () => { actionEpoch.current += 1; }, []);
  const autoSetupJob = useRef<string | null>(null);
  const [mappingDraft, setMappingDraft] = useState<Record<string, MappingDraft>>({});

  useEffect(() => {
    const items: Record<string, unknown> = { upload, job, result, preview, dataset, version, datasetName, destinationDatasetId };
    for (const [name, value] of Object.entries(items)) sessionStorage.setItem(`solaris:${workspaceId}:${name}`, JSON.stringify(value));
    sessionStorage.setItem(`solaris:${workspaceId}:mapping:${dataset}:${version}`, JSON.stringify(mapping));
    sessionStorage.setItem(`solaris:${workspaceId}:validation:${dataset}:${version}`, JSON.stringify(validation));
    sessionStorage.setItem(`solaris:${workspaceId}:approval:${dataset}:${version}`, JSON.stringify(approval));
  }, [workspaceId, upload, job, result, preview, dataset, version, mapping, validation, approval, datasetName, destinationDatasetId]);

  useEffect(()=>{const focusSearch=(event:KeyboardEvent)=>{if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='k'){event.preventDefault();const panel=document.getElementById('recent-datasets') as HTMLDetailsElement|null;if(panel)panel.open=true;document.getElementById('recent-dataset-search')?.focus();}};window.addEventListener('keydown',focusSearch);return()=>window.removeEventListener('keydown',focusSearch);},[]);
  const refreshDatasets = async () => { const data = await api.datasets(workspaceId); setDatasets(data.items); };
  useEffect(() => { let active = true; const c = new AbortController(); api.datasets(workspaceId, c.signal).then((d) => { if (active) setDatasets(d.items); }).catch((e) => { if (active) setError(userFacingImportError(e)); }); return () => { active = false; c.abort(); }; }, [workspaceId]);
  useEffect(() => {
    if (!upload?.job_id) { setJobVerified(false); return; }
    let active = true;
    let terminal = false;
    let timer: number | undefined;
    const controller = new AbortController();
    const terminalStates = ["succeeded", "failed_terminal", "cancelled", "reconciliation_required"];
    const refresh = async () => {
      if (!active || terminal) return;
      try {
        const current = await api.job(workspaceId, upload.job_id, controller.signal);
        if (!active) return;
        if (current.job_id !== upload.job_id) {
          throw new Error("The API returned a different processing job for this workspace.");
        }
        setJob(current);
        setJobVerified(true);
        if (terminalStates.includes(current.state)) {
          terminal = true;
          if (timer !== undefined) window.clearInterval(timer);
        }
      } catch (requestError) {
        if (!active || controller.signal.aborted) return;
        if (requestError instanceof ApiError && requestError.status === 404) {
          terminal = true;
          if (timer !== undefined) window.clearInterval(timer);
          autoSetupJob.current = null;
          setUpload(null);
          setJob(null);
          setJobVerified(false);
          setResult(null);
          setPreview(null);
          setError("The saved processing job was not found in this workspace. This can happen after changing the development database or workspace. No server data was deleted; select the original file to start a fresh import.");
          return;
        }
        setError(userFacingImportError(requestError));
      }
    };
    void refresh();
    timer = window.setInterval(() => void refresh(), 1500);
    return () => { active = false; controller.abort(); if (timer !== undefined) window.clearInterval(timer); };
  }, [workspaceId, upload?.job_id]);
  useEffect(() => {
    if (dataset || !jobVerified || job?.state !== "succeeded" || !upload?.job_id) return;
    let active = true;
    api.result(workspaceId, upload.job_id).then((value) => {
      if (!active) return;
      if (value.job_id !== upload.job_id || (upload.source?.source_file_id && value.source_file_id !== upload.source.source_file_id)) {
        setError("The processing result belongs to a different source. Refresh the job before registering this dataset.");
        return;
      }
      setResult(value);
      const inlinePreview = normalizePreview(value.preview ?? value.result?.preview);
      if (inlinePreview) {
        setPreview({ ...inlinePreview, source_file_id: inlinePreview.source_file_id ?? value.source_file_id });
        if (value.preview_error) setError(value.preview_error);
        return;
      }
      return api.jobPreview(workspaceId, upload.job_id, 10).then((fallback) => {
        if (!active) return;
        const normalized = normalizePreview(fallback);
        if (!normalized) throw new Error("The API returned no preview columns or rows.");
        setPreview({ ...normalized, source_file_id: fallback.source_file_id ?? value.source_file_id });
        setError("");
      });
    }).catch((requestError) => { if (active) setError(userFacingImportError(requestError)); });
    return () => { active = false; };
  }, [workspaceId, dataset, jobVerified, job?.state, upload?.job_id]);
  useEffect(() => { if (!dataset) { setVersions([]); return; } let active = true; const c = new AbortController(); api.versions(workspaceId, dataset, c.signal).then((v) => { if (active) { setVersions(v.items); setVersion((current) => v.items.some((item) => item.dataset_version_id === current) ? current : v.items[0]?.dataset_version_id ?? ""); } }).catch((e) => { if (active) setError(userFacingImportError(e)); }); return () => { active = false; c.abort(); }; }, [workspaceId, dataset]);
  useEffect(() => {
    if (!dataset || !version) { setProfile(null); return; }
    let active = true; const controller = new AbortController();
    setDatasetUnavailable(false); setProfile(null); setPreview(null); setMapping(null); setValidation(null); setApproval(null); setServerIntelligence(null);
    Promise.all([
      api.profile(workspaceId, dataset, version, controller.signal),
      api.preview(workspaceId, dataset, version, controller.signal),
      api.mapping(workspaceId, dataset, version, controller.signal),
      api.version(workspaceId, dataset, version, controller.signal),
    ]).then(async ([nextProfile, nextPreview, mappingResponse, versionResponse]) => {
      if (!active) return;
      setProfile(nextProfile); setPreview(nextPreview); setMapping(mappingResponse.mapping ?? null);
      if (mappingResponse.mapping?.columns) {
        setMappingDraft(Object.fromEntries(mappingResponse.mapping.columns.map((column: Obj) => [column.source_column, {
          target: column.target_field, type: column.expected_type, unit: column.measurement_unit ?? "",
          required: Boolean(column.is_required), timestampFormat: column.timestamp_format ?? undefined,
          valueScale: column.value_scale ?? undefined,
        }])));
      }
      if (versionResponse.current_validation_run_id) {
        try {
          const currentValidation = await api.validation(workspaceId, versionResponse.current_validation_run_id, controller.signal);
          if (active) setValidation(currentValidation);
        } catch { if (active) { setValidation(null); setError("The saved validation report is unavailable. Approval is disabled until the report can be verified."); } }
      }
      if (!versionResponse.current_validation_run_id && active) setValidation(null);

    }).catch((requestError) => { if (active) { setProfile(null); setPreview(null); setMapping(null); setValidation(null); setApproval(null); setServerIntelligence(null); setDatasetUnavailable(true); setError(userFacingImportError(requestError)); } });
    return () => { active = false; controller.abort(); };
  }, [workspaceId, dataset, version, recoveryAttempt]);

  async function act(fn: () => Promise<any>, success: string | ((value: any) => string), after?: (value: any) => void | Promise<void>) {
    if (busy) return;
    const epoch = actionEpoch.current;
    setBusy(true); setError(""); setMessage("");
    try { const value = await fn(); if (epoch !== actionEpoch.current) return; await after?.(value); if (epoch === actionEpoch.current) setMessage(typeof success === "function" ? success(value) : success); }
    catch (e) {
      if (epoch !== actionEpoch.current) return;
      setError(userFacingImportError(e));
      if (datasetSetupState === "setting_up") { setDatasetSetupState("failed"); autoSetupJob.current = null; }
    } finally { if (epoch === actionEpoch.current) setBusy(false); }
  }
  function changeSelection() {
    setDatasetUnavailable(false);
    actionEpoch.current += 1; setBusy(false); setProfile(null); setPreview(null);
    setUpload(null); setJob(null); setResult(null); setMapping(null); setValidation(null); setApproval(null); setMappingDraft({}); setServerIntelligence(null); setError(""); setMessage("");
  }
  function selectDataset(id: string) { if(id===dataset)return; changeSelection(); setVersions([]); setDataset(id); setVersion(""); }
  function selectVersion(id: string) { changeSelection(); setVersion(id); }
  const previewRows: unknown[] = Array.isArray(preview?.rows) ? preview.rows : [];
  const previewFields = previewRows.find((row: unknown) => row !== null && typeof row === "object" && !Array.isArray(row));
  const resultProfile = result?.result?.profile;
  const profileColumns: Obj[] = profile?.profile?.columns ?? profile?.profile?.fields ?? resultProfile?.columns ?? resultProfile?.fields ?? [];
  const fields: string[] = profileColumns.map((column: Obj | string) => typeof column === "string" ? column : column.name ?? column.column_name).filter(Boolean);
  if (!fields.length && Array.isArray(preview?.columns)) fields.push(...preview.columns.filter((field: unknown) => typeof field === "string"));
  if (!fields.length && previewFields) fields.push(...Object.keys(previewFields as Record<string, unknown>));
  if (!fields.length && Array.isArray(profile?.profile?.top_level_keys ?? resultProfile?.top_level_keys)) fields.push(...(profile?.profile?.top_level_keys ?? resultProfile.top_level_keys).filter((field: unknown) => typeof field === "string" && field !== "records"));
  const selectedVersion = versions.find((item) => item.dataset_version_id === version);
  const sourceProfile = profile ?? (resultProfile ? { profile: resultProfile } : null);
  const recognizedCount = fields.filter((field) => headerRule(field) !== null).length;
  useEffect(() => setMappingDraft((current) => Object.fromEntries(fields.map((field) => {
    if (current[field]) return [field, current[field]];
    const rule = headerRule(field);
    const evidence = columnEvidence(field, profileColumns, previewRows);
    return [field, {
      target: rule?.target ?? field,
      type: rule?.type ?? evidence.suggestion ?? "string",
      unit: rule?.unit ?? "",
      required: false,
      timestampFormat: timestampFormat(field, previewRows),
    }];
  }))), [profile, result, preview]);
  async function registerDataset() {
    if (!upload?.job_id || !datasetName.trim()) return;
    const operation = destinationDatasetId
      ? `version-create:${destinationDatasetId}:${upload.job_id}`
      : `dataset-create:${upload.job_id}`;
    await act(async () => {
      const created = destinationDatasetId
        ? await api.createVersion(workspaceId, destinationDatasetId, { job_id: upload.job_id, idempotency_key: idempotencyKey(workspaceId, operation) })
        : await api.createDataset(workspaceId, { name: datasetName.trim(), job_id: upload.job_id, idempotency_key: idempotencyKey(workspaceId, operation) });
      const datasetId = created.dataset_id ?? destinationDatasetId;
      const prepared = await api.prepare(workspaceId, datasetId, created.dataset_version_id, sourceProfileId || undefined);
      const savedMapping = prepared.mapping;
      const validated = prepared.validation;
      const needsScale = fields.some((field) => percentPowerFactorNeedsReview(field) && !savedMapping?.columns?.some((column: Obj) => column.source_column === field && column.value_scale));
      clearIdempotencyKey(workspaceId, operation);
      clearIdempotencyKey(workspaceId, `mapping:${datasetId}:${created.dataset_version_id}`);
      clearIdempotencyKey(workspaceId, `validation:${datasetId}:${created.dataset_version_id}`);
      return { created: { ...created, dataset_id: datasetId }, savedMapping, validated, needsScale };
    }, (value) => value.needsScale
      ? `Dataset draft registered, ${value.savedMapping?.columns?.length ?? 0} verified mappings saved, and preliminary validation completed. Confirm the power-factor scale for final validation.`
      : `Dataset draft registered, ${value.savedMapping?.columns?.length ?? 0} known mappings saved, and validation completed (${value.validated.outcome}).`, ({ created, savedMapping, validated, needsScale }) => {
      // Keep completed server writes visible even if a follow-up list refresh fails.
      setDataset(created.dataset_id); setVersion(created.dataset_version_id);
      setMapping(savedMapping); setValidation(validated); setApproval(null);
      setDatasetSetupState(needsScale ? "needs_scale" : "ready");
      void api.datasets(workspaceId).then((listed) => setDatasets(listed.items)).catch(() => {
        setError("The dataset was saved, but the dataset list could not refresh. Refresh the page to try again.");
      });
    });
  }
  async function addDatasetVersion() {
    const sourceJobId = selectedVersion?.source_job_id ?? upload?.job_id;
    if (!dataset || !sourceJobId) return;
    const operation = `version-create:${dataset}:${sourceJobId}`;
    await act(async () => {
      const created = await api.createVersion(workspaceId, dataset, { job_id: sourceJobId, idempotency_key: idempotencyKey(workspaceId, operation) });
      const columns = mappingPayload(fields, profileColumns, previewRows, mappingDraft, true);
      const savedMapping = columns.length
        ? await api.saveMapping(workspaceId, dataset, created.dataset_version_id, columns, idempotencyKey(workspaceId, `mapping:${dataset}:${created.dataset_version_id}`))
        : null;
      const updated = await api.versions(workspaceId, dataset);
      clearIdempotencyKey(workspaceId, operation);
      clearIdempotencyKey(workspaceId, `mapping:${dataset}:${created.dataset_version_id}`);
      return { created, savedMapping, updated };
    }, "New version created with known mappings saved. Review the mapping and run validation.", ({ created, savedMapping, updated }) => {
      setVersion(created.dataset_version_id); setMapping(savedMapping); setValidation(null); setApproval(null);
      setVersions(updated.items);
    });
  }
  async function saveFieldMapping() {
    if (!dataset || !version) return;
    const columns = mappingPayload(fields, profileColumns, previewRows, mappingDraft);
    const operation = `mapping:${dataset}:${version}`;
    await act(() => api.saveMapping(workspaceId, dataset, version, columns, mappingIdempotencyKey(workspaceId, operation, columns), mapping?.mapping_revision_id), "Field mapping saved. Run validation again to review this mapping revision.", (value) => { clearIdempotencyKey(workspaceId, operation); setMapping(value); setValidation(null); setApproval(null); });
  }
  async function confirmPowerFactorScale(field: string) {
    if (!dataset || !version || !mappingDraft[field]?.valueScale) return;
    const scaleColumn = suggestedMapping(field, profileColumns, previewRows, mappingDraft);
    const mappingOperation = `mapping:${dataset}:${version}`;
    const epoch = actionEpoch.current;
    await act(async () => {
      const latest = await api.mapping(workspaceId, dataset, version);
      if (!latest.mapping?.mapping_revision_id) throw new Error("The saved mapping could not be verified. Reload before confirming the scale.");
      const columns = [...latest.mapping.columns.filter((c: Obj) => c.source_column !== field).map((c: Obj) => ({...c,is_required:Boolean(c.is_required)})), scaleColumn];
      const savedMapping = await api.saveMapping(workspaceId, dataset, version, columns, mappingIdempotencyKey(workspaceId, mappingOperation, columns), latest.mapping.mapping_revision_id);
      if (epoch === actionEpoch.current) { setMapping(savedMapping); setValidation(null); setApproval(null); }
      const validated = await api.validate(workspaceId, dataset, version, idempotencyKey(workspaceId, `validation:${dataset}:${version}`));
      if (epoch === actionEpoch.current) setValidation(validated);
      clearIdempotencyKey(workspaceId, mappingOperation);
      clearIdempotencyKey(workspaceId, `validation:${dataset}:${version}`);
      try {
        const [current, listed] = await Promise.all([api.version(workspaceId, dataset, version), api.versions(workspaceId, dataset)]);
        if (epoch === actionEpoch.current) setVersions(listed.items.map((item: Obj) => item.dataset_version_id === version ? current : item));
      } catch { if (epoch === actionEpoch.current) setError("The scale and validation were saved. The version list could not refresh; retry or refresh to reload history."); }
      return { savedMapping, validated };
    }, "Power-factor scale saved with the mapping; validation completed.", () => setDatasetSetupState("ready"));
  }
  function updateMapping(field: string, updates: Partial<MappingDraft>) {
    setMappingDraft((current) => ({ ...current, [field]: { ...(current[field] ?? { target: field, type: "string", unit: "", required: false }), ...updates } }));
  }
  async function runValidation() {
    if (!dataset || !version) return;
    const operation = `validation:${dataset}:${version}`;
    await act(() => api.validate(workspaceId, dataset, version, idempotencyKey(workspaceId, operation)), "Validation report received from the backend.", async (value) => {
      clearIdempotencyKey(workspaceId, operation); setValidation(value);
      const [current, listed] = await Promise.all([api.version(workspaceId, dataset, version), api.versions(workspaceId, dataset)]);
      setVersions(listed.items.map((item) => item.dataset_version_id === version ? current : item));
    });
  }
  async function startReview() {
    if (!dataset || !version || !validation?.validation_run_id) return;
    const operation = `approval:${dataset}:${version}:${validation.validation_run_id}`;
    await act(() => api.approval(workspaceId, dataset, version, validation.validation_run_id, idempotencyKey(workspaceId, operation)), "Version submitted for review.", (value) => { clearIdempotencyKey(workspaceId, operation); setApproval(value); });
  }
  async function decide(decision: "approved" | "rejected") { if (approval?.approval_id) await act(() => api.decide(workspaceId, approval.approval_id, decision, reviewer), `Review decision recorded: ${decision}.`, setApproval); }

  async function retryFailedJob() {
    if (!upload?.job_id) return;
    const operation = `retry:${upload.job_id}`;
    await act(() => api.retryJob(workspaceId, upload.job_id, idempotencyKey(workspaceId, operation)), "A new linked processing attempt was queued.", (nextJob) => {
      clearIdempotencyKey(workspaceId, operation);
      setUpload((current) => current ? { ...current, job_id: nextJob.job_id, job_state: nextJob.state, job_reused: false } : current);
      setJob(nextJob); setResult(null); setPreview(null); setValidation(null); setApproval(null);
    });
  }

  useEffect(() => {
    if (job?.state !== "succeeded" || !result || !upload?.job_id || dataset || !fields.length
      || (!previewRows.length && !preview?.columns?.length) || !fields.every((field) => mappingDraft[field])
      || autoSetupJob.current === upload.job_id) return;
    autoSetupJob.current = upload.job_id;
    setDatasetSetupState("setting_up");
    if (!datasetName.trim()) setDatasetName((upload.source?.original_name ?? "Uploaded dataset").replace(/\.[^.]+$/, ""));
  }, [job?.state, result, upload?.job_id, dataset, datasetName, fields.join("\0"), preview, mappingDraft]);

  useEffect(() => {
    if (job?.state !== "succeeded" || !result || !upload?.job_id || dataset || !fields.length
      || (!previewRows.length && !preview?.columns?.length) || !fields.every((field) => mappingDraft[field])
      || autoSetupJob.current !== upload.job_id) return;
    const name = (datasetName.trim() || (upload.source?.original_name ?? "Uploaded dataset").replace(/\.[^.]+$/, "")).slice(0, 200);
    if (!name) return;
    void registerDataset().catch(() => { autoSetupJob.current = null; setDatasetSetupState("failed"); });
  }, [job?.state, result, upload?.job_id, dataset, datasetName, fields.join("\0"), preview, mappingDraft]);
  function resetImport() {
    setDatasetUnavailable(false); autoSetupJob.current = null; setDatasetSetupState("waiting"); setJobVerified(false);
    actionEpoch.current += 1; setBusy(false);
    setFile(null); setUpload(null); setJob(null); setResult(null); setPreview(null); setDataset(""); setVersion("");
    setVersions([]); setProfile(null); setMapping(null); setMappingDraft({}); setValidation(null); setApproval(null);
    setDatasetName(""); setMessage(""); setError("");
  }

  const sourceFile = upload?.source ?? null;
  const format = viewFilename ? viewFilename.split(".").pop()?.toLowerCase() : result?.result?.format ?? (sourceFile?.original_name ?? file?.name ?? "").split(".").pop()?.toLowerCase();
  const processingComplete = !datasetUnavailable && (dataset ? Boolean(version && profile) : jobVerified && job?.state === "succeeded" && Boolean(result));
  const jobActive = jobVerified && ["queued", "running", "retry_wait", "cancel_requested"].includes(job?.state);
  const profileData = sourceProfile?.profile ?? {};
  const rowCount = profileData.row_count ?? profileData.record_count;
  const columnCount = profileData.column_count ?? profileColumns.length;
  const mappedColumns = Array.isArray(mapping?.columns) ? mapping.columns : [];
  const recognizedFields = fields.filter((field) => headerRule(field) !== null);
  const reviewMappingReady = recognizedFields.every((field) => {
    const savedColumn = mappedColumns.find((column: Obj) => column.source_column === field);
    const draft = mappingDraft[field];
    return savedColumn && draft && savedColumn.target_field === draft.target && savedColumn.expected_type === draft.type
      && (savedColumn.measurement_unit ?? "") === draft.unit.trim() && Boolean(savedColumn.is_required) === draft.required
      && (savedColumn.timestamp_format ?? "") === (draft.timestampFormat ?? "")
      && (savedColumn.value_scale ?? undefined) === draft.valueScale;
  });
  const mappingIsSaved = mappedColumns.length > 0 && reviewMappingReady;
  const unitReviewCount = fields.filter((field) => {
    const persisted = mappedColumns.find((column: Obj) => column.source_column === field);
    return sourceUnitNeedsReview(field, persisted?.measurement_unit ?? "", persisted?.value_scale);
  }).length;
  const validationState = validation?.outcome === "passed" ? "Passed" : validation?.outcome === "warnings" ? "Warnings" : validation?.outcome === "failed" ? "Errors found" : "Not run";

  function openImportView(name:string){document.getElementById(`tab-${name.replaceAll(' ','-')}`)?.click();}
  function openMappings(){const disclosure=document.getElementById('mapping-review') as HTMLDetailsElement|null;if(disclosure&&!disclosure.open)disclosure.querySelector('summary')?.click();disclosure?.scrollIntoView?.({block:'nearest'});}
  function stageDetails(name:string){if(name==='Map')openMappings();else if(name==='Register')document.getElementById('open-registration')?.click();else if(name==='Validate')openImportView('Advanced Findings');else if(dataset)openImportView('Processing Log');else document.querySelector<HTMLInputElement>('input[aria-label="Select CSV or JSON file"]')?.click();}
  return <div className="module-content data-imports-page">
    <header className="import-dashboard-heading"><div><h2>Data Import &amp; Processing</h2><p>Ingest, validate, map, and register solar PV data with full traceability.</p></div><label className="header-dataset-selector"><span className="sr-only">Dataset</span><select aria-label="Selected dashboard dataset" value={dataset} onChange={event=>selectDataset(event.target.value)}><option value="">Choose a dataset</option>{dataset&&!datasets.some(item=>item.dataset_id===dataset)&&<option value={dataset}>Current selected dataset</option>}{datasets.map(item=><option key={item.dataset_id} value={item.dataset_id}>{item.name}</option>)}</select></label><button type="button" className="primary-button" onClick={()=>document.querySelector<HTMLInputElement>('input[aria-label="Select CSV or JSON file"]')?.click()}>Import New Data ↗</button></header>
    <nav className="import-dashboard-navigation" aria-label="Import workspace sections"><a href="#import-process">Import &amp; Process</a><a href="#recent-datasets" onClick={()=>{const panel=document.getElementById('recent-datasets') as HTMLDetailsElement|null;if(panel)panel.open=true;}}>Datasets</a><button type="button" onClick={openMappings}>Mapping &amp; Quality</button><button type="button" onClick={()=>openImportView('Transformations')}>Transformations</button><button type="button" onClick={()=>document.getElementById("open-registration")?.click()}>Registration</button></nav>
    <div className="import-dashboard-layout"><details id="recent-datasets"><summary>Datasets &amp; recent imports</summary><RecentImports key={workspaceId} workspaceId={workspaceId} selected={dataset} onSelect={selectDataset} refresh={datasets.length}/></details><div className="import-dashboard-content" id="import-process">
    <section className="automated-pipeline" aria-label="Automated Pipeline">
      {[{name:"Ingest", detail:"Original file received", done:Boolean(sourceFile && jobVerified || profile)},
        {name:"Analyze", detail:"Source structure detected", done:processingComplete, running:jobActive, failed:jobVerified && job?.state === "failed_terminal"},
        {name:"Map", detail:`${mappedColumns.length} / ${fields.length} mapped${unitReviewCount ? " - review required" : ""}`, done:Boolean(mapping?.mapping_revision_id)&&!unitReviewCount&&serverIntelligence?.eligibility?.pending_decisions===0, concern:unitReviewCount>0||Boolean(serverIntelligence?.eligibility?.pending_decisions)},
        {name:"Validate", detail:validation ? `${Number(validation.error_count).toLocaleString()} errors / ${Number(validation.warning_count).toLocaleString()} warnings` : "Quality and consistency", done:Boolean(validation)&&!validation?.error_count, failed:Boolean(validation?.error_count), concern:Boolean(serverIntelligence?.eligibility?.pending_decisions)},
        {name:"Register", detail:approval?.state === "approved" ? "Approval recorded" : "Explicit approval required", done:serverIntelligence?.eligibility?.registered === true}].map((stage) => <button type="button" aria-label={`${stage.name} details`} onClick={()=>stageDetails(stage.name)} className={`pipeline-stage ${stage.failed ? "failed" : stage.concern ? "has-findings" : stage.done ? "complete" : stage.running ? "running" : "pending"}`} key={stage.name}><span aria-hidden="true">{stage.failed || stage.concern ? "!" : stage.done ? "\u2713" : stage.running ? "..." : "\u25cb"}</span><div><strong>{stage.name}</strong><small>{stage.failed ? stage.detail : stage.concern ? `Needs Review: ${stage.detail}` : stage.done ? stage.detail : stage.running ? "Processing" : "Pending"}</small></div></button>)}
    </section>

    {error && <p className="api-error import-alert" role="alert">{error}</p>}
    {datasetUnavailable && <section className="import-recovery intelligent-card"><h2>Saved dataset unavailable</h2><p>The server could not verify this dataset in the selected workspace. Its cached preview is hidden. Check the workspace and API configuration, choose an available dataset in Import History, or start a fresh import. No server records have been removed.</p><button type="button" className="secondary-button" onClick={() => setRecoveryAttempt((value) => value + 1)}>Retry saved dataset</button><button type="button" className="secondary-button" onClick={resetImport}>Start a fresh import</button></section>}
    {message && <span className="sr-only" role="status">{message}</span>}

    <section className="uploaded-file-banner" aria-label="Uploaded file status">
      <div className="file-banner-identity">
        <span className={`file-type-icon ${format === "json" ? "is-json" : ""}`} aria-hidden="true">{format ? format.toUpperCase() : "FILE"}</span>
        <div><strong>{viewFilename || sourceFile?.original_name || file?.name || "Choose a CSV or JSON file"}</strong><p>{serverIntelligence?.source_size_bytes != null ? `${Number(serverIntelligence.source_size_bytes).toLocaleString()} bytes | Original source preserved` : sourceFile ? `${sourceFile.size_bytes == null ? "Size not reported" : `${Number(sourceFile.size_bytes).toLocaleString()} bytes`} · Stored in this workspace` : file ? `${file.size.toLocaleString()} bytes · ${file.type || "File type will be verified by the server"}` : "Original files are stored privately and preserved unchanged."}</p></div>
      </div>
      <p className="dataset-coverage-identity">{coverage?.scope===`${dataset}:${version}`?`${coverage.range[0].slice(0,10)} to ${coverage.range[1].slice(0,10)} · ${coverage.timezone}`:'Time coverage not yet established'} · {rowCount==null?'Record count unavailable':`${Number(rowCount).toLocaleString()} records`} · {columnCount} columns</p>
      <div className={`file-analysis-status ${validation?.error_count || validation?.warning_count ? "has-findings" : processingComplete ? "is-ready" : jobActive ? "is-working" : job?.state === "failed_terminal" ? "has-error" : ""}`} role="status">
        <span className="analysis-status-mark" aria-hidden="true">{processingComplete ? "✓" : job?.state === "failed_terminal" ? "!" : jobActive ? "•" : "○"}</span>
        <div><strong>{processingComplete ? "Analysis complete" : jobVerified && job?.state === "failed_terminal" ? "Analysis stopped" : jobActive ? "Processing status" : sourceFile ? "Checking saved job" : "Ready for upload"}</strong><small>{datasetSetupState === "setting_up" ? "Saving dataset mappings and validation" : validation ? `Validation: ${validationState}` : jobVerified && job ? `Job state: ${job.state}` : sourceFile ? "Confirming job in this workspace" : "CSV and JSON files supported"}</small></div>
      </div>
      {processingComplete && <div className="dataset-recognition-summary"><strong>{mappedColumns.length} / {fields.length}</strong><span>Recognized mappings</span><small>{rowCount == null ? "Record count unavailable" : `${Number(rowCount).toLocaleString()} imported rows`} | {columnCount} source fields</small><span className={`quality-pill ${serverIntelligence?.eligibility?.state === "blocked" ? "invalid" : serverIntelligence?.eligibility?.pending_decisions ? "unresolved" : ""}`}>{serverIntelligence?.eligibility ? `${serverIntelligence.eligibility.state.replaceAll("_"," ")}${serverIntelligence.eligibility.pending_decisions ? ` | ${serverIntelligence.eligibility.pending_decisions} scientific decision pending` : ""}` : "Checking registration requirements"}</span></div>}
      <details className="file-actions-menu" open={!dataset}><summary aria-label="Source file actions">&#8943;</summary><div className="file-banner-actions">{dataset && version && profile && <a className="secondary-button" href={api.originalSourceUrl(workspaceId,dataset,version)} download>View Raw File</a>}<details className="import-history"><summary>Import History</summary><label>Dataset<select aria-label="Import history dataset" disabled={busy} value={dataset} onFocus={() => void refreshDatasets()} onChange={(e) => selectDataset(e.target.value)}><option value="">Select dataset</option>{datasets.map((d) => <option key={d.dataset_id} value={d.dataset_id}>{d.name}</option>)}</select></label><label>Version<select aria-label="Import history version" disabled={busy} value={version} onChange={(e) => selectVersion(e.target.value)}><option value="">Select version</option>{versions.map((v) => <option key={v.dataset_version_id} value={v.dataset_version_id}>Version {v.version_number} | {v.state}</option>)}</select></label></details>
        <label className="secondary-button choose-file-button">{sourceFile ? "Choose another file" : "Select file"}<input aria-label="Select CSV or JSON file" disabled={busy} type="file" accept=".csv,.json,text/csv,application/json" onChange={(event) => { actionEpoch.current += 1; setBusy(false); const selected = event.target.files?.[0] ?? null; setDatasetUnavailable(false); setJobVerified(false); setFile(selected); setDatasetName(selected ? selected.name.replace(/\.[^.]+$/, "") : ""); setUpload(null); setJob(null); setResult(null); setPreview(null); setProfile(null); setDataset(""); setVersion(""); setMapping(null); setMappingDraft({}); setValidation(null); setApproval(null); setError(""); setMessage(""); }} /></label>
        {file && !sourceFile && <details className="dataset-destination-details"><summary>Dataset destination</summary><label>Dataset name<input aria-label="Dataset name" value={datasetName} onChange={(event) => setDatasetName(event.target.value)} /></label><label>Use existing dataset<select aria-label="Use existing dataset" value={destinationDatasetId} onChange={(event) => setDestinationDatasetId(event.target.value)}><option value="">Create a new dataset</option>{datasets.map((item) => <option key={item.dataset_id} value={item.dataset_id}>{item.name}</option>)}</select></label>{sourceProfiles.length>0 && <label>Approved source interpretation<select aria-label="Approved source profile" value={sourceProfileId} onChange={(e) => setSourceProfileId(e.target.value)}><option value="">Ask again for scientific ambiguities</option>{sourceProfiles.map((p) => <option key={p.profile_id} value={p.profile_id}>Reuse approved source profile v{p.profile_version} (same instrument)</option>)}</select><small>Choose reuse only when this is the same documented instrument/source. Filenames are not identity evidence.</small></label>}</details>}
        {file && !sourceFile && busy && <progress aria-label="Upload progress" />}
        {file && !sourceFile && <button className="primary-button" type="button" disabled={busy} onClick={() => void act(() => api.upload(workspaceId, file), "File received; durable processing job created.", (value) => { setUpload(value); setJob({ job_id: value.job_id, state: value.job_state }); setJobVerified(true); })}>{busy ? "Uploading…" : "Upload and analyze"}</button>}
        {jobActive && upload?.job_id && <button className="secondary-button" type="button" disabled={busy} onClick={() => void act(() => api.cancel(workspaceId, upload.job_id), "Cancellation request recorded.", setJob)}>Cancel processing</button>}
        {job?.state === "failed_terminal" && upload?.job_id && <button className="secondary-button" type="button" disabled={busy} onClick={() => void retryFailedJob()}>{busy ? "Queuing…" : "Retry processing"}</button>}
        {sourceFile && <button className="quiet-button" type="button" disabled={busy} onClick={resetImport}>New import</button>}
      </div></details>
    </section>

    {datasetSetupState === "failed" && <button type="button" className="secondary-button" disabled={busy} onClick={() => void registerDataset()}>Retry dataset preparation</button>}
    {job?.state === "failed_terminal" && <p className="import-error-note" role="alert">{job.error_message || "The file could not be processed."} Correct the source file or request a new linked processing attempt. Your original file remains available.</p>}
    {jobActive && <p className="import-processing-note" role="status">Processing runs in the background. The status above updates from the durable job record; no estimated progress is shown.</p>}
    {job?.state === "succeeded" && !result && <button className="secondary-button" type="button" disabled={busy} onClick={() => void act(() => api.result(workspaceId, upload?.job_id ?? ""), "Processing result refreshed from the server.", setResult)}>Refresh processing result</button>}


    {processingComplete && dataset && version && profile && <ImportWorkspace workspaceId={workspaceId} dataset={dataset} version={version}
      jobId={selectedVersion?.source_job_id??upload?.job_id} onCoverage={setCoverage}
      datasetRows={rowCount} mapping={mapping} validation={validation} approval={approval} preview={preview} source={sourceFile}
      key={`${workspaceId}:${dataset}:${version}`} onIntelligence={setServerIntelligence} onFilename={setViewFilename} onNormalization={setNormalizationVerified} onInspect={setFindingsFilter} onApproval={setApproval} onReviewScale={() => { setEditingMapping(false);setScaleReviewRequest((value) => value+1); }}
      mappingPanel={<>      <section className="import-panel smart-mapping-panel panel-card" id="smart-field-mapping" tabIndex={-1}>
        <div className="mapping-panel-header"><div><h2><span className="panel-heading-icon" aria-hidden="true">&#8644;</span>Smart Field Mapping</h2><p>Verified header matches are saved automatically. Ambiguous scale remains open for review.</p></div><span className={`mapping-count-badge ${mappingIsSaved ? "is-complete" : ""}`}>{mappedColumns.length} / {fields.length} mapped</span><button className="secondary-button mapping-edit-button" type="button" aria-pressed={editingMapping} onClick={() => setEditingMapping((value) => !value)}>{editingMapping ? "Done" : "Edit"}</button></div>
        {fields.length ? <MappingTable fields={fields} profileColumns={profileColumns} rows={previewRows} draft={mappingDraft} savedColumns={mappedColumns} editable={editingMapping} reviewRequest={scaleReviewRequest} onChange={updateMapping} onConfirmScale={(field) => void confirmPowerFactorScale(field)} /> : <p className="module-empty-state">The processing result did not include source columns for mapping.</p>}
        {selectedVersion && selectedVersion.state !== "draft" && <div className="mapping-revision-note"><p>This version's mapping is frozen after validation.</p><button type="button" className="secondary-button" disabled={busy || !(selectedVersion?.source_job_id ?? upload?.job_id)} onClick={() => void addDatasetVersion()}>Create mapping revision</button></div>}
        {editingMapping && <div className="mapping-actions"><button className="secondary-button" type="button" disabled={!dataset || !version || !fields.length || selectedVersion?.state !== "draft" || busy} onClick={() => void saveFieldMapping()}>{busy ? "Saving?" : "Save field mapping"}</button>{mappingIsSaved && <span className="mapping-saved-note">Mapping revision saved to the selected dataset version.</span>}</div>}
        <details><summary>Column Details</summary><table className="intelligent-table" aria-label="Column profile"><thead><tr><th>Source column</th><th>Detected types</th></tr></thead><tbody>{profileColumns.map((c: Obj) => <tr key={c.name ?? c.column_name}><th>{c.name ?? c.column_name}</th><td>{Object.entries(c.observed_types ?? {}).map(([kind,count]) => `${kind} (${count})`).join(" | ")}</td></tr>)}</tbody></table></details>
        <p className="mapping-unit-note">{unitReviewCount ? `${unitReviewCount} measurement field${unitReviewCount === 1 ? " needs" : "s need"} unit or scale review. Source values are retained; verified unit conversions appear in Normalized Data.` : "Only verified source units are saved."}</p>
      </section></>}
      findingsPanel={validation ? <ValidationFindings validation={validation} workspaceId={workspaceId} initialFilter={findingsFilter} /> : <p>Validation has not run.</p>}
      registrationPanel={<div className="validation-primary-action" aria-live="polite">
        {!serverIntelligence?.eligibility && <p>Verifying registration requirements with the server...</p>}
        {serverIntelligence?.eligibility?.primary_action === "review_interpretation" && <button type="button" className="primary-button" onClick={() => { openMappings();setEditingMapping(false);setScaleReviewRequest((value) => value+1);const panel=document.getElementById("smart-field-mapping");panel?.scrollIntoView?.({block:"nearest"});panel?.focus(); }}>Confirm interpretation</button>}
        {serverIntelligence?.eligibility?.primary_action === "inspect_integrity" && <p>Blocking findings need review. Inspect the source evidence before deciding whether a mapping revision or a new corrected source is appropriate.</p>}
        {serverIntelligence?.eligibility?.primary_action === "validate" && <button type="button" className="primary-button" disabled={busy || !mapping} onClick={() => void runValidation()}>Validate Dataset</button>}
        {serverIntelligence?.eligibility?.can_submit && <button type="button" className="primary-button" disabled={busy} onClick={() => void startReview()}>{busy ? "Submitting..." : "Submit for Review"}</button>}
        {serverIntelligence?.eligibility?.can_approve && <div className="review-decision-controls"><label>Reviewer<input aria-label="Reviewer identity" value={reviewer} onChange={(e) => setReviewer(e.target.value)} placeholder="Operator name"/></label><button type="button" className="primary-button" disabled={!reviewer.trim() || busy} onClick={() => void decide("approved")}>{busy ? "Recording..." : "Approve and Register"}</button><button type="button" className="secondary-button" disabled={!reviewer.trim() || busy} onClick={() => void decide("rejected")}>Reject</button></div>}
        {serverIntelligence?.eligibility?.registered && <strong className="approved-dataset-state">Dataset registered and approved.</strong>}
        {serverIntelligence?.eligibility && <details className="eligibility-policy"><summary>Registration policy</summary><p>{serverIntelligence.eligibility.policy}</p></details>}
      </div>}

    />}

  </div></div></div>;
}
