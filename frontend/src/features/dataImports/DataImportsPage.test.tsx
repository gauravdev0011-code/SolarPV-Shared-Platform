import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../api/solaris";
import DataImportsPage, { PreviewMeasurementCards } from "./DataImportsPage";

async function openPreview(){
  const summary=await screen.findByText("Data preview & technical details");
  if(!(summary.closest('details') as HTMLDetailsElement).open)fireEvent.click(summary);
  return within(summary.closest("details")!).findByRole("tab",{name:"Data Explorer"});
}
async function previewTable(){fireEvent.click(await openPreview());return within(screen.getByText("Data preview & technical details").closest("details")!).findByRole("table",{name:"Record preview"});}
async function mappingTab(){await openPreview();return within(screen.getByText("Data preview & technical details").closest("details")!).findByRole("tab",{name:"Mapping"});}

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); sessionStorage.clear(); });

const solarMeterColumns = ["DateTime", "Meter: ConsumptionTOTAL (kWh)", "Meter: ac_energy_accumulated (kWh)", "Meter: apparent_power (kVA)", "Meter: energy_accumulated (kWh)", "Meter: power_factor (%)", "Meter: power_frequency (Hz)", "Meter: power_true_kw (kW)", "Meter: power_true_kw_a (kW)", "Meter: power_true_kw_b (kW)", "Meter: power_true_kw_c (kW)"];
const solarMeterProfile = {
  row_count: 2,
  column_count: 11,
  encoding: "utf-8",
  columns: solarMeterColumns.map((name) => ({ name, observed_types: name === "DateTime" ? { text: 2 } : { number: 2 } })),
};
const solarMeterRows = [
  { DateTime: "Sep 1, 2026 14:39:00", "Meter: ConsumptionTOTAL (kWh)": "22.00", "Meter: ac_energy_accumulated (kWh)": "400.5", "Meter: apparent_power (kVA)": "883.87", "Meter: energy_accumulated (kWh)": "5206", "Meter: power_factor (%)": "1.00", "Meter: power_frequency (Hz)": "59.99", "Meter: power_true_kw (kW)": "294.78", "Meter: power_true_kw_a (kW)": "292.89", "Meter: power_true_kw_b (kW)": "296.20", "Meter: power_true_kw_c (kW)": "293.10" },
  { DateTime: "Sep 1, 2026 14:40:00", "Meter: ConsumptionTOTAL (kWh)": "60.00", "Meter: ac_energy_accumulated (kWh)": "401.1", "Meter: apparent_power (kVA)": "882.66", "Meter: energy_accumulated (kWh)": "5207", "Meter: power_factor (%)": "1.00", "Meter: power_frequency (Hz)": "60.00", "Meter: power_true_kw (kW)": "294.12", "Meter: power_true_kw_a (kW)": "292.44", "Meter: power_true_kw_b (kW)": "296.10", "Meter: power_true_kw_c (kW)": "292.80" },
];

// Mock the backend prepare boundary while preserving the existing mapping/validation
// HTTP assertions. Real recognition and idempotency are covered by API integration tests.
beforeEach(() => {
  vi.spyOn(api, "prepare").mockImplementation(async (w,d,v) => {
    const columns = d === "ds-1" ? solarMeterColumns.filter((c) => !c.includes("power_factor")) : d === "ds-recover" ? ["DateTime", "Meter: power_true_kw (kW)"] : [];
    const targets = ["timestamp", "energy_consumption", "accumulated_ac_energy", "apparent_power", "energy_accumulated", "frequency", "total_real_power", "phase_a_power", "phase_b_power", "phase_c_power"];
    const mapped = columns.map((c,i) => ({source_column:c, target_field:d==="ds-recover" ? i===0?"timestamp":"total_real_power" : targets[i], expected_type:i===0?"datetime":"number", measurement_unit:i===0?null:c.match(/\(([^()]*)\)$/)?.[1], is_required:false, timestamp_format:i===0?"%b %d, %Y %H:%M:%S":null}));
    const mapping = mapped.length ? await api.saveMapping(w,d,v,mapped,"automatic-mapping-v1") : null;
    const validation = await api.validate(w,d,v,"automatic-validation-v1");
    return {mapping,validation};
  });
});

