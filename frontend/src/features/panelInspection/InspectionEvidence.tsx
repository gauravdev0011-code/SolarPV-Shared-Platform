import { useEffect, useId, useState } from "react";
import { apiDownloadUrl } from "../../api/client";
import { demoLabel, type Inspection } from "./panelTypes";

export function measurement(visit: Inspection, kind: string) {
  const valid = visit.measurements.filter((item) => item.observation_type === kind
    && item.data_quality !== "invalid" && item.value != null
    && ["°C", "C", "degC"].includes(item.unit ?? ""));
  return valid.length === 1 ? valid[0].value : null;
}

export function formatTemperature(value: number | null) {
  return value === null ? "Not measured" : `${value} °C`;
}

function Simulation({ thermal }: { thermal: boolean }) {
  const gradient = useId();
  return <svg viewBox="0 0 360 165" role="img" aria-label={thermal ? "Simulated thermal illustration" : "Simulated RGB illustration"}>
    <defs><linearGradient id={gradient} x2="1" y2="1">
      <stop offset="0" stopColor={thermal ? "#29125f" : "#8ba374"} />
      <stop offset="1" stopColor={thermal ? "#801783" : "#3a5837"} />
    </linearGradient></defs>
    <rect width="360" height="165" fill={`url(#${gradient})`} />
    <g transform="translate(28 24) skewX(-12) rotate(6)" stroke={thermal ? "#ff9e5e" : "#cadcf2"} strokeWidth="0.65">
      {Array.from({ length: 96 }, (_, index) => {
        const row = Math.floor(index / 16), column = index % 16;
        const colors = thermal ? ["#30206f", "#742685", "#b52b7a", "#de4b73", "#f57458", "#ffad55"]
          : ["#153d66", "#22537d", "#244873", "#27577e"];
        return <rect key={index} x={column * 21} y={row * 22} width="21" height="22"
          fill={colors[(column * 3 + row * 2 + Math.floor(column / 4)) % colors.length]} />;
      })}
    </g>
  </svg>;
}

function PhotographPreview({ file }: { file: Inspection["attachments"][number] }) {
  const [url, setUrl] = useState("");
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    let preview = "";
    fetch(apiDownloadUrl(file.path), { signal: controller.signal }).then(async (response) => {
      if (!response.ok) throw new Error("Image unavailable.");
      const blob = await response.blob();
      if (controller.signal.aborted) return;
      preview = URL.createObjectURL(new Blob([blob], { type: file.media_type }));
      setUrl(preview);
    }).catch(() => { if (!controller.signal.aborted) setFailed(true); });
    return () => {
      controller.abort();
      if (preview) URL.revokeObjectURL(preview);
    };
  }, [file]);
  if (failed) return <p role="alert">The image preview could not be loaded.</p>;
  return url ? <img src={url} alt={file.original_name} /> : <p role="status">Loading image…</p>;
}

export function EvidenceImages({ visit }: { visit: Inspection | undefined }) {
  const [expanded, setExpanded] = useState<"RGB" | "Thermal" | null>(null);
  const [photograph, setPhotograph] = useState<Inspection["attachments"][number]>();
  const simulated = visit?.data_origin === "synthetic" && visit.data_source?.includes(demoLabel) &&
    visit.attachments.length === 0;
  return <>
    <div className="pi-images">
      {(["RGB", "Thermal"] as const).map((image) => simulated
        ? <button key={image} type="button" aria-label={`Simulated ${image}`} onClick={() => setExpanded(image)} className="pi-image">
            <Simulation thermal={image === "Thermal"} />
            <span>Simulated {image} <b aria-hidden="true">↗</b></span>
          </button>
        : null)}
    </div>
    {simulated && <small className="pi-source">{demoLabel} · Illustrations have no radiometric scale.</small>}
    {visit?.attachments.length ? <div className="pi-attachments"><strong>Visit attachments</strong>
      {visit.attachments.map((file) => <div key={file.path}>
        <a href={apiDownloadUrl(file.path)}>{file.original_name}</a>{" "}
        {file.kind && <small>{file.kind.toUpperCase()} · </small>}
        {["image/png", "image/jpeg"].includes(file.media_type) &&
          <button type="button" onClick={() => setPhotograph(file)}>Preview</button>}
      </div>)}
    </div> : !simulated && <p>No images uploaded.</p>}
    {photograph && <dialog ref={(element) => { if (element && !element.open) element.showModal(); }}
      onClose={() => setPhotograph(undefined)} className="pi-image-dialog">
      <header><strong>{photograph.original_name}</strong><form method="dialog"><button type="submit">Close</button></form></header>
      <PhotographPreview file={photograph} />
    </dialog>}
    {expanded && simulated && <dialog ref={(element) => { if (element && !element.open) element.showModal(); }}
      onClose={() => setExpanded(null)} className="pi-image-dialog">
      <header><strong>Simulated {expanded}</strong><form method="dialog"><button type="submit">Close</button></form></header>
      <Simulation thermal={expanded === "Thermal"} /><p>{demoLabel}</p>
    </dialog>}
  </>;
}

export function TemperatureTrend({ inspections }: { inspections: Inspection[] }) {
  const chronological = [...inspections].reverse();
  const measured = chronological.map((visit) => measurement(visit, "module_temperature"));
  const values = measured.filter((value): value is number => value !== null);
  if (!values.length) return <p>Not measured</p>;
  const dates = chronological.map((visit) => {
    const time = visit.inspected_at.replace(" ", "T");
    return Date.parse(time.length > 10 && !/(Z|[+-]\d{2}:\d{2})$/.test(time) ? time + "Z" : time);
  });
  const start = dates[0], duration = dates[dates.length - 1] - start;
  const x = (index: number) => duration > 0 ? 52 + 316 * (dates[index] - start) / duration : 210;
  const min = Math.floor(Math.min(...values)) - 1, max = Math.ceil(Math.max(...values)) + 1;
  const y = (value: number) => 99 - (value - min) * 78 / (max - min);
  return <svg className="pi-trend" viewBox="0 0 390 128" role="img" aria-label="Module temperatures by inspection date. The inspection table lists exact values.">
    {[min, (min + max) / 2, max].map((value) => <g key={value}>
      <line x1="49" x2="371" y1={y(value)} y2={y(value)} />
      <text x="4" y={y(value) + 4}>{value} °C</text>
    </g>)}
    {measured.map((value, index) => {
      const prior = measured[index - 1];
      return <g key={chronological[index].inspection_id}>
        {value !== null && index > 0 && prior !== null && <path d={`M${x(index - 1)},${y(prior)} L${x(index)},${y(value)}`} />}
        {value !== null && <circle cx={x(index)} cy={y(value)} r="4"><title>{chronological[index].inspected_at}: {formatTemperature(value)}</title></circle>}
        {(index === 0 || index === measured.length - 1) && <text x={x(index)} y="120" textAnchor="middle">{chronological[index].inspected_at.slice(5, 10)}</text>}
      </g>;
    })}
  </svg>;
}
