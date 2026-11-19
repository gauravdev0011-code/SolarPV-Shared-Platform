import {afterEach,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {api,type AssociationPreview as Preview} from '../../api/solaris';
import AssociationPreview from './AssociationPreview';

afterEach(()=>{cleanup();vi.restoreAllMocks();});
const props={workspaceId:'default',dataset:'d',version:'v',columns:['equipment','name']};
const result:Preview={mode:'preview_only',can_commit:false,can_promote:false,preview_revision:'revision1',blocked_reason:'No associations are saved.',total:30,offset:0,limit:25,provenance:{source_sha256:'verified-hash',validation_run_id:'validation1'},scientific_warnings:[{code:'pf',message:'PF scale unresolved'}],items:[{source_row:2,identifiers:{external_id:'SYN-1'},association_status:'exact_match',reason:'Candidate, not approved',committed:false,candidates:[{asset_id:1,external_id:'SYN-1',name:'Fictional equipment',asset_type:'meter',data_origin:'synthetic'}],candidates_truncated:false,original:{equipment:'SYN-1'},normalized:{power:{value:'1',unit:'kW'}},status:'valid'}]};
function select(){fireEvent.change(screen.getByLabelText('External equipment identifier'),{target:{value:'equipment'}});}

it('shows original row evidence, synthetic candidates and lineage without a commit action',async()=>{
  const call=vi.spyOn(api,'associationPreview').mockResolvedValue(result);
  render(<AssociationPreview {...props}/>);select();fireEvent.click(screen.getByText('Preview source matches'));
  expect(await screen.findByText('Candidate, not approved')).toBeTruthy();
  expect(screen.getByText(/Fictional equipment/).textContent).toContain('synthetic');
  expect(screen.getByText('verified-hash')).toBeTruthy();expect(screen.getByText('PF scale unresolved')).toBeTruthy();
  expect(screen.queryByRole('button',{name:/save|approve|commit|promote/i})).toBeNull();
  fireEvent.click(screen.getByText('Next source matches'));
  await waitFor(()=>expect(call.mock.calls[1][4]).toBe(25));
});

it('clears obsolete results when identifier choices change and ignores late responses',async()=>{
  let resolve!:(value:Preview)=>void;
  vi.spyOn(api,'associationPreview').mockImplementation(()=>new Promise(r=>{resolve=r;}));
  render(<AssociationPreview {...props}/>);select();fireEvent.click(screen.getByText('Preview source matches'));
  fireEvent.change(screen.getByLabelText('External equipment identifier'),{target:{value:'name'}});
  resolve(result);
  await waitFor(()=>expect(screen.queryByText('Candidate, not approved')).toBeNull());
  expect(screen.queryByText(/Checking source/)).toBeNull();
});

it('shows corrective failures, permits retry and clears preview on workspace changes',async()=>{
  const call=vi.spyOn(api,'associationPreview').mockRejectedValueOnce(new Error('Source changed')).mockResolvedValue(result);
  const view=render(<AssociationPreview {...props}/>);select();fireEvent.click(screen.getByText('Preview source matches'));
  expect((await screen.findByRole('alert')).textContent).toContain('Source changed');
  fireEvent.click(screen.getByText('Preview source matches'));await screen.findByText('Candidate, not approved');
  expect(call).toHaveBeenCalledTimes(2);
  view.rerender(<AssociationPreview {...props} workspaceId="other"/>);
  expect(screen.queryByText('Candidate, not approved')).toBeNull();
  expect((screen.getByLabelText('External equipment identifier') as HTMLSelectElement).value).toBe('');
});
