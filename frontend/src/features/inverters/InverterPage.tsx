import { useEffect, useState } from "react";
import { requestJson } from "../../api/client";
import { api } from "../../api/solaris";
import type { LiveInspectionRecord, MaintenanceRecord } from "../../api/types";
import { VisitEditor, VisitEvidence } from "../live/VisitWorkspace";
import PanelNotes from "../panelInspection/PanelNotes";
import "../panelInspection/panelInspection.css";
import "./inverters.css";

type Inverter = {
  asset_id: number; device: string; manufacturer: string; model: string; serial_number: string | null;
  ac_capacity_kw: number; dc_capacity_kw: number; configured_efficiency_percent: number;
  logger_uid: string; comm_id: number; protocol: string; port: number; polling_interval: number;
  polling_unit: string | null; tag_mapping: string; tag_offset: number; monitored: boolean; run_kpis: boolean;
  source_reference: string; imported_at: string; plan_label: string | null; evidence: string | null;
  confirmed_by: string | null; confirmed_at: string | null;
};
type Inventory = { items: Inverter[]; plan_source: string; markers: { label: string; x: number; y: number; proposed_device: string }[] };

function Facts({ rows }: { rows: [string, string | number][] }) {
  return <dl className="pi-facts">{rows.map(([name, value]) => <div key={name}>
    <dt>{name}</dt><dd>{value}</dd>
  </div>)}</dl>;
}

function History({ workspace, asset, base }: { workspace: string; asset: number; base: string }) {
  const [visits, setVisits] = useState<LiveInspectionRecord[]>([]);
  const [maintenance, setMaintenance] = useState<MaintenanceRecord[]>([]);
  const [visit, setVisit] = useState<number>();
  const [action, setAction] = useState<"capture" | "correct">();
  const [refresh, setRefresh] = useState(0);
  const [offset, setOffset] = useState(0);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const request = new AbortController();
    setLoading(true);
    setError("");
    Promise.all([api.assetInspections(workspace, asset, request.signal, offset),
      requestJson<MaintenanceRecord[]>(base + "/maintenance", { signal: request.signal })])
      .then(([history, records]) => {
        if (request.signal.aborted) return;
        setVisits(history.items);
        setTotal(history.total);
        setMaintenance(records);
        setLoading(false);
      }).catch((failure: Error) => {
        if (!request.signal.aborted) { setError(failure.message); setLoading(false); }
      });
    return () => request.abort();
  }, [workspace, asset, base, refresh, offset]);

  const saved = (id: number) => { setVisit(id); setOffset(0); setRefresh((value) => value + 1); };
  return <>
    {error && <p role="alert">{error} <button onClick={() => setRefresh((value) => value + 1)}>Retry</button></p>}
    {loading && <p role="status">Loading history…</p>}
    <h4>Inspections, measurements and files</h4>
    {!loading && !error && visits.length === 0 && <p>No inspections recorded.</p>}
    {visits.length > 0 && <label className="pi-visit">Inspection <select value={visit ?? ""} onChange={(event) => {
      setVisit(Number(event.target.value) || undefined); setAction(undefined);
    }}>
      <option value="">Choose an inspection</option>
      {visits.map((item) => <option key={item.inspection_id} value={item.inspection_id}>
        {item.inspected_at} · {item.data_origin}
      </option>)}
    </select></label>}
    {total > 50 && <div className="pi-actions">
      <button disabled={offset === 0} onClick={() => { setVisit(undefined); setAction(undefined); setOffset(offset - 50); }}>Previous</button>
      <button disabled={offset + 50 >= total} onClick={() => { setVisit(undefined); setAction(undefined); setOffset(offset + 50); }}>Next</button>
    </div>}
    <div className="pi-actions">
      <button type="button" onClick={() => setAction(action === "capture" ? undefined : "capture")}>
        {action === "capture" ? "Close form" : "Record inspection"}
      </button>
      {visit !== undefined && <button type="button" onClick={() => setAction(action === "correct" ? undefined : "correct")}>
        {action === "correct" ? "Close correction" : "Correct visit"}
      </button>}
    </div>
    {action && <div className="asset-registration pi-capture">
      <VisitEditor key={`${action}:${action === "correct" ? visit : asset}`} asset={asset} workspaceId={workspace}
        captureOnly correctionVisit={action === "correct" ? visit : undefined} onSaved={saved} />
    </div>}
    {visit !== undefined && <VisitEvidence key={`${visit}:${refresh}`} id={visit} workspaceId={workspace} />}
    <h4>Maintenance</h4>
    {!loading && !error && !maintenance.length && <p>No maintenance records.</p>}
    {maintenance.map((record) => <article className="pi-record" key={record.maintenance_id}>
      <strong>{record.maintenance_type}</strong> · {record.performed_at ?? "Date unavailable"}
      <p>{record.description}</p><small>{record.data_origin}</small>
    </article>)}
  </>;
}

