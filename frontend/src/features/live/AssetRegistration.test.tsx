import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import AssetRegistration from './AssetRegistration';
import {api,type AssetDraft} from '../../api/solaris';

afterEach(()=>{cleanup();vi.restoreAllMocks();});
const draft:AssetDraft={name:'Fictional panel',asset_type:'panel',external_id:'FIX-1',description:'',location:'',site_id:null,data_origin:'unknown'};
const saved={...draft,asset_id:42,revision:'a'.repeat(64)};
function form(onSaved=vi.fn(),assetId=''){render(<AssetRegistration workspaceId="default" assetId={assetId} sites={[]} onSaved={onSaved}/>);return onSaved;}
function fill(){fireEvent.change(screen.getByLabelText('Equipment name'),{target:{value:draft.name}});fireEvent.change(screen.getByLabelText('Equipment type'),{target:{value:draft.asset_type}});fireEvent.change(screen.getByLabelText('External identifier (optional)'),{target:{value:draft.external_id}});}

it('registers explicit equipment with unknown origin and reports backend success only',async()=>{
  const write=vi.spyOn(api,'saveAsset').mockResolvedValue(saved);const done=form();fill();
  fireEvent.click(screen.getByRole('button',{name:'Register asset'}));
  await waitFor(()=>expect(done).toHaveBeenCalled());
  expect(write.mock.calls[0][0]).toBe('default');expect(write.mock.calls[0][1]).toEqual(draft);expect(write.mock.calls[0][2].length).toBeGreaterThan(15);
});

it('retains the retry key after an uncertain failed save and never reports false success',async()=>{
  const write=vi.spyOn(api,'saveAsset').mockRejectedValueOnce(new Error('Connection lost')).mockResolvedValue(saved);const done=form();fill();
  fireEvent.click(screen.getByRole('button',{name:'Register asset'}));
  expect((await screen.findByRole('alert')).textContent).toContain('Connection lost');expect(done).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button',{name:'Register asset'}));await waitFor(()=>expect(done).toHaveBeenCalled());
  expect(write.mock.calls[0][2]).toBe(write.mock.calls[1][2]);
});

it('loads selected equipment for revision-checked edits and keeps origin immutable',async()=>{
  vi.spyOn(api,'assetRegistration').mockResolvedValue(saved);const write=vi.spyOn(api,'saveAsset').mockResolvedValue(saved);form(vi.fn(),'42');
  fireEvent.click(screen.getByRole('button',{name:'Edit selected asset'}));await screen.findByRole('button',{name:'Save asset changes'});
  expect((screen.getByLabelText('Data origin') as HTMLSelectElement).disabled).toBe(true);
  fireEvent.change(screen.getByLabelText('Equipment name'),{target:{value:'Edited panel'}});fireEvent.click(screen.getByRole('button',{name:'Save asset changes'}));
  await waitFor(()=>expect(write).toHaveBeenCalled());expect(write.mock.calls[0][3]).toBe(42);expect(write.mock.calls[0][4]).toBe(saved.revision);
});

it('previews spreadsheet matches before commit, rejects conflicts and invalidates edited previews',async()=>{
  const preview=vi.spyOn(api,'previewAssets').mockResolvedValue({preview_revision:'b'.repeat(64),can_commit:true,rows:[{row:1,external_id:'FIX-1',action:'create',proposed:draft,existing:null}]});
  const commit=vi.spyOn(api,'commitAssets').mockResolvedValue({items:[saved]});form();
  fireEvent.click(screen.getByText('Register several assets'));fireEvent.change(screen.getByLabelText('Spreadsheet asset rows'),{target:{value:'FIX-1\tFictional panel\tpanel'}});
  expect(screen.queryByRole('button',{name:'Confirm and save reviewed assets'})).toBeNull();expect(commit).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button',{name:'Preview asset matches'}));await screen.findByText('create');
  expect(preview).toHaveBeenCalledWith('default',[draft]);
  fireEvent.change(screen.getByLabelText('Spreadsheet asset rows'),{target:{value:'FIX-1\tDifferent name\tpanel'}});expect(screen.queryByRole('button',{name:'Confirm and save reviewed assets'})).toBeNull();
  preview.mockResolvedValue({preview_revision:'c'.repeat(64),can_commit:false,rows:[{row:1,external_id:'FIX-1',action:'conflict',proposed:draft,existing:saved}]});
  fireEvent.click(screen.getByRole('button',{name:'Preview asset matches'}));await screen.findByText('conflict');expect((screen.getByRole('button',{name:'Confirm and save reviewed assets'}) as HTMLButtonElement).disabled).toBe(true);expect(commit).not.toHaveBeenCalled();
});

it('commits only the reviewed rows and displays parse errors without writing',async()=>{
  vi.spyOn(api,'previewAssets').mockResolvedValue({preview_revision:'b'.repeat(64),can_commit:true,rows:[{row:1,external_id:'FIX-1',action:'create',proposed:draft,existing:null}]});
  const commit=vi.spyOn(api,'commitAssets').mockResolvedValue({items:[saved]});const done=form();
  fireEvent.click(screen.getByText('Register several assets'));fireEvent.change(screen.getByLabelText('Spreadsheet asset rows'),{target:{value:'bad row'}});fireEvent.click(screen.getByRole('button',{name:'Preview asset matches'}));
  expect((await screen.findByRole('alert')).textContent).toContain('three tab-separated cells');expect(commit).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('Spreadsheet asset rows'),{target:{value:'FIX-1\tFictional panel\tpanel'}});fireEvent.click(screen.getByRole('button',{name:'Preview asset matches'}));await screen.findByText('create');fireEvent.click(screen.getByRole('button',{name:'Confirm and save reviewed assets'}));
  await waitFor(()=>expect(done).toHaveBeenCalled());expect(commit.mock.calls[0].slice(0,3)).toEqual(['default',[draft],'b'.repeat(64)]);
});
