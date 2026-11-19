import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {api,type VisitDetail} from '../../api/solaris';
import VisitWorkspace from './VisitWorkspace';

const detail=(id=11):VisitDetail=>({visit:{asset_id:1,inspection_id:id,inspected_at:id===11?'2026-09-01T08:00:00Z':'2026-10-01T08:00:00Z',inspection_method:'Visual',data_source:'Fictional sheet',data_origin:'unknown',status:'completed',notes:null,reason:'',expected_revision:null,observations:[],attachment_ids:[]},head_revision:'revision-one',observations:{items:[{observation_id:1,observation_type:'surface_temperature',value:34.5,source_value:'0034.50',quantity:'temperature',unit:'degC',finding:null,data_quality:'good',source_reference:'Fictional source row'}],total:1,offset:0,limit:50},attachments:[],revisions:{items:[{revision_id:'revision-one',revision_number:1,reason:'Original capture',recorded_at:'2026-09-01T08:00:01Z'}],total:1,offset:0,limit:50}});
beforeEach(()=>{
  vi.spyOn(api,'assets').mockResolvedValue({items:[{asset_id:1,external_id:'FIX-1',name:'Fictional panel'}] as any,total:1,offset:0,limit:20});
  vi.spyOn(api,'assetInspections').mockResolvedValue({items:[{inspection_id:11,inspected_at:'2026-09-01',inspection_method:'Visual'},{inspection_id:12,inspected_at:'2026-10-01',inspection_method:'Visual'}] as any,total:2,offset:0,limit:50});
  vi.spyOn(api,'visitUnits').mockResolvedValue({quantities:{temperature:['degC'],power:['kW']}});
  vi.spyOn(api,'visit').mockImplementation(async(_w,id)=>detail(id));
});
afterEach(()=>{cleanup();vi.restoreAllMocks();});
async function open(onSaved=vi.fn()){
  render(<VisitWorkspace workspaceId="default" onSaved={onSaved}/>);
  fireEvent.click(screen.getByText('Capture or compare visits'));await screen.findByRole('option',{name:'FIX-1'});
  fireEvent.change(screen.getByLabelText('Trend asset'),{target:{value:'1'}});
  await screen.findAllByRole('option',{name:/2026-09-01.*visit 11/});return onSaved;
}
function header(){
  fireEvent.change(screen.getByLabelText('Visit timestamp (ISO date or datetime)'),{target:{value:'2026-09-01T08:00:00Z'}});
  fireEvent.change(screen.getByLabelText('Inspection method'),{target:{value:'Visual'}});
  fireEvent.change(screen.getByLabelText('Visit data source'),{target:{value:'Fictional sheet'}});
}

it('captures explicit source readings without converting raw decimal text',async()=>{
  const save=vi.spyOn(api,'saveVisit').mockResolvedValue({inspection_id:11,revision_id:'revision-one'});const done=await open();header();
  fireEvent.click(screen.getByRole('button',{name:'Add reading or finding'}));
  fireEvent.change(screen.getByLabelText('Measurement name'),{target:{value:'surface_temperature'}});
  fireEvent.change(screen.getByLabelText('Documented quantity'),{target:{value:'temperature'}});
  fireEvent.change(screen.getByLabelText('Source numeric value'),{target:{value:'0034.50'}});
  fireEvent.change(screen.getByLabelText('Source measurement unit'),{target:{value:'degC'}});
  fireEvent.click(screen.getByRole('button',{name:'Save new visit'}));await waitFor(()=>expect(done).toHaveBeenCalled());
  expect(save.mock.calls[0][1].observations[0].value).toBe('0034.50');expect(save.mock.calls[0][1].data_origin).toBe('unknown');expect(save.mock.calls[0][3]).toBeUndefined();
});

it('preserves an unchanged retry key and never reports success after a failed save',async()=>{
  const save=vi.spyOn(api,'saveVisit').mockRejectedValueOnce(new Error('Connection lost')).mockResolvedValue({inspection_id:11,revision_id:'revision-one'});const done=await open();header();
  fireEvent.click(screen.getByRole('button',{name:'Save new visit'}));expect((await screen.findByRole('alert')).textContent).toContain('Connection lost');expect(done).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button',{name:'Save new visit'}));await waitFor(()=>expect(done).toHaveBeenCalled());expect(save.mock.calls[0][2]).toBe(save.mock.calls[1][2]);
});

it('loads a stable visit for an explicit immutable amendment with its expected head',async()=>{
  const save=vi.spyOn(api,'saveVisit').mockResolvedValue({inspection_id:11,revision_id:'revision-two'});await open();
  fireEvent.change(screen.getByLabelText('First comparison visit'),{target:{value:'11'}});
  fireEvent.click(screen.getByRole('button',{name:'Amend selected first visit'}));await screen.findByLabelText('Correction reason');
  expect((screen.getByLabelText('Source numeric value') as HTMLInputElement).value).toBe('0034.50');
  fireEvent.change(screen.getByLabelText('Correction reason'),{target:{value:'Documented transcription correction'}});
  fireEvent.click(screen.getByRole('button',{name:'Save immutable amendment'}));await waitFor(()=>expect(save).toHaveBeenCalled());
  expect(save.mock.calls[0][3]).toBe(11);expect(save.mock.calls[0][1].expected_revision).toBe('revision-one');expect(save.mock.calls[0][1].reason).toContain('correction');
});

it('compares two chosen visits and exposes original evidence without inferring a delta',async()=>{
  await open();fireEvent.change(screen.getByLabelText('First comparison visit'),{target:{value:'11'}});fireEvent.change(screen.getByLabelText('Second comparison visit'),{target:{value:'12'}});
  await screen.findByRole('region',{name:'Visit 11 evidence'});await screen.findByRole('region',{name:'Visit 12 evidence'});
  expect((await screen.findAllByText('0034.50')).length).toBe(2);
  fireEvent.click(screen.getAllByRole('button',{name:'Original evidence'})[0]);
  await waitFor(()=>expect(vi.mocked(api.visit).mock.calls.some(call=>call[1]===11&&call[2]?.revision==='original')).toBe(true));
  expect(screen.getByText(/No conversion, inferred delta/)).toBeTruthy();
});

it('uploads a photograph separately and links it only in the confirmed visit request',async()=>{
  const photo=vi.spyOn(api,'visitPhotograph').mockResolvedValue({source_file_id:'photo-one',original_name:'original.png',sha256:'a'.repeat(64),size_bytes:100,media_type:'image/png'});
  const save=vi.spyOn(api,'saveVisit').mockResolvedValue({inspection_id:11,revision_id:'revision-one'});await open();header();
  fireEvent.change(screen.getByLabelText('Add original file'),{target:{files:[new File(['fixture'],'original.png',{type:'image/png'})]}});
  await screen.findByText("original.png");expect(screen.getByText("Selected for this save")).toBeTruthy();expect(photo).toHaveBeenCalled();expect(save).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button',{name:'Save new visit'}));await waitFor(()=>expect(save).toHaveBeenCalled());expect(save.mock.calls[0][1].attachment_ids).toEqual(['photo-one']);
});

it('retains discovery controls after a units/history API failure and permits retry',async()=>{
  vi.mocked(api.visitUnits).mockRejectedValueOnce(new Error('Unit service unavailable'));await open().catch(()=>{});
  expect((await screen.findByRole('alert')).textContent).toContain('Unit service unavailable');
  fireEvent.click(screen.getByRole('button',{name:'Reload visit choices and units'}));await screen.findAllByRole('option',{name:/2026-09-01.*visit 11/});
});
