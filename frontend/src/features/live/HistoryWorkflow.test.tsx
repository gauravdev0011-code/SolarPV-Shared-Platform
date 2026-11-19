import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {api} from '../../api/solaris';
import ConditionHistory from './ConditionHistory';
import AssetDetailsPanel from './AssetDetailsPanel';
import InspectionObservation from './InspectionObservation';
import LiveWorkspacePage from './LiveWorkspacePage';

afterEach(()=>{cleanup();vi.restoreAllMocks();});
const asset=(id:number)=>({asset_id:id,external_id:`FIX-${id}`,name:`Fictional ${id}`,asset_type:'panel'} as any);
const points=Array.from({length:51},(_,index)=>({observation_id:index+1,inspection_id:index+1,timestamp:`2026-09-01T${String(Math.floor(index/60)).padStart(2,'0')}:${String(index%60).padStart(2,'0')}:00Z`,plot_seconds:index*60,value:index,unit:'C',reading_status:'recorded',metric:'old-only',data_quality:'good',source_reference:'fixture',flags:[],break_before:false}));
const trend=(offset=0)=>({items:points.slice(offset,offset+50),offset,limit:50,total:51,has_more:offset===0,truncated:true,timestamp_policy:'Fixture UTC policy',provenance:'Fictional source',chart:{points,available:true,unit:'C',units:['C'],unavailable_reason:null,source_count:51,valid_count:51,excluded_count:0,source_time_range:[points[0].timestamp,points[50].timestamp],plotted_time_range:[points[0].timestamp,points[50].timestamp],time_basis:'UTC',sampling:'Full source fixture',returned_points:51,downsampled:false}} as any);

function mocks(){
  const assets=vi.spyOn(api,'assets').mockImplementation(async(_w,params)=>({items:[asset(params.offset===20||params.search?121:1)],total:params.search?1:121,offset:params.offset,limit:20} as any));
  const metrics=vi.spyOn(api,'metrics').mockImplementation(async(_w,_id,params)=>({items:[{metric:'old-only',record_count:51}],total:21,offset:Number(params.offset),limit:20}));
  const readings=vi.spyOn(api,'trend').mockImplementation(async(_w,_id,_metric,_signal,params)=>trend(Number(params?.offset??0)));
  vi.spyOn(api,'inspection').mockResolvedValue({inspection_id:1,inspected_at:'2026-09-01',observations:[],observations_page:{total:0,offset:0,limit:100,has_more:false}} as any);
  return {assets,metrics,readings};
}
async function select(){
  await screen.findByRole('option',{name:'FIX-1'});
  fireEvent.change(screen.getByLabelText('Trend asset'),{target:{value:'1'}});
  await screen.findByRole('option',{name:'old-only (51 records)'});
  fireEvent.change(screen.getByLabelText('Recorded measurement metric'),{target:{value:'old-only'}});
}

