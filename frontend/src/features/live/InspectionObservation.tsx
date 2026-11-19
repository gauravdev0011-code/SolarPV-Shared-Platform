import {useEffect,useState} from 'react';
import {api} from '../../api/solaris';
import RecordTable from './RecordTable';

export default function InspectionObservation({workspaceId,id,initiallyOpen=false}:{workspaceId:string;id:number;initiallyOpen?:boolean}){
  const [open,setOpen]=useState(initiallyOpen),[offset,setOffset]=useState(0),[retry,setRetry]=useState(0);
  const [data,setData]=useState<Awaited<ReturnType<typeof api.inspection>>|null>(null),[loading,setLoading]=useState(false),[error,setError]=useState('');
  useEffect(()=>{
    if(!open)return;
    let active=true;const controller=new AbortController();setData(null);setError('');setLoading(true);
    api.inspection(workspaceId,id,controller.signal,offset).then(value=>{if(active)setData(value);}).catch(e=>{if(active&&e.name!=='AbortError')setError(e.message);}).finally(()=>{if(active)setLoading(false);});
    return()=>{active=false;controller.abort();};
  },[workspaceId,id,open,offset,retry]);
  const total=data?.observations_page?.total??data?.observations?.length??0;
  return <details className="panel-card" open={open} onToggle={e=>setOpen(e.currentTarget.open)}><summary>Inspection {id} observations</summary>
    {loading&&<p role="status">Loading inspection {id} observations…</p>}{error&&<p role="alert">Could not load inspection {id}: {error}<button type="button" onClick={()=>setRetry(v=>v+1)}>Retry inspection {id}</button></p>}
    {data&&<><p>{data.inspected_at} · {total} observations</p><RecordTable rows={data.observations??[]} columns={['observation_id','observation_type','value','unit','data_quality','finding','source_reference']}/>
      <button type="button" disabled={loading||!offset} onClick={()=>setOffset(v=>Math.max(0,v-100))}>Previous observations</button><span>{total?`${offset+1}–${Math.min(offset+100,total)} of ${total}`:'No observations'}</span><button type="button" disabled={loading||offset+100>=total} onClick={()=>setOffset(v=>v+100)}>Next observations</button></>}
  </details>;
}
