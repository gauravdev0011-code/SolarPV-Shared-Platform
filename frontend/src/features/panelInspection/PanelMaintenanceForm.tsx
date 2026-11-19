import { useState, type FormEvent } from "react";
import { requestJson } from "../../api/client";
import type { Inspection, MaintenanceRecord } from "./panelTypes";

export function MaintenanceEntry({ record, endpoint, onSaved }: {
  record: MaintenanceRecord; endpoint?: string; onSaved: () => void;
}) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const current = record.status_history[0];
  async function changeStatus(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!endpoint || busy) return;
    setBusy(true);
    setError("");
    const fields = new FormData(event.currentTarget);
    try {
      await requestJson(endpoint, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expected_revision: current?.revision ?? 0,
          status: fields.get("status"), notes: fields.get("notes") }),
      });
      setOpen(false);
      onSaved();
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return <article className="pi-record">
    <strong>{record.maintenance_type}</strong>
    <time>{record.performed_at ?? "Date unavailable"}</time>
    {record.description && record.description !== record.maintenance_type && <p>{record.description}</p>}
    <small>{current?.status ?? record.status ?? "Status unrecorded"} · {record.data_origin}
      {record.related_inspection_id ? ` · Visit ${record.related_inspection_id}` : ""}</small>
    {record.status_history.length > 0 && <details><summary>Status history</summary><ul>
      {record.status_history.map((item) => <li key={item.revision}>
        {item.status} · {item.recorded_at} · {item.notes}
      </li>)}
      {record.status && <li>Original status · {record.status}</li>}
    </ul></details>}
    {endpoint && !open && <div><button type="button" onClick={() => setOpen(true)}>Update status</button></div>}
    {endpoint && open && <form className="pi-notes" onSubmit={changeStatus}>
      <fieldset disabled={busy}><legend>Update maintenance status</legend>
        {error && <p role="alert">{error}</p>}
        <label>Status<select name="status" defaultValue={current?.status ?? record.status ?? "planned"}>
          <option value="planned">Planned</option><option value="completed">Completed</option>
        </select></label>
        <label>Status note<textarea name="notes" required maxLength={2000} /></label>
        <button type="submit">Save status</button>
        <button type="button" onClick={() => setOpen(false)}>Cancel</button>
      </fieldset>
    </form>}
  </article>;
}

export default function PanelMaintenanceForm({ endpoint, inspections, onSaved }: {
  endpoint: string; inspections: Inspection[]; onSaved: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    try {
      await requestJson(endpoint, { method: "POST", headers: {"Content-Type": "application/json"},
        body: JSON.stringify({ request_id: requestId, performed_at: data.get("date"), work: data.get("work"),
          notes: data.get("notes"), status: data.get("status"), related_inspection_id: Number(data.get("inspection")) || null }) });
      setOpen(false);
      setSaved(true);
      onSaved();
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return <div className="pi-notes">
    {saved && <p role="status">Maintenance saved.</p>}
    {!open && <button type="button" onClick={() => { setRequestId(crypto.randomUUID()); setSaved(false); setOpen(true); }}>Add Maintenance</button>}
    {open && <form onSubmit={submit} onChange={() => setRequestId(crypto.randomUUID())}>
      <fieldset disabled={busy}>
        <legend>Add maintenance record</legend>
        {error && <p role="alert">{error}</p>}
        <label>Date<input name="date" type="date" required /></label>
        <label>Work performed<input name="work" required maxLength={2000} /></label>
        <label>Status<select name="status"><option value="completed">Completed</option><option value="planned">Planned</option></select></label>
        <label>Notes<textarea name="notes" maxLength={2000} /></label>
        <label>Related inspection<select name="inspection"><option value="">None</option>
          {inspections.map((visit) => <option key={visit.inspection_id} value={visit.inspection_id}>{visit.inspected_at}</option>)}
        </select></label>
        <button type="submit" className="pi-primary">Save maintenance</button>
        <button type="button" onClick={() => setOpen(false)}>Cancel</button>
      </fieldset>
    </form>}
  </div>;
}
