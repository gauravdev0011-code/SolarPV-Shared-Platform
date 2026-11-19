import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import AppSidebar from "./components/AppSidebar";
import DashboardHeader from "./components/DashboardHeader";
import type { AppPage } from "./components/AppSidebar";
import SitesAssetsPage from "./features/sitesAssets/SitesAssetsPage";
import InspectionHistoryPage from "./features/inspectionHistory/InspectionHistoryPage";
import { getDashboardViewModel, type DashboardFilters } from "./features/overview/dashboardModel";
import OverviewDashboard from "./features/overview/OverviewDashboard";
import { api, type Workspace } from "./api/solaris";
import type { DataMode } from "./components/WorkspaceControls";
import LiveWorkspacePage from "./features/live/LiveWorkspacePage";
import DataImportsPage from "./features/dataImports/DataImportsPage";

const InverterPage = lazy(() => import("./features/inverters/InverterPage"));
const PanelInspectionPage = lazy(() => import("./features/panelInspection/PanelInspectionPage"));

export default function App() {
  const [page, setPage] = useState<AppPage>(() => {
    const saved = sessionStorage.getItem("solaris:page");
    return ["overview","sites-assets","panel-inspection","inverters","inspection-history","condition-analysis","alerts-work-orders","data-imports","reports","map-explorer","administration"].includes(saved ?? "") ? saved as AppPage : "overview";
  });
  const [mode, setMode] = useState<DataMode>(() => sessionStorage.getItem("solaris:mode") === "live" ? "live" : "sample");
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [workspaceId, setWorkspaceId] = useState(() => sessionStorage.getItem("solaris:workspace") ?? "");
  useEffect(() => { sessionStorage.setItem("solaris:page", page); sessionStorage.setItem("solaris:mode", mode); sessionStorage.setItem("solaris:workspace", workspaceId); }, [page,mode,workspaceId]);
  const [workspaceError, setWorkspaceError] = useState("");
  const [workspaceLoading, setWorkspaceLoading] = useState(false);
  const [apiConnected, setApiConnected] = useState(false);
  const [panelSidebarCollapsed, setPanelSidebarCollapsed] = useState(false);
  const [filters, setFilters] = useState<DashboardFilters>({
    siteId: "north-ridge",
    dateRange: "reference",
    search: "",
  });
  const dashboard = useMemo(() => getDashboardViewModel(filters), [filters]);

  useEffect(() => {
    if (mode !== "live") return;
    const controller = new AbortController();
    setWorkspaceLoading(true); setWorkspaceError("");
    api.workspaces(controller.signal).then((result) => {
      setApiConnected(true);
      setWorkspaces(result.items);
      setWorkspaceId((current) => result.items.some((item) => item.workspace_id === current) ? current : result.items[0]?.workspace_id ?? "");
    }).catch((error: Error) => { if (error.name !== "AbortError") { setApiConnected(false); setWorkspaceError(error.message); } })
      .finally(() => { if (!controller.signal.aborted) setWorkspaceLoading(false); });
    return () => controller.abort();
  }, [mode]);

  async function createWorkspace(name: string) {
    try { const created = await api.createWorkspace(name); setApiConnected(true); setWorkspaces((items) => [...items, created]); setWorkspaceId(created.workspace_id); setWorkspaceError(""); }
    catch (error) { setWorkspaceError((error as Error).message); }
  }
  async function renameWorkspace(name: string) {
    if (!workspaceId) return;
    try { const updated = await api.renameWorkspace(workspaceId, name); setWorkspaces((items) => items.map((item) => item.workspace_id === workspaceId ? updated : item)); setWorkspaceError(""); }
    catch (error) { setWorkspaceError((error as Error).message); }
  }

  return (
    <div className={`application-shell${page === "panel-inspection" && panelSidebarCollapsed ? " panel-sidebar-collapsed" : ""}`}>
      <AppSidebar currentPage={page} onNavigate={setPage} liveMode={mode === "live"} apiConnected={apiConnected} mode={mode} workspaceId={workspaceId} workspaces={workspaces} onModeChange={(next) => { setMode(next); setWorkspaceError(""); }} onWorkspaceChange={(id) => setWorkspaceId(id)} onCreateWorkspace={(name) => void createWorkspace(name)} onRenameWorkspace={(name) => void renameWorkspace(name)}
        collapsed={page === "panel-inspection" && panelSidebarCollapsed}
        onToggle={page === "panel-inspection" ? () => setPanelSidebarCollapsed((value) => !value) : undefined} />
      <main className="application-main" id={page}>
        <DashboardHeader
          filters={filters}
          showFilters={page === "overview"}
          onFiltersChange={(updates) => setFilters((current) => ({ ...current, ...updates }))}
          mode={mode}
          workspaceControl={page === "data-imports" && mode === "live" ? <><button type="button" className="dataset-search-shortcut" onClick={()=>{const panel=document.getElementById('recent-datasets') as HTMLDetailsElement|null;if(panel)panel.open=true;document.getElementById('recent-dataset-search')?.focus();}}>⌕ Search datasets… <kbd>Ctrl K</kbd></button><label className="import-header-workspace"><span className="sr-only">Import workspace</span><select aria-label="Import workspace" value={workspaceId} onChange={(e) => setWorkspaceId(e.target.value)}>{workspaces.map((w) => <option key={w.workspace_id} value={w.workspace_id}>Live Workspace: {w.name}</option>)}</select></label></> : undefined}
          title={page === "inverters" ? "Inverters" : page === "panel-inspection" ? "Panel Inspection" : page === "data-imports" ? "Data & Integrations" : undefined}
          subtitle={page === "inverters" ? "Engineering locations and imported monitoring configuration" : page === "panel-inspection" ? "Find panels, record inspections, and track changes." : page === "data-imports" ? "Automated ingestion, recognition, validation, and registration of solar research data" : undefined}
        />
        {mode === "live" && workspaceError && <p className="api-error" role="alert">{workspaceError}</p>}
        {mode === "live" && workspaceLoading && <p className="live-loading" role="status">Loading available workspaces…</p>}
        {mode === "live" && page !== "panel-inspection" && page !== "inverters" && !workspaceLoading && !workspaceError && !workspaceId && <section className="live-onboarding"><p className="section-eyebrow">LIVE WORKSPACE</p><h2>No workspace is available</h2><p>Create a workspace with the New workspace control above. Live records remain separate from the illustrative sample dataset.</p></section>}
        {page === "inverters" && (mode === "live"
          ? <Suspense fallback={<p className="live-loading" role="status">Loading Inverters?</p>}>
              <InverterPage key={workspaceId} workspace={workspaceId} />
            </Suspense>
          : <section className="live-onboarding"><h2>Inverter configuration</h2><p>Open a live workspace to view imported equipment records.</p><button type="button" onClick={() => setMode("live")}>Open live workspace</button></section>)}
        {page === "panel-inspection" && <Suspense fallback={<p className="live-loading" role="status">Loading Panel Inspection…</p>}>
          <PanelInspectionPage live={mode === "live"} workspace={workspaceId} />
        </Suspense>}
        {mode === "sample" && page === "overview" && <OverviewDashboard dashboard={dashboard} filters={filters} />}
        {mode === "sample" && page === "sites-assets" && <SitesAssetsPage />}
        {mode === "sample" && page === "inspection-history" && <InspectionHistoryPage />}
        {mode === "live" && workspaceId && !workspaceLoading && page === "data-imports" && <DataImportsPage key={workspaceId} workspaceId={workspaceId} />}
        {mode === "live" && workspaceId && !workspaceLoading && page !== "data-imports" && page !== "panel-inspection" && page !== "inverters" && <LiveWorkspacePage key={`${page}:${workspaceId}`} page={page} workspaceId={workspaceId} dateRange={filters.dateRange} />}
        {mode === "sample" && page !== "overview" && page !== "sites-assets" && page !== "inspection-history" && page !== "panel-inspection" && page !== "inverters" && <section className="live-onboarding"><p className="section-eyebrow">LIVE MODULE</p><h2>{page.replaceAll("-", " ")}</h2><p>This module uses live workspace records. Switch to Live Workspace to view it; sample fixtures remain available on the existing sample screens.</p><button type="button" onClick={() => setMode("live")}>Open live workspace</button></section>}
      </main>
    </div>
  );
}
