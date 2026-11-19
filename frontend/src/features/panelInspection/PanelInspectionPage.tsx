import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { apiDownloadUrl, requestJson } from "../../api/client";
import ArrayMap from "./ArrayMap";
import PanelNotes from "./PanelNotes";
import { InverterView, useInverterInventory } from "../inverters/InverterPage";
import PanelMaintenanceForm, { MaintenanceEntry } from "./PanelMaintenanceForm";
import PanelMetadata from "./PanelMetadata";
import InspectionComparison, { VisitMeasurements } from "./InspectionComparison";
import InspectionCsvImport, { type InspectionImportReceipt } from "./InspectionCsvImport";
import { VisitEditor, VisitEvidence } from "../live/VisitWorkspace";
import { EvidenceImages, formatTemperature, measurement, TemperatureTrend } from "./InspectionEvidence";
import { demoLabel, type Layout, type Panel, type PanelEvidence } from "./panelTypes";
import "./panelInspection.css";

const tabs = ["Overview", "Inspections", "Measurements", "Notes", "Files", "Maintenance"] as const;
const emptyInspections: PanelEvidence["inspections"] = [];
const selectionKey = "solaris:panel-inspection:selection";

export default function PanelInspectionPage({ live, workspace }: { live: boolean; workspace: string }) {
  const [view, setView] = useState<"array" | "site" | "import">("array");
  const inverterInventory = useInverterInventory(live ? workspace : "default");
  const [noteRequest, setNoteRequest] = useState(0);
  const [layout, setLayout] = useState<Layout>();
  const [layoutError, setLayoutError] = useState("");
  const [layoutAttempt, setLayoutAttempt] = useState(0);
  const [selected, setSelected] = useState<Panel>();
  const [query, setQuery] = useState("");
  const [searchError, setSearchError] = useState("");
  const [result, setResult] = useState<{ key: string; data?: PanelEvidence; error?: string }>();
  const [tab, setTab] = useState<typeof tabs[number]>("Overview");
  const detailsBody = useRef<HTMLDivElement>(null);
  const [visitId, setVisitId] = useState<number>();
  const [reveal, setReveal] = useState(0);
  const [refresh, setRefresh] = useState(0);
  const [coverage, setCoverage] = useState<{ key: string; count: number | null }>();
  const [capture, setCapture] = useState<string>();
  const [openRecord, setOpenRecord] = useState<string>();
  const [correction, setCorrection] = useState<string>();
  const [importNotice, setImportNotice] = useState<{ key: string; text: string }>();
  const selectedId = selected?.id;
  const mode = live ? "live" : "demo";
  const evidenceKey = `${mode}:${workspace}:${selectedId}`;
  const coverageKey = `${mode}:${workspace}`;
  const evidence = result?.key === evidenceKey ? result.data : undefined;
  const evidenceError = result?.key === evidenceKey ? result.error : undefined;
  const inspections = evidence?.inspections ?? emptyInspections;
  const panelPath = `/panel-inspection/panels/${selectedId}`;
  const params = new URLSearchParams({ mode, workspace });
  const visit = inspections.find((item) => item.inspection_id === visitId) ?? inspections[0];
  const latestVisit = inspections[0];

  useEffect(() => {
    if (detailsBody.current) detailsBody.current.scrollTop = 0;
  }, [tab, evidenceKey]);

  useEffect(() => {
    const controller = new AbortController();
    requestJson<Layout>("/panel-inspection/layout", { signal: controller.signal }).then((data) => {
      if (controller.signal.aborted) return;
      setLayout(data);
      const remembered = sessionStorage.getItem(selectionKey);
      const initial = remembered === "" ? undefined : data.panels.find((panel) => panel.id === (remembered ?? "H-04-T"))
        ?? data.panels[0];
      setSelected(initial);
      setQuery(initial?.id ?? "");
    }).catch((error: Error) => { if (!controller.signal.aborted) setLayoutError(error.message); });
    return () => controller.abort();
  }, [layoutAttempt]);

  useEffect(() => {
    if (!selectedId) return;
    const controller = new AbortController();
    const params = new URLSearchParams({ mode, workspace });
    requestJson<PanelEvidence>(`/panel-inspection/panels/${encodeURIComponent(selectedId)}?${params}`, { signal: controller.signal })
      .then((data) => { if (!controller.signal.aborted) setResult({ key: evidenceKey, data }); })
      .catch((error: Error) => { if (!controller.signal.aborted) setResult({ key: evidenceKey, error: error.message }); });
    return () => controller.abort();
  }, [selectedId, evidenceKey, mode, workspace, refresh]);

  useEffect(() => {
    if (!layout) return;
    const controller = new AbortController();
    const params = new URLSearchParams({ mode, workspace });
    requestJson<{ with_inspections: number | null }>(
      `/panel-inspection/coverage?${params}`, { signal: controller.signal },
    ).then((data) => {
      if (!controller.signal.aborted) setCoverage({ key: coverageKey, count: data.with_inspections });
    }).catch(() => {
      if (!controller.signal.aborted) setCoverage({ key: coverageKey, count: null });
    });
    return () => controller.abort();
  }, [layout, mode, workspace, coverageKey, refresh]);

  const select = useCallback((panel: Panel) => {
    setSelected(panel);
    sessionStorage.setItem(selectionKey, panel.id);
    setQuery(panel.id);
    setSearchError("");
    setVisitId(undefined);
    setCapture(undefined);
    setCorrection(undefined);
    setNoteRequest(0);
    setOpenRecord(undefined);
  }, []);

  function finishImport(receipt: InspectionImportReceipt) {
    setRefresh((value) => value + 1);
    if (!selectedId || !receipt.inspections.some((item) => item.panel_id === selectedId)) return;
    const count = receipt.inspections.length;
    const readings = receipt.measurement_count;
    setImportNotice({ key: evidenceKey, text: receipt.duplicate ? "Already imported. 0 new visits or readings." :
      `Import saved. ${count} ${count === 1 ? "visit" : "visits"}, ${readings} ${readings === 1 ? "reading" : "readings"}.` });
    setResult(undefined);
    setVisitId(undefined);
    setCorrection(undefined);
    setCapture(undefined);
    setOpenRecord(undefined);
    setTab("Overview");
    setView("array");
    window.scrollTo(0, 0);
  }

  function search(event: FormEvent) {
    event.preventDefault();
    const parts = /^([A-P])[ -]?(\d{1,3})[ -]?([TB])$/i.exec(query.trim());
    const id = parts ? `${parts[1].toUpperCase()}-${String(Number(parts[2])).padStart(2, "0")}-${parts[3].toUpperCase()}` : "";
    const panel = layout?.panels.find((item) => item.id === id);
    if (panel) { select(panel); setReveal((value) => value + 1); }
    else setSearchError("No matching module. Enter a panel ID such as H-04-T.");
  }

  const facts = [
    ["Connected inverter", evidence?.inverter ?? "Not verified"], ["String", evidence?.string ?? "Not verified"],
    ["Combiner", evidence?.combiner ?? "Not verified"], ["Manufacturer", evidence?.manufacturer ?? "Not verified"],
    ["Module model", evidence?.module_model ?? "Not verified"],
    ["Serial number", evidence?.serial_number ?? "Not verified"],
  ];

  return <div className="pi">
    <div className="pi-banner">
      <span><i />{live ? "Live Data" : `Synthetic Demo · ${demoLabel}`}</span>
      <span>{live ? "Matched to the configured site in the selected workspace" : "Isolated synthetic inspection history"}</span>
    </div>
    {layoutError && <p role="alert" className="pi-error">{layoutError} <button type="button" onClick={() => {
      setLayoutError(""); setLayoutAttempt((value) => value + 1);
    }}>Retry layout</button></p>}
    {!layout && !layoutError && <p role="status">Loading the SOLAR FARM layout…</p>}
    {layout && <div className="pi-stats">
      <div><strong>{layout.panels.length.toLocaleString("en-US")}</strong><span>{layout.source === "Synthetic layout fixture" ? "Demo modules" : "Workbook modules"}</span></div>
      <div><strong>{layout.panels.filter((panel) => panel.source_mark).length}</strong><span>Reported damaged</span></div>
      <div><strong>{coverage?.key === coverageKey ? coverage.count ?? "—" : "—"}</strong><span>{live ? "With live inspections" : "With demo inspections"}</span></div>
      <div><strong>{inverterInventory.data?.markers.length ?? "—"}</strong><span>Inverter locations</span></div>
    </div>}
    <nav className="pi-view-switch" aria-label="Site view">
      <button type="button" aria-pressed={view === "array"} onClick={() => setView("array")}>Array Map</button>
      <button type="button" aria-pressed={view === "site"} onClick={() => setView("site")}>Site Layout</button>
        <button type="button" aria-pressed={view === "import"} onClick={() => setView("import")}>Import Inspection Data</button>
    </nav>
    {view === "site" && <InverterView key={inverterInventory.workspace} inventory={inverterInventory} readOnly={!live} />}
    {view === "import" && <InspectionCsvImport key={`${coverageKey}:${selectedId}`} mode={mode} workspace={workspace} selectedPanel={selectedId}
      onImported={finishImport}
      onOpenPanel={(id, visit) => {
        const panel = layout?.panels.find((item) => item.id === id);
        if (!panel) return;
        select(panel);
        setVisitId(visit);
        setTab("Inspections");
        setView("array");
        setReveal((value) => value + 1);
      }} />}
    {layout && <div className="pi-workspace" hidden={view !== "array"}>
      <section className="pi-card pi-explorer" aria-labelledby="pi-array-title">
        <header className="pi-card-header"><h2 id="pi-array-title">Solar Array Map</h2></header>
        <form className="pi-search" onSubmit={search} role="search">
          <label htmlFor="pi-panel-search">Search Panel</label>
          <input id="pi-panel-search" value={query} onChange={(event) => { setQuery(event.target.value); setSearchError(""); }}
            placeholder="e.g. H-04-T" aria-invalid={!!searchError} aria-describedby={searchError ? "pi-search-error" : undefined}/>
          <button type="submit" className="pi-primary">Find panel</button>
        </form>
        {searchError && <p id="pi-search-error" role="alert" className="pi-error">{searchError}</p>}
        <ArrayMap panels={layout.panels} selected={selected} reveal={reveal} onSelect={select} />
        <footer className="pi-layout-source"><strong>Layout source</strong><span>{layout.source} · {layout.sheet}</span></footer>
      </section>
      <section className="pi-card pi-details" aria-labelledby="pi-details-title">
        <header className="pi-card-header"><h2 id="pi-details-title">Panel Details</h2></header>
        {!selected && <p className="pi-detail-body">Select an array module to open its inspection history.</p>}
        {selected && <>
          <div className="pi-identity">
            <div><h3>{selected.id}</h3><p>Row {selected.row} · Position {selected.position} · {selected.layer === "T" ? "Top" : "Bottom"} layer</p></div>
            <div className="pi-actions">{selected.source_mark && <span className="pi-mark">Reported damaged</span>}
              <button type="button" onClick={() => {
                sessionStorage.setItem(selectionKey, "");
                setSelected(undefined); setQuery(""); setSearchError(""); setVisitId(undefined);
                setCapture(undefined); setOpenRecord(undefined);
                document.getElementById("pi-panel-search")?.focus();
              }}>Clear selection</button>
            </div>
          </div>
          {selected.inferred_number && <p className="pi-note">The workbook leaves this number blank between 81 and 83. Both module cells are present.</p>}
          {evidence?.asset_id ? <div className="pi-quick-actions">
            <button type="button" className="pi-primary" onClick={() => { setTab("Inspections"); setCapture(evidenceKey); }}>New Inspection</button>
            <button type="button" onClick={() => { setNoteRequest((value) => value + 1); setTab("Notes"); }}>Add Note</button>
            <button type="button" onClick={() => {
              if (visit) { setTab("Files"); setCorrection(`${evidenceKey}:Files`); }
              else { setTab("Inspections"); setCapture(evidenceKey); }
            }}>Upload File</button>
          </div> : live && evidence && <p className="pi-note">Register this panel in the configured site to enter records.</p>}
          <nav className="pi-tabs" aria-label="Panel detail sections">
            {tabs.map((item) => <button key={item} type="button" aria-current={tab === item ? "true" : undefined}
              onClick={() => setTab(item)}>{item}</button>)}
          </nav>
          <div className="pi-detail-body" ref={detailsBody}>
            {!evidence && !evidenceError && <p role="status">Loading inspection evidence…</p>}
            {evidenceError && <p role="alert" className="pi-error">{evidenceError} <button type="button" onClick={() => {
              setResult(undefined); setRefresh((value) => value + 1);
            }}>Retry evidence</button></p>}
            {tab === "Overview" && <>
              {importNotice?.key === evidenceKey && <p role="status" className="pi-import-success">{importNotice.text}</p>}
              <dl className="pi-facts">
                {evidence && <div><dt>Inspection status</dt><dd>{latestVisit
                  ? latestVisit.data_origin === "synthetic" ? "Demo inspection recorded" : "Inspection recorded"
                  : "No inspections recorded"}</dd></div>}
                <div><dt>Condition</dt><dd>Condition not assessed</dd></div>
                {latestVisit && <>
                  <div><dt>Latest inspection</dt><dd><time dateTime={latestVisit.inspected_at}>{latestVisit.inspected_at.slice(0, 10)}</time></dd></div>
                  <div><dt>Inspection source</dt><dd>{latestVisit.data_source || "Source unavailable"}</dd></div>
                </>}
                <div><dt>Layout cell</dt><dd>{layout.sheet} · {selected.cell}</dd></div>
              </dl>
              {latestVisit && <section aria-label="Latest readings"><h4>Latest readings</h4>
                {latestVisit.measurements.length ? <VisitMeasurements visit={latestVisit} compact /> : <p>No readings recorded for this visit.</p>}
              </section>}
              {evidence && <details><summary>Equipment details</summary>
                <dl className="pi-facts">{facts.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
                {evidence.equipment_source && <p className="pi-source">Equipment source · {evidence.equipment_source}</p>}
                {live && evidence.asset_id && <details><summary>Edit verified metadata</summary>
                  <PanelMetadata key={evidenceKey} workspace={workspace} asset={evidence.asset_id} onSaved={() => setRefresh((value) => value + 1)} />
                </details>}
              </details>}
            </>}
            {tab === "Notes" && (!live || evidence?.asset_id
              ? <PanelNotes key={`${evidenceKey}:${noteRequest}`} startOpen={noteRequest > 0} endpoint={`${panelPath}/notes?${params}`} />
              : evidence && <p>Register this panel in the configured site to add notes.</p>)}
            {evidence && (tab === "Inspections" || tab === "Measurements" || tab === "Files") && <>
              {inspections.length > 0 && <label className="pi-visit">Inspection visit <select value={visit?.inspection_id}
                onChange={(event) => { setVisitId(Number(event.target.value)); setCorrection(undefined); }}>
                {inspections.map((item) => <option key={item.inspection_id} value={item.inspection_id}>{item.inspected_at} · {item.data_origin}</option>)}
              </select></label>}
              {visit && <p className="pi-source">Data source · {visit.data_source || "Not verified"}</p>}
              {visit?.inspection_method && <p className="pi-source">Method · {visit.inspection_method}</p>}
              {tab === "Inspections" && <EvidenceImages key={evidenceKey + ":" + visit?.inspection_id} visit={visit} />}
            </>}
            {evidence?.asset_id && visit && (tab === "Measurements" || tab === "Files") && (() => {
              const key = `${evidenceKey}:${tab}`;
              return <div className="pi-capture asset-registration">
                <button type="button" aria-expanded={correction === key}
                  onClick={() => setCorrection(correction === key ? undefined : key)}>
                  {correction === key ? "Close visit editor" : tab === "Files" ? "Upload to this inspection" : "Edit measurement"}
                </button>
                {correction === key && <VisitEditor key={`${key}:${visit.inspection_id}`} workspaceId={workspace} asset={evidence.asset_id}
                  captureOnly demo={!live} fileOnly={tab === "Files"} correctionVisit={visit.inspection_id} onImportCsv={() => setView("import")} onSaved={() => setRefresh((value) => value + 1)} />}
              </div>;
            })()}
            {tab === "Inspections" && evidence && <>
              <button type="button" onClick={() => {
                const module = document.getElementById(`array-module-${selected.id}`);
                (module ?? document.getElementById("pi-panel-search"))?.focus();
                setReveal((value) => value + 1);
              }}>Return to selected module</button>
              {evidence.asset_id && capture === evidenceKey && <div className="pi-capture asset-registration">
                <button type="button" aria-expanded={capture === evidenceKey}
                  onClick={() => setCapture(capture === evidenceKey ? undefined : evidenceKey)}>
                  {capture === evidenceKey ? "Close capture form" : "Record inspection"}</button>
                {capture === evidenceKey && <VisitEditor key={evidenceKey} workspaceId={workspace} asset={evidence.asset_id}
                  captureOnly demo={!live} onImportCsv={() => setView("import")} onSaved={(id) => { setVisitId(id); setRefresh((value) => value + 1); }} />}
              </div>}
              {live && !evidence.asset_id && <p>Register this workbook ID as a real panel in the configured live site to record inspections.</p>}
              {visit && <><h4>Visit {visit.inspection_id} · {visit.inspected_at}</h4>
                {visit.measurements.length ? <VisitMeasurements visit={visit} /> : <p>Not measured</p>}
                {<button type="button" aria-expanded={openRecord === `${evidenceKey}:${visit.inspection_id}`}
                  onClick={() => setOpenRecord(openRecord === `${evidenceKey}:${visit.inspection_id}` ? undefined : `${evidenceKey}:${visit.inspection_id}`)}>
                  {openRecord === `${evidenceKey}:${visit.inspection_id}` ? "Close full visit record" : "Open full visit record"}
                </button>}
                {openRecord === `${evidenceKey}:${visit.inspection_id}` &&
                  <VisitEvidence key={openRecord} workspaceId={workspace} demo={!live} id={visit.inspection_id} />}
              </>}
            </>}
            {evidence && tab === "Measurements" && <>
              <h4>Visit measurements</h4>
              {!visit?.measurements.length && <p>No measurements recorded.</p>}
              {visit && <dl className="pi-facts">
                <div><dt>Module temperature</dt><dd>{formatTemperature(visit ? measurement(visit, "module_temperature") : null)}</dd></div>
                <div><dt>Temperature difference (ΔT)</dt><dd>{formatTemperature(visit ? measurement(visit, "delta_t") : null)}</dd></div>
              </dl>}
              {tab === "Measurements" && !!visit?.measurements.length && <VisitMeasurements visit={visit} />}
              {tab === "Measurements" && <><h4>Module temperature trend</h4><TemperatureTrend inspections={inspections} /></>}
            </>}
            {(tab === "Measurements" || tab === "Inspections") && evidence && <>
              <h4>Inspection history <span>({inspections.length})</span></h4>
              {inspections.length === 0 ? <p>No inspections yet.</p> : <div className="pi-table-scroll"><table>
                <thead><tr><th scope="col">Inspection date</th><th scope="col">Module temp.</th><th scope="col">ΔT</th></tr></thead>
                <tbody>{inspections.map((item) => <tr key={item.inspection_id}>
                  <td><button type="button" className="pi-text-button" aria-pressed={item.inspection_id === visit?.inspection_id}
                    onClick={() => { setVisitId(item.inspection_id); setCorrection(undefined); setTab("Inspections"); }}>{item.inspected_at.slice(0, 10)}</button></td>
                  <td>{formatTemperature(measurement(item, "module_temperature"))}</td><td>{formatTemperature(measurement(item, "delta_t"))}</td>
                </tr>)}</tbody>
              </table></div>}
            </>}
            {(tab === "Measurements" || tab === "Inspections") && inspections.length > 1 &&
              <InspectionComparison key={`${evidenceKey}:${inspections.length}`} inspections={inspections} />}
            {tab === "Maintenance" && evidence && <><h4>Maintenance records</h4>
              {evidence.maintenance.length ? evidence.maintenance.map((record) => <MaintenanceEntry key={record.maintenance_id} record={record}
                endpoint={evidence.asset_id ? `${panelPath}/maintenance/${record.maintenance_id}/status?${params}` : undefined}
                onSaved={() => setRefresh((value) => value + 1)} />) : <p>No maintenance records.</p>}
              {evidence.asset_id && <PanelMaintenanceForm key={evidenceKey} endpoint={`${panelPath}/maintenance?${params}`} inspections={inspections} onSaved={() => setRefresh((value) => value + 1)} />}
            </>}
            {tab === "Files" && evidence && <><h4>Source documents</h4>
              <p>{layout.source} · {layout.sheet}!{selected.cell}</p>
              <h4>Uploaded visit evidence</h4>
              {inspections.some((item) => item.attachments.length) ? <ul>{inspections.flatMap((item) => item.attachments.map((file) =>
                <li key={file.path}><a href={apiDownloadUrl(file.path)}>{file.original_name}</a> · {item.inspected_at.slice(0, 10)}</li>))}</ul> : <p>No files uploaded.</p>}
            </>}
          </div>
        </>}
      </section>
    </div>}
  </div>;
}