const bands = [150, 310, 470, 630].flatMap((y) => [[250, y, 600], [1000, y, 550]]);

export function useInverterInventory(workspace: string) {
  const base = `/workspaces/${encodeURIComponent(workspace)}/inverters`;
  const [response, setResponse] = useState<{ workspace: string; data?: Inventory; error?: string }>();
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!workspace) return;
    const request = new AbortController();
    requestJson<Inventory>(base, { signal: request.signal }).then((inventory) => {
      if (!request.signal.aborted) setResponse({ workspace, data: inventory });
    }).catch((failure: Error) => {
      if (!request.signal.aborted) setResponse({ workspace, error: failure.message });
    });
    return () => request.abort();
  }, [base, workspace, attempt]);
  return { base, workspace, data: response?.workspace === workspace ? response.data : undefined,
    error: response?.workspace === workspace ? response.error : undefined,
    retry: () => { setResponse(undefined); setAttempt((value) => value + 1); } };
}

export default function InverterPage({ workspace }: { workspace: string }) {
  const inventory = useInverterInventory(workspace);
  return <InverterView key={workspace} inventory={inventory} />;
}

export function InverterView({ inventory, readOnly = false }: {
  inventory: ReturnType<typeof useInverterInventory>; readOnly?: boolean;
}) {
  const { base, workspace, data, error, retry } = inventory;
  const [asset, setAsset] = useState<number | null>();
  const [marker, setMarker] = useState<string>();
  const [tab, setTab] = useState("Overview");
  const selected = asset === undefined && !marker ? data?.items[0] : data?.items.find((item) => item.asset_id === asset);
  const selectedMarker = data?.markers.find((item) => item.label === marker);
  return <div className="pi inverter-page">
    {!workspace && <p>Choose a live workspace to view imported inverter configuration.</p>}
    {error && <p role="alert">{error} <button type="button" onClick={retry}>Retry</button></p>}
    {workspace && !data && !error && <p role="status">Loading inverter configuration…</p>}
    {data && <div className="pi-workspace">
      <section className="pi-card">
        <header className="pi-card-header"><div><h2>Illustrative site schematic</h2><p>Drawing-relative positions</p></div></header>
        <div className="inverter-map">
          <svg viewBox="155 22 1780 740" aria-label="Illustrative site schematic inverter locations">
            {bands.map(([x, y, width]) => <rect key={`${x}:${y}`} x={x} y={y} width={width} height="38" className="inverter-band" />)}

            {data.markers.map((item) => <g key={item.label} role="button" tabIndex={0} aria-label={item.label}
              aria-pressed={marker === item.label} onClick={() => {
                setMarker(item.label); setAsset(data.items.find((inv) => inv.plan_label === item.label)?.asset_id); setTab("Overview");
              }} onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") { event.preventDefault();
                  setMarker(item.label); setAsset(data.items.find((inv) => inv.plan_label === item.label)?.asset_id); setTab("Overview");
                }
              }}>
              <circle cx={item.x} cy={item.y} r="18" />
              <text x={item.x + (item.label > "INV.04" ? -26 : 26)} y={item.y - 5}
                textAnchor={item.label > "INV.04" ? "end" : "start"}>{item.label}</text>
            </g>)}
          </svg>
        </div>
        <footer className="pi-layout-source">
          <span>{data.plan_source}</span>
          {selectedMarker && <strong>{selectedMarker.label} · {selected?.plan_label === selectedMarker.label
            ? `Confirmed as ${selected.device}` : `Proposed ${selectedMarker.proposed_device} · Unverified`}</strong>}
        </footer>
      </section>
      <section className="pi-card">
        <header className="pi-card-header"><div><h2>Monitoring configuration</h2><p>{data.items.length} imported records</p></div></header>
        <div className="pi-detail-body">
          {data.items.length === 0 && <p>No configuration has been imported into this workspace.</p>}
          {selectedMarker && !selected && data.items.some((item) => item.device === selectedMarker.proposed_device) &&
            <button type="button" onClick={() => setAsset(data.items.find((item) => item.device === selectedMarker.proposed_device)?.asset_id)}>
              View proposed configuration
            </button>}
          {data.items.length > 0 && <label className="pi-visit">Device <select value={selected?.asset_id ?? ""} onChange={(event) => {
            const id = Number(event.target.value);
            setAsset(id || null);
            setMarker(data.items.find((item) => item.asset_id === id)?.plan_label ?? undefined);
            setTab("Overview");
          }}>
            <option value="">Choose a configuration record</option>
            {data.items.map((item) => <option value={item.asset_id} key={item.asset_id}>{item.device}</option>)}
          </select></label>}
          {selected && <>
            <h3>{selected.device}</h3>
            <nav className="pi-tabs" aria-label="Inverter sections">
              {(readOnly ? ["Overview", "Communication"] : ["Overview", "Communication", "History", "Notes"]).map((label) => <button key={label} type="button"
                aria-current={tab === label ? "true" : undefined} onClick={() => setTab(label)}>{label}</button>)}
            </nav>
            {tab === "Overview" && <>
              <Facts rows={[
                ["Manufacturer", selected.manufacturer], ["Model", selected.model],
                ["AC capacity", `${selected.ac_capacity_kw} kW`], ["DC capacity", `${selected.dc_capacity_kw} kW`],
                ["Configured efficiency", `${selected.configured_efficiency_percent}%`],
                ["Serial number", selected.serial_number ?? "Not configured"],
                ["Plan mapping", selected.plan_label ?? "Unverified"],
              ]} />
              <p>{selected.source_reference}</p><small>Imported {selected.imported_at}</small>
              {selected.plan_label && <p>{selected.evidence} · {selected.confirmed_by} · {selected.confirmed_at}</p>}
            </>}
            {tab === "Communication" && <Facts rows={[
              ["DataLogger UID", selected.logger_uid], ["Comm ID", selected.comm_id],
              ["Protocol", selected.protocol === "ModbusTCP" ? "Modbus TCP" : selected.protocol], ["Port", selected.port],
              ["Endpoint", "Restricted to database operators"],
              ["Polling interval", `${selected.polling_interval} (${selected.polling_unit ?? "unit unspecified"})`],
              ["Monitoring configured", selected.monitored ? "Yes" : "No"], ["Run KPIs configured", selected.run_kpis ? "Yes" : "No"],
              ["Tag mapping", selected.tag_mapping], ["Tag offset", selected.tag_offset],
            ]} />}
            {tab === "History" && <History key={selected.asset_id} workspace={workspace} asset={selected.asset_id} base={`${base}/${selected.asset_id}`} />}
            {tab === "Notes" && <PanelNotes key={selected.asset_id} label="Inverter notes" endpoint={`${base}/${selected.asset_id}/notes`} />}
          </>}
        </div>
      </section>
    </div>}
  </div>;
}
