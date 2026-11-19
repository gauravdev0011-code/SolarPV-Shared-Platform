import { useEffect, useState, type FormEvent } from "react";
import { requestJson } from "../../api/client";

interface Revision {
  note_id: string;
  revision: number;
  body: string;
  author: string;
  recorded_at: string;
}

export default function PanelNotes({ endpoint, label = "Panel notes", startOpen = false }: { endpoint: string; label?: string; startOpen?: boolean }) {
  const [revisions, setRevisions] = useState<Revision[]>();
  const [draft, setDraft] = useState<{ id: string; revision: number; body: string; author: string } | undefined>(() => startOpen ? { id: crypto.randomUUID(), revision: 0, body: "", author: "" } : undefined);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [path, query = ""] = endpoint.split("?");
  useEffect(() => {
    const controller = new AbortController();
    requestJson<Revision[]>(endpoint, { signal: controller.signal }).then(setRevisions).catch((failure: Error) => {
      if (!controller.signal.aborted) setError(failure.message);
    });
    return () => controller.abort();
  }, [endpoint, attempt]);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!draft || busy) return;
    setBusy(true); setError(""); setStatus("");
    try {
      setRevisions(await requestJson<Revision[]>(`${path}/${draft.id}?${query}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: draft.body, author: draft.author, expected_revision: draft.revision }),
      }));
      setDraft(undefined); setStatus("Note saved.");
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const groups = new Map<string, Revision[]>();
  for (const item of revisions ?? []) {
    const group = groups.get(item.note_id) ?? [];
    group.push(item);
    groups.set(item.note_id, group);
  }
  return <section aria-label={label} className="pi-notes">
    {error && <p role="alert">{error} <button type="button" onClick={() => { setError(""); setAttempt(attempt + 1); }}>Reload notes</button></p>}
    {status && <p role="status">{status}</p>}
    {!revisions && !error && <p role="status">Loading notes…</p>}
    {revisions?.length === 0 && <p>No notes yet.</p>}
    {revisions && !draft && <button type="button" className="pi-primary"
      onClick={() => { setStatus(""); setDraft({ id: crypto.randomUUID(), revision: 0, body: "", author: "" }); }}>Add note</button>}
    {draft && <form onSubmit={save}>
      <fieldset disabled={busy}>
        <legend>{draft.revision ? "Edit note" : "Add note"}</legend>
        <label>Author or source <input required maxLength={120} value={draft.author}
          onChange={(event) => setDraft({ ...draft, author: event.target.value })} /></label>
        <label>Note <textarea required maxLength={2000} rows={4} value={draft.body}
          onChange={(event) => setDraft({ ...draft, body: event.target.value })} /></label>
        <button type="submit" className="pi-primary">Save note</button>{" "}
        <button type="button" onClick={() => setDraft(undefined)}>Cancel</button>
      </fieldset>
    </form>}
    {[...groups.values()].map((history) => {
      const [current, ...previous] = [...history].sort((a, b) => b.revision - a.revision);
      return <article key={current.note_id} className="pi-record">
        <p>{current.body}</p><small>{current.author} · {current.recorded_at}</small>{" "}
        {!draft && <button type="button" onClick={() => setDraft({
          id: current.note_id, revision: current.revision, author: current.author, body: current.body,
        })}>Edit note</button>}
        {previous.length > 0 && <details><summary>Previous versions ({previous.length})</summary>
          {previous.map((item) => <div key={item.revision}>
            <p>{item.body}</p><small>{item.author} · {item.recorded_at}</small>
          </div>)}
        </details>}
      </article>;
    })}
  </section>;
}
