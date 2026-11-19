import type { DiagnosisRecord } from "../../api/importTypes";
type Obj = Record<string, any>;

/** A bounded overview. Complete evidence remains in the findings browser. */
export default function DiagnosisOverview({ diagnoses, onInspect, onSource }: {
  diagnoses: DiagnosisRecord[];
  onInspect: (diagnosis: DiagnosisRecord) => void;
  onSource: (row: number, field?: string) => void;
}) {
  const material=diagnoses.filter((d) => d.category!=="interpretation").slice(0,3);
  return (<div className="diagnosis-overview">{material.map((d) => <article key={d.diagnosis_id ?? `${d.field}:${d.diagnosis_code}`} className={`diagnosis-item ${d.blocks_registration ? "blocking" : "nonblocking"}`}><div className="diagnosis-title"><h3>{d.title}</h3><span className={`quality-pill ${d.blocks_registration ? "invalid" : "warning"}`}>{d.impact?.replaceAll("_"," ") ?? (d.blocks_registration ? "Review required" : "Nonblocking")}</span></div><p>{d.distinct_affected_rows} distinct records | {d.fields?.length ?? (d.field ? 1 : 0)} fields | {d.finding_count} findings</p><p>{d.explanation}</p><small>{d.handling_explanation}</small><details><summary>Evidence, fields and next action</summary><ul>{(d.fields ?? []).map((f: Obj) => <li key={f.field}>{f.field}: {f.distinct_affected_rows} records ({f.required ? "required" : "optional"})</li>)}</ul><p>{d.supported_explanation}</p><p>{d.unverified_hypothesis}</p><p>Rules: {(d.supporting_rules ?? [d.diagnosis_code]).join(", ")}</p><ul>{(d.examples ?? []).map((e: Obj,i:number) => <li key={i}>Source row {e.row ?? "not row-specific"}: {e.field} = {e.observed_value_preview ?? "not supplied"}{e.representation_note && <small>{e.representation_note}</small>}<button type="button" onClick={() => { if(e.row) { onSource(e.row, e.field); } else onInspect(d); }}>Inspect source</button></li>)}</ul><p>{d.researcher_action}</p></details><button type="button" onClick={() => onInspect(d)}>Inspect rows</button></article>)}</div>);
}
