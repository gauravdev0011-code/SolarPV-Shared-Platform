import {afterEach,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {api} from '../../api/solaris';
import RecentImports from './RecentImports';
afterEach(()=>{cleanup();vi.restoreAllMocks();});
const item={dataset_id:'old',name:'Historical dataset',latest_version_state:'draft',approved_version_number:null,updated_at:'2026-09-01',latest_version_number:1};
it('reopens accessible history, pages and searches on the server',async()=>{
  const fetch=vi.spyOn(api,'datasets').mockResolvedValue({items:[item],total:7,limit:6,offset:0});const select=vi.fn();
  render(<RecentImports workspaceId="w" selected="" onSelect={select}/>);
  fireEvent.click(await screen.findByRole('button',{name:/Historical dataset/}));expect(select).toHaveBeenCalledWith('old');
  expect(screen.getByText(/Approval not recorded/)).toBeTruthy();
  fireEvent.click(screen.getByText('Next imports'));await waitFor(()=>expect(fetch.mock.calls.at(-1)?.[2]?.offset).toBe(6));
  fireEvent.change(screen.getByLabelText('Search datasets'),{target:{value:'September'}});
  await waitFor(()=>expect(fetch.mock.calls.at(-1)?.[2]).toEqual({search:'September',offset:0,limit:6}));
});
it('handles invalid responses and failed requests without hiding the import workspace',async()=>{
  vi.spyOn(api,'datasets').mockResolvedValueOnce({} as any).mockResolvedValue({items:[],total:0,limit:6,offset:0});
  render(<RecentImports workspaceId="w" selected="" onSelect={vi.fn()}/>);
  expect(await screen.findByRole('alert')).toBeTruthy();fireEvent.click(screen.getByText('Retry recent imports'));
  expect(await screen.findByText(/No matching datasets/)).toBeTruthy();
});
