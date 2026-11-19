import { useEffect, useState } from "react";
import RecoveryPanel from "./RecoveryPanel";
import Table from "./RecordTable";
import ConditionHistory from "./ConditionHistory";
import AssetDetailsPanel from "./AssetDetailsPanel";
import InspectionObservation from "./InspectionObservation";
import AssetRegistration from "./AssetRegistration";
import EquipmentConfiguration from "./EquipmentConfiguration";
import VisitWorkspace from "./VisitWorkspace";
import type { ReactNode } from "react";
import { requestJson } from "../../api/client";
import type { AppPage } from "../../components/AppSidebar";
import { api } from "../../api/solaris";
import type { DateRangeId } from "../overview/dashboardModel";

type AnyRecord = Record<string, any>;
type LivePage = Exclude<AppPage, "panel-inspection" | "inverters">;
const title: Record<LivePage, string> = { overview: "Solar Asset Operations", "sites-assets": "Sites & Assets", "inspection-history": "Inspection History", "condition-analysis": "Condition Analysis", "alerts-work-orders": "Alerts & Work Orders", "data-imports": "Data Imports", reports: "Reports", "map-explorer": "Map Explorer", administration: "Administration" };
function liveDateWindow(range: DateRangeId) { const end = new Date(); const start = new Date(end); if (range === "30-days") start.setDate(end.getDate() - 29); else if (range === "60-days") start.setDate(end.getDate() - 59); else if (range === "all") return { end: end.toISOString().slice(0, 10) }; else start.setDate(end.getDate() - 89); return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) }; }

