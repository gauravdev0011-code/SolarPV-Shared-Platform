import {useEffect,useState} from 'react';
import {api} from '../../api/solaris';

type Choice={id:string;label:string};
function Picker({workspaceId,assetId,value,onChange}:{workspaceId:string;assetId?:string;value:string;onChange:(value:string)=>void}){
  const metric=assetId!==undefined;
  const [search,setSearch]=useState(''),[offset,setOffset]=useState(0),[retry,setRetry]=useState(0);
  const [items,setItems]=useState<Choice[]>([]),[total,setTotal]=useState(0),[loading,setLoading]=useState(false),[error,setError]=useState('');
  const [selected,setSelected]=useState<Choice|null>(null);
  useEffect(()=>{
    let active=true;const controller=new AbortController();setLoading(true);setError('');setItems([]);
    const params={limit:20,offset,search:search||undefined};
    const request=metric?api.metrics(workspaceId,Number(assetId),params,controller.signal).then(v=>({total:v.total,items:v.items.map(item=>({id:item.metric,label:`${item.metric} (${item.record_count} records)`}))})):api.assets(workspaceId,params,controller.signal).then(v=>({total:v.total,items:v.items.map(item=>({id:String(item.asset_id),label:item.external_id||item.name}))}));
    request.then(v=>{if(active){setItems(v.items);setTotal(v.total);}}).catch(e=>{if(active&&e.name!=='AbortError')setError(e.message);}).finally(()=>{if(active)setLoading(false);});
    return()=>{active=false;controller.abort();};
  },[workspaceId,assetId,search,offset,retry]);
  const noun=metric?'metrics':'assets';
  return <fieldset className="history-picker"><legend>{metric?'Recorded metric':'Asset'}</legend><label>Search {noun}<input aria-label={`Search ${noun}`} value={search} onChange={e=>{setSearch(e.target.value);setOffset(0);}}/></label>
    <label>{metric?'Recorded metric':'Asset'}<select aria-label={metric?'Recorded measurement metric':'Trend asset'} value={value} onChange={e=>{const item=items.find(i=>i.id===e.target.value);setSelected(item??null);onChange(e.target.value);}}><option value="">{metric?'Select recorded metric':'Select asset'}</option>{value&&!items.some(i=>i.id===value)&&<option value={value}>{selected?.id===value?selected.label:value} (selected)</option>}{items.map(item=><option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
    {loading&&<p role="status">Loading {noun}…</p>}{error&&<p role="alert">{error}<button type="button" onClick={()=>setRetry(v=>v+1)}>Retry {noun}</button></p>}
    {!loading&&!error&&<span>{total} matching {noun}; page {offset/20+1}</span>}
    <button type="button" disabled={!offset||loading} onClick={()=>setOffset(v=>Math.max(0,v-20))}>Previous {noun}</button><button type="button" disabled={loading||offset+20>=total} onClick={()=>setOffset(v=>v+20)}>Next {noun}</button>
  </fieldset>;
}
export function HistoryAssetPicker(props:{workspaceId:string;value:string;onChange:(value:string)=>void}){return <Picker key={props.workspaceId} {...props}/>;}
export function HistoryMetricPicker(props:{workspaceId:string;assetId:string;value:string;onChange:(value:string)=>void}){return <Picker key={`${props.workspaceId}:${props.assetId}`} {...props}/>;}
