import { useState } from "react";
import type { Inspection } from "./panelTypes";

export const temperatureMetrics = [
  ["module_temperature", "Module temperature"],
  ["ambient_temperature", "Ambient temperature"],
  ["reference_temperature", "Reference temperature"],
  ["delta_t", "Temperature difference (ΔT)"],
] as const;

function reading(visit: Inspection, metric: string) {
  const rows = visit.measurements.filter((item) => item.observation_type === metric);
  if (rows.length > 1) return "Multiple readings · see visit record";
  const item = rows[0];
  if (item?.data_quality === "invalid") return "Invalid · see visit record";
  if (item?.value == null) return "Not measured";
  return `${item.value} ${item.unit ?? "(unit unrecorded)"}`;
}

const readingLabels: Record<string, string> = {
  module_surface_temperature: "Panel temperature",
  ambient_temperature: "Air temperature",
  hotspot_temperature: "Hotspot temperature",
};

export function VisitMeasurements({ visit, compact = false }: { visit: Inspection; compact?: boolean }) {
  return <div className="pi-table-scroll"><table>
    <caption className="sr-only">Readings for visit {visit.inspection_id}</caption>
    <thead><tr><th scope="col">Reading</th><th scope="col">Value</th>{!compact && <th scope="col">Quality and provenance</th>}</tr></thead>
    <tbody>{visit.measurements.map((item, index) => <tr key={index}>
      <th scope="row">{readingLabels[item.observation_type] ?? temperatureMetrics.find(([name]) => name === item.observation_type)?.[1] ?? item.observation_type}</th>
      <td>{item.value == null ? "Not measured" : `${item.value} ${item.unit === "degC" ? "°C" : item.unit ?? "(unit unrecorded)"}`}
        {compact && item.data_quality === "invalid" && " · Invalid"}</td>
      {!compact && <td>{item.data_quality} · {item.source_reference ?? visit.data_source ?? "Source unrecorded"}
        {item.recorded_at && <div>Recorded {item.recorded_at}</div>}
        {item.measurement_status && <div>CSV status · {item.measurement_status}</div>}
        {item.finding && <div>{item.finding}</div>}</td>}
    </tr>)}</tbody>
  </table></div>;
}

export default function InspectionComparison({ inspections }: { inspections: Inspection[] }) {
  const [first, setFirst] = useState(inspections[inspections.length - 1].inspection_id);
  const [second, setSecond] = useState(inspections[0].inspection_id);
  const a = inspections.find((item) => item.inspection_id === first);
  const b = inspections.find((item) => item.inspection_id === second);
  const options = inspections.map((item) => <option key={item.inspection_id} value={item.inspection_id}>
    {item.inspected_at} · Visit {item.inspection_id}</option>);

  return <section className="pi-compare" aria-label="Compare two inspections">
    <h4>Compare two inspections</h4>
    <div className="pi-compare-controls">
      <label>First inspection <select value={first} onChange={(event) => setFirst(Number(event.target.value))}>{options}</select></label>
      <label>Second inspection <select value={second} onChange={(event) => setSecond(Number(event.target.value))}>{options}</select></label>
    </div>
    {first === second ? <p role="status">Choose two different inspections.</p> : a && b && <div className="pi-table-scroll">
      <table>
        <thead><tr><th scope="col">Reading</th><th scope="col">{a.inspected_at}</th><th scope="col">{b.inspected_at}</th></tr></thead>
        <tbody>
          <tr><th scope="row">Origin</th><td>{a.data_origin}</td><td>{b.data_origin}</td></tr>
          <tr><th scope="row">Source</th><td>{a.data_source ?? "Unrecorded"}</td><td>{b.data_source ?? "Unrecorded"}</td></tr>
          {temperatureMetrics.map(([metric, label]) => <tr key={metric}>
            <th scope="row">{label}</th><td>{reading(a, metric)}</td><td>{reading(b, metric)}</td>
          </tr>)}
        </tbody>
      </table>
    </div>}
  </section>;
}