describe("workspace dataset import workflow", () => {
  it("revalidates a saved terminal job and lets the researcher start a fresh import when the job is missing", async () => {
    sessionStorage.setItem("solaris:workspace-stale:upload", JSON.stringify({
      source: { source_file_id: "src-stale", original_name: "old.csv", sha256: "old-hash" }, job_id: "job-stale",
    }));
    sessionStorage.setItem("solaris:workspace-stale:job", JSON.stringify({ job_id: "job-stale", state: "succeeded" }));
    sessionStorage.setItem("solaris:workspace-stale:result", JSON.stringify({ job_id: "job-stale", result: { format: "csv" } }));
    const calls: string[] = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push(`${init?.method ?? "GET"} ${url}`);
      if (url.endsWith("/jobs/job-stale")) {
        return new Response(JSON.stringify({ detail: "Processing job not found." }), { status: 404, headers: { "Content-Type": "application/json" } });
      }
      const body = /\/datasets\?/.test(url)
        ? { items: [], total: 0, limit: 100, offset: 0 }
        : url.endsWith("/uploads") && init?.method === "POST"
          ? { source: { source_file_id: "src-new", original_name: "new.csv", size_bytes: 12, sha256: "new-hash" }, job_id: "job-new", job_state: "queued" }
          : url.endsWith("/jobs/job-new")
            ? { job_id: "job-new", state: "queued" }
            : {};
      return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<DataImportsPage workspaceId="workspace-stale" />);

    expect(await screen.findByText(/saved processing job was not found in this workspace/i)).toBeTruthy();
    expect(calls.some((call) => call.includes("GET /api/v1/workspaces/workspace-stale/jobs/job-stale/result"))).toBe(false);
    expect(calls.some((call) => call.includes("GET /api/v1/workspaces/workspace-stale/jobs/job-stale/preview"))).toBe(false);

    fireEvent.change(screen.getByLabelText("Select CSV or JSON file"), { target: { files: [new File(["x,y\n1,2"], "new.csv", { type: "text/csv" })] } });
    fireEvent.click(screen.getByRole("button", { name: "Upload and analyze" }));
    await screen.findByText("File received; durable processing job created.");
    expect(calls.some((call) => call.includes("POST /api/v1/workspaces/workspace-stale/uploads"))).toBe(true);
    await waitFor(() => expect(sessionStorage.getItem("solaris:workspace-stale:upload")).toContain("job-new"));
  });

  it("automatically saves verified meter mappings, recovers preview, and waits for explicit scale review", async () => {
    const calls: Array<{ url: string; method: string; body?: string }> = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input); const method = init?.method ?? "GET"; const requestBody = typeof init?.body === "string" ? init.body : undefined;
      calls.push({ url, method, body: requestBody });
      let body: unknown = {};
      if (/\/datasets\?/.test(url)) body = { items: [], total: 0, limit: 100, offset: 0 };
      else if (url.endsWith("/intelligence")) {
        const saved=calls.filter((c) => c.method==="PUT" && c.url.endsWith("/mapping")).at(-1);
        const pending=!saved || !JSON.parse(saved.body!).columns.some((column:any) => column.target_field==="power_factor" && column.value_scale);
        body={filename:"meter.csv",approval:null,diagnoses:[],eligibility:{state:pending ? "review_required" : "eligible",primary_action:pending ? "review_interpretation" : "submit_review",pending_decisions:pending ? 1 : 0,can_submit:!pending,can_approve:false,registered:false,policy:"Synthetic explicit approval policy"}};
      }
      else if (url.endsWith("/uploads") && method === "POST") body = { source: { source_file_id: "src-1", original_name: "meter.csv", size_bytes: 456, sha256: "hash" }, job_id: "job-1", job_state: "queued", job_reused: false };
      else if (url.endsWith("/jobs/job-1")) body = { job_id: "job-1", state: "succeeded", result_available: true };
      else if (url.endsWith("/jobs/job-1/result")) body = { job_id: "job-1", source_file_id: "src-1", checksum: "sum", result: { format: "csv", profile: solarMeterProfile } };
      else if (url.endsWith("/jobs/job-1/preview?limit=10")) body = { job_id: "job-1", source_file_id: "src-1", source_sha256: "hash", columns: solarMeterColumns, rows: solarMeterRows, returned_rows: 2, limit: 10 };
      else if (url.endsWith("/datasets") && method === "POST") body = { dataset_id: "ds-1", dataset_version_id: "ver-1", version_number: 1, state: "draft" };
      else if (url.endsWith("/datasets/ds-1/versions")) body = { items: [{ dataset_id: "ds-1", dataset_version_id: "ver-1", version_number: 1, state: "draft", source_file_id: "src-1", source_job_id: "job-1" }] };
      else if (url.endsWith("/versions/ver-1")) body = { dataset_version_id: "ver-1", state: "valid" };
      else if (url.endsWith("/profile")) body = { dataset_id: "ds-1", dataset_version_id: "ver-1", profile: solarMeterProfile };
      else if (url.endsWith("/preview?limit=10")) body = { dataset_id: "ds-1", dataset_version_id: "ver-1", source_file_id: "src-1", source_sha256: "hash", columns: solarMeterColumns, rows: solarMeterRows, returned_rows: 2, limit: 10 };
      else if (url.endsWith("/mapping") && method === "GET") { const last=calls.filter((c) => c.method==="PUT" && c.url.endsWith("/mapping")).at(-1); body={mapping:last ? {mapping_revision_id:"map-1",columns:JSON.parse(last.body!).columns} : null}; }
      else if (url.endsWith("/mapping") && method === "PUT") body = { mapping_revision_id: "map-1", revision_number: 1, columns: JSON.parse(requestBody!).columns };
      else if (url.endsWith("/validate") && method === "POST") body = { validation_run_id: "val-1", outcome: "warnings", error_count: 0, warning_count: 1, errors: [], warnings: [{ field: "Meter: ConsumptionTOTAL (kWh)", code: "review", message: "Review measurement context." }] };
      else if (url.endsWith("/validation-runs/val-1/issue-groups")) body = { total_issues: 1, groups: [{ severity: "warning", field: "Meter: ConsumptionTOTAL (kWh)", code: "review", message: "Review measurement context.", count: 1, examples: [{ row: 1 }] }] };
      else if (url.includes("/validation-runs/val-1/issues?")) body = { total: 1, items: [{ severity: "warning", field: "Meter: ConsumptionTOTAL (kWh)", code: "review", message: "Review measurement context.", row: 1 }] };
      else if (url.endsWith("/approvals") && method === "POST") body = { approval_id: "approval-1", state: "pending" };
      else if (url.endsWith("/decision")) body = { approval_id: "approval-1", state: "approved" };
      return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<DataImportsPage workspaceId="workspace-A" />);
    fireEvent.change(screen.getByLabelText("Select CSV or JSON file"), { target: { files: [new File(["data"], "meter.csv", { type: "text/csv" })] } });
    fireEvent.click(screen.getByText("Upload and analyze",{selector:"button"}));
    for (const step of ["Ingest", "Analyze", "Map", "Validate", "Register"]) {
      expect(screen.getByText(step)).toBeTruthy();
    }
    expect(await previewTable()).toBeTruthy();
    expect(await within(screen.getByRole("table", { name: "Record preview" })).findByText("22.00")).toBeTruthy();
    fireEvent.click(await mappingTab());
    await screen.findByText(/Clarification required/);
    expect(screen.queryByLabelText("Target field for Meter: apparent_power (kVA)")).toBeNull();
    expect(screen.queryByRole("button", { name: /Register, Map & Validate/ })).toBeNull();
    await waitFor(() => expect(calls.some((call) => call.method === "PUT" && call.url.endsWith("/mapping"))).toBe(true));
    expect(await within(await screen.findByLabelText("Dataset state summary")).findByText("10 / 11")).toBeTruthy();
    const automatic = calls.find((call) => call.method === "PUT" && call.url.endsWith("/mapping"));
    const automaticColumns = JSON.parse(automatic!.body!).columns as Array<Record<string, unknown>>;
    expect(automaticColumns).toHaveLength(10);
    expect(automaticColumns.map((column) => column.target_field)).toEqual([
      "timestamp", "energy_consumption", "accumulated_ac_energy", "apparent_power",
      "energy_accumulated", "frequency", "total_real_power", "phase_a_power", "phase_b_power", "phase_c_power",
    ]);
    expect(automaticColumns.map((column) => column.measurement_unit)).toEqual([
      null, "kWh", "kWh", "kVA", "kWh", "Hz", "kW", "kW", "kW", "kW",
    ]);
    expect(automaticColumns.some((column) => column.source_column === "Meter: power_factor (%)")).toBe(false);
    expect(calls.some((call) => call.url.endsWith("/jobs/job-1/preview?limit=10"))).toBe(true);
    await waitFor(() => expect(calls.some((call) => call.method === "POST" && call.url.endsWith("/validate"))).toBe(true));
    fireEvent.click(await mappingTab());
    fireEvent.click(await screen.findByText("Confirm interpretation",{selector:"button"}));
    fireEvent.change(screen.getByLabelText("Power-factor reading scale"), { target: { value: "percent_0_100" } });
    expect(screen.queryByText(/Scale saved/)).toBeNull();
    fireEvent.click(screen.getByText("Confirm scale & validate",{selector:"button"}));
    expect(await screen.findByText(/Power-factor scale saved with the mapping/)).toBeTruthy();
    await waitFor(() => expect(screen.getByText(/Validation: Warnings/)).toBeTruthy());
    fireEvent.click(screen.getByText("Advanced Findings",{selector:"button"}));
    fireEvent.click(screen.getByText(/Inspect all findings/,{selector:"button"}));
    expect(await screen.findByText(/Grouped by field and validation rule/)).toBeTruthy();
    expect(await screen.findByText(/1 findings/)).toBeTruthy();
    fireEvent.click(screen.getByText("Inspect matching records",{selector:"button"}));
    expect(await screen.findByText(/Finding records \(1 match\)/)).toBeTruthy();
    const mappingCalls = calls.filter((call) => call.method === "PUT" && call.url.endsWith("/mapping"));
    const finalColumns = JSON.parse(mappingCalls.at(-1)!.body!).columns;
    expect(finalColumns).toHaveLength(11);
    expect(finalColumns.find((column: Record<string, unknown>) => column.source_column === "Meter: power_factor (%)")).toMatchObject({ target_field: "power_factor", expected_type: "number", measurement_unit: "%", value_scale: "percent_0_100" });
    expect(calls.some((call) => call.method === "POST" && call.url.endsWith("/approvals"))).toBe(false);
    expect(calls.every((call) => call.url.includes("/workspaces/workspace-A/"))).toBe(true);
    expect(calls.some((call) => /\/(assets|inspections|observations)(?:\/|\?|$)/.test(call.url))).toBe(false);
  });


  it("keeps saved mappings and validation visible when the version-list refresh fails", async () => {
    const columns = ["DateTime", "Meter: power_true_kw (kW)"];
    const profile = { row_count: 1, column_count: 2, columns: columns.map((name) => ({ name, observed_types: { text: 1 } })) };
    const rows = [{ DateTime: "2026-09-01 14:39:00", "Meter: power_true_kw (kW)": "12.5" }];
    let persistedMapping: any = null;
    const calls: Array<{ url: string; method: string }> = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input); const method = init?.method ?? "GET"; calls.push({ url, method });
      if (url.endsWith("/datasets/ds-recover/versions")) {
        return new Response(JSON.stringify({ detail: "Internal Server Error" }), { status: 500, headers: { "Content-Type": "application/json" } });
      }
      let body: unknown = {};
      if (/\/datasets\?/.test(url)) body = { items: [], total: 0, limit: 100, offset: 0 };
      else if (url.endsWith("/jobs/job-recover")) body = { job_id: "job-recover", state: "succeeded" };
      else if (url.endsWith("/jobs/job-recover/result")) body = { job_id: "job-recover", source_file_id: "src-recover", result: { format: "csv", profile }, preview: { columns, rows, returned_rows: 1, limit: 10 } };
      else if (url.endsWith("/datasets") && method === "POST") body = { dataset_id: "ds-recover", dataset_version_id: "ver-recover", version_number: 1, state: "draft" };
      else if (url.endsWith("/profile")) body = {profile};
      else if (url.endsWith("/preview?limit=10")) body = {columns,rows};
      else if (url.endsWith("/versions/ver-recover")) body = {dataset_version_id:"ver-recover",state:"draft",current_validation_run_id:"val-recover"};
      else if (url.endsWith("/mapping") && method === "GET") body = {mapping:persistedMapping};
      else if (url.endsWith("/mapping") && method === "PUT") body = persistedMapping = { mapping_revision_id: "map-recover", columns: JSON.parse(String(init?.body)).columns };
      else if (url.endsWith("/validation-runs/val-recover")) body = {validation_run_id:"val-recover",outcome:"warnings",error_count:0,warning_count:1};
      else if (url.endsWith("/validate") && method === "POST") body = { validation_run_id: "val-recover", outcome: "warnings", error_count: 0, warning_count: 1, errors: [], warnings: [] };
      return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
    });
    sessionStorage.setItem("solaris:workspace-recover:upload", JSON.stringify({ source: { source_file_id: "src-recover", original_name: "meter.csv", sha256: "source-hash" }, job_id: "job-recover" }));
    vi.stubGlobal("fetch", fetchMock);
    render(<DataImportsPage workspaceId="workspace-recover" />);

    expect(await screen.findByText(/Dataset draft registered, 2 known mappings saved/)).toBeTruthy();
    expect(await within(await screen.findByLabelText("Dataset state summary")).findByText("2 / 2")).toBeTruthy();
    expect(await screen.findByText(/could not complete that step because of a server error \(HTTP 500\)/i)).toBeTruthy();
    expect(screen.queryByText(/API request to \/workspaces/)).toBeNull();
    expect(calls.some((call) => call.method === "PUT" && call.url.endsWith("/mapping"))).toBe(true);
    expect(calls.some((call) => call.method === "POST" && call.url.endsWith("/validate"))).toBe(true);
  });

  it("allows a researcher to edit and persist mappings in explicit edit mode", async () => {
    sessionStorage.setItem("solaris:workspace-edit:dataset", JSON.stringify("ds-edit"));
    sessionStorage.setItem("solaris:workspace-edit:version", JSON.stringify("ver-edit"));
    sessionStorage.setItem("solaris:workspace-edit:upload", JSON.stringify({ source: { source_file_id: "src-edit", original_name: "edit.csv" }, job_id: "job-edit" }));
    sessionStorage.setItem("solaris:workspace-edit:job", JSON.stringify({ job_id: "job-edit", state: "succeeded" }));
    sessionStorage.setItem("solaris:workspace-edit:result", JSON.stringify({ job_id: "job-edit", source_file_id: "src-edit", result: { format: "csv" } }));
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input); let body: unknown = {};
      if (/\/datasets\?/.test(url)) body = { items: [{ dataset_id: "ds-edit", name: "Editable" }] };
      else if (url.endsWith("/jobs/job-edit")) body = { job_id: "job-edit", state: "succeeded" };
      else if (url.endsWith("/datasets/ds-edit/versions")) body = { items: [{ dataset_id: "ds-edit", dataset_version_id: "ver-edit", version_number: 1, state: "draft", source_file_id: "src-edit", source_job_id: "job-edit" }] };
      else if (url.endsWith("/profile")) body = { profile: { row_count: 1, column_count: 1, columns: [{ name: "power_kw", observed_types: { number: 1 } }] } };
      else if (url.endsWith("/preview?limit=10")) body = { columns: ["power_kw"], rows: [{ power_kw: "12.5" }], returned_rows: 1, limit: 10 };
      else if (url.endsWith("/mapping") && init?.method === "GET") body = { mapping: null };
      else if (url.endsWith("/mapping") && init?.method === "PUT") body = { mapping_revision_id: "map-edit", columns: JSON.parse(String(init.body)).columns };
      else if (url.endsWith("/versions/ver-edit")) body = { dataset_version_id: "ver-edit", state: "draft" };
      return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<DataImportsPage workspaceId="workspace-edit" />);
    expect(await previewTable()).toBeTruthy();
    expect(screen.queryByLabelText("Target field for power_kw")).toBeNull();
    fireEvent.click(await mappingTab());
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByLabelText("Target field for power_kw"), { target: { value: "active_power" } });
    fireEvent.change(screen.getByLabelText("Unit for power_kw"), { target: { value: "kW" } });
    fireEvent.click(screen.getByRole("button", { name: "Save field mapping" }));
    await screen.findByText("Field mapping saved. Run validation again to review this mapping revision.");
    const request = fetchMock.mock.calls.find(([, init]) => init?.method === "PUT");
    const payload = JSON.parse(String(request?.[1]?.body));
    expect(payload.columns[0]).toMatchObject({ source_column: "power_kw", target_field: "active_power", measurement_unit: "kW" });
  });

  it("keeps a mixed numeric and text source column visible and preserves explicit mapping edits", async () => {
    const calls: Array<{ url: string; method: string; body?: string }> = [];
    const fields = ["power_kw", "status", "available_kw"];
    const mixedProfile = { row_count: 2, column_count: 3, columns: [{ name: "power_kw", observed_types: { number: 1, text: 1 } }, { name: "status", observed_types: { text: 2 } }, { name: "available_kw", observed_types: { number: 1, null_marker: 1, empty: 1 } }] };
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input); const method = init?.method ?? "GET"; const requestBody = typeof init?.body === "string" ? init.body : undefined; calls.push({ url, method, body: requestBody });
      let body: unknown = {};
      if (/\/datasets\?/.test(url)) body = { items: [], total: 0, limit: 100, offset: 0 };
      else if (url.endsWith("/uploads")) body = { source: { source_file_id: "src-2", original_name: "mixed.csv", sha256: "mix" }, job_id: "job-2", job_state: "queued" };
      else if (url.endsWith("/jobs/job-2")) body = { job_id: "job-2", state: "succeeded" };
      else if (url.endsWith("/jobs/job-2/result")) body = { job_id: "job-2", source_file_id: "src-2", result: { format: "csv", profile: mixedProfile }, preview: { columns: fields, rows: [{ power_kw: "12.5", status: "ok", available_kw: "7.5" }, { power_kw: "unknown", status: "bad", available_kw: "null" }], returned_rows: 2, limit: 10 } };
      else if (url.endsWith("/datasets") && method === "POST") body = { dataset_id: "ds-2", dataset_version_id: "ver-2", version_number: 1, state: "draft" };
      else if (url.endsWith("/datasets/ds-2/versions")) body = { items: [{ dataset_id: "ds-2", dataset_version_id: "ver-2", version_number: 1, state: "draft", source_file_id: "src-2", source_job_id: "job-2" }] };
      else if (url.endsWith("/versions/ver-2")) body = { dataset_version_id: "ver-2", state: "draft" };
      else if (url.endsWith("/profile")) body = { profile: mixedProfile };
      else if (url.endsWith("/preview?limit=10")) body = { columns: fields, rows: [{ power_kw: "12.5", status: "ok", available_kw: "7.5" }, { power_kw: "unknown", status: "bad", available_kw: "null" }], returned_rows: 2, limit: 10 };
      else if (url.endsWith("/mapping") && method === "GET") body = { mapping: null };
      else if (url.endsWith("/mapping") && method === "PUT") body = { mapping_revision_id: "map-2", revision_number: 1, columns: JSON.parse(requestBody!).columns };
      return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<DataImportsPage workspaceId="workspace-A" />);
    fireEvent.change(screen.getByLabelText("Select CSV or JSON file"), { target: { files: [new File(["data"], "mixed.csv", { type: "text/csv" })] } });
    fireEvent.click(screen.getByRole("button", { name: "Upload and analyze" }));
    await screen.findByText("Analysis complete");
    fireEvent.click(await mappingTab());
    expect(await screen.findByText(/number \(1\).*text \(1\)/)).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "Data Explorer" }));
    expect(screen.getByText("unknown")).toBeTruthy();
    expect(screen.queryByLabelText("Expected type for power_kw")).toBeNull();
    fireEvent.click(await mappingTab());
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(screen.getByLabelText("Expected type for power_kw")).toHaveProperty("value", "string");
    await waitFor(() => expect(screen.getByLabelText("Expected type for available_kw")).toHaveProperty("value", "number"));
    fireEvent.click(await mappingTab());
    expect(screen.getByText(/null_marker \(1\)/)).toBeTruthy();
    expect(screen.getByLabelText("Expected type for power_kw")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Target field for power_kw"), { target: { value: "active_power" } });
    fireEvent.change(screen.getByLabelText("Expected type for power_kw"), { target: { value: "number" } });
    fireEvent.change(screen.getByLabelText("Unit for power_kw"), { target: { value: "kW" } });
    fireEvent.click(screen.getByLabelText("Required field power_kw"));
    await waitFor(() => expect(screen.getByRole("button", { name: "Save field mapping" })).toHaveProperty("disabled", false));
    fireEvent.click(screen.getByRole("button", { name: "Save field mapping" }));
    await screen.findByText("Field mapping saved. Run validation again to review this mapping revision.");
    const mappingRequest = calls.find((call) => call.method === "PUT" && call.url.endsWith("/mapping"));
    const savedPayload = JSON.parse(mappingRequest!.body!);
    expect(savedPayload.columns.find((column: Record<string, unknown>) => column.source_column === "power_kw")).toMatchObject({ target_field: "active_power", expected_type: "number", measurement_unit: "kW", is_required: true });
  });

  it("retains unknown columns and withholds automatic mapping when the header unit conflicts with the measurement", async () => {
    const calls: Array<{ url: string; method: string; body?: string }> = [];
    const columns = ["Meter: apparent_power (kW)", "Operator note"];
    const profile = { row_count: 1, column_count: 2, columns: [{ name: columns[0], observed_types: { number: 1 } }, { name: columns[1], observed_types: { text: 1 } }] };
    const rows = [{ "Meter: apparent_power (kW)": "12.5", "Operator note": "calibrated" }];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input); const method = init?.method ?? "GET"; const requestBody = typeof init?.body === "string" ? init.body : undefined;
      calls.push({ url, method, body: requestBody });
      let body: unknown = {};
      if (/\/datasets\?/.test(url)) body = { items: [], total: 0 };
      else if (url.endsWith("/uploads")) body = { source: { source_file_id: "src-unit", original_name: "unit.csv", sha256: "unit" }, job_id: "job-unit" };
      else if (url.endsWith("/jobs/job-unit")) body = { job_id: "job-unit", state: "succeeded" };
      else if (url.endsWith("/jobs/job-unit/result")) body = { job_id: "job-unit", source_file_id: "src-unit", result: { format: "csv", profile }, preview: { columns, rows, returned_rows: 1, limit: 10 } };
      else if (url.endsWith("/datasets") && method === "POST") body = { dataset_id: "ds-unit", dataset_version_id: "ver-unit", state: "draft" };
      else if (url.endsWith("/datasets/ds-unit/versions")) body = { items: [{ dataset_id: "ds-unit", dataset_version_id: "ver-unit", state: "draft", source_file_id: "src-unit", source_job_id: "job-unit" }] };
      else if (url.endsWith("/mapping") && method === "GET") body = { mapping: null };
      else if (url.endsWith("/mapping") && method === "PUT") body = { columns: JSON.parse(requestBody!).columns };
      else if (url.endsWith("/validate")) body = { validation_run_id: "val-unit", outcome: "warnings", error_count: 0, warning_count: 2, errors: [], warnings: [] };
      else if (url.endsWith("/profile")) body = { profile };
      else if (url.endsWith("/preview?limit=10")) body = { columns, rows, returned_rows: 1, limit: 10 };
      else if (url.endsWith("/versions/ver-unit")) body = { dataset_version_id: "ver-unit", state: "draft" };
      return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<DataImportsPage workspaceId="workspace-A" />);
    fireEvent.change(screen.getByLabelText("Select CSV or JSON file"), { target: { files: [new File(["data"], "unit.csv", { type: "text/csv" })] } });
    fireEvent.click(screen.getByRole("button", { name: "Upload and analyze" }));
    expect(await previewTable()).toBeTruthy();
    expect(screen.getByText("calibrated")).toBeTruthy();
    fireEvent.click(await mappingTab());
    expect(screen.getByText("Mapping pending")).toBeTruthy();
    await waitFor(() => expect(calls.some((call) => call.method === "POST" && call.url.endsWith("/validate"))).toBe(true));
    expect(calls.some((call) => call.method === "PUT" && call.url.endsWith("/mapping"))).toBe(false);
    fireEvent.click(await mappingTab());
    expect(screen.getByText("Mapping pending")).toBeTruthy();
    fireEvent.click(await mappingTab());
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(screen.getByLabelText("Unit for Meter: apparent_power (kW)")).toBeTruthy();
  });

  it("shows JSON null, empty string, zero, and mixed values as distinct source values", async () => {
    sessionStorage.setItem("solaris:workspace-J:dataset", JSON.stringify("ds-json"));
    sessionStorage.setItem("solaris:workspace-J:version", JSON.stringify("ver-json"));
    sessionStorage.setItem("solaris:workspace-J:upload", JSON.stringify({ source: { source_file_id: "src-json", original_name: "sample.json", sha256: "abc" }, job_id: "job-json" }));
    sessionStorage.setItem("solaris:workspace-J:job", JSON.stringify({ job_id: "job-json", state: "succeeded" }));
    sessionStorage.setItem("solaris:workspace-J:result", JSON.stringify({ job_id: "job-json", source_file_id: "src-json", result: { format: "json" } }));
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      let body: unknown = {};
      if (/\/datasets\?/.test(url)) body = { items: [], total: 0, limit: 100, offset: 0 };
      else if (url.endsWith("/jobs/job-json")) body = { job_id: "job-json", state: "succeeded" };
      else if (url.endsWith("/datasets/ds-json/versions")) body = { items: [{ dataset_id: "ds-json", dataset_version_id: "ver-json", version_number: 1, state: "draft", source_file_id: "src-json", source_job_id: "job-json" }] };
      else if (url.endsWith("/profile")) body = { format: "json", profile: { record_count: 2, top_level_keys: ["reading", "note", "metadata", "power_factor (%)"] } };
      else if (url.endsWith("/preview?limit=10")) body = { columns: ["reading", "note", "metadata", "power_factor (%)"], rows: [{ reading: null, note: "", metadata: { source: "meter" }, "power_factor (%)": 0.98 }, { reading: 0, note: "not measured", metadata: ["calibrated"], "power_factor (%)": 98 }], returned_rows: 2, limit: 10 };
      else if (url.endsWith("/mapping")) body = { mapping: null };
      else if (url.endsWith("/versions/ver-json")) body = { dataset_version_id: "ver-json", state: "draft" };
      return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<DataImportsPage workspaceId="workspace-J" />);
    const preview = await previewTable();
    expect(within(preview).getByText("Missing")).toBeTruthy();
    expect(within(preview).getByText("Empty string")).toBeTruthy();
    expect(within(preview).getByText("0")).toBeTruthy();
    expect(within(preview).getByText("not measured")).toBeTruthy();
    expect(within(preview).getByText("Object (1 field)")).toBeTruthy();
    expect(within(preview).getByText("Array (1 item)")).toBeTruthy();
    fireEvent.click(await mappingTab());
    expect(screen.getByText("Clarification required")).toBeTruthy();
    expect(screen.queryByLabelText("Power-factor reading scale")).toBeNull();
    fireEvent.click(await mappingTab());
    fireEvent.click(screen.getByRole("button", { name: "Review scale" }));
    expect(screen.getByLabelText("Power-factor reading scale")).toBeTruthy();
    expect(screen.getByText("JSON", { selector: ".file-type-icon" })).toBeTruthy();
    expect(fetchMock.mock.calls.every(([input]) => String(input).includes("/workspaces/workspace-J/"))).toBe(true);
  });
});