it('discovers later assets and older metrics, pages readings without changing chart coverage, and resets filters',async()=>{
  const {assets,metrics,readings}=mocks();render(<ConditionHistory workspaceId="workspace"/>);
  await screen.findByRole('option',{name:'FIX-1'});
  fireEvent.click(screen.getByRole('button',{name:'Next assets'}));
  await screen.findByRole('option',{name:'FIX-121'});
  fireEvent.change(screen.getByLabelText('Trend asset'),{target:{value:'121'}});
  await screen.findByRole('option',{name:'old-only (51 records)'});
  fireEvent.click(screen.getByRole('button',{name:'Next metrics'}));
  await waitFor(()=>expect(metrics).toHaveBeenLastCalledWith('workspace',121,expect.objectContaining({offset:20}),expect.any(AbortSignal)));
  fireEvent.change(screen.getByLabelText('Recorded measurement metric'),{target:{value:'old-only'}});
  await screen.findByRole('img');
  expect(screen.getByText(/51 source records/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button',{name:'Next readings'}));
  await waitFor(()=>expect(readings).toHaveBeenLastCalledWith('workspace',121,'old-only',expect.any(AbortSignal),expect.objectContaining({offset:50})));
  await screen.findByRole('img');expect(screen.getByText(/51 source records/)).toBeTruthy();
  fireEvent.change(screen.getByLabelText('Historical start date'),{target:{value:'2026-09-01'}});
  await waitFor(()=>expect(readings).toHaveBeenLastCalledWith('workspace',121,'old-only',expect.any(AbortSignal),expect.objectContaining({offset:0,start:'2026-09-01'})));
  expect(assets.mock.calls.some(call=>call[1].offset===20)).toBe(true);
  fireEvent.change(screen.getByLabelText('Search metrics'),{target:{value:'old'}});
  await waitFor(()=>expect(metrics).toHaveBeenLastCalledWith('workspace',121,expect.objectContaining({offset:0,search:'old'}),expect.any(AbortSignal)));
  fireEvent.change(screen.getByLabelText('Search assets'),{target:{value:'late'}});
  await waitFor(()=>expect(assets).toHaveBeenLastCalledWith('workspace',expect.objectContaining({offset:0,search:'late'}),expect.any(AbortSignal)));
});

it('shows a retryable history error without hiding discovery controls',async()=>{
  const {readings}=mocks();readings.mockRejectedValueOnce(new Error('fixture query failure'));
  render(<ConditionHistory workspaceId="workspace"/>);await select();
  expect(await screen.findByRole('alert')).toBeTruthy();expect(screen.getByLabelText('Trend asset')).toBeTruthy();
  fireEvent.click(screen.getByRole('button',{name:'Retry history'}));
  expect(await screen.findByRole('img')).toBeTruthy();
});

it('ignores a stale asset-detail response after selection changes',async()=>{
  let finish:(value:any)=>void=()=>{};const old=new Promise(resolve=>{finish=resolve;});
  vi.spyOn(api,'asset').mockImplementation(async(_w,id)=>id===1?old as any:asset(2));
  vi.spyOn(api,'assetInspections').mockResolvedValue({items:[],total:0,offset:0,limit:50});
  const view=render(<AssetDetailsPanel workspaceId="workspace" assetId="1"/>);
  view.rerender(<AssetDetailsPanel workspaceId="workspace" assetId="2"/>);
  await screen.findByRole('heading',{name:/FIX-2/});
  await act(async()=>{finish(asset(1));await old;});
  expect(screen.queryByRole('heading',{name:/FIX-1/})).toBeNull();
});

it('ignores stale metric history and clears selection when workspace changes',async()=>{
  const {metrics,readings}=mocks();
  metrics.mockResolvedValue({items:[{metric:'old-only',record_count:51},{metric:'new-metric',record_count:51}],total:2,offset:0,limit:20});
  let finish:(value:any)=>void=()=>{};const old=new Promise(resolve=>{finish=resolve;});
  const updated={...trend(),items:[{...points[0],source_reference:'new-source-evidence'}]};
  readings.mockImplementation(async(_w,_id,metric)=>metric==='old-only'?old as any:updated);
  const view=render(<ConditionHistory workspaceId="workspace"/>);await select();
  fireEvent.change(screen.getByLabelText('Recorded measurement metric'),{target:{value:'new-metric'}});
  await screen.findByText('new-source-evidence');
  await act(async()=>{finish(trend());await old;});
  expect(screen.getByText('new-source-evidence')).toBeTruthy();
  view.rerender(<ConditionHistory workspaceId="another-workspace"/>);
  expect(screen.queryByText('new-source-evidence')).toBeNull();
  expect(screen.queryByRole('img')).toBeNull();
});

it('retries a failed inspection and pages its observations beyond 100',async()=>{
  const inspection=vi.spyOn(api,'inspection').mockRejectedValueOnce(new Error('Fictional unavailable report')).mockImplementation(async(_w,_id,_signal,offset)=>({inspection_id:15,inspected_at:'2026-09-01',observations:[{observation_id:offset?151:1,observation_type:'temperature',value:0,unit:'C'}],observations_page:{total:151,limit:100,offset:offset??0,has_more:!offset}} as any));
  render(<InspectionObservation workspaceId="workspace" id={15} initiallyOpen/>);
  expect(await screen.findByRole('alert')).toBeTruthy();
  fireEvent.click(screen.getByRole('button',{name:'Retry inspection 15'}));
  await screen.findByText('151 observations',{exact:false});
  fireEvent.click(screen.getByRole('button',{name:'Next observations'}));
  await waitFor(()=>expect(inspection).toHaveBeenLastCalledWith('workspace',15,expect.any(AbortSignal),100));
});

it('pages selected asset history beyond the former 100-inspection cap',async()=>{
  vi.spyOn(api,'asset').mockResolvedValue(asset(1));
  const history=vi.spyOn(api,'assetInspections').mockImplementation(async(_w,_id,_signal,offset=0)=>({items:[{inspection_id:offset+1,inspected_at:'2026-09-01'}],total:101,limit:50,offset} as any));
  render(<AssetDetailsPanel workspaceId="workspace" assetId="1"/>);
  await screen.findByText('Inspection 1 observations');
  fireEvent.click(screen.getByRole('button',{name:'Next asset inspections'}));
  await screen.findByText('Inspection 51 observations');
  fireEvent.click(screen.getByRole('button',{name:'Next asset inspections'}));
  await screen.findByText('Inspection 101 observations');
  expect(history).toHaveBeenLastCalledWith('workspace',1,expect.any(AbortSignal),100);
  expect(screen.getByRole('button',{name:'Next asset inspections'})).toHaveProperty('disabled',true);
});

it('exposes every inspection on a page and resets date/status filters to page one',async()=>{
  const inspections=vi.spyOn(api,'inspections').mockImplementation(async(_w,params)=>({items:Array.from({length:50},(_,i)=>({inspection_id:Number(params.offset)+i+1,inspected_at:'2026-09-01',asset_id:1})),total:101,limit:50,offset:Number(params.offset)} as any));
  render(<LiveWorkspacePage workspaceId="workspace" page="inspection-history" dateRange="all"/>);
  expect(await screen.findByText('Inspection 50 observations')).toBeTruthy();
  fireEvent.click(screen.getByRole('button',{name:'Next'}));
  await screen.findByText('Inspection 100 observations');
  fireEvent.change(screen.getByLabelText('Live inspection start date'),{target:{value:'2026-09-01'}});
  await waitFor(()=>expect(inspections).toHaveBeenLastCalledWith('workspace',expect.objectContaining({offset:0,start:'2026-09-01'}),expect.any(AbortSignal)));
  await screen.findByText('Inspection 50 observations');
  fireEvent.change(screen.getByLabelText('Live inspection status'),{target:{value:'completed'}});
  await waitFor(()=>expect(inspections).toHaveBeenLastCalledWith('workspace',expect.objectContaining({offset:0,status:'completed'}),expect.any(AbortSignal)));
});

it('keeps inspection filters available to correct a failed query',async()=>{
  vi.spyOn(api,'inspections').mockRejectedValueOnce(new Error('Invalid date window')).mockResolvedValue({items:[{inspection_id:12,inspected_at:'2026-09-01'}],total:1,limit:50,offset:0} as any);
  render(<LiveWorkspacePage workspaceId="workspace" page="inspection-history" dateRange="all"/>);
  expect(await screen.findByRole('alert')).toBeTruthy();
  expect(screen.getByRole('button',{name:'Retry inspections'})).toBeTruthy();
  fireEvent.change(screen.getByLabelText('Live inspection start date'),{target:{value:'2026-09-01'}});
  expect(await screen.findByText('Inspection 12 observations')).toBeTruthy();
  expect(screen.queryByRole('alert')).toBeNull();
});
