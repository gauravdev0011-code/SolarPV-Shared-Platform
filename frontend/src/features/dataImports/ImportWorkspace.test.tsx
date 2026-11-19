import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { Profiler } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import ImportWorkspace from "./ImportWorkspace";
import { api } from "../../api/solaris";
import workspaceCss from "./importWorkspace.css?inline";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it("preserves scientific unit casing and contains expanded recognition evidence styles", async () => {
  const style = document.createElement("style");
  style.textContent = workspaceCss;
  document.head.append(style);
  document.body.classList.add("data-imports-page");
  try {
    setup();
    await screen.findByRole("img", {name:/Validated total_real_power/});
    expect(getComputedStyle(screen.getByLabelText("Measurement")).textTransform).toBe("none");
    const evidence = screen.getByText("Recognition evidence and measurements").closest("details")!;
    const fingerprint = within(evidence).getByText(/Schema fingerprint/);
    expect(getComputedStyle(fingerprint).overflowWrap).toBe("anywhere");
    expect(getComputedStyle(evidence.querySelector(".source-characteristics span")!).textTransform).toBe("none");
    expect(getComputedStyle(evidence.querySelector(".source-characteristics")!).maxHeight).toBe("240px");
  } finally {
    style.remove();
    document.body.classList.remove("data-imports-page");
  }
});

it("keeps source totals separate from filtered results and hides fallback rows after explorer failure", async () => {
  vi.spyOn(api,"intelligence").mockResolvedValue({diagnoses:[],approval:null} as any);
  vi.spyOn(api,"explorer").mockRejectedValue(new Error("Missing dataset"));
  render(<ImportWorkspace workspaceId="w" dataset="d" version="v" datasetRows={99} mapping={null} validation={null} approval={null} preview={{columns:["power"],rows:[{power:"cached-value"}]}} source={null} mappingPanel={<p>Persistent mapping editor</p>} findingsPanel={null} registrationPanel={null} onApproval={vi.fn()} onReviewScale={vi.fn()} onNormalization={vi.fn()} onInspect={vi.fn()}/>);
  expect(await screen.findByText(/explorer could not load/)).toBeTruthy();
  expect(screen.queryByText("cached-value")).toBeNull();
  expect(screen.getByText("99")).toBeTruthy();
  expect(screen.getByText("Persistent mapping editor")).toBeTruthy();
});
const mapping = { mapping_revision_id:"map", columns:[{source_column:"power", target_field:"total_real_power",expected_type:"number",measurement_unit:"kW"}] };
const data = { columns:["power"], total:3, items:[{source_row:2,original:{power:"abc"},normalized:{power:{value:null,status:"invalid",rules:[]}},status:"invalid"}],chart:{unit:"kW",excluded_count:1,scope:"Source rows",points:[{source_row:2,timestamp:"2026-09-01T00:00:00",value:2,flags:[]},{source_row:3,timestamp:"2026-09-01T00:01:00",value:null,flags:["invalid_number"]},{source_row:4,timestamp:"2026-09-01T00:02:00",value:4,flags:[]}]},provenance:{rule_version:"normalization-v1"} };

it('reports actual validation revisions without clearing prior source evidence',async()=>{
  vi.spyOn(api,'intelligence').mockResolvedValue({diagnoses:[],approval:null} as any);
  vi.spyOn(api,'explorer').mockResolvedValue(data as any);
  const props={workspaceId:'w',dataset:'d',version:'v',mapping,approval:null,preview:null,source:null,mappingPanel:null,findingsPanel:null,registrationPanel:null,onApproval:vi.fn(),onReviewScale:vi.fn(),onNormalization:vi.fn(),onInspect:vi.fn()};
  const {rerender}=render(<ImportWorkspace {...props} validation={{validation_run_id:'before',error_count:3,warning_count:8}}/>);
  expect(screen.queryByText(/Validation refreshed/)).toBeNull();
  rerender(<ImportWorkspace {...props} validation={null}/>);
  rerender(<ImportWorkspace {...props} validation={{validation_run_id:'after',error_count:1,warning_count:8}}/>);
  expect(await screen.findByText('Validation refreshed: errors 3 to 1; warnings 8 to 8. Original source preserved.')).toBeTruthy();
  expect(within(screen.getByLabelText('Dataset state summary').querySelector('.quality-state') as HTMLElement).getByText('1')).toBeTruthy();
});