describe("scientific preview summaries", () => {
  const mapping = { columns: [
    { source_column: "time", target_field: "timestamp" },
    { source_column: "energy", target_field: "energy_accumulated", measurement_unit: "kWh" },
    { source_column: "power", target_field: "total_real_power", measurement_unit: "kW" },
  ] };
  it("does not infer production across a cumulative meter reset", () => {
    render(<PreviewMeasurementCards mapping={mapping} preview={{ rows: [
      { time: "2026-09-01T00:00:00Z", energy: "100", power: "2" },
      { time: "2026-09-01T00:01:00Z", energy: "10", power: "4" },
      { time: "2026-09-01T00:02:00Z", energy: "110", power: "6" },
    ] }} />);
    expect(screen.getByText("No defensible energy summary available")).toBeTruthy();
    expect(screen.getByRole("img", { name: /Power trend/ })).toBeTruthy();
  });
  it("does not show a power trend when source timestamps run backwards", () => {
    render(<PreviewMeasurementCards mapping={mapping} preview={{ rows: [
      { time: "2026-09-01T00:02:00Z", energy: "100", power: "2" },
      { time: "2026-09-01T00:01:00Z", energy: "110", power: "4" },
    ] }} />);
    expect(screen.queryByRole("img", { name: /Power trend/ })).toBeNull();
    expect(screen.getByText("No defensible energy summary available")).toBeTruthy();
  });
});

