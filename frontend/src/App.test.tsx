import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "./App";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); sessionStorage.clear(); });

describe("SOLARIS overview dashboard", () => {
  it("preserves SOLARIS branding and clearly labels the demo dataset", () => {
    render(<App />);

    expect(screen.getByRole("link", { name: /SOLARIS Asset Intelligence/i })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Solar Asset Operations" })).toBeTruthy();
    expect(screen.getAllByText("DEMO DATASET")).toHaveLength(2);
    expect(screen.getByText("Illustrative data for development and demonstration only")).toBeTruthy();
  });

  it("enables completed navigation modules", () => {
    render(<App />);

    const navigation = screen.getByRole("navigation", { name: "Primary navigation" });
    expect(within(navigation).getByRole("link", { name: "Sites & Assets" })).toBeTruthy();
    expect(within(navigation).getByRole("link", { name: "Inspection History" })).toBeTruthy();
    expect(within(navigation).getByRole("link", { name: "Condition Analysis" })).toBeTruthy();
    expect(within(navigation).getByRole("link", { name: "Data Imports" })).toBeTruthy();
  });

  it("renders dashboard sections with coherent North Ridge demo values", () => {
    render(<App />);

    expect(screen.getByRole("article", { name: "Total Assets: 1,248" })).toBeTruthy();
    expect(screen.getByRole("article", { name: "Inspection Coverage: 96.8%" })).toBeTruthy();
    expect(screen.getByRole("article", { name: "Open Findings: 18" })).toBeTruthy();
    expect(screen.getByRole("article", { name: "Priority Actions: 7" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: /Site Map — North Ridge Solar Farm/ })).toBeTruthy();
    expect(screen.getByRole("heading", { name: /Site Condition — North Ridge Solar Farm/ })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Module Temperature Delta (ΔT) Trend" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Inverter Output / Performance" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Recent Inspection Activity" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Priority Work Queue" })).toBeTruthy();
  });

  it("filters the dashboard when the site, date range, and search change", () => {
    render(<App />);

    fireEvent.change(screen.getByRole("combobox", { name: "Site" }), {
      target: { value: "south-mesa" },
    });
    expect(screen.getByRole("article", { name: "Total Assets: 186" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: /Site Map — South Mesa Solar Park/ })).toBeTruthy();

    fireEvent.change(screen.getByRole("combobox", { name: "Site" }), {
      target: { value: "north-ridge" },
    });
    fireEvent.change(screen.getByRole("combobox", { name: "Date range" }), {
      target: { value: "30-days" },
    });
    expect(screen.getByRole("article", { name: /^Inspection Coverage:/ })).toBeTruthy();
    expect(screen.queryByRole("article", { name: "Inspection Coverage: 96.8%" })).toBeNull();

    fireEvent.change(screen.getByRole("searchbox", { name: "Search assets" }), {
      target: { value: "PV-1203" },
    });
    expect(screen.getByRole("article", { name: "Total Assets: 1" })).toBeTruthy();
    expect(screen.getByRole("article", { name: "Open Findings: 1" })).toBeTruthy();
  });

  it("identifies the site layout as illustrative and provides accessible map filters", () => {
    render(<App />);

    expect(screen.getByText("ILLUSTRATIVE LAYOUT · NOT GEOGRAPHIC DATA")).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "Map asset type" })).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "Map condition" })).toBeTruthy();
    expect((screen.getByRole("checkbox", { name: "Show Labels" }) as HTMLInputElement).checked).toBe(true);
  });

  it("loads live workspaces from the API without showing sample KPIs", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ items: [{ workspace_id: "live-1", name: "Research", description: null }], total: 1, limit: 100, offset: 0 }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    render(<App />);
    fireEvent.change(screen.getByRole("combobox", { name: "Data mode" }), { target: { value: "live" } });
    expect(await screen.findByRole("combobox", { name: "Live workspace" })).toBeTruthy();
    expect(screen.getByText("Workspace records only; unavailable values are not inferred")).toBeTruthy();
    expect(screen.queryByRole("article", { name: "Total Assets: 1,248" })).toBeNull();
    expect(fetchMock).toHaveBeenCalledWith("/api/v1/workspaces?limit=100", expect.objectContaining({ signal: expect.any(AbortSignal) }));
  });

  it("creates and renames live workspaces through the existing API", async () => {
    const calls: string[] = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input); calls.push(`${init?.method ?? "GET"} ${url}`);
      const body = url.includes("/workspaces?limit") ? { items: [{ workspace_id: "ws-a", name: "Alpha", description: null }], total: 1, limit: 100, offset: 0 }
        : init?.method === "POST" ? { workspace_id: "ws-b", name: "Beta", description: "" }
          : { workspace_id: "ws-b", name: "Beta renamed", description: null };
      return new Response(JSON.stringify(body), { status: init?.method === "POST" ? 201 : 200, headers: { "Content-Type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<App />);
    fireEvent.change(screen.getByRole("combobox", { name: "Data mode" }), { target: { value: "live" } });
    await screen.findByRole("option", { name: "Alpha" });
    fireEvent.click(screen.getByText("New workspace"));
    fireEvent.change(screen.getByLabelText("New workspace name"), { target: { value: "Beta" } });
    fireEvent.click(screen.getByRole("button", { name: /^Create$/ }));
    await screen.findByRole("option", { name: "Beta" });
    fireEvent.click(screen.getByText("Rename"));
    fireEvent.change(screen.getByLabelText("Renamed workspace name"), { target: { value: "Alpha renamed" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(calls.some((call) => call.startsWith("PATCH /api/v1/workspaces/ws-b"))).toBe(true));
    expect(calls.some((call) => call.startsWith("POST /api/v1/workspaces"))).toBe(true);
  });
});


it("restores the live import page and workspace selection after remount", async () => {
  sessionStorage.setItem("solaris:page","data-imports");
  sessionStorage.setItem("solaris:mode","live");
  sessionStorage.setItem("solaris:workspace","resume-workspace");
  vi.stubGlobal("fetch",vi.fn(async (input: RequestInfo | URL) => new Response(JSON.stringify(String(input).includes("/workspaces?limit") ? {items:[{workspace_id:"resume-workspace",name:"Resume"}]} : {items:[]}),{status:200,headers:{"Content-Type":"application/json"}})));
  render(<App/>);
  expect(await screen.findByRole("heading",{name:"Data Import & Processing"})).toBeTruthy();
  await waitFor(() => expect(screen.getByLabelText("Import workspace")).toHaveProperty("value","resume-workspace"));
  expect(screen.getByLabelText("Select CSV or JSON file")).toBeTruthy();
});