it('keeps an API power-factor ambiguity warning visible across original, normalized and transformation views',async()=>{
  const view={...data,scientific_warnings:[{code:'power_factor_percent_scale_review',field:'Meter: power_factor (%)',source_unit:'%',state:'unresolved'}]};
  setup([],async()=>view as any);
  const warning=await screen.findByRole('note',{name:'Power-factor unit interpretation'});
  expect(warning.textContent).toContain('No percentage/ratio conversion');
  fireEvent.click(screen.getByRole('button',{name:'Normalized Data'}));expect(screen.getByRole('note',{name:'Power-factor unit interpretation'})).toBeTruthy();
  fireEvent.click(screen.getByRole('tab',{name:'Transformations'}));expect(screen.getByRole('note',{name:'Power-factor unit interpretation'})).toBeTruthy();
});
function setup(diagnoses: any[] = [], implementation?: any, selectedMapping = mapping, openPreview = true) {
  vi.spyOn(api,"intelligence").mockResolvedValue({diagnoses,approval:null,recognition:{schema_fingerprint:"fingerprint"}} as any);
  const explorer=vi.spyOn(api,"explorer").mockImplementation(implementation ?? (async () => data as any));
  const inspect=vi.fn();
  render(<ImportWorkspace workspaceId="workspace" dataset="dataset" version="version" mapping={selectedMapping} validation={{validation_run_id:"run",error_count:1,warning_count:0}} approval={null} preview={null} source={null} mappingPanel={<p>Saved mapping controls</p>} findingsPanel={<p>Detailed findings</p>} registrationPanel={<button disabled>Register Dataset</button>} onApproval={vi.fn()} onReviewScale={vi.fn()} onNormalization={vi.fn()} onInspect={inspect}/>);
  if(openPreview)fireEvent.click(screen.getByText("Data preview & technical details"));
  return {explorer,inspect};
}
describe("integrated explorer", () => {
  it("preserves invalid original text while exposing explicit normalized missing output",async () => {
    setup();
    expect(await screen.findByText("abc")).toBeTruthy();
    fireEvent.click(screen.getByRole("button",{name:"Normalized Data"}));
    expect(screen.getByText("Missing")).toBeTruthy();
    fireEvent.click(screen.getByRole("tab",{name:"Mapping"}));
    expect(screen.getByText("Saved mapping controls")).toBeTruthy();
  });
  it("breaks the trend at an excluded reading and supports keyboard reading inspection",async () => {
    setup();
    const chart=await screen.findByRole("img",{name:/Validated total_real_power readings/});
    expect(chart.getAttribute('preserveAspectRatio')).toBe('none'); // SVG x coordinates match pointer-to-time conversion at every panel ratio.
    expect(chart.querySelectorAll("polyline")).toHaveLength(2);
    if(!screen.getByText("Range, exact readings & chart evidence").closest("details")!.open)fireEvent.click(screen.getByText("Range, exact readings & chart evidence"));
  fireEvent.change(screen.getByLabelText("Inspect chart reading"),{target:{value:"3"}});
    expect(screen.getByText(/Excluded/)).toBeTruthy();
    fireEvent.click(document.getElementById("open-registration")!);expect(screen.getByRole("button",{name:"Register Dataset"})).toHaveProperty("disabled",true);
  });
  it("opens source findings with the selected backend diagnosis",async () => {
    const diagnosis={category:"numeric",diagnosis_id:"numeric-1",examples:[],diagnosis_code:"invalid_number",field:"power",title:"Unparseable numeric values",distinct_affected_rows:1,finding_count:1,blocks_registration:true,explanation:"Source text is not numeric.",handling_explanation:"Original retained.",researcher_action:"Review mapping."};
    const {inspect,explorer}=setup([diagnosis]);
    fireEvent.click(await screen.findByRole("button",{name:/Unparseable numeric values/}));
    expect(inspect).not.toHaveBeenCalled();
    expect(within(screen.getByLabelText("Fix & Validate")).getByText("Source text is not numeric.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button",{name:"Inspect affected records"}));
    expect(inspect).toHaveBeenCalledWith(expect.objectContaining({category:"numeric",field:"power"}));
    expect(screen.getByText("Detailed findings")).toBeTruthy();
    fireEvent.click(screen.getByRole("tab",{name:"Data Explorer"}));
    fireEvent.change(screen.getByLabelText("Search in data"),{target:{value:"abc"}});
    await waitFor(() => expect(explorer).toHaveBeenLastCalledWith("workspace","dataset","version",expect.objectContaining({search:"abc"}),expect.any(AbortSignal)));
  });
});


