import { useState } from "react";
import type { Workspace } from "../api/solaris";

export type DataMode = "sample" | "live";

export default function WorkspaceControls({ mode, workspaceId, workspaces, onMode, onWorkspace, onCreate, onRename }: {
  mode: DataMode; workspaceId: string; workspaces: Workspace[]; onMode: (mode: DataMode) => void;
  onWorkspace: (id: string) => void; onCreate: (name: string) => void; onRename: (name: string) => void;
}) {
  const [newName, setNewName] = useState(""); const [rename, setRename] = useState("");
  return <div className="workspace-controls" aria-label="Data workspace controls">
    <label>Data mode<select aria-label="Data mode" value={mode} onChange={(event) => onMode(event.target.value as DataMode)}>
      <option value="sample">Sample dashboard</option><option value="live">Live workspace</option>
    </select></label>
    {mode === "live" && <>
      <label>Workspace<select aria-label="Live workspace" value={workspaceId} onChange={(event) => onWorkspace(event.target.value)}>
        {workspaces.map((item) => <option key={item.workspace_id} value={item.workspace_id}>{item.name}</option>)}
      </select></label>
      <details><summary>New workspace</summary><input aria-label="New workspace name" maxLength={200} value={newName} onChange={(event) => setNewName(event.target.value)} /><button type="button" disabled={!newName.trim()} onClick={() => { onCreate(newName.trim()); setNewName(""); }}>Create</button></details>
      <details><summary>Rename</summary><input aria-label="Renamed workspace name" maxLength={200} value={rename} onChange={(event) => setRename(event.target.value)} /><button type="button" disabled={!workspaceId || !rename.trim()} onClick={() => { onRename(rename.trim()); setRename(""); }}>Save</button></details>
    </>}
  </div>;
}
