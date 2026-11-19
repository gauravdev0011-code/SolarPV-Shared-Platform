import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import HistoricalChart from './HistoricalChart';
import type {HistoricalReading,HistoricalTrend} from '../../api/types';

afterEach(()=>{cleanup();vi.restoreAllMocks();});
const point=(id:number,seconds:number,value:number|null):HistoricalReading=>({observation_id:id,inspection_id:id,timestamp:`source-${id}`,metric:'temperature',value,unit:'C',reading_status:value===null?'missing':'recorded',data_quality:'good',source_reference:'fixture',plot_seconds:seconds,break_before:false,flags:[]});
function chart(points:HistoricalReading[]):HistoricalTrend['chart']{return {points,available:true,unit:'C',units:['C'],unavailable_reason:null,source_count:points.length,valid_count:points.filter(p=>p.value!==null).length,excluded_count:points.filter(p=>p.value===null).length,source_time_range:['first','last'],plotted_time_range:['first','last'],time_basis:'source clock',sampling:'Fixture; no interpolation',returned_points:points.length,downsampled:false};}

it('uses elapsed seconds rather than array index or browser timestamp parsing',()=>{
  vi.spyOn(Date,'parse').mockImplementation(()=>{throw Error('Do not guess source timezone');});
  render(<HistoricalChart chart={chart([point(1,0,1),point(2,3600,2),point(3,36000,3)])} onInspect={vi.fn()}/>);
  const svg=screen.getByRole('img',{name:'Recorded measurement trend in C'});
  const x=svg.querySelector('polyline')!.getAttribute('points')!.split(' ').map(p=>Number(p.split(',')[0]));
  expect(x).toEqual([55,123,735]);
  expect(screen.getByText('Elapsed time (source clock)')).toBeTruthy();
});

it('breaks at explicit excluded readings and duplicate instants and retains source inspection',()=>{
  const inspect=vi.fn();
  render(<HistoricalChart chart={chart([point(1,0,0),point(2,1,null),point(3,4,3),point(4,4,9),point(5,10,1)])} onInspect={inspect}/>);
  expect(screen.getByRole('img').querySelectorAll('polyline')).toHaveLength(3);
  fireEvent.change(screen.getByLabelText('Inspect historical observation'),{target:{value:'4'}});
  fireEvent.click(screen.getByRole('button',{name:'Inspect observation source'}));
  expect(inspect).toHaveBeenCalledWith(4);
});

it('discloses incompatible units rather than inventing a combined trend',()=>{
  const value={...chart([]),available:false,units:['C','F'],unit:null,unavailable_reason:'Conflicting units; source readings remain available.'};
  render(<HistoricalChart chart={value} onInspect={vi.fn()}/>);
  expect(screen.queryByRole('img')).toBeNull();
  expect(screen.getByRole('status').textContent).toContain('Conflicting units');
});
