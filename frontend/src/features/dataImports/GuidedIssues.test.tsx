import {act,cleanup,fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import GuidedIssues from './GuidedIssues';
import ProcessingLog from './ProcessingLog';
import {compatibleComparison} from './comparisonPolicy';
import {api} from '../../api/solaris';

afterEach(()=>{cleanup();vi.restoreAllMocks();});
const numeric={severity:'error',category:'numeric',field:'ConsumptionTOTAL',code:'numeric.invalid',message:'Unparseable source value.',count:2204,affected_record_count:2204,blocks_registration:true,recommended_action:'Inspect original text.',examples:[{row:6163,observed_value_preview:'undefined'}]};
const interpretation={...numeric,severity:'warning',category:'interpretation',field:'power_factor (%)',code:'scale.review',message:'Scale remains unverified.',count:1,affected_record_count:0,examples:[{row:2,observed_value_preview:'1.00'}]};
function setup(groups=[numeric]){
  const page=vi.spyOn(api,'issueGroupPage').mockResolvedValue({groups,total_groups:groups.length} as any);
  const records=vi.fn(),source=vi.fn(),mapping=vi.fn(),view=vi.fn();
  render(<GuidedIssues workspaceId="default" dataset="d" version="v" runId="run" fields={['ConsumptionTOTAL','power_factor (%)']} diagnoses={[{id:'numeric',category:'numeric',title:'Invalid readings',severity:'error',field:'ConsumptionTOTAL',explanation:numeric.message,finding_count:2204,distinct_affected_rows:2204,blocks_registration:true,examples:numeric.examples} as any]} onRecords={records} onSource={source} onMapping={mapping} onView={view}/>);
  return {page,records,source,mapping,view};
}

it('distinguishes outdated API contracts and filtered-empty results, with retry and clear filters',async()=>{
  const callbacks=setup();
  callbacks.page.mockResolvedValueOnce({groups:[numeric],total_issues:2204} as any);
  expect((await screen.findByRole('alert')).textContent).toContain('Restart the local backend');
  expect(screen.queryByText('No issues exist in this validation run.')).toBeNull();
  fireEvent.click(screen.getByRole('button',{name:'Retry issues'}));
  await screen.findByRole('button',{name:'undefined'});
  callbacks.page.mockResolvedValueOnce({groups:[],total_groups:0} as any);
  fireEvent.change(screen.getByLabelText('Severity'),{target:{value:'warning'}});
  await screen.findByText('No issues match the current filters.');
  fireEvent.click(screen.getByRole('button',{name:'Clear Filters'}));
  await screen.findByRole('button',{name:'undefined'});
  expect(callbacks.page).toHaveBeenLastCalledWith('default','run',expect.objectContaining({severity:'',offset:0}),expect.any(AbortSignal));
});

it('selects evidence, drills into exact records, exports filters and blocks unsupported repair',async()=>{
  const callbacks=setup();
  fireEvent.click(screen.getByRole('button',{name:/Invalid readings.*2,204 records/}));
  expect(within(screen.getByRole('region',{name:'Fix & Validate'})).getByText(numeric.message)).toBeTruthy();
  await screen.findByRole('button',{name:'undefined'});
  fireEvent.click(screen.getByRole('button',{name:'undefined'}));
  expect(callbacks.source).toHaveBeenCalledWith(6163,'ConsumptionTOTAL');
  const table=screen.getByRole('table');
  fireEvent.click(within(table).getByRole('button',{name:'2,204 source records'}));
  expect(callbacks.records).toHaveBeenCalledWith(expect.objectContaining({field:'ConsumptionTOTAL',category:'numeric',diagnosis_code:'numeric.invalid'}));
  fireEvent.click(screen.getByRole('tab',{name:'Preview'}));
  expect((screen.getByRole('button',{name:'Scientific or source-policy review required'}) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.change(screen.getByLabelText('Search findings'),{target:{value:'undefined'}});
  await waitFor(()=>expect(callbacks.page).toHaveBeenLastCalledWith('default','run',expect.objectContaining({search:'undefined',offset:0,limit:10}),expect.any(AbortSignal)));
  expect(screen.getByRole('link',{name:'Export filtered findings (JSONL)'}).getAttribute('href')).toContain('search=undefined');
  fireEvent.click(screen.getByRole('button',{name:'Processing Log'}));
  expect(callbacks.view).toHaveBeenCalledWith('Processing Log');
});

it('previews a chosen scale without applying it, resets cancelled requests and supports keyboard tabs',async()=>{
  const callbacks=setup([interpretation]);
  let finish!:(value:any)=>void;
  const preview=vi.spyOn(api,'resolutionPreview').mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
  fireEvent.click(await screen.findByRole('button',{name:'Review & Confirm'}));
  fireEvent.keyDown(screen.getByRole('tab',{name:'Details'}),{key:'End'});
  expect(screen.getByRole('tab',{name:'Preview'}).getAttribute('aria-selected')).toBe('true');
  expect((screen.getByRole('button',{name:'Compute resolution preview'}) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.change(screen.getByLabelText('Proposed power-factor scale'),{target:{value:'ratio_0_1'}});
  fireEvent.click(screen.getByRole('button',{name:'Compute resolution preview'}));
  await waitFor(()=>expect(preview).toHaveBeenCalledTimes(1));
  fireEvent.change(screen.getByLabelText('Proposed power-factor scale'),{target:{value:'percent_0_100'}});
  expect((screen.getByRole('button',{name:'Compute resolution preview'}) as HTMLButtonElement).disabled).toBe(false);
  await act(async()=>finish({reason:'Stale result must not appear'}));
  expect(screen.queryByText('Stale result must not appear')).toBeNull();
  preview.mockResolvedValue({reason:'No state changed.',counts:{affected_records:1,unchanged_records:3,invalid_records:1},examples:[{source_row:2,original:'1.00',proposed:'0.01',unit:'ratio',status:'valid'}],rule_version:'v3',validation_consequences:'Revalidate after documented confirmation.'} as any);
  fireEvent.click(screen.getByRole('button',{name:'Compute resolution preview'}));
  await screen.findByText('No state changed.');
  expect(screen.getByText('0.01')).toBeTruthy();
  expect(callbacks.mapping).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button',{name:'Continue to explicit mapping review'}));
  expect(callbacks.mapping).toHaveBeenCalledTimes(1);
});

it('retries failed issue pages, ignores stale filter results and paginates bounded groups',async()=>{
  const callbacks=setup();
  callbacks.page.mockRejectedValueOnce(new Error('offline'));
  fireEvent.change(screen.getByLabelText('Severity'),{target:{value:'error'}});
  fireEvent.click(await screen.findByRole('button',{name:'Retry issues'}));
  await screen.findByRole('button',{name:'undefined'});
  let finish!:(value:any)=>void;
  callbacks.page.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
  fireEvent.change(screen.getByLabelText('Search findings'),{target:{value:'old'}});
  await waitFor(()=>expect(callbacks.page).toHaveBeenLastCalledWith('default','run',expect.objectContaining({search:'old'}),expect.any(AbortSignal)));
  callbacks.page.mockResolvedValue({groups:[numeric],total_groups:11} as any);
  fireEvent.change(screen.getByLabelText('Search findings'),{target:{value:'new'}});
  await screen.findByRole('button',{name:'undefined'});
  await act(async()=>finish({groups:[],total_groups:0}));
  expect(screen.getByRole('button',{name:'undefined'})).toBeTruthy();
  fireEvent.click(screen.getByRole('button',{name:'Next issues'}));
  await waitFor(()=>expect(callbacks.page).toHaveBeenLastCalledWith('default','run',expect.objectContaining({offset:10,limit:10}),expect.any(AbortSignal)));
});

it('shows only actual processing fields and supports recovery from read errors',async()=>{
  const job=vi.spyOn(api,'job').mockRejectedValueOnce(new Error('offline')).mockResolvedValue({job_id:'j',state:'succeeded',attempt_count:2,created_at:'2026-01-01',storage_key:'private/do-not-display'} as any);
  render(<ProcessingLog workspaceId="default" jobId="j"/>);
  fireEvent.click(await screen.findByRole('button',{name:'Retry processing log'}));
  await screen.findByText('succeeded');
  expect(job).toHaveBeenCalledTimes(2);
  expect(screen.queryByText('private/do-not-display')).toBeNull();
  expect(screen.getAllByText('Not recorded').length).toBeGreaterThan(0);
});

it('separates physical meanings even with matching units and rejects unknown units',()=>{
  const field=(target_field:string,measurement_unit?:string)=>({source_column:target_field,target_field,measurement_unit});
  expect(compatibleComparison(field('energy_consumption','kWh'),field('energy_accumulated','kWh'))).toBe(false);
  expect(compatibleComparison(field('total_real_power','kW'),field('phase_a_power','W'))).toBe(true);
  expect(compatibleComparison(field('total_real_power','Hz'),field('phase_a_power','Hz'))).toBe(false);
  expect(compatibleComparison(field('total_real_power'),field('phase_a_power','kW'))).toBe(false);
  expect(compatibleComparison(field('frequency','Hz'),field('power_factor','Hz'))).toBe(false);
  expect(compatibleComparison(field('energy_consumption','unknown'),field('energy_consumption','unknown'))).toBe(false);
});