it("supports roving keyboard tabs and does not refetch chart for table search",async () => {
  const {explorer}=setup();await screen.findByText("abc");
  const chartRequests=() => explorer.mock.calls.filter((call) => call[3].include_chart!=="false").length;
  const initial=chartRequests();
  const first=screen.getByRole("tab",{name:"Data Explorer"});first.focus();fireEvent.keyDown(first,{key:"ArrowRight"});
  expect(screen.getByRole("tab",{name:"Mapping"})).toHaveProperty("tabIndex",0);
  expect(document.activeElement).toBe(screen.getByRole("tab",{name:"Mapping"}));
  fireEvent.click(first);fireEvent.change(screen.getByLabelText("Search in data"),{target:{value:"abc"}});
  await waitFor(() => expect(explorer).toHaveBeenLastCalledWith("workspace","dataset","version",expect.objectContaining({search:"abc",include_chart:"false"}),expect.any(AbortSignal)));
  expect(chartRequests()).toBe(initial);
});

it("ignores an older table response after measurement selection changes",async () => {
  let finish: (value:any) => void=()=>{};
  const old=new Promise((resolve) => {finish=resolve;});
  const updated={...data,items:[{...data.items[0],original:{power:"new-reading"}}]};
  const multi={...mapping,columns:[...mapping.columns,{...mapping.columns[0],source_column:"power2",target_field:"phase_a_power"}]};
  setup([],async (_w:any,_d:any,_v:any,params:any) => params.include_chart==="false" && params.field!=="power2" ? old : updated,multi);
  fireEvent.change(screen.getByLabelText("Measurement"),{target:{value:"power2"}});
  await screen.findByText("new-reading");
  await act(async () => {finish(data);await old;});
  expect(within(screen.getByRole("table",{name:"Record preview"})).queryByText("abc")).toBeNull();
  expect(screen.getByText("new-reading")).toBeTruthy();
});

it("measures bounded synthetic rendering commits without claiming browser paint performance",async () => {
  const points=Array.from({length:2000},(_,i) => ({source_row:i+2,timestamp:`2026-09-01T00:00:00`,plot_seconds:1790000000+i*300,value:i%100,flags:[]}));
  vi.spyOn(api,"intelligence").mockResolvedValue({diagnoses:[],approval:null} as any);
  vi.spyOn(api,"explorer").mockResolvedValue({...data,chart:{...data.chart,points,downsampled:true}} as any);
  const durations:number[]=[];
  render(<Profiler id="import" onRender={(_id,_phase,duration) => durations.push(duration)}><ImportWorkspace workspaceId="w" dataset="d" version="v" mapping={mapping} validation={{validation_run_id:"run"}} approval={null} preview={null} source={null} mappingPanel={null} findingsPanel={null} registrationPanel={null} onApproval={vi.fn()} onReviewScale={vi.fn()} onNormalization={vi.fn()} onInspect={vi.fn()}/></Profiler>);
  const chart=await screen.findByRole("img",{name:/Validated total_real_power/});
  expect(chart.querySelectorAll("circle").length).toBeLessThan(5);
  expect(chart.querySelector("path[data-reading-count=\"2000\"]")).not.toBeNull();
  console.log("FRONTEND_PROFILE",JSON.stringify({environment:"Vitest/jsdom; synthetic 2000 chart points; React commit duration, no layout/paint timing",commits:durations.length,max_commit_ms:Math.max(...durations),total_commit_ms:durations.reduce((a,b)=>a+b,0)}));
});

it("keeps technical chart disclosures local and closed without hiding excluded-reading notices",async () => {
 setup();
 await screen.findByRole("img",{name:/Validated total_real_power/});
 const disclosure=screen.getByText("Chart Details").closest("details")!;
 expect(disclosure.open).toBe(false);
 expect(within(disclosure).getByText(/Blue: numeric readings/).className).toBe("import-chart-key");
 expect(screen.getByText(/1 excluded readings; gaps remain visible/).closest("details")).toHaveProperty("open",false);
 expect(screen.getByText("Source clock range")).toBeTruthy();
});


