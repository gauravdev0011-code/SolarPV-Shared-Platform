import {useEffect,useState} from 'react';
import {api} from '../../api/solaris';

interface Dataset {dataset_id:string;name:string;latest_version_state:string;approved_version_number:number|null;updated_at:string;created_at:string;latest_version_number:number;source_name?:string|null;source_row_count?:number|null;source_size_bytes?:number|null}
export default function RecentImports({workspaceId,selected,onSelect,refresh=0}:{workspaceId:string;selected:string;onSelect:(id:string)=>void;refresh?:number}){
  const [search,setSearch]=useState(''),[offset,setOffset]=useState(0),[retry,setRetry]=useState(0);
  const [items,setItems]=useState<Dataset[]>([]),[total,setTotal]=useState(0),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  useEffect(()=>{let active=true;const controller=new AbortController();setBusy(true);setItems([]);setError('');
    const timer=setTimeout(()=>{api.datasets(workspaceId,controller.signal,{search,offset,limit:6}).then(data=>{if(active){if(!Array.isArray(data.items)||!data.items.every(item=>item&&typeof item.dataset_id==='string'&&typeof item.name==='string')||!Number.isFinite(data.total)||data.total<0)throw new Error('Invalid dataset list response');setItems(data.items);setTotal(data.total);}}).catch(e=>{if(active&&e.name!=='AbortError')setError('Recent imports could not load. Retry.');}).finally(()=>{if(active)setBusy(false);});},200);
    return()=>{active=false;clearTimeout(timer);controller.abort();};
  },[workspaceId,search,offset,retry,refresh]);
  return <aside className="recent-imports intelligent-card" aria-label="Recent imports"><header><h2>Recent Imports</h2><button type="button" onClick={()=>setRetry(n=>n+1)}>Refresh</button></header>
    <label>Search datasets<input id="recent-dataset-search" type="search" value={search} onChange={e=>{setSearch(e.target.value);setOffset(0);}}/></label>
    {busy&&<p role="status">Loading accessible datasets…</p>}{error&&<p role="alert">{error}<button type="button" onClick={()=>setRetry(n=>n+1)}>Retry recent imports</button></p>}
    {!busy&&!error&&!items.length&&<p>No matching datasets. Import a CSV or JSON file to begin.</p>}
    <ul>{items.map(item=><li key={item.dataset_id}><button type="button" aria-pressed={selected===item.dataset_id} onClick={()=>onSelect(item.dataset_id)}><span className="recent-file-icon" aria-hidden="true">▤</span><span><strong>{item.name}</strong><small>{item.source_name??'Source metadata unavailable'}{item.source_size_bytes!=null?` · ${item.source_size_bytes.toLocaleString()} bytes`:''}</small><small>Version {item.latest_version_number} · {item.latest_version_state}{item.source_row_count!=null?` · ${item.source_row_count.toLocaleString()} records`:''}</small><small>{item.approved_version_number?`Approved version ${item.approved_version_number}`:'Approval not recorded'} · Activity {item.updated_at||item.created_at}</small><small>Open for verified time coverage</small></span></button></li>)}</ul>
    <nav aria-label="Recent import pages"><button type="button" disabled={busy||offset===0} onClick={()=>setOffset(n=>Math.max(0,n-6))}>Previous imports</button><span>{total?`${offset+1}–${Math.min(offset+6,total)} of ${total}`:'0 datasets'}</span><button type="button" disabled={busy||offset+6>=total} onClick={()=>setOffset(n=>n+6)}>Next imports</button></nav>
  </aside>;
}
