import ImportGlyph from "./ImportGlyph";
import EvidenceDialog from "./EvidenceDialog";
import GuidedIssues from "./GuidedIssues";
import ProcessingLog from "./ProcessingLog";
import {compatibleComparison} from './comparisonPolicy';
import AssociationPreview from "./AssociationPreview";
import MeasurementCards,{type MeasurementField} from "./MeasurementCards";
import type { DiagnosisRecord } from "../../api/importTypes";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { api } from "../../api/solaris";
import "./importWorkspace.css";

type Obj = Record<string, any>;
const show = (v: unknown): string => v === undefined || v === null ? "Missing" : v === "" ? "Empty string" : Array.isArray(v) ? `Array (${v.length} item${v.length === 1 ? "" : "s"})` : typeof v === "object" ? `Object (${Object.keys(v).length} field${Object.keys(v).length === 1 ? "" : "s"})` : String(v);
const tabs = ["Data Explorer", "Mapping", "Provenance", "Transformations", "Advanced Findings", "Processing Log"];

export default function ImportWorkspace({ workspaceId, dataset, version, datasetRows, mapping, validation, approval, preview, source, mappingPanel, findingsPanel, registrationPanel, onApproval, onReviewScale, onNormalization, onInspect, onFilename, onIntelligence, jobId, onCoverage }: {
  workspaceId: string; dataset: string; version: string; datasetRows?: number; mapping: Obj | null; validation: Obj | null; approval: Obj | null;
  preview: Obj | null; source: Obj | null; mappingPanel: ReactNode; findingsPanel: ReactNode; registrationPanel: ReactNode;
  jobId?: string;
  onCoverage?:(value:{scope:string;range:[string,string];timezone:string})=>void;
  onIntelligence?: (value: Obj) => void;
  onFilename?: (filename: string) => void;
  onNormalization: (ready: boolean) => void; onInspect: (diagnosis: Obj) => void;
  onApproval: (value: Obj | null) => void; onReviewScale: () => void;
}) {
  const [intelligence, setIntelligence] = useState<Obj | null>(null);
  const [chartPayload, setChartData] = useState<Obj | null>(null);
  const [chartLoading, setChartLoading] = useState(false);
  const [chartProblem, setChartProblem] = useState("");
  const [data, setData] = useState<Obj | null>(null);
  const [tab, setTab] = useState("Data Explorer");
  const previousValidation=useRef<Obj|null>(validation);
  const [validationChange,setValidationChange]=useState<Obj|null>(null);
  useEffect(()=>{if(validation?.validation_run_id){const before=previousValidation.current;if(before?.validation_run_id&&before.validation_run_id!==validation.validation_run_id)setValidationChange({before,after:validation});previousValidation.current=validation;}},[validation]);
  const [evidenceOpen,setEvidenceOpen]=useState(false);
  const [evidencePage,setEvidencePage]=useState("Data");
  const [expandedChart,setExpandedChart]=useState(false);
  const [previewOpen,setPreviewOpen]=useState(false);
  const [summariesOpen,setSummariesOpen]=useState(false);
  const [mappingOpen,setMappingOpen]=useState(false);
  useEffect(()=>{if(mappingOpen){setEvidenceOpen(true);setEvidencePage("Data");setPreviewOpen(true);setTab("Mapping");const panel=document.getElementById('smart-field-mapping');panel?.scrollIntoView?.({block:'nearest'});panel?.focus();}},[mappingOpen]);
  const [normalized, setNormalized] = useState(false);
  const [field, setField] = useState("");
  const [comparison,setComparison]=useState('');
  const [comparisonPayload,setComparisonData]=useState<Obj|null>(null);
  const [comparisonError,setComparisonError]=useState('');
  const [comparisonRetry,setComparisonRetry]=useState(0);
  const [inspectSeries,setInspectSeries]=useState('primary');
  const [start, setStart] = useState(""); const [end, setEnd] = useState("");
  const [search, setSearch] = useState(""); const [query, setQuery] = useState("");
  const [quality, setQuality] = useState(""); const [sort, setSort] = useState("source"); const [sourceRow, setSourceRow] = useState("");
  const [offset, setOffset] = useState(0); const [hidden, setHidden] = useState<string[]>([]);
  const [retry, setRetry] = useState(0);
  const [loading, setLoading] = useState(false); const [problem, setProblem] = useState("");
  const [focus, setFocus] = useState<Obj | null>(null);
  const [inspectRow, setInspectRow] = useState("");
  const numeric: MeasurementField[] = (mapping?.columns ?? []).filter((c: Obj) => ["number", "integer"].includes(c.expected_type));
  const selected = numeric.find((c) => c.source_column === field);
  const chartRequest=JSON.stringify([workspaceId,dataset,version,field,start,end,mapping?.mapping_revision_id,validation?.validation_run_id]);
  const chartData=chartPayload?._request_key===chartRequest?chartPayload:null;
  const coverageStart=chartData?.chart?.source_time_range?.[0],coverageEnd=chartData?.chart?.source_time_range?.[1];
  useEffect(()=>{if(coverageStart&&coverageEnd)onCoverage?.({scope:`${dataset}:${version}`,range:[coverageStart,coverageEnd],timezone:/Z$|[+-]\d\d:\d\d$/.test(coverageStart)?'Recorded offset retained':'Source clock; timezone unconfirmed'});},[coverageStart,coverageEnd,dataset,version,onCoverage]);
  useEffect(() => { if (!numeric.some((c) => c.source_column === field)) setField((numeric.find((c) => c.target_field==="total_real_power") ?? numeric[0])?.source_column ?? ""); }, [mapping]);
  useEffect(() => { const timer = window.setTimeout(() => { setQuery(search); setOffset(0); }, 250); return () => window.clearTimeout(timer); }, [search]);
  useEffect(() => {
    if (!dataset || !version) return;
    let active = true; const c = new AbortController();
    setIntelligence(null);
    api.intelligence(workspaceId, dataset, version, c.signal).then((value) => {
      if (active) { setIntelligence(value); onIntelligence?.(value); if (value.filename) onFilename?.(value.filename); if ("approval" in value) onApproval(value.approval); }
    }).catch((e) => { if (active && e.name !== "AbortError") setProblem("Diagnosis could not be loaded. Retry or refresh to recover server state."); });
    return () => { active = false; c.abort(); };
  }, [workspaceId, dataset, version, mapping?.mapping_revision_id, validation?.validation_run_id, approval?.state, retry]);
  useEffect(() => {
    if (!dataset || !version) return;
    let active = true; const c = new AbortController();
    setLoading(true); setProblem(""); setFocus(null); setData(null);
    api.explorer(workspaceId, dataset, version, { offset, limit:25, search:query, field: field || undefined, start:start || undefined, end:end || undefined, quality:quality || undefined, sort, source_row:sourceRow ? Number(sourceRow) : undefined, include_chart:"false" }, c.signal)
      .then((value) => { if (active) { setData(value); if (Array.isArray(value.items)) onNormalization(Boolean(mapping?.mapping_revision_id && value.provenance?.mapping_revision_id === mapping.mapping_revision_id)); } })
      .catch((e) => { if (active && e.name !== "AbortError") setProblem("The explorer could not load the selected readings. Check the selected time range and retry."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; c.abort(); };
  }, [workspaceId, dataset, version, mapping?.mapping_revision_id, validation?.validation_run_id, offset, query, field, start, end, retry, quality, sort, sourceRow]);
  useEffect(() => {
    let active=true; const controller=new AbortController();
    setChartData(null); setChartProblem(""); setFocus(null);
    if (!dataset || !version || !field || !validation) { setChartLoading(false); return; }
    setChartLoading(true);
    api.explorer(workspaceId,dataset,version,{field,start:start||undefined,end:end||undefined,limit:1},controller.signal)
      .then((v) => {if(active)setChartData({...v,_request_key:chartRequest});})
      .catch((e) => {if(active && e.name!=="AbortError")setChartProblem("Chart readings could not load. Check the source-clock range or retry.");})
      .finally(() => {if(active)setChartLoading(false);});
    return () => {active=false;controller.abort();};
  },[workspaceId,dataset,version,field,start,end,mapping?.mapping_revision_id,validation?.validation_run_id,retry]);
  function goToSource(row:number, sourceField?:string) {
    setEvidencePage("Data");setEvidenceOpen(true);setMappingOpen(false);setPreviewOpen(true);
    setSearch("");setQuery("");setQuality("");setSort("source");setStart("");setEnd("");setOffset(0);setNormalized(false);setSourceRow(String(row));
    if(sourceField)setHidden((h) => h.filter((name) => name!==sourceField));setTab("Data Explorer");
  }
  const fallbackAllowed=!problem && !loading && !normalized && !query && offset===0 && !quality && !sourceRow && sort==="source" && !start && !end;
  const items: Obj[] = data?.items ?? (fallbackAllowed ? preview?.rows ?? [] : []).map((row: Obj, i: number) => ({ source_row:preview?.source_rows?.[i] ?? i+1, original:row, original_truncated:(preview?.truncated_cells ?? []).filter((cell:Obj) => cell.source_row === (preview?.source_rows?.[i] ?? i+1)).map((cell:Obj) => cell.field) }));
  const columns: string[] = data?.columns ?? preview?.columns ?? [];
  const visible = columns.filter((c) => !hidden.includes(c));
  const chartUnit = chartData?.chart?.unit ?? selected?.measurement_unit;
  const comparisonRequest=JSON.stringify([chartRequest,comparison,chartUnit]);
  const comparisonData=comparisonPayload?._request_key===comparisonRequest?comparisonPayload:null;
  useEffect(()=>{
    let active=true;const controller=new AbortController();setComparisonData(null);setComparisonError('');
    const other=numeric.find(c=>c.source_column===comparison);
    if(!comparison||!other||comparison===field||!compatibleComparison(selected,other)){setComparison('');return;}
    api.explorer(workspaceId,dataset,version,{field:comparison,start:start||undefined,end:end||undefined,limit:1},controller.signal).then(value=>{if(active){if(value.chart.unit!==chartUnit){setComparisonError('Normalized units differ; comparison is not drawn.');return;}setComparisonData({...value,_request_key:comparisonRequest});}}).catch(e=>{if(active&&e.name!=='AbortError')setComparisonError('Comparison could not load. Select it again to retry.');});
    return()=>{active=false;controller.abort();};
  },[comparison,field,chartUnit,start,end,workspaceId,dataset,version,mapping?.mapping_revision_id,validation?.validation_run_id,comparisonRetry]);
  const rawPoints: Obj[] = validation ? chartData?.chart?.points ?? [] : [];
  // Break at every excluded row. Unknown cadence is never bridged: a single segment joins
  // only runs with an unchanged positive interval, with explicit markers at discontinuities.
  const points: Obj[] = rawPoints.map((point) => ({ ...point, source_field:field, time: point.plot_seconds != null ? point.plot_seconds * 1000 : point.timestamp ? Date.parse(point.timestamp) : NaN }));
  const valid = points.filter((p) => p.value !== null && Number.isFinite(p.time));
  const comparePoints:Obj[]=(comparisonData?.chart?.points??[]).map((p:Obj)=>({...p,source_field:comparison,time:p.plot_seconds!=null?p.plot_seconds*1000:NaN}));
  const inspectedPoints=inspectSeries==='comparison'&&comparisonData?comparePoints:points;
  const hoverPoints=inspectedPoints.filter(p=>p.value!==null&&Number.isFinite(p.time));
  const combined=[...valid,...comparePoints.filter(p=>p.value!==null&&Number.isFinite(p.time))];
  const low = combined.length ? Math.min(...combined.map((p) => p.value)) : 0;
  const high = combined.length ? Math.max(...combined.map((p) => p.value)) : 1;
  const first = combined.length ? Math.min(...combined.map((p) => p.time)) : 0;
  const last = combined.length ? Math.max(...combined.map((p) => p.time)) : 1;
  const xy = (p: Obj) => ({ x: 55 + (p.time - first) / Math.max(1,last - first) * 790, y: 205 - (p.value - low) / Math.max(1,high - low) * 160 });
  const segments: string[] = []; let segment: string[] = []; let prior: Obj | null = null; let interval: number | null = null;
  for (const p of points) {
    if (p.value === null || !Number.isFinite(p.time)) { if (segment.length) segments.push(segment.join(" ")); segment=[]; prior=null; interval=null; continue; }
    const gap = prior ? p.time - prior.time : null;
    if (p.break_before || gap !== null && (gap <= 0 || !chartData?.chart?.sampling && interval !== null && gap !== interval)) { if (segment.length) segments.push(segment.join(" ")); segment=[]; interval=null; }
    const point=xy(p); segment.push(`${point.x},${point.y}`); if(gap !== null && gap > 0) interval=gap; prior=p;
  }
  if(segment.length) segments.push(segment.join(" "));
  const comparisonSegments:string[]=[];let comparisonSegment:string[]=[];
  for(const point of comparePoints){if(point.value===null||!Number.isFinite(point.time)||point.break_before){if(comparisonSegment.length)comparisonSegments.push(comparisonSegment.join(' '));comparisonSegment=[];}if(point.value!==null&&Number.isFinite(point.time)){const position=xy(point);comparisonSegment.push(`${position.x},${position.y}`);}}
  if(comparisonSegment.length)comparisonSegments.push(comparisonSegment.join(' '));
  const diagnoses: Obj[] = intelligence?.diagnoses ?? [];
  const pendingScale = Boolean((data?.scientific_warnings ?? []).some((w: Obj) => w.code === "power_factor_percent_scale_review") || (intelligence?.eligibility ? intelligence.eligibility.pending_decisions > 0 : (mapping?.columns ?? []).some((c: Obj) => c.target_field === "power_factor" && c.measurement_unit === "%" && !c.value_scale)
    || diagnoses.some((d) => d.diagnosis_code === "power_factor_percent_scale_review")));
  const range: string[] | null = chartData?.chart?.plotted_time_range ?? null;
  function moveRange(mode: "zoom" | "left" | "right") {
    if (!range) return;
    const parse = (value: string) => Date.parse(`${value.slice(0,19)}Z`);
    const a=parse(range[0]), b=parse(range[1]), width=b-a;
    if (!Number.isFinite(width) || width<=0) return;
    const delta=mode==="zoom" ? width/4 : (mode==="left" ? -width/2 : width/2);
    const from=mode==="zoom" ? a+delta : a+delta;
    const to=mode==="zoom" ? b-delta : b+delta;
    setStart(new Date(from).toISOString().slice(0,19)); setEnd(new Date(to).toISOString().slice(0,19)); setOffset(0);
  }
  function openView(name:string){setEvidencePage("Data");setEvidenceOpen(true);setPreviewOpen(true);setTab(name);setMappingOpen(name==="Mapping");}
  function reviewScale() {
    setEvidencePage("Data");setEvidenceOpen(true);setPreviewOpen(true);setMappingOpen(true);
    setTab("Mapping"); onReviewScale();
    document.getElementById("smart-field-mapping")?.scrollIntoView?.({block:"nearest",behavior:"auto"});
    document.getElementById("smart-field-mapping")?.focus();
  }
  useEffect(()=>{if(previewOpen){setEvidenceOpen(true);const control=document.getElementById(`tab-${tab.replaceAll(" ","-")}`);control?.scrollIntoView?.({block:"nearest"});control?.focus();}},[previewOpen,tab]);
  const inspectDiagnosis=(d: Obj) => { setEvidencePage("Data");setEvidenceOpen(true);setPreviewOpen(true);onInspect(d); setTab("Advanced Findings"); };
  return <div className="intelligent-import-grid" data-layout="guided-dashboard">
      <section className="dataset-state-cards" aria-label="Dataset state summary">
        <button type="button" className="intelligent-card" onClick={()=>setMappingOpen(true)}><ImportGlyph kind="layers"/><span>Measurement Mapping</span><strong>{mapping?.columns?.length??0} / {columns.length}</strong><small>Saved fields; {intelligence?.eligibility?.pending_decisions??'unverified'} open interpretation decisions. Not blanket scientific approval.</small><div className="mapping-breakdown"><span>Mapped <b>{mapping?.columns?.length??0}</b></span><span>Needs clarification <b>{intelligence?.eligibility?.pending_decisions??Math.max(0,columns.length-(mapping?.columns?.length??0))}</b></span></div></button>
        <section className="intelligent-card quality-state"><ImportGlyph kind="shield"/><h2>Data Quality</h2><div><button type="button" onClick={()=>inspectDiagnosis({severity:'error'})}><strong>{validation?.error_count==null?'Not run':Number(validation.error_count).toLocaleString()}</strong><span>Blocking errors</span></button><button type="button" onClick={()=>inspectDiagnosis({severity:'warning'})}><strong>{validation?.warning_count==null?'Not run':Number(validation.warning_count).toLocaleString()}</strong><span>Warnings</span></button></div></section>
        <button type="button" className="intelligent-card" onClick={()=>{setEvidencePage("Registration");setEvidenceOpen(true);}}><ImportGlyph kind="database"/><span>Dataset Status</span><strong className="dataset-state-badge">{intelligence?.eligibility?.state?.replaceAll('_',' ')??'Verifying'}</strong><small>{intelligence?.eligibility?.registered?'Registered source; equipment promotion remains separate.':'Resolve blocking evidence, confirm documented interpretations, then explicitly approve.'}</small></button>
        {validationChange&&<p role="status">Validation refreshed: errors {validationChange.before.error_count} to {validationChange.after.error_count}; warnings {validationChange.before.warning_count} to {validationChange.after.warning_count}. Original source preserved.</p>}
      </section>
      <section className={`intelligent-card measurement-explorer ${expandedChart?"chart-expanded":""}`} aria-label="Measurement Explorer">
        <header><h2><span aria-hidden="true">&#9637;</span> Measurement Explorer</h2><button type="button" className="chart-expand" aria-label={expandedChart?"Collapse chart":"Expand chart"} aria-pressed={expandedChart} onClick={()=>setExpandedChart(value=>!value)}>&#10530;</button><div className="explorer-controls">
          <label className="sr-only" htmlFor="measurement">Measurement</label><select id="measurement" value={field} onChange={(e) => { setField(e.target.value); if(!e.target.value)setSort("source"); setOffset(0); }}><option value="">Select measurement</option>{numeric.map((c) => <option key={c.source_column} value={c.source_column}>{c.target_field.replaceAll("_", " ")} {c.measurement_unit ? `(${c.target_field === "power_factor" && c.value_scale ? "ratio" : c.measurement_unit})` : "- unit unknown"}</option>)}</select>

          <details><summary>Source clock range</summary><div className="range-controls"><label>From<input aria-label="Chart start time" type="datetime-local" value={start} onChange={(e) => { setStart(e.target.value); setOffset(0); }} /></label><label>To<input aria-label="Chart end time" type="datetime-local" value={end} onChange={(e) => { setEnd(e.target.value); setOffset(0); }} /></label><button type="button" onClick={() => { setStart(""); setEnd(""); }}>All timestamps</button></div></details>
        </div></header>
        {chartLoading && <p role="status">Loading chart readings...</p>}
        {comparisonError&&<p role="alert">{comparisonError}<button type="button" onClick={()=>setComparisonRetry(value=>value+1)}>Retry comparison</button></p>}
        {comparisonData&&<p className="comparison-legend">Blue: {selected?.target_field.replaceAll('_',' ')} · Orange: {numeric.find(c=>c.source_column===comparison)?.target_field.replaceAll('_',' ')} · Shared unit: {chartUnit}. Gaps and sampling retained independently.</p>}
        {chartProblem && <p role="alert" className="explorer-error">{chartProblem}</p>}
        {problem && <div><p role="alert" className="explorer-error">{problem}</p><button type="button" onClick={() => setRetry((n) => n+1)}>Retry explorer and diagnosis</button></div>}
        {valid.length >= 2 && selected?.measurement_unit ? <>
          <svg className="measurement-chart" viewBox="0 0 880 255" preserveAspectRatio="none" role="img" aria-label={`Validated ${selected.target_field} readings (${chartUnit})`} onPointerMove={(e) => { const rect=e.currentTarget.getBoundingClientRect(); if(!rect.width || !hoverPoints.length)return; const x=(e.clientX-rect.left)*880/rect.width; const nearest=hoverPoints.reduce((a,b) => Math.abs(xy(a).x-x)<Math.abs(xy(b).x-x) ? a : b); setFocus((old) => old?.source_row===nearest.source_row&&old?.source_field===nearest.source_field ? old : nearest); }}>
            <text x="14" y="18">{chartUnit}</text><defs><linearGradient id="measurement-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#83c5fa" stopOpacity=".65"/><stop offset="100%" stopColor="#e9f5ff" stopOpacity=".15"/></linearGradient></defs>
            {[0,.5,1].map((fraction) => <g key={fraction}><line x1="55" x2="845" y1={205-fraction*160} y2={205-fraction*160} stroke="#e2eaf4"/><text x="48" y={210-fraction*160} textAnchor="end">{(low+(high-low)*fraction).toLocaleString(undefined,{maximumFractionDigits:2})}</text></g>)}
            <path d="M55 30V205H845" fill="none" stroke="#667c99"/>
            {segments.map((s,i) => <g key={i}><polygon points={`${s.split(" ")[0].split(",")[0]},205 ${s} ${s.split(" ").at(-1)!.split(",")[0]},205`} fill="url(#measurement-fill)"/><polyline points={s} fill="none" stroke="#0874ff" strokeWidth="2.5"/></g>)}
            {[false,true].map((warn) => <path key={String(warn)} data-reading-count={valid.filter((p) => Boolean(p.flags.length)===warn).length} fill={warn ? "#a15b00" : "#0874ff"} d={valid.filter((p) => Boolean(p.flags.length)===warn).map((p) => {const point=xy(p);return `M${point.x-1.8},${point.y}a1.8,1.8 0 1,0 3.6,0a1.8,1.8 0 1,0 -3.6,0`;}).join(" ")}/>)}
            {comparisonSegments.map((segment,index)=><polyline key={`comparison-${index}`} data-series="comparison" points={segment} fill="none" stroke="#d97606" strokeWidth="2"/>)}
            <path fill="none" stroke="#b73846" strokeWidth="2" d={points.filter((p) => p.value===null && Number.isFinite(p.time) && p.time>=first && p.time<=last).map((p) => `M${xy({...p,value:low}).x},208v6`).join(" ")}/>
            {focus?.value != null && Number.isFinite(focus.time) && <circle cx={xy(focus).x} cy={xy(focus).y} r="5" fill="#fff" stroke="#125cc7" strokeWidth="2"/>}

            <text x="55" y="233">{(range?.[0] ?? valid.find((p) => p.time===first)?.timestamp)?.replace("T"," ")}</text><text x="845" y="233" textAnchor="end">{(range?.[1] ?? valid.find((p) => p.time===last)?.timestamp)?.replace("T"," ")}</text>
          </svg>
          <details className="chart-tools"><summary>Range, exact readings &amp; chart evidence</summary>          <label>Compare compatible series<select aria-label="Compare compatible series" value={comparison} onChange={e=>setComparison(e.target.value)}><option value="">No comparison</option>{numeric.filter(c=>c.source_column!==field&&compatibleComparison(selected,c)).map(c=><option key={c.source_column} value={c.source_column}>{c.target_field.replaceAll('_',' ')} ({c.measurement_unit})</option>)}</select></label>          <div className="chart-navigation"><button type="button" disabled={!range} onClick={() => moveRange("left")}>Pan earlier</button><button type="button" disabled={!range} onClick={() => moveRange("zoom")}>Zoom in</button><button type="button" disabled={!range} onClick={() => moveRange("right")}>Pan later</button><button type="button" onClick={() => { setStart(""); setEnd(""); }}>Reset range</button></div>
          <p className="chart-summary"><strong>{selected.target_field.replaceAll("_"," ")} ({chartUnit})</strong><span>{range ? range.map((value) => value.replace("T"," ")).join(" to ") : "Plotted interval unavailable"}</span><span>Observed interval: {chartData?.chart?.observed_cadence?.most_common_seconds != null ? `${chartData.chart.observed_cadence.most_common_seconds} seconds (most common)` : "not established"}</span></p>
          <details className="chart-details"><summary>Chart Details</summary>          <p className="chart-coverage"><strong>Plotted range:</strong> {range ? range.join(" to ") : "Not established"}<br/><strong>Source coverage:</strong> {chartData?.chart?.source_time_range?.join(" to ") ?? "Not established"}<br/>{chartData?.chart?.sampling ?? "Sampling strategy not reported by this server"}. {chartData?.chart?.source_count != null ? `${chartData.chart.source_count} selected source rows; ` : ""}{points.length} displayed points. {chartData?.chart?.observed_cadence?.most_common_seconds != null && `Most common observed interval: ${chartData.chart.observed_cadence.most_common_seconds} seconds. Filename is not a cadence contract.`}</p>
          <p className="import-chart-key">Blue: numeric readings. Amber: quality flags. Red ticks below the axis: sampled excluded timestamps.</p>
<p>{chartData?.chart?.scope}. {points.length} displayed points. Decimal values are approximated for plotting. {chartData?.chart?.downsampled && "Full range is downsampled with extrema retained; gapped buckets are disconnected."}</p></details>
          {comparisonData&&<label className="point-inspector">Inspect series<select aria-label="Inspect series" value={inspectSeries} onChange={event=>{setInspectSeries(event.target.value);setFocus(null);setInspectRow('');}}><option value="primary">{selected?.target_field.replaceAll('_',' ')}</option><option value="comparison">{numeric.find(c=>c.source_column===comparison)?.target_field.replaceAll('_',' ')}</option></select></label>}
          <label className="point-inspector">Inspect reading<input aria-label="Inspect chart reading" type="number" min="1" placeholder="Source row number" value={inspectRow} onChange={(e) => { setInspectRow(e.target.value); setFocus(inspectedPoints.find((p) => p.source_row===Number(e.target.value)) ?? null); }}/></label>
          {inspectRow && !focus && Number(inspectRow)>0 && <p>That row is not in the displayed sample. <button type="button" onClick={() => goToSource(Number(inspectRow),field)}>Open source row</button></p>}
          {focus && <output>{focus.timestamp ?? "Timestamp unavailable"} | {focus.value_text ?? focus.value ?? "Excluded"}{focus.value_text_truncated?'… (truncated; inspect source)':''} {chartUnit} | row {focus.source_row} {focus.flags.join(", ")} <button type="button" onClick={() => { goToSource(focus.source_row, focus.source_field??field); }}>Inspect source row</button></output>}
          {chartData?.chart?.truncated && <p role="status" className="chart-exclusions">This chart is truncated. Narrow the range; full source coverage is not verified.</p>}
          {!!chartData?.chart?.excluded_count && <p className="chart-exclusions">{chartData.chart.excluded_count} excluded readings; gaps remain visible. See Chart Details for sampling and provenance.</p>}</details>


        </> : !chartLoading && <div className="chart-empty">{!validation ? "Validated readings will appear after mapping and quality checks finish." : "No reliable chart is available for this selection. Choose a mapped measurement with verified units and at least two valid timestamps."}</div>}
      </section>
    <GuidedIssues key={`${workspaceId}:${version}:${validation?.validation_run_id}`} workspaceId={workspaceId} dataset={dataset} version={version} runId={validation?.validation_run_id??''} diagnoses={diagnoses as DiagnosisRecord[]} fields={columns} onRecords={inspectDiagnosis} onSource={goToSource} onMapping={reviewScale} onView={openView}/>

    <button type="button" id="open-registration" hidden onClick={()=>{setEvidencePage('Registration');setEvidenceOpen(true);}}>Open registration</button>
    <EvidenceDialog open={evidenceOpen} onClose={()=>{setEvidenceOpen(false);setPreviewOpen(false);setMappingOpen(false);}}>
      {pendingScale && <div className="scientific-decision" role="note" aria-label="Power-factor unit interpretation"><div><strong>Power-factor scale unresolved</strong><p>Source label and values are retained. No percentage/ratio conversion is applied while interpretation is unresolved. Confirm meter documentation before power-factor analysis.</p></div></div>}
      <nav className="evidence-navigation" aria-label="Additional dataset evidence">
        <button type="button" onClick={()=>{setEvidencePage('Data');setPreviewOpen(true);setTab('Data Explorer');}}>Original &amp; normalized data</button>
        <button type="button" onClick={()=>{setEvidencePage('Source');setMappingOpen(false);}}>Source &amp; metadata</button>
        <button type="button" onClick={()=>{setEvidencePage('Extra');setMappingOpen(false);}}>Measurements &amp; associations</button>
        <button type="button" onClick={()=>setEvidencePage('Registration')}>Registration &amp; approval</button>
      </nav>
      <div hidden={evidencePage!=='Source'}>    <details className="import-source-column intelligent-card" aria-label="Source and metadata"><summary>Dataset summary &amp; source identity</summary>
      <section className="intelligent-card detected-source"><header><h2>Detected Data Source</h2></header><div className="source-summary"><span aria-hidden="true">&#9678;</span><div><strong>{numeric.length ? "Mapped measurement data" : "Tabular source"}</strong><p>{numeric.length} numeric measurements / {columns.length} source fields</p></div></div><p className="source-identity">Instrument and plant identity unverified.</p><ul className="source-categories">{[
        {label:"Power measurements",fields:numeric.filter((c) => /power/.test(c.target_field) && c.target_field!=="power_factor")},
        {label:"Energy measurements",fields:numeric.filter((c) => /energy|consumption/.test(c.target_field))},
        {label:"Frequency and power factor",fields:numeric.filter((c) => ["frequency","power_factor"].includes(c.target_field))},
        {label:"Other numeric measurements",fields:numeric.filter((c) => !/power|energy|consumption/.test(c.target_field) && c.target_field!=="frequency")}
      ].filter((group) => group.fields.length).map((group) => <li key={group.label}><span>{group.label}</span><strong>{group.fields.length}</strong></li>)}</ul><details className="source-evidence"><summary>Recognition evidence and measurements</summary><p>Category based on saved field mappings. No physical instrument is inferred from the filename.</p><p>Format: {(intelligence?.filename ?? source?.original_name)?.split(".").pop()?.toUpperCase() ?? "Not reported"}</p><p>Schema fingerprint: {intelligence?.recognition?.schema_fingerprint ?? "Awaiting server evidence"}</p><ul className="source-characteristics">{numeric.map((c) => <li key={c.source_column}>{c.target_field.replaceAll("_"," ")} <span>{c.target_field==="power_factor" && c.value_scale ? "ratio" : c.measurement_unit ?? "Unit unknown"}</span></li>)}</ul></details></section>
      <section className="intelligent-card dataset-metadata"><header><h2>Dataset Summary</h2></header><dl><dt>Records</dt><dd>{datasetRows??validation?.row_count??"Not established"}</dd><dt>Source coverage</dt><dd>{chartData?.chart?.source_time_range?.join(" to ") ?? "Not established"}</dd><dt>Observed interval</dt><dd>{chartData?.chart?.observed_cadence?.most_common_seconds != null ? `${chartData.chart.observed_cadence.most_common_seconds} seconds (most common)` : "Not established"}</dd><dt>Source columns</dt><dd>{columns.length || "Awaiting source"}</dd><dt>File</dt><dd>{intelligence?.filename ?? source?.original_name ?? "Loading source identity"}</dd><dt>Version identity</dt><dd>{version}</dd></dl></section>
    </details>
</div>
      <div hidden={evidencePage!=='Extra'}>
      {validation&&<details className="numeric-summaries" onToggle={event=>setSummariesOpen(event.currentTarget.open)}><summary>Latest measurement values</summary>{summariesOpen&&<MeasurementCards key={`${workspaceId}:${dataset}:${version}:${mapping?.mapping_revision_id}:${validation?.validation_run_id}`} workspaceId={workspaceId} dataset={dataset} version={version} fields={numeric} selected={field} onSelect={value=>{setField(value);setOffset(0);}}/>}</details>}
      <details><summary>Review equipment association (preview only)</summary><AssociationPreview key={`${workspaceId}:${dataset}:${version}:${mapping?.mapping_revision_id}:${validation?.validation_run_id}`} workspaceId={workspaceId} dataset={dataset} version={version} columns={columns}/></details>

</div>
      <div hidden={evidencePage!=='Data'}>      <details className="intelligent-card explorer-card technical-disclosure" open={previewOpen} onToggle={event=>setPreviewOpen(event.currentTarget.open)}><summary onClick={event=>{event.preventDefault();setPreviewOpen(open=>!open);}}>Data preview &amp; technical details</summary>
        <div hidden={!previewOpen}>
        <div role="tablist" aria-label="Dataset views" className="explorer-tabs">{tabs.map((name) => <button type="button" role="tab" aria-selected={tab === name} aria-controls={`view-${name.replaceAll(" ","-")}`} id={`tab-${name.replaceAll(" ","-")}`} tabIndex={tab===name ? 0 : -1} onKeyDown={(e) => { const index=tabs.indexOf(name); const next=e.key==="ArrowRight" ? (index+1)%tabs.length : e.key==="ArrowLeft" ? (index+tabs.length-1)%tabs.length : e.key==="Home" ? 0 : e.key==="End" ? tabs.length-1 : -1; if(next>=0) { e.preventDefault(); setTab(tabs[next]); document.getElementById(`tab-${tabs[next].replaceAll(" ","-")}`)?.focus(); } }} key={name} onClick={() => {setPreviewOpen(true);setTab(name);if(name==="Mapping")setMappingOpen(true);}}>{name}</button>)}</div>
        <div role="tabpanel" id={`view-${tab.replaceAll(" ","-")}`} aria-labelledby={`tab-${tab.replaceAll(" ","-")}`}>
        {tab==='Data Explorer'&&<a className="selection-export" download href={api.selectionExportUrl(workspaceId,dataset,version,{offset,limit:25,search:query,field:field||undefined,start:start||undefined,end:end||undefined,quality:quality||undefined,sort,source_row:sourceRow?Number(sourceRow):undefined})}>Export current table selection (JSON)</a>}
        {tab === "Data Explorer" && <><div className="data-explorer-toolbar"><div className="source-toggle"><button type="button" aria-pressed={!normalized} onClick={() => setNormalized(false)}>Original Data</button><button type="button" aria-pressed={normalized} disabled={!data?.items} onClick={() => setNormalized(true)}>Normalized Data</button></div><label><span className="sr-only">Search in data</span><input aria-label="Search in data" placeholder="Search in data..." value={search} onChange={(e) => setSearch(e.target.value)} /></label><details className="column-selector"><summary>Columns</summary>{columns.map((c) => <label key={c}><input type="checkbox" checked={!hidden.includes(c)} onChange={() => setHidden((h) => h.includes(c) ? h.filter((x) => x!==c) : [...h,c])}/>{c}</label>)}</details></div>
        <div className="data-filters"><label>Quality<select aria-label="Filter data quality" value={quality} onChange={(e) => { setQuality(e.target.value); setOffset(0); }}>{["","valid","invalid","warning","missing","unresolved","unmapped"].map((q) => <option key={q} value={q}>{q || "All conditions"}</option>)}</select></label><label>Order<select aria-label="Sort data" value={sort} onChange={(e) => { setSort(e.target.value); setOffset(0); }}><option value="source">Source order</option><option value="source_desc">Source order, newest row first</option><option value="value_asc" disabled={!field}>Selected measurement, ascending</option><option value="value_desc" disabled={!field}>Selected measurement, descending</option></select></label><label>Source row<input aria-label="Go to source row" type="number" min="1" value={sourceRow} onChange={(e) => { setSourceRow(e.target.value); setOffset(0); }}/></label>{sourceRow && <button type="button" onClick={() => setSourceRow("")}>Clear row filter</button>}</div>
        <div className="intelligent-table-scroll"><table aria-label="Record preview" className="intelligent-table"><thead><tr><th scope="col">#</th>{visible.map((c) => <th scope="col" key={c}>{c}{normalized && <small>{items[0]?.normalized?.[c]?.unit ?? ""}</small>}</th>)}{data?.items && <th scope="col">Status</th>}</tr></thead><tbody>{items.map((item) => <tr key={item.source_row}><th scope="row">{item.source_row}</th>{visible.map((c) => { const cell=item.normalized?.[c]; return <td key={c} title={show(normalized ? cell?.value : item.original_literals?.[c] ?? item.original?.[c])} className={cell?.status === "invalid" ? "cell-invalid" : cell?.status === "missing" ? "cell-missing" : ""}>{show(normalized ? cell?.value : item.original_literals?.[c] ?? item.original?.[c])}{normalized && cell?.status !== "valid" && <small>{cell?.status}</small>}{(normalized ? cell?.display_truncated : item.original_truncated?.includes(c)) && <small>Display shortened; complete original is preserved.</small>}</td>; })}{data?.items && <td><span className={`quality-pill ${item.status}`}>{item.status}</span></td>}</tr>)}</tbody></table></div>
        {loading && <p role="status">Loading table rows...</p>}
        {!data?.items && fallbackAllowed && items.length>0 && <p>Original upload preview; server explorer results are not yet available.</p>}
        {!items.length && !loading && !problem && Array.isArray(data?.items) && <p>No rows match this selection.</p>}
        {data?.total !== undefined && <div className="explorer-pagination"><button type="button" disabled={offset===0 || loading} onClick={() => setOffset(Math.max(0,offset-25))}>Previous</button><span>{data.total ? `${offset+1}-${Math.min(offset+25,data.total)} of ${data.total.toLocaleString()}` : "0"} source rows</span><button type="button" disabled={offset+25>=data.total || loading} onClick={() => setOffset(offset+25)}>Next</button></div>}</>}
        {tab === "Mapping" && <div><p>Smart Field Mapping remains available alongside the preview.</p><button type="button" onClick={() => { setMappingOpen(true);const panel=document.getElementById("smart-field-mapping");panel?.scrollIntoView?.({block:"nearest"});panel?.focus(); }}>Go to field mapping</button></div>}
        {tab === "Provenance" && <><p><a href={api.originalSourceUrl(workspaceId,dataset,version)} download>Download preserved original source</a></p><dl className="intelligent-provenance"><dt>Original file</dt><dd>{intelligence?.filename ?? source?.original_name ?? "Not reported"}</dd><dt>Source checksum</dt><dd>{data?.provenance?.source_sha256 ?? source?.sha256 ?? "Unavailable"}</dd><dt>Schema fingerprint</dt><dd>{intelligence?.recognition?.schema_fingerprint ?? "Unavailable"}</dd><dt>Schema comparison</dt><dd>{intelligence?.schema_changed == null ? "No earlier approved version" : intelligence?.schema_changed ? "Changed since the earlier approved version" : "Same headers as the earlier approved version"}</dd><dt>Timestamp convention</dt><dd>Source timezone is retained. Naive timestamps are not assigned a timezone.</dd></dl></>}
        {tab === "Transformations" && <><h3>Reproducible normalization</h3><p>Derived from the original source and saved mapping. Missing and invalid values remain explicit. No interpolation, unit guessing, or source correction is performed.</p><dl className="intelligent-provenance"><dt>Rule version</dt><dd>{intelligence?.normalization?.rule_version ?? "Unavailable"}</dd><dt>Mapping revision</dt><dd>{mapping?.mapping_revision_id ?? "Not saved"}</dd></dl><div className="intelligent-table-scroll"><table className="intelligent-table"><thead><tr><th>Source row</th><th>Field</th><th>Input</th><th>Output</th><th>Rules / status</th></tr></thead><tbody>{(data?.items ?? []).flatMap((row: Obj) => Object.entries(row.normalized ?? {}).filter(([,c]) => (c as Obj).rules?.length || (c as Obj).status !== "valid").map(([name,c]) => <tr key={`${row.source_row}:${name}`}><td>{row.source_row}</td><th>{name}</th><td>{show(row.original_literals?.[name] ?? row.original[name])}</td><td>{show((c as Obj).value)}</td><td>{(c as Obj).rules.join(", ")}{(c as Obj).parameters && ` (${(c as Obj).parameters.source_unit} to ${(c as Obj).parameters.output_unit}; factor ${(c as Obj).parameters.factor})`} | {(c as Obj).status}</td></tr>))}</tbody></table></div></>}
        {tab === "Processing Log" && <ProcessingLog workspaceId={workspaceId} jobId={jobId}/>}
        {tab === "Advanced Findings" && findingsPanel}
        </div>
        </div>
      </details>
    <div className="intelligent-side"><section className="intelligent-card mapping-summary"><header><h2>Measurement Mapping</h2><span className="evidence-badge">{mapping?.columns?.length??0} / {columns.length} saved</span></header><p>{pendingScale?'Scientific interpretation requires review. Saved mappings are not blanket approval.':'Saved mapping revisions preserve source units and evidence. Registration requires separate approval.'}</p><details id="mapping-review" className="mapping-dashboard technical-disclosure" open={mappingOpen} onToggle={event=>setMappingOpen(event.currentTarget.open)}><summary onClick={event=>{event.preventDefault();setMappingOpen(open=>!open);}}>Review measurement mappings</summary><div hidden={!mappingOpen}>{mappingPanel}</div></details></section>

    </div>
</div>
      <div hidden={evidencePage!=='Registration'}>          <section id="dataset-registration" className="intelligent-card registration-card"><header><h2><span aria-hidden="true">&#128274;</span> Dataset Registration</h2></header><p>{validation ? `${Number(validation.error_count ?? 0).toLocaleString()} errors / ${Number(validation.warning_count ?? 0).toLocaleString()} warnings / ${validation.affected_record_count == null ? "affected-record count unavailable" : `${validation.affected_record_count} distinct affected records`}. ` : "Validation not run. "}{approval?.state === "approved" ? "The review decision is recorded. Original source data remains preserved." : "Registration requires scientific checks and explicit approval."}</p><div className="registration-next">{intelligence?.eligibility?.primary_action === "inspect_integrity" && <button type="button" className="primary-button" onClick={() => { onInspect({severity:"error"});setEvidencePage("Data"); setPreviewOpen(true);setTab("Advanced Findings"); }}>Review blocking findings</button>}{registrationPanel}</div><details className="registration-policy"><summary>Approval workflow</summary><div className="registration-stages"><span className={validation ? "complete" : ""}>Processing<br/>{validation ? "Completed" : "Pending"}</span><span className={pendingScale ? "current" : "complete"}>Confirm interpretation<br/>{pendingScale ? "Decision required" : "No open scale decision"}</span><span className={approval?.state === "approved" ? "complete" : ""}>Approve & Register<br/>{approval?.state ?? "Explicit approval required"}</span></div></details></section>
</div>
    </EvidenceDialog>
  </div>;
}
