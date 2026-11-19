import { useEffect, useRef, useState, type FormEvent } from "react";
import { api, type EquipmentHistory } from "../../api/solaris";

const fields = [
  ["Manufacturer", ["manufacturer", "module manufacturer"]],
  ["Model", ["model", "module model"]],
  ["Serial number", ["serial number", "module serial number"]],
] as const;
const normalize = (name: string) => name.toLowerCase().replaceAll("_", " ").trim();

export default function PanelMetadata({ workspace, asset, onSaved }: {
  workspace: string; asset: number; onSaved: () => void;
}) {
  const [data, setData] = useState<EquipmentHistory>();
  const [values, setValues] = useState<string[]>([]);
  const [source, setSource] = useState("");
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const attempt = useRef<{ signature: string; key: string; effective: string } | undefined>(undefined);
  useEffect(() => {
    const controller = new AbortController();
    api.equipmentHistory(workspace, asset, {}, controller.signal).then((history) => {
      if (controller.signal.aborted) return;
      setData(history);
      setValues(fields.map(([, names]) =>
        history.current?.specifications.find((item) => names.some((name) => name === normalize(item.name)))?.value ?? ""));
    }).catch((failure: Error) => { if (!controller.signal.aborted) setError(failure.message); });
    return () => controller.abort();
  }, [workspace, asset]);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!data || busy) return;
    const current = data.current;
    const signature = JSON.stringify([values, source, data.head_revision]);
    if (attempt.current?.signature !== signature) {
      attempt.current = { signature, key: crypto.randomUUID(), effective: new Date().toISOString() };
    }
    const pending = attempt.current;
    const known: string[] = fields.flatMap(([, names]) => [...names]);
    const specifications = (current?.specifications ?? []).filter((item) => !known.includes(normalize(item.name)));
    fields.forEach(([name], index) => {
      if (values[index]?.trim()) specifications.push({ name, value: values[index].trim(), unit: null });
    });
    setError(""); setStatus(""); setBusy(true);
    try {
      const revision = await api.appendEquipment(workspace, asset, {
        effective_from: pending.effective, expected_revision: data.head_revision, equipment_kind: "panel",
        parent_asset_id: current?.parent_asset_id ?? null, site_id: current ? current.site_id : data.legacy_site_id,
        source_reference: source.trim(), specifications,
      }, pending.key);
      setData({ ...data, current: revision, latest: revision, head_revision: revision.configuration_id });
      setStatus("Verified metadata saved.");
      onSaved();
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return <>
    {error && <p role="alert">{error}</p>}
    {status && <p role="status">{status}</p>}
    {!data && !error && <p role="status">Loading equipment details…</p>}
    {data && <form onSubmit={save} className="pi-notes">
      <fieldset disabled={busy || data.latest?.configuration_id !== data.current?.configuration_id}>
        <legend>Verified equipment details</legend>
        {fields.map(([label], index) => <label key={label}>{label}<input maxLength={200}
          value={values[index] ?? ""} onChange={(event) => setValues(values.map((value, i) => i === index ? event.target.value : value))} /></label>)}
        <label>Verification source<input required maxLength={200} value={source} onChange={(event) => setSource(event.target.value)} /></label>
        <button type="submit" className="pi-primary">Save details</button>
      </fieldset>
      {data.latest?.configuration_id !== data.current?.configuration_id && <p>A scheduled configuration exists. Use Sites &amp; Assets to review it.</p>}
    </form>}
  </>;
}