it("hides a cached source when the saved dataset is missing and offers recovery", async () => {
 sessionStorage.setItem("solaris:missing:dataset",JSON.stringify("gone"));
 sessionStorage.setItem("solaris:missing:version",JSON.stringify("gone-version"));
 sessionStorage.setItem("solaris:missing:preview",JSON.stringify({columns:["power"],rows:[{power:"stale reading"}]}));
 vi.stubGlobal("fetch",vi.fn(async (input: RequestInfo | URL) => {
  const url=String(input);
  return new Response(JSON.stringify(/\/datasets\?/.test(url) ? {items:[]} : {detail:"Dataset not found"}),{status:/\/datasets\?/.test(url) ? 200 : 404,headers:{"Content-Type":"application/json"}});
 }));
 render(<DataImportsPage workspaceId="missing"/>);
 expect(await screen.findByRole("heading",{name:"Saved dataset unavailable"})).toBeTruthy();
 expect(screen.queryByText("stale reading")).toBeNull();
 expect(screen.queryByText("Analysis complete")).toBeNull();
 expect(screen.queryByRole("table",{name:"Record preview"})).toBeNull();
 fireEvent.click(screen.getByRole("button",{name:"Start a fresh import"}));
 expect(screen.queryByRole("heading",{name:"Saved dataset unavailable"})).toBeNull();
 expect(screen.getByLabelText("Select CSV or JSON file")).toBeTruthy();
});
