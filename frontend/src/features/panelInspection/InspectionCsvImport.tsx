import { useEffect, useState } from "react";
import { requestJson } from "../../api/client";

const columns = ["panel_id", "inspected_at", "data_source", "measurement", "quantity", "value", "unit", "finding"] as const;
const visitColumns = ["panel_id", "visit_timestamp", "visit_origin", "inspection_method", "measurement", "value", "unit", "measurement_status", "notes"] as const;
type CsvRow = Partial<Record<typeof columns[number] | typeof visitColumns[number], string>> & { line: number };
type Preview = { filename: string; confirmation: string; columns?: (typeof columns[number] | typeof visitColumns[number])[]; rows: CsvRow[]; inspection_count: number;
  errors: { line: number; message: string }[] };
export type InspectionImportReceipt = { import_id: string; filename: string; measurement_count: number; duplicate?: boolean;
  origin: "real" | "synthetic"; created_at?: string;
  inspections: { inspection_id: number; panel_id: string; inspected_at: string }[] };

export default function InspectionCsvImport({ mode, workspace, selectedPanel, onOpenPanel, onImported }: {
  mode: "live" | "demo"; workspace: string; selectedPanel?: string; onOpenPanel: (panel: string, visit: number) => void;
  onImported: (receipt: InspectionImportReceipt) => void;
}) {
  const scope = new URLSearchParams({ mode, workspace });
  const base = "/panel-inspection/csv-imports";
  const [file, setFile] = useState<File>();
  const [preview, setPreview] = useState<Preview>();
  const [receipt, setReceipt] = useState<InspectionImportReceipt>();
  const [history, setHistory] = useState<InspectionImportReceipt[]>();
  const [historyError, setHistoryError] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(0);
  const [confirmed, setConfirmed] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ mode, workspace });
    requestJson<{ imports: InspectionImportReceipt[] }>(`${base}?${params}`, { signal: controller.signal })
      .then(({ imports }) => setHistory(imports))
      .catch((failure: Error) => { if (!controller.signal.aborted) setHistoryError(failure.message); });
    return () => controller.abort();
  }, [mode, workspace, loaded]);

  async function send(operation: "preview" | "commit") {
    if (!file || busy || (operation === "commit" && (!preview || !confirmed))) return;
    setBusy(true);
    setError("");
    try {
      const form = new FormData();
      form.append("file", file);
      if (selectedPanel) form.append("selected_panel", selectedPanel);
      if (operation === "commit" && preview) form.append("confirmed_digest", preview.confirmation);
      const result = await requestJson<{ preview: Preview; receipt: InspectionImportReceipt | null }>(
        `${base}/${operation}?${scope}`, { method: "POST", body: form },
      );
      setPreview(result.preview);
      setConfirmed(false);
      if (result.receipt) {
        setReceipt(result.receipt);
        setLoaded((value) => value + 1);
        onImported(result.receipt);
      }
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const shownColumns = preview?.columns ?? columns;
  const visitCount = receipt?.inspections.length ?? 0;
  const readingCount = receipt?.measurement_count ?? 0;
  const templatePanel = selectedPanel ?? "J-24-B";
  const template = visitColumns.join(",") + "\n" + (mode === "demo"
    ? `${templatePanel},2026-11-19T15:00:00Z,synthetic,Demo meter,module_temperature,31.250,degC,measured,Demo reading\n` +
      `${templatePanel},2026-11-19T15:00:00Z,synthetic,Demo meter,ambient_temperature,,,missing,Sensor offline\n`
    : "");

  return <section className="pi-card pi-import" aria-labelledby="inspection-import-title">
    <header className="pi-card-header"><h2 id="inspection-import-title">Import Inspection Data</h2></header>
    <div className="pi-detail-body">
      <p>{mode === "demo" ? "Synthetic demo records are saved in the isolated demo database." : "Confirm that these are documented field inspection records for this workspace."}</p>
      {selectedPanel && <p>Selected panel <strong>{selectedPanel}</strong></p>}
      <p><a href={`data:text/csv;charset=utf-8,${encodeURIComponent(template)}`}
        download={mode === "demo" ? `${templatePanel}-demo-inspection.csv` : "inspection-template.csv"}>
        {mode === "demo" ? "Download demo inspection CSV" : "Download inspection CSV template"}
      </a></p>
      <details><summary>CSV format</summary>
        <p>UTF-8 CSV, up to 1 MB and 1,000 rows. One measurement per row. Rows with the same panel and timestamp form one inspection.</p>
        <code>{visitColumns.join(",")}</code>
        <p>Use an ISO date or timestamp. Mark a blank reading with the status <code>missing</code>. Use a supported unit for recorded values.</p>
        <p>Files with explicit quantities may use this format.</p><code>{columns.join(",")}</code>
      </details>
      <div className="pi-actions pi-import-file">
        <label>Inspection CSV <input type="file" accept=".csv,text/csv" disabled={busy} onChange={(event) => {
          setFile(event.target.files?.[0]); setPreview(undefined); setReceipt(undefined); setError(""); setConfirmed(false);
        }} /></label>
        <button type="button" onClick={() => void send("preview")} disabled={!file || busy}>Preview CSV</button>
      </div>
      {busy && <p role="status">Processing the CSV…</p>}
      {error && <p className="pi-error" role="alert">{error}</p>}
      {preview && <section aria-label="Import preview">
        <h3>Preview</h3>
        <p>{preview.filename} · {preview.rows.length} rows · {preview.inspection_count} inspections</p>
        {!!preview.errors.length && <div className="pi-error" role="alert">
          <strong>Correct these rows before importing.</strong>
          <ul>{preview.errors.map((item, index) => <li key={index}>Row {item.line}: {item.message}</li>)}</ul>
        </div>}
        {!!preview.rows.length && <div className="pi-table-scroll pi-import-table" tabIndex={0} aria-label="Previewed CSV rows">
          <table><thead><tr><th scope="col">Row</th>{shownColumns.map((name) => <th key={name} scope="col">{name.replaceAll("_", " ")}</th>)}</tr></thead>
            <tbody>{preview.rows.map((row) => <tr key={row.line}><td>{row.line}</td>
              {shownColumns.map((name) => <td key={name}>{row[name] || (name === "value" ? "Missing" : "—")}</td>)}</tr>)}</tbody>
          </table>
        </div>}
        {!receipt && !preview.errors.length && <div className="pi-actions pi-import-file">
          <label><input type="checkbox" checked={confirmed} disabled={busy} onChange={(event) => setConfirmed(event.target.checked)} />
            {mode === "demo" ? " Confirm synthetic import" : " Confirm field data import"}</label>
          <button type="button" className="pi-primary" disabled={busy || !confirmed} onClick={() => void send("commit")}>Import inspections</button>
        </div>}
      </section>}
      {receipt && <p role="status">{receipt.duplicate ? "Already imported. 0 new visits or readings." :
        `Import saved. ${visitCount} ${visitCount === 1 ? "visit" : "visits"}, ${readingCount} ${readingCount === 1 ? "reading" : "readings"}.`}</p>}
      <h3>Import history</h3>
      {historyError && <p role="alert">{historyError} <button type="button" onClick={() => {
        setHistoryError(""); setLoaded((value) => value + 1);
      }}>Retry</button></p>}
      {!history && !historyError && <p role="status">Loading import history…</p>}
      {history?.length === 0 && <p>No inspection imports yet.</p>}
      {history?.map((item) => <details key={item.import_id} className="pi-import-receipt" open={item.import_id === receipt?.import_id || undefined}>
        <summary>{item.filename} · {item.origin === "synthetic" ? "Synthetic" : "Field data"} · {item.created_at} UTC · {item.inspections.length} inspections</summary>
        <ul>{item.inspections.map((visit) => <li key={visit.inspection_id}>
          <button type="button" onClick={() => onOpenPanel(visit.panel_id, visit.inspection_id)}>
            Open {visit.panel_id}
          </button>{" "}{visit.inspected_at} · Visit {visit.inspection_id}
        </li>)}</ul>
      </details>)}
    </div>
  </section>;
}
