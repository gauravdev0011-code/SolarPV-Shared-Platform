import {useEffect,useState} from 'react';
import {api} from '../../api/solaris';
import type {HistoricalTrend} from '../../api/types';
import {HistoryAssetPicker,HistoryMetricPicker} from './HistoryPickers';
import RecordTable from './RecordTable';
import HistoricalChart from './HistoricalChart';
import InspectionObservation from './InspectionObservation';
import './historyViews.css';

export default function ConditionHistory({workspaceId}:{workspaceId:string}){return <HistoryView key={workspaceId} workspaceId={workspaceId}/>;}
function HistoryView({workspaceId}:{workspaceId:string}){
  const [asset,setAsset]=useState(''),[metric,setMetric]=useState(''),[start,setStart]=useState(''),[end,setEnd]=useState('');
  const [offset,setOffset]=useState(0),[retry,setRetry]=useState(0),[inspection,setInspection]=useState<number|null>(null);
  const [data,setData]=useState<HistoricalTrend|null>(null),[loading,setLoading]=useState(false),[error,setError]=useState('');
  useEffect(()=>{
    setData(null);setError('');setInspection(null);
    if(!asset||!metric){setLoading(false);return;}
    let active=true;const controller=new AbortController();setLoading(true);
    api.trend(workspaceId,Number(asset),metric,controller.signal,{offset,limit:50,start:start||undefined,end:end||undefined})
      .then(value=>{if(active)setData(value);}).catch(e=>{if(active&&e.name!=='AbortError')setError(e.message);}).finally(()=>{if(active)setLoading(false);});
    return()=>{active=false;controller.abort();};
  },[workspaceId,asset,metric,start,end,offset,retry]);
  return <section className="module-content historical-browser"><h2>Condition Analysis — Recorded history</h2><p>Observed measurements only. No equipment health or deterioration classification is inferred.</p>
    <HistoryAssetPicker workspaceId={workspaceId} value={asset} onChange={value=>{setAsset(value);setMetric('');setOffset(0);}}/>
    {asset&&<HistoryMetricPicker workspaceId={workspaceId} assetId={asset} value={metric} onChange={value=>{setMetric(value);setOffset(0);}}/>}
    <div className="module-filter-bar"><label>Start date<input aria-label="Historical start date" type="date" value={start} onChange={e=>{setStart(e.target.value);setOffset(0);}}/></label><label>End date<input aria-label="Historical end date" type="date" value={end} onChange={e=>{setEnd(e.target.value);setOffset(0);}}/></label><button type="button" onClick={()=>{setStart('');setEnd('');setOffset(0);}}>All historical dates</button></div>
    {!asset||!metric?<p>Select an asset and a recorded metric. Search and paging include older records.</p>:null}
    {loading&&<p role="status">Loading recorded history…</p>}{error&&<p role="alert">History could not load: {error}<button type="button" onClick={()=>setRetry(v=>v+1)}>Retry history</button></p>}
    {data&&<><section className="panel-card live-panel"><h3>Recorded measurements</h3><p>Selected source interval: {data.chart.source_time_range?.join(' to ')??'No records'} · {data.chart.source_count} source records.</p><HistoricalChart chart={data.chart} onInspect={setInspection}/>
      <details><summary>Coverage, units and sampling</summary><p>{data.chart.sampling}</p><p>{data.chart.returned_points} chart points; {data.chart.downsampled?'downsampled with extrema preserved':'not downsampled'}. Chart coverage is independent of the readings-table page.</p><p>Units: {data.chart.units.map(unit=>unit??'Unknown').join(', ')||'No numeric recorded units'}</p><p>{data.timestamp_policy}</p><p>{data.provenance}</p></details></section>
      <section className="panel-card live-panel"><h3>Readings and provenance</h3><p>{data.total?`${offset+1}–${Math.min(offset+50,data.total)} of ${data.total}`:'No matching readings'}. {data.truncated?'This table is paged; it does not show every selected source record at once.':'All selected readings are shown.'}</p><RecordTable rows={data.items} columns={['observation_id','timestamp','metric','value','unit','reading_status','data_quality','source_reference','inspection_id']}/>
        <button type="button" disabled={!offset||loading} onClick={()=>setOffset(v=>Math.max(0,v-50))}>Previous readings</button><button type="button" disabled={!data.has_more||loading} onClick={()=>setOffset(v=>v+50)}>Next readings</button>
        <label>Inspection source<input aria-label="Open historical inspection" type="number" min="1" value={inspection??''} onChange={e=>setInspection(e.target.value?Number(e.target.value):null)}/></label>
      </section></>}
    {inspection&&<InspectionObservation key={`${workspaceId}:${inspection}`} workspaceId={workspaceId} id={inspection} initiallyOpen/>}
  </section>;
}
