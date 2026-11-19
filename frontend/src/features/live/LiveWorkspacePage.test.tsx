import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import LiveWorkspacePage from "./LiveWorkspacePage";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("live workspace screens", () => {
  it("scopes requests to the selected workspace and replaces data on workspace change", async () => {
    const requests: string[] = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input); requests.push(url);
      const workspace = url.includes("workspace-A") ? "A" : "B";
      const body = url.includes("/sites?") ? { items: [], total: 0, limit: 100, offset: 0 }
        : { items: [{ asset_id: workspace === "A" ? 11 : 22, external_id: `ASSET-${workspace}`, name: `Asset ${workspace}`, asset_type: "PV Module", site_name: null, location: null, inspection_count: 0 }], total: 1, limit: 100, offset: 0 };
      return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);
    const view = render(<LiveWorkspacePage page="sites-assets" workspaceId="workspace-A" dateRange="all" />);
    expect((await screen.findAllByText("ASSET-A")).length).toBeGreaterThan(0);
    view.rerender(<LiveWorkspacePage page="sites-assets" workspaceId="workspace-B" dateRange="all" />);
    expect((await screen.findAllByText("ASSET-B")).length).toBeGreaterThan(0);
    await waitFor(() => expect(screen.queryAllByText("ASSET-A")).toHaveLength(0));
    expect(requests.every((url) => /\/api\/v1\/workspaces\/workspace-[AB]\//.test(url))).toBe(true);
    expect(requests.some((url) => url.includes("workspace-B"))).toBe(true);
  });

  it("keeps unsupported condition and priority values explicitly unavailable", async () => {
    const response = { workspace_id: "ws", metrics: { total_assets: { value: 0 }, inspection_coverage: { value: null }, inspected_assets: { value: 0 }, maintenance_count: { value: 0 } }, provenance: {} };
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const body = url.includes("/dashboard/overview") ? response : { items: [], total: 0, limit: 10, offset: 0 };
      return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<LiveWorkspacePage page="overview" workspaceId="workspace-A" dateRange="all" />);
    expect(await screen.findByText("Unavailable")).toBeTruthy();
    expect(screen.getByRole("article", { name: "Total Assets: 0" })).toBeTruthy();
    expect(screen.getByRole("article", { name: "Inspection Coverage: Unavailable" })).toBeTruthy();
    expect(screen.getByText(/no approved condition classification rule/i)).toBeTruthy();
    expect(screen.getByText(/priority is not defined/i)).toBeTruthy();
  });
});
