import { useEffect, useRef, useState } from "react";
import { requestJson } from "../../api/client";

type Backup = { backup_id: string; state: string };
type Result = {state?:string; package_path?:string; database_path?:string; storage_path?:string; active_store_replaced?:boolean};

export default function RecoveryPanel() {
  const [enabled,setEnabled]=useState<boolean|null>(null);
  const [token,setToken]=useState("");
  const [items,setItems]=useState<Backup[]>([]);
  const [selected,setSelected]=useState("");
  const [verified,setVerified]=useState("");
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const [message,setMessage]=useState("");
  const [result,setResult]=useState<Result|null>(null);
  const active=useRef(true);
  useEffect(()=>{
    active.current=true;
    const controller=new AbortController();
    requestJson<{enabled:boolean}>("/recovery/status",{signal:controller.signal}).then(v=>{if(active.current)setEnabled(v.enabled);}).catch(()=>{if(active.current)setError("Recovery configuration could not load. Refresh to retry.");});
    return ()=>{active.current=false;controller.abort();};
  },[]);
  const options=(method="GET"):RequestInit=>({method,headers:{Authorization:`Bearer ${token}`}});
  async function refresh(){
    const value=await requestJson<{items:Backup[]}>("/recovery/backups",options());
    if(active.current)setItems(value.items);
  }
  async function act(action:()=>Promise<void>){
    setBusy(true);setError("");setMessage("");setResult(null);
    try{await action();}catch(cause){if(active.current){setVerified("");setError(cause instanceof Error ? cause.message : "Recovery stopped. Current data was not replaced.");}}
    finally{if(active.current)setBusy(false);}
  }
  return <section className="panel-card live-panel" aria-label="Backup and recovery">
    <h2>Backup and recovery</h2>
    <p>Protect the entire SOLARIS instance, including all workspaces, original files, mappings and approvals. Recovery requires operator access.</p>
    {error && <p role="alert" className="api-error">{error}</p>}
    {enabled===null && !error && <p role="status">Checking recovery configuration…</p>}
    {enabled===false && <p>Recovery controls are disabled. Ask the local operator to configure a private recovery folder and recovery access token. The command-line recovery tool is also available.</p>}
    {enabled && <>
      <label>Recovery operator token<input aria-label="Recovery operator token" type="password" autoComplete="off" value={token} disabled={busy} onChange={e=>{setToken(e.target.value);setItems([]);setVerified("");setSelected("");setResult(null);}}/></label>
      <p>The token stays in memory on this page. It is not saved in browser storage.</p>
      <button type="button" disabled={busy||!token} onClick={()=>void act(async()=>{await refresh();if(active.current)setMessage("Recovery packages loaded. Verify a package before restoring it.");})}>Load recovery packages</button>
      <button type="button" disabled={busy||!token} onClick={()=>void act(async()=>{
        const value=await requestJson<Result>("/recovery/backups",options("POST"));
        if(active.current){setResult(value);setMessage("Backup created and verified. Copy the complete package folder to protected separate storage.");}
        await refresh();
      })}>Create verified backup</button>
      <p>Database writes pause while a coherent copy is captured. Let uploads finish first. Never close the operator's server during a recovery operation.</p>
      <label>Recovery package<select aria-label="Recovery package" value={selected} disabled={busy} onChange={e=>{setSelected(e.target.value);setVerified("");setResult(null);setMessage("");}}><option value="">Select a package</option>{items.map(item=><option key={item.backup_id} value={item.backup_id}>{item.backup_id} — {item.state==="incomplete" ? "Incomplete; cannot restore" : "Ready for verification"}</option>)}</select></label>
      <button type="button" disabled={busy||!selected||!token} onClick={()=>void act(async()=>{
        setVerified("");
        await requestJson(`/recovery/backups/${selected}/verify`,options("POST"));
        if(active.current){setVerified(selected);setMessage("Package verified: database relationships, schema and required file checksums passed.");}
      })}>Verify selected package</button>
      <button type="button" disabled={busy||verified!==selected||!selected||!token} onClick={()=>void act(async()=>{
        const value=await requestJson<Result>(`/recovery/backups/${selected}/restore`,options("POST"));
        if(active.current){setResult(value);setMessage("A separate restored copy was created and verified. Current data was not replaced. Ask the operator to open the recovered copy when ready.");}
      })}>Restore to a new copy</button>
      {busy && <p role="status">Recovery operation in progress. Please wait for a verified result.</p>}
      {message && <p role="status">{message}</p>}
      {result && <details><summary>Operator paths</summary>{result.package_path && <p>Complete package: <code>{result.package_path}</code></p>}{result.database_path && <><p>Recovered database: <code>{result.database_path}</code></p><p>Recovered private storage: <code>{result.storage_path}</code></p><p>Opening the copy requires restarting the API and worker with these paths. No automatic switch was made.</p></>}</details>}
    </>}
  </section>;
}
