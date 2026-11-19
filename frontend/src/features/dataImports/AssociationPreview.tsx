import {useEffect,useRef,useState} from 'react';
import {api,type AssociationColumns,type AssociationPreview as Preview} from '../../api/solaris';
import './associationPreview.css';

const empty:AssociationColumns={external_id:null,asset_id:null,name:null,asset_type:null};
export default function AssociationPreview({workspaceId,dataset,version,columns}:{workspaceId:string;dataset:string;version:string;columns:string[]}){
  const [selected,setSelected]=useState<AssociationColumns>({...empty}),[result,setResult]=useState<Preview|null>(null);
  const [error,setError]=useState(''),[busy,setBusy]=useState(false);
  const epoch=useRef(0),controller=useRef<AbortController|null>(null);
  useEffect(()=>()=>{epoch.current++;controller.current?.abort();},[]);
  useEffect(()=>{epoch.current++;controller.current?.abort();setSelected({...empty});setResult(null);setError('');setBusy(false);},[workspaceId,dataset,version]);
  function change(key:keyof AssociationColumns,value:string){epoch.current++;controller.current?.abort();setSelected(current=>({...current,[key]:value||null}));setResult(null);setError('');setBusy(false);}
  async function load(offset:number){const current=++epoch.current;controller.current?.abort();const abort=new AbortController();controller.current=abort;setResult(null);setError('');setBusy(true);
    try{const next=await api.associationPreview(workspaceId,dataset,version,selected,offset,abort.signal);if(current===epoch.current)setResult(next);}
    catch(e){if(current===epoch.current&&(e as Error).name!=='AbortError')setError((e as Error).message);}
    finally{if(current===epoch.current)setBusy(false);}
  }
  return <section className="intelligent-card equipment-association" aria-label="Equipment association preview"><h2>Equipment association preview</h2>
    <p>Preview only. No equipment relationships, visits or observations are saved. Exact identifiers support candidates; names alone never establish identity. Synthetic equipment is labelled.</p>
    <form onSubmit={e=>{e.preventDefault();void load(0);}}><fieldset><legend>Select original source identifier columns</legend>
      {([['external_id','External equipment identifier'],['asset_id','Internal asset ID'],['name','Equipment name'],['asset_type','Equipment type']] as const).map(([key,label])=><label key={key}>{label}<select value={selected[key]??''} onChange={e=>change(key,e.target.value)}><option value="">Not supplied</option>{columns.map(column=><option key={column} value={column}>{column}</option>)}</select></label>)}
      <button type="submit" disabled={busy||!Object.values(selected).some(Boolean)}>Preview source matches</button>
    </fieldset></form>
    {busy&&<p role="status">Checking source and workspace equipment…</p>}{error&&<p role="alert">{error} Retry the preview after correcting the request.</p>}
    {result&&<><p role="status">{result.blocked_reason}</p>{result.scientific_warnings.map(w=><p key={w.code}>{w.message}</p>)}
      <details><summary>Source and validation lineage</summary><dl>{Object.entries(result.provenance).map(([key,value])=><div key={key}><dt>{key.replaceAll('_',' ')}</dt><dd>{value??'Not available'}</dd></div>)}</dl><p>Preview revision: {result.preview_revision}. Refresh after equipment or validation changes; this is not an approval token.</p></details>
      <div className="intelligent-table-scroll"><table className="intelligent-table"><caption>Proposed candidates only; no committed associations</caption><thead><tr><th scope="col">Source row / identifiers</th><th scope="col">Result</th><th scope="col">Workspace candidates</th><th scope="col">Evidence</th></tr></thead><tbody>{result.items.map(row=><tr key={row.source_row}><th scope="row">{row.source_row}<pre>{JSON.stringify(row.identifiers,null,2)}</pre></th><td>{row.association_status.replaceAll('_',' ')}<p>{row.reason}</p></td><td>{row.candidates.map(c=><p key={c.asset_id}>{c.name} ({c.external_id??`ID ${c.asset_id}`}) — {c.asset_type}; {c.data_origin}</p>)}{row.candidates_truncated&&<p>More than 20 candidates. Supply a unique identifier.</p>}</td><td><p>Validation: {row.status}</p><details><summary>Original readings, timestamps and units</summary><pre>{JSON.stringify({original:row.original,normalized:row.normalized},null,2)}</pre></details></td></tr>)}</tbody></table></div>
      {!result.items.length&&<p>No source records on this page.</p>}<div><button type="button" disabled={busy||result.offset===0} onClick={()=>void load(Math.max(0,result.offset-result.limit))}>Previous source matches</button><span> {result.items.length?result.offset+1:0}-{result.items.length?result.offset+result.items.length:0} of {result.total} source rows </span><button type="button" disabled={busy||result.offset+result.limit>=result.total} onClick={()=>void load(result.offset+result.limit)}>Next source matches</button><button type="button" disabled={busy} onClick={()=>void load(result.offset)}>Refresh preview</button></div>
    </>}
  </section>;
}
