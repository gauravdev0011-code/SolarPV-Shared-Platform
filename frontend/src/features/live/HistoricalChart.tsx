import {useEffect,useState} from 'react';
import type {HistoricalReading,HistoricalTrend} from '../../api/types';

export default function HistoricalChart({chart,onInspect}:{chart:HistoricalTrend['chart'];onInspect:(inspectionId:number)=>void}){
  const [focus,setFocus]=useState<HistoricalReading|null>(null),[lookup,setLookup]=useState('');
  useEffect(()=>{setFocus(null);setLookup('');},[chart]);
  if(!chart.available)return <p role="status">{chart.unavailable_reason||'A reliable chart is unavailable. All readings remain in the table.'}</p>;
  const valid=chart.points.filter(p=>p.value!==null&&Number.isFinite(p.value)&&Number.isFinite(p.plot_seconds));
  if(valid.length<2)return <p>At least two recorded numeric readings are required.</p>;
  const first=Math.min(...valid.map(p=>p.plot_seconds)),last=Math.max(...valid.map(p=>p.plot_seconds));
  const low=Math.min(...valid.map(p=>p.value!)),high=Math.max(...valid.map(p=>p.value!));
  const xy=(p:HistoricalReading)=>({x:55+(p.plot_seconds-first)/Math.max(last-first,1)*680,y:190-(p.value!-low)/Math.max(high-low,1)*150});
  const segments:string[]=[];let segment:string[]=[];let prior:number|null=null;
  for(const point of chart.points){
    if(point.value===null||!Number.isFinite(point.plot_seconds)){if(segment.length)segments.push(segment.join(' '));segment=[];prior=null;continue;}
    if(point.break_before||prior!==null&&point.plot_seconds<=prior){if(segment.length)segments.push(segment.join(' '));segment=[];}
    const {x,y}=xy(point);segment.push(`${x},${y}`);prior=point.plot_seconds;
  }
  if(segment.length)segments.push(segment.join(' '));
  return <div className="historical-chart"><svg viewBox="0 0 790 260" role="img" aria-label={`Recorded measurement trend in ${chart.unit}`} onPointerMove={e=>{
    const rect=e.currentTarget.getBoundingClientRect();if(!rect.width)return;
    const x=(e.clientX-rect.left)*790/rect.width;
    const nearest=valid.reduce((a,b)=>Math.abs(xy(a).x-x)<Math.abs(xy(b).x-x)?a:b);
    setFocus(old=>old?.observation_id===nearest.observation_id?old:nearest);
  }}>
    <path d="M55 25V190H735" fill="none" stroke="#687f99"/>
    <text x="48" y="40" textAnchor="end">{high.toPrecision(5)}</text><text x="48" y="190" textAnchor="end">{low.toPrecision(5)}</text>
    <text x="55" y="16">{chart.unit}</text>
    {segments.map((points,index)=><polyline key={index} points={points} fill="none" stroke="#0874d1" strokeWidth="2"/>)}
    <path fill="#0874d1" data-reading-count={valid.length} d={valid.map(p=>{const{x,y}=xy(p);return `M${x-2},${y}a2,2 0 1,0 4,0a2,2 0 1,0 -4,0`;}).join(' ')}/>
    <text x="55" y="214">{chart.plotted_time_range?.[0]}</text><text x="735" y="234" textAnchor="end">{chart.plotted_time_range?.[1]}</text><text x="395" y="255" textAnchor="middle">Elapsed time ({chart.time_basis})</text>
  </svg>
    <p>{chart.valid_count.toLocaleString()} recorded readings; {chart.excluded_count.toLocaleString()} excluded missing/invalid/suspect readings. Explicit gaps and duplicate instants are not connected.</p>
    <label>Inspect observation<input aria-label="Inspect historical observation" type="number" min="1" value={lookup} onChange={e=>{setLookup(e.target.value);setFocus(chart.points.find(p=>p.observation_id===Number(e.target.value))??null);}}/></label>
    {lookup&&!focus&&<p>That observation is not in the displayed sample. Use the paged readings table and its inspection identifier.</p>}
    {focus&&<output>{focus.timestamp}: {focus.value??'Excluded'} {chart.unit}; observation {focus.observation_id}; inspection {focus.inspection_id} <button type="button" onClick={()=>onInspect(focus.inspection_id)}>Inspect observation source</button></output>}
  </div>;
}