function Panel({ heading, children }: { heading: string; children: ReactNode }) {
  return <section className="panel-card live-panel"><h2>{heading}</h2>{children}</section>;
}
function State({ loading, error, empty }: { loading: boolean; error: string; empty?: boolean }) {
  if (loading) return <p role="status">Loading workspace records…</p>;
  if (error) return <p className="api-error" role="alert">{error}</p>;
  if (empty) return <p className="module-empty-state">No records are available for this workspace and selection.</p>;
  return null;
}
export default function LiveWorkspacePage({ page, workspaceId, dateRange }: { page: LivePage; workspaceId: string; dateRange: DateRangeId }) {
  const [data, setData] = useState<AnyRecord>({}); const [loading, setLoading] = useState(true); const [error, setError] = useState("");
  const [search, setSearch] = useState(""); const [assetId, setAssetId] = useState(""); const [openedAssetId,setOpenedAssetId]=useState("");
  const [siteName, setSiteName] = useState(""); const [siteLocation, setSiteLocation] = useState(""); const [siteAssignment, setSiteAssignment] = useState("");
  const [refreshToken, setRefreshToken] = useState(0);
  const [assetMessage,setAssetMessage]=useState('');
  const [assetActionError,setAssetActionError]=useState('');
  const [equipmentNavigation,setEquipmentNavigation]=useState<{assetId:string;asOf:string}|null>(null);
  const [assetSite, setAssetSite] = useState(""); const [assetType, setAssetType] = useState(""); const [assetPage, setAssetPage] = useState(0);
  const [inspectionStart, setInspectionStart] = useState(""); const [inspectionEnd, setInspectionEnd] = useState(""); const [inspectionStatus, setInspectionStatus] = useState(""); const [inspectionPage, setInspectionPage] = useState(0);
  useEffect(() => {
    const controller = new AbortController(); let active = true; setLoading(true); setError(""); setData({}); setOpenedAssetId("");
    const params = { limit: 50, offset: assetPage * 50, search: search || undefined, site_id: assetSite || undefined, asset_type: assetType || undefined };
    const load = async () => {
      try {
        let result: AnyRecord = {};
        if (page === "overview") {
          const range = liveDateWindow(dateRange); const [overview, inspections, maintenance] = await Promise.all([api.overview(workspaceId, range.start, range.end, controller.signal), api.inspections(workspaceId, { limit: 10, offset: 0, ...range }, controller.signal), api.maintenance(workspaceId, controller.signal)]);
          result = { overview, inspections: inspections.items, maintenance: maintenance.items.slice(0, 10) };
        } else if (page === "sites-assets") {
          const [sites, assets] = await Promise.all([api.sites(workspaceId, controller.signal), api.assets(workspaceId, params, controller.signal)]); result = { sites: sites.items, assets: assets.items, assetTotal: assets.total };
        } else if (page === "inspection-history") {
          const records = await api.inspections(workspaceId, { limit: 50, offset: inspectionPage * 50, asset_id: assetId ? Number(assetId) : undefined, start: inspectionStart || undefined, end: inspectionEnd || undefined, status: inspectionStatus || undefined }, controller.signal); result.inspections = records.items; result.inspectionTotal = records.total;
        } else if (page === "condition-analysis") { result = {}; } else if (page === "alerts-work-orders") result.maintenance = (await api.maintenance(workspaceId, controller.signal)).items;
        else if (page === "map-explorer" || page === "reports") {
          const range = liveDateWindow(dateRange); const [sites, overview] = await Promise.all([api.sites(workspaceId, controller.signal), api.overview(workspaceId, range.start, range.end, controller.signal)]); result = { sites: sites.items, overview };
        } else if (page === "administration") result = { workspace: await fetchWorkspace(workspaceId, controller.signal), sites: (await api.sites(workspaceId, controller.signal)).items };
        if (active) setData(result);
      } catch (cause) { if (active && (cause as Error).name !== "AbortError") setError((cause as Error).message); }
      finally { if (active) setLoading(false); }
    };
    void load(); return () => { active = false; controller.abort(); };
  }, [page, workspaceId, search, assetId, refreshToken, assetSite, assetType, assetPage, inspectionStart, inspectionEnd, inspectionStatus, inspectionPage, dateRange]);

  function loadAssetDetails() { setOpenedAssetId(assetId); }
  if (page === "condition-analysis") return <ConditionHistory workspaceId={workspaceId}/>;

  const failed = <State loading={loading} error={error} />;
  if ((loading || error) && page !== "inspection-history") return <div className="module-content"><PageHeading page={page} /><Panel heading={title[page]}>{failed}</Panel></div>;
  if (page === "overview") {
    const metrics = data.overview?.metrics ?? {}; const value = (key: string, format?: (v: any) => string) => metrics[key]?.value == null ? "Unavailable" : format ? format(metrics[key].value) : String(metrics[key].value);
    return <div className="overview-dashboard live-overview"><section className="kpi-grid">{[["Total Assets", value("total_assets")], ["Inspection Coverage", value("inspection_coverage", (v) => `${(v * 100).toFixed(1)}%`)], ["Inspected Assets", value("inspected_assets")], ["Maintenance Records", value("maintenance_count")]].map(([label, val]) => <article aria-label={`${label}: ${val}`} className="kpi-card" key={label}><span>{label}</span><strong>{val}</strong></article>)}</section>
      <div className="live-two-column"><Panel heading="Site Map"><p>Live sites are shown only with recorded coordinates. Use Map Explorer for the workspace site list.</p><p>No illustrative map markers are included in live mode.</p></Panel><Panel heading="Site Condition"><p>Unavailable: the backend has no approved condition classification rule.</p></Panel></div>
      <div className="live-two-column"><Panel heading="Module Temperature Delta (ΔT) Trend"><p>Unavailable: no aggregate workspace trend series is provided. Recorded per-asset measurements are available in Condition Analysis.</p></Panel><Panel heading="Inverter Output / Performance"><p>Unavailable unless corresponding recorded measurements are selected in Condition Analysis.</p></Panel></div>
      <div className="live-two-column"><Panel heading="Recent Inspection Activity"><Table rows={data.inspections ?? []} columns={["inspected_at", "asset_id", "asset_type", "inspection_method", "status"]} /></Panel><Panel heading="Priority Work Queue"><p>Priority is not defined by the backend. Recent recorded maintenance is shown without inferred priority.</p><Table rows={data.maintenance ?? []} columns={["performed_at", "asset_id", "maintenance_type", "description"]} /></Panel></div>
      <Panel heading="Data provenance"><pre>{JSON.stringify(data.overview?.provenance ?? {}, null, 2)}</pre><p>Metrics exclude synthetic records. Definitions come from the API response.</p></Panel></div>;
  }
  return <div className="module-content"><PageHeading page={page} />
    {page==='inspection-history'&&<VisitWorkspace key={`visits:${workspaceId}`} workspaceId={workspaceId} onSaved={()=>setRefreshToken(v=>v+1)}/>}
    {page==='sites-assets' && assetId && <EquipmentConfiguration key={`equipment:${workspaceId}:${assetId}`} workspaceId={workspaceId} assetId={Number(assetId)} sites={data.sites??[]} initialAsOf={equipmentNavigation?.assetId===assetId?equipmentNavigation.asOf:''} onNavigate={(id,asOf)=>{setEquipmentNavigation({assetId:String(id),asOf});setAssetId(String(id));}} onSaved={()=>{setAssetMessage("Documented configuration revision saved.");setRefreshToken(v=>v+1);}}/>}
    {page === 'sites-assets' && <>{assetMessage&&<p role="status">{assetMessage}</p>}{assetActionError&&<p role="alert">{assetActionError}</p>}<AssetRegistration key={`${workspaceId}:${assetId}`} workspaceId={workspaceId} assetId={assetId} sites={data.sites??[]} onSaved={message=>{setAssetMessage(message);setRefreshToken(v=>v+1);}}/></>}
    {page === "sites-assets" && <><div className="module-filter-bar"><label className="module-search">Search assets<input aria-label="Search live assets" value={search} onChange={(e) => { setSearch(e.target.value); setAssetPage(0); }} /></label><label>Site<select aria-label="Live asset site filter" value={assetSite} onChange={(e) => { setAssetSite(e.target.value); setAssetPage(0); }}><option value="">All sites</option>{(data.sites ?? []).map((s: AnyRecord) => <option key={s.site_id} value={s.site_id}>{s.name}</option>)}</select></label><label>Asset type<select aria-label="Live asset type filter" value={assetType} onChange={(e) => { setAssetType(e.target.value); setAssetPage(0); }}><option value="">All types</option>{[...new Set((data.assets ?? []).map((a: AnyRecord) => a.asset_type))].filter(Boolean).map((t) => <option key={String(t)}>{String(t)}</option>)}</select></label><span>{data.assetTotal ?? 0} matching assets</span></div><Panel heading="Sites"><Table rows={data.sites ?? []} columns={["name", "location_text", "latitude", "longitude", "asset_count"]} /><label>New site name<input aria-label="New site name" value={siteName} onChange={(e) => setSiteName(e.target.value)} /></label><label>Recorded location<input aria-label="New site location" value={siteLocation} onChange={(e) => setSiteLocation(e.target.value)} /></label><button disabled={!siteName.trim()} onClick={() => api.createSite(workspaceId, siteName.trim(), siteLocation || undefined).then(() => { setSiteName(""); setRefreshToken((v) => v + 1); }).catch((e) => setError(e.message))}>Register site</button></Panel><Panel heading="Asset Inventory"><Table rows={data.assets ?? []} columns={["external_id", "name", "asset_type", "site_name", "location", "data_origin", "inspection_count"]} />{data.assets?.length > 0 && <label>View asset details<select aria-label="Select live asset details" value={assetId} onChange={(e) => setAssetId(e.target.value)}><option value="">Select asset</option>{data.assets.map((a: AnyRecord) => <option key={a.asset_id} value={a.asset_id}>{a.external_id || a.name}</option>)}</select></label>}<button disabled={!assetId} onClick={() => void loadAssetDetails()}>Load asset details and inspection history</button>{openedAssetId && <AssetDetailsPanel key={`${workspaceId}:${openedAssetId}`} workspaceId={workspaceId} assetId={openedAssetId}/>}<label>Assign selected asset to site<select aria-label="Assign asset site" value={siteAssignment} onChange={(e) => setSiteAssignment(e.target.value)}><option value="">No site</option>{(data.sites ?? []).map((s: AnyRecord) => <option key={s.site_id} value={s.site_id}>{s.name}</option>)}</select></label><button disabled={!assetId} onClick={() => api.assignSite(workspaceId, Number(assetId), siteAssignment || null).then(() => {setAssetActionError("");setRefreshToken((v) => v + 1);}).catch((e) => setAssetActionError(e.message))}>Save site association</button><div className="module-pagination"><span>Page {assetPage + 1}</span><button disabled={assetPage === 0} onClick={() => setAssetPage((p) => p - 1)}>Previous</button><button disabled={(assetPage + 1) * 50 >= (data.assetTotal ?? 0)} onClick={() => setAssetPage((p) => p + 1)}>Next</button></div></Panel><p className="module-demo-note">Use Register or edit equipment to add an asset or edit the selected asset. Synthetic equipment is excluded from the live research inventory.</p></>}
    {page === "inspection-history" && <><div className="module-filter-bar"><label>Asset ID<input aria-label="Live inspection asset ID" value={assetId} onChange={(e) => { setAssetId(e.target.value); setInspectionPage(0); }} /></label><label>Start date<input aria-label="Live inspection start date" type="date" value={inspectionStart} onChange={(e) => { setInspectionStart(e.target.value);setInspectionPage(0); }} /></label><label>End date<input aria-label="Live inspection end date" type="date" value={inspectionEnd} onChange={(e) => { setInspectionEnd(e.target.value);setInspectionPage(0); }} /></label><label>Status<select aria-label="Live inspection status" value={inspectionStatus} onChange={(e) => { setInspectionStatus(e.target.value);setInspectionPage(0); }}><option value="">All statuses</option>{["planned", "in_progress", "completed", "cancelled"].map((s) => <option key={s}>{s}</option>)}</select></label></div><Panel heading="Inspection Records">{failed}{error && <button type="button" onClick={() => setRefreshToken(v => v+1)}>Retry inspections</button>}{!loading && !error && <><Table rows={data.inspections ?? []} columns={["inspected_at", "asset_id", "asset_type", "inspection_method", "data_source", "notes", "status"]} /><div className="module-pagination"><span>{data.inspectionTotal ?? 0} records · page {inspectionPage + 1}</span><button disabled={!inspectionPage} onClick={() => setInspectionPage((p) => p - 1)}>Previous</button><button disabled={(inspectionPage + 1) * 50 >= (data.inspectionTotal ?? 0)} onClick={() => setInspectionPage((p) => p + 1)}>Next</button></div></>}</Panel>{data.inspections?.map((i: AnyRecord) => <InspectionObservation key={i.inspection_id} workspaceId={workspaceId} id={i.inspection_id} />)}</>}

    {page === "alerts-work-orders" && <><Panel heading="Recorded Maintenance"><Table rows={data.maintenance ?? []} columns={["performed_at", "asset_id", "maintenance_type", "description", "performed_by", "data_origin"]} /></Panel><Panel heading="Alerts and Work Orders"><p>Unavailable: the current schema does not define alert severity, work-order priority, assignment, or completion status.</p></Panel></>}
    {page === "reports" && <><Panel heading="Workspace summary"><pre>{JSON.stringify(data.overview?.metrics ?? {}, null, 2)}</pre></Panel><Panel heading="Sites"><Table rows={data.sites ?? []} columns={["name", "location_text", "latitude", "longitude", "asset_count"]} /></Panel><p>Export is not available.</p></>}
    {page === "map-explorer" && <Panel heading="Recorded site locations"><p>Coordinates below are supplied by the workspace database. No pins are fabricated.</p><Table rows={(data.sites ?? []).filter((s: AnyRecord) => s.latitude != null && s.longitude != null)} columns={["name", "latitude", "longitude", "location_text"]} /><p>Sites without coordinates: {(data.sites ?? []).filter((s: AnyRecord) => s.latitude == null || s.longitude == null).length}</p></Panel>}
    {page === "administration" && <><Panel heading="Workspace"><pre>{JSON.stringify(data.workspace ?? {}, null, 2)}</pre></Panel><RecoveryPanel/><Panel heading="Operational status"><p>Local API workspace mode. Recovery has a separate operator capability. Enterprise user roles remain outside this task.</p></Panel></>}
  </div>;
}
function PageHeading({ page }: { page: LivePage }) { return <section className="module-page-heading"><div><p className="section-eyebrow">LIVE WORKSPACE RECORDS</p><h2>{title[page]}</h2><p>Data is scoped to the selected workspace; unsupported values are not inferred.</p></div><span className="phase-label">LIVE DATA</span></section>; }
async function fetchWorkspace(id: string, signal: AbortSignal) { return requestJson<AnyRecord>(`/workspaces/${encodeURIComponent(id)}`, { signal }); }
