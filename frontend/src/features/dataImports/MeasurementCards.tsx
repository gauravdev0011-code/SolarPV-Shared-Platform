import {useEffect,useState} from 'react';
import {api} from '../../api/solaris';
import type {ExplorerResponse,ChartPoint} from '../../api/importTypes';
export type MeasurementField={source_column:string;target_field:string;measurement_unit?:string;value_scale?:string};
function Sparkline({points}:{points:ChartPoint[]}){
  const valid=points.filter(p=>p.value!==null&&p.plot_seconds!=null),values=valid.map(p=>p.value as number);
  if(!valid.length)return null;
  const low=Math.min(...values),high=Math.max(...values),first=valid[0].plot_seconds!,last=valid.at(-1)!.plot_seconds!;
  const segments:string[][]=[];let current:string[]=[];
  for(const point of points){if(point.value===null||point.plot_seconds==null||point.break_before){if(current.length)segments.push(current);current=[];}if(point.value!==null&&point.plot_seconds!=null)current.push(`${5+(point.plot_seconds-first)/Math.max(1,last-first)*170},${40-(point.value-low)/Math.max(1,high-low)*32}`);}
  if(current.length)segments.push(current);
  return <svg viewBox="0 0 180 48" aria-hidden="true">{segments.map((segment,index)=><polyline key={index} points={segment.join(' ')} fill="none" stroke="currentColor" strokeWidth="2"/>)}</svg>;
}
export default function MeasurementCards({workspaceId,dataset,version,fields,selected,onSelect}:{workspaceId:string;dataset:string;version:string;fields:MeasurementField[];selected:string;onSelect:(field:string)=>void}){
  const [offset,setOffset]=useState(0),[views,setViews]=useState<Record<string,ExplorerResponse>>({}),[error,setError]=useState(''),[retry,setRetry]=useState(0);
  const signature=JSON.stringify(fields);
  useEffect(()=>{let active=true;const controller=new AbortController();setViews({});setError('');
    Promise.all(fields.slice(offset,offset+4).map(async field=>{const view=await api.explorer(workspaceId,dataset,version,{field:field.source_column,limit:1},controller.signal);if(!view.chart||!Array.isArray(view.chart.points))throw new Error('Invalid measurement response');return [field.source_column,view] as const;})).then(entries=>{if(active)setViews(Object.fromEntries(entries));}).catch(e=>{if(active&&e.name!=='AbortError')setError('Measurement summaries could not load. Retry.');});
    return()=>{active=false;controller.abort();};
  },[workspaceId,dataset,version,signature,offset,retry]);
  return <section className="measurement-summary" aria-label="Measurement summaries"><div className="measurement-card-row">{fields.slice(offset,offset+4).map(field=>{
    const chart=views[field.source_column]?.chart,last=chart?.latest_reading??chart?.points.filter(p=>p.value!==null).at(-1);
    return <button type="button" className="measurement-summary-card" aria-pressed={selected===field.source_column} key={field.source_column} onClick={()=>onSelect(field.source_column)}><span>{field.target_field.replaceAll('_',' ')}</span><strong>{last?.value!=null?last.value.toLocaleString(undefined,{maximumFractionDigits:3}):chart?'No plottable readings':'Loading…'} <small>{chart?.unit??field.measurement_unit}</small></strong><small>{last?.timestamp?`Latest plotted: ${last.timestamp}`:'Scale, units and validation must be verified'}</small>{chart&&<Sparkline points={chart.points}/>}<small>{chart?`${chart.excluded_count} excluded · ${chart.downsampled?'extrema sampled':'source readings'}`:'Awaiting backend'}; not a scientific approval</small></button>;
  })}</div>{error&&<p role="alert">{error}<button type="button" onClick={()=>setRetry(n=>n+1)}>Retry measurement summaries</button></p>}{fields.length>4&&<nav aria-label="Measurement summary pages"><button type="button" disabled={!offset} onClick={()=>setOffset(n=>Math.max(0,n-4))}>Previous measurements</button><button type="button" disabled={offset+4>=fields.length} onClick={()=>setOffset(n=>n+4)}>More measurements</button></nav>}<p className="measurement-summary-note">Latest available plotted values over the source range; gaps retained, decimal plotting approximations. These are not averages or energy totals.</p></section>;
}
