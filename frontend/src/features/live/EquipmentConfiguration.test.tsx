import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {api,type EquipmentHistory,type EquipmentRevision} from '../../api/solaris';
import EquipmentConfiguration from './EquipmentConfiguration';

const revision:EquipmentRevision={configuration_id:'config-one',recorded_at:'2026-09-02T00:00:00Z',effective_from:'2026-09-01T00:00:00.000000Z',effective_to:null,expected_revision:null,equipment_kind:'panel',parent_asset_id:1,site_id:null,source_reference:'Fictional source sheet',specifications:[{name:'Rated power',value:'00340.000',unit:'W'}]};
const asset={asset_id:4,revision:'a'.repeat(64),name:'Fictional panel',asset_type:'panel',external_id:'FIX-panel',description:'',location:'',site_id:null,data_origin:'unknown' as const};
function result():EquipmentHistory{return {asset,as_of:'2026-09-15T00:00:00Z',current:revision,latest:revision,parent:{...asset,asset_id:1,name:'Fictional array',external_id:'FIX-array'},head_revision:'config-one',legacy_site_id:null,history:{items:[revision],total:1,offset:0,limit:20},children:{items:[{asset_id:5,name:'Fictional child',external_id:'FIX-child'}],total:1,offset:0,limit:20}};}
function view(onSaved=vi.fn(),onNavigate=vi.fn()){render(<EquipmentConfiguration workspaceId="default" assetId={4} sites={[]} onSaved={onSaved} onNavigate={onNavigate}/>);return {onSaved,onNavigate};}
beforeEach(()=>{vi.spyOn(api,'assets').mockResolvedValue({items:[],total:0,offset:0,limit:20});});
afterEach(()=>{cleanup();vi.restoreAllMocks();});

it('navigates the documented parent and children and displays exact specifications',async()=>{
  vi.spyOn(api,'equipmentHistory').mockResolvedValue(result());const {onNavigate}=view();
  expect((await screen.findAllByText('Rated power: 00340.000 W')).length).toBe(2);
  fireEvent.click(screen.getByRole('button',{name:'FIX-array — Fictional array'}));expect(onNavigate).toHaveBeenCalledWith(1,result().as_of);
  fireEvent.click(screen.getByRole('button',{name:'FIX-child — Fictional child'}));expect(onNavigate).toHaveBeenCalledWith(5,result().as_of);
  expect(screen.getByText(/effective history unknown/)).toBeTruthy();
});

it('queries earlier configurations and pages without hiding unknown states',async()=>{
  const value=result();value.history.total=25;value.current=null;value.parent=null;
  const read=vi.spyOn(api,'equipmentHistory').mockResolvedValue(value);view();
  await screen.findByText(/No documented configuration/);
  fireEvent.change(screen.getByLabelText('Configuration at time (ISO datetime with offset)'),{target:{value:'2026-08-01T00:00:00Z'}});fireEvent.click(screen.getByRole('button',{name:'View configuration'}));
  await waitFor(()=>expect(read.mock.calls.at(-1)?.[2].as_of).toBe('2026-08-01T00:00:00Z'));
  await screen.findByRole('button',{name:'Next configuration page'});fireEvent.click(screen.getByRole('button',{name:'Next configuration page'}));
  await waitFor(()=>expect(read.mock.calls.at(-1)?.[2].offset).toBe(20));
});

it('copies documented values and appends a revision with a stable retry key after failure',async()=>{
  vi.spyOn(api,'equipmentHistory').mockResolvedValue(result());const write=vi.spyOn(api,'appendEquipment').mockRejectedValueOnce(new Error('Connection lost')).mockResolvedValue({...revision,configuration_id:'config-two'});const {onSaved}=view();
  await screen.findByText(/At 2026/);fireEvent.click(screen.getByText('Record a documented configuration revision'));fireEvent.click(screen.getByRole('button',{name:'Copy latest documented configuration'}));
  fireEvent.change(screen.getByLabelText('Effective from'),{target:{value:'2026-10-01T00:00:00Z'}});fireEvent.change(screen.getByLabelText('Source reference'),{target:{value:'Fictional revision sheet'}});
  fireEvent.click(screen.getByRole('button',{name:'Save configuration revision'}));expect((await screen.findByRole('alert')).textContent).toContain('Connection lost');expect(onSaved).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button',{name:'Save configuration revision'}));await waitFor(()=>expect(onSaved).toHaveBeenCalled());
  expect(write.mock.calls[0][2].expected_revision).toBe('config-one');expect(write.mock.calls[0][2].specifications[0].value).toBe('00340.000');expect(write.mock.calls[0][3]).toBe(write.mock.calls[1][3]);
});

it('shows retryable read errors without hiding time controls',async()=>{
  const read=vi.spyOn(api,'equipmentHistory').mockRejectedValueOnce(new Error('Unavailable')).mockResolvedValue(result());view();
  expect((await screen.findByRole('alert')).textContent).toContain('Unavailable');fireEvent.click(screen.getByRole('button',{name:'View current configuration'}));await screen.findByText(/At 2026/);expect(read).toHaveBeenCalledTimes(2);
});

it('ignores late history from an obsolete selected asset',async()=>{
  let resolve!:(value:EquipmentHistory)=>void;
  const stale=new Promise<EquipmentHistory>(done=>{resolve=done;});
  vi.spyOn(api,'equipmentHistory').mockReturnValueOnce(stale).mockResolvedValue({...result(),asset:{...asset,name:'New selection'}});
  const rendered=render(<EquipmentConfiguration key="old" workspaceId="default" assetId={4} sites={[]} onNavigate={vi.fn()} onSaved={vi.fn()}/>);
  rendered.rerender(<EquipmentConfiguration key="new" workspaceId="default" assetId={5} sites={[]} onNavigate={vi.fn()} onSaved={vi.fn()}/>);
  await screen.findByText('FIX-panel: New selection');resolve(result());
  await waitFor(()=>expect(screen.queryByText('FIX-panel: Fictional panel')).toBeNull());
});