it("compares only compatible units and retains independent series gaps",async()=>{
  const multi={...mapping,columns:[...mapping.columns,{...mapping.columns[0],source_column:"phase",target_field:"phase_a_power"},{...mapping.columns[0],source_column:"frequency",target_field:"frequency",measurement_unit:"Hz"}]};
  setup([],async()=>({...data,chart:{...data.chart,unit:"kW",points:[{source_row:2,plot_seconds:1,timestamp:"2026-09-01T00:00:00",value:1,flags:[]},{source_row:3,plot_seconds:2,timestamp:"2026-09-01T00:05:00",value:null,flags:[]},{source_row:4,plot_seconds:3,timestamp:"2026-09-01T00:10:00",value:2,flags:[]}]}}),multi);
  await screen.findByRole("img",{name:/Validated total_real_power/});
  const control=screen.getByLabelText("Compare compatible series");
  expect(within(control).queryByRole("option",{name:/frequency/})).toBeNull();
  fireEvent.change(control,{target:{value:"phase"}});
  await screen.findByText(/Shared unit: kW/);
  expect(screen.getByRole("img",{name:/Validated total_real_power/}).querySelectorAll('[data-series="comparison"]')).toHaveLength(2);
});


it("keeps technical tables closed by default and opens mapping and source review explicitly",async()=>{
  setup([],undefined,mapping,false);
  await screen.findByRole("img",{name:/Validated total_real_power/});
  expect(screen.queryByRole("table",{name:"Record preview"})).toBeNull();
  expect(screen.getByText("Review measurement mappings").closest("details")).toHaveProperty("open",false);
  fireEvent.click(screen.getByText("Review measurement mappings"));
  expect(screen.getByText("Review measurement mappings").closest("details")).toHaveProperty("open",true);
  if(!screen.getByText("Range, exact readings & chart evidence").closest("details")!.open)fireEvent.click(screen.getByText("Range, exact readings & chart evidence"));
  fireEvent.change(screen.getByLabelText("Inspect chart reading"),{target:{value:"2"}});
  fireEvent.click(screen.getByRole("button",{name:"Inspect source row"}));
  expect(await screen.findByRole("table",{name:"Record preview"})).toBeTruthy();
  expect(screen.getByLabelText("Go to source row")).toHaveProperty("value","2");
});

it("shows exact comparison evidence and retries a failed comparison without promoting data",async()=>{
  let fail=true;
  const multi={...mapping,columns:[...mapping.columns,{...mapping.columns[0],source_column:"phase",target_field:"phase_a_power"}]};
  setup([],async (_w:any,_d:any,_v:any,params:any)=>{
    if(params.field==='phase'&&params.include_chart!=='false'){if(fail)throw new Error('Synthetic transient error');return {...data,chart:{...data.chart,unit:'kW',points:[{source_row:2,plot_seconds:1,timestamp:'2026-09-01T00:00:00',value:5,value_text:'5.000000000000000001',flags:[]},{source_row:4,plot_seconds:3,timestamp:'2026-09-01T00:10:00',value:6,flags:[]}]}};}
    return data;
  },multi,false);
  await screen.findByRole("img",{name:/Validated total_real_power/});
  fireEvent.click(await screen.findByText('Range, exact readings & chart evidence'));
  fireEvent.change(screen.getByLabelText('Compare compatible series'),{target:{value:'phase'}});
  expect(await screen.findByRole('button',{name:'Retry comparison'})).toBeTruthy();
  fail=false;fireEvent.click(screen.getByRole('button',{name:'Retry comparison'}));
  fireEvent.change(await screen.findByLabelText('Inspect series'),{target:{value:'comparison'}});
  fireEvent.change(screen.getByLabelText('Inspect chart reading'),{target:{value:'2'}});
  expect(screen.getByText(/5.000000000000000001/)).toBeTruthy();
  fireEvent.click(document.getElementById('open-registration')!);expect(screen.getByRole('button',{name:'Register Dataset'})).toHaveProperty('disabled',true);
});

it("does not display a previous measurement chart while a new field request is pending",async()=>{
  let finish!:(value:any)=>void;
  const pending=new Promise(resolve=>{finish=resolve;});
  const multi={...mapping,columns:[...mapping.columns,{...mapping.columns[0],source_column:'phase',target_field:'phase_a_power'}]};
  setup([],async (_w:any,_d:any,_v:any,params:any)=>params.field==='phase'&&params.include_chart!=='false'?pending:data,multi,false);
  await screen.findByRole('img',{name:/Validated total_real_power/});
  fireEvent.change(screen.getByLabelText('Measurement'),{target:{value:'phase'}});
  expect(screen.queryByRole('img',{name:/Validated total_real_power/})).toBeNull();
  expect(screen.queryByRole('img',{name:/Validated phase_a_power/})).toBeNull();
  await act(async()=>{finish(data);await pending;});
  expect(await screen.findByRole('img',{name:/Validated phase_a_power/})).toBeTruthy();
});
