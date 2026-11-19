import {useEffect,useState} from 'react';
import {api} from '../../api/solaris';
import RecordTable from './RecordTable';
import InspectionObservation from './InspectionObservation';

export default function AssetDetailsPanel({workspaceId,assetId}:{workspaceId:string;assetId:string}){
  const [offset,setOffset]=useState(0),[retry,setRetry]=useState(0),[error,setError]=useState('');
  const [data,setData]=useState<{asset:Awaited<ReturnType<typeof api.asset>>;history:Awaited<ReturnType<typeof api.assetInspections>>}|null>(null);
  useEffect(()=>{
    let active=true;const controller=new AbortController();setData(null);setError('');
    Promise.all([api.asset(workspaceId,Number(assetId),controller.signal),api.assetInspections(workspaceId,Number(assetId),controller.signal,offset)])
      .then(([asset,history])=>{if(active)setData({asset,history});}).catch(e=>{if(active&&e.name!=='AbortError')setError(e.message);});
    return()=>{active=false;controller.abort();};
  },[workspaceId,assetId,offset,retry]);
  if(error)return <p role="alert">Asset details could not load: {error}<button type="button" onClick={()=>setRetry(v=>v+1)}>Retry asset details</button></p>;
  if(!data)return <p role="status">Loading selected asset and history…</p>;
  return <section aria-label="Selected asset history"><h3>{data.asset.external_id||data.asset.name} · Recorded asset details</h3><pre>{JSON.stringify(data.asset,null,2)}</pre><h4>Recorded inspection history</h4><RecordTable rows={data.history.items} columns={['inspection_id','inspected_at','inspection_method','data_source','status','notes']}/>
    <button type="button" disabled={!offset} onClick={()=>setOffset(v=>Math.max(0,v-50))}>Previous asset inspections</button><span>{data.history.total} inspections · page {offset/50+1}</span><button type="button" disabled={offset+50>=data.history.total} onClick={()=>setOffset(v=>v+50)}>Next asset inspections</button>
    {data.history.items.map(item=><InspectionObservation key={item.inspection_id} workspaceId={workspaceId} id={item.inspection_id}/>)}
  </section>;
}
