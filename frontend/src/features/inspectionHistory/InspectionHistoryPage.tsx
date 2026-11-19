import { useMemo, useState } from "react";
import {
  DEMO_ASSETS,
  DEMO_SITES,
  type AssetCondition,
  type DemoInspectionRecord,
  type DemoInspectionMethod,
  type DemoInspectionStatus,
} from "../overview/demoData";
import { INSPECTION_CONDITIONS, INSPECTION_METHODS, INSPECTION_STATUSES, selectInspections, type InspectionFilters } from "./inspectionModel";

const PAGE_SIZE = 25;
const EMPTY_FILTERS: InspectionFilters = { siteId: "all", search: "", startDate: "", endDate: "", method: "all", status: "all" };

function displayDate(value: string): string {
  return new Date(`${value}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

function StatusBadge({ status }: { status: DemoInspectionStatus }) {
  return <span className={`inspection-status status-${status === "Complete" ? "complete" : status === "Attention" ? "attention" : "follow-up"}`}>{status}</span>;
}

function InspectionDetailsDialog({ inspection, onClose }: { inspection: DemoInspectionRecord; onClose: () => void }) {
  const asset = DEMO_ASSETS.find((item) => item.id === inspection.assetId);
  const site = DEMO_SITES.find((item) => item.id === inspection.siteId);

  return (
    <div className="detail-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section aria-labelledby="inspection-detail-title" aria-modal="true" className="detail-dialog inspection-detail-dialog" role="dialog">
        <div className="detail-dialog-heading">
          <div><p className="section-eyebrow">ILLUSTRATIVE INSPECTION RECORD</p><h2 id="inspection-detail-title">{inspection.assetId}</h2><p>{asset?.name ?? "Unknown asset"} <span aria-hidden="true">·</span> {site?.name ?? "Unknown demo site"}</p></div>
          <button aria-label="Close inspection details" className="detail-close" onClick={onClose} type="button">×</button>
        </div>

        <div className="inspection-detail-facts">
          <div><span>Inspection date</span><strong>{displayDate(inspection.inspectedAt)}</strong></div>
          <div><span>Asset type</span><strong>{asset?.type ?? "Not provided"}</strong></div>
          <div><span>Method</span><strong>{inspection.method}</strong></div>
          <div><span>Status / condition</span><strong><StatusBadge status={inspection.status} /> <span className={`condition-text condition-${inspection.condition.toLowerCase()}`}>{inspection.condition}</span></strong></div>
        </div>

        <section className="detail-section"><h3>Findings</h3><p className="inspection-finding-detail">{inspection.finding}</p></section>
        <section aria-labelledby="observation-title" className="detail-section">
          <div className="detail-section-title"><h3 id="observation-title">Observations &amp; measurements</h3><span>{inspection.observations.length} recorded</span></div>
          {inspection.observations.length === 0 ? (
            <p className="missing-measurement-note">No measurement was recorded for this synthetic inspection. Missing data is not represented as zero.</p>
          ) : (
            <div className="module-table-scroll"><table className="operations-table observation-table"><thead><tr><th scope="col">Parameter</th><th scope="col">Value</th><th scope="col">Quality</th><th scope="col">Source</th></tr></thead><tbody>
              {inspection.observations.map((observation) => <tr key={observation.id}><td>{observation.parameter}</td><td className="observation-value">{observation.value} {observation.unit}</td><td>{observation.quality}</td><td>{observation.source}</td></tr>)}
            </tbody></table></div>
          )}
        </section>
        <p className="fixture-footnote">All inspection rows and any listed values are synthetic frontend demonstration data.</p>
      </section>
    </div>
  );
}

function InspectionTable({ records, page, onPageChange, onSelect }: {
  records: DemoInspectionRecord[];
  page: number;
  onPageChange: (page: number) => void;
  onSelect: (inspection: DemoInspectionRecord) => void;
}) {
  const pages = Math.max(1, Math.ceil(records.length / PAGE_SIZE));
  const rows = records.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const assetsById = new Map(DEMO_ASSETS.map((asset) => [asset.id, asset]));

  return (
    <section aria-labelledby="inspection-records-title" className="panel-card module-table-panel">
      <div className="module-table-heading"><div><h3 id="inspection-records-title">Inspection Records</h3><span>{records.length.toLocaleString("en-US")} matching records</span></div><span className="phase-label">DEMO DATASET</span></div>
      <div className="module-table-scroll">
        <table className="operations-table module-data-table inspection-record-table">
          <caption className="sr-only">Synthetic inspection history for demonstration sites and assets</caption>
          <thead><tr><th scope="col">Inspection date</th><th scope="col">Asset ID</th><th scope="col">Asset type</th><th scope="col">Method</th><th scope="col">Source</th><th scope="col">Findings</th><th scope="col">Status / condition</th><th scope="col"><span className="sr-only">Details</span></th></tr></thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td className="module-empty-cell" colSpan={8}><strong>No inspection records match these filters</strong><span>Adjust the date range, site, method, condition, or asset ID search.</span></td></tr>
            ) : rows.map((inspection) => (
              <tr key={inspection.id}>
                <td>{displayDate(inspection.inspectedAt)}</td><td className="asset-id-cell">{inspection.assetId}</td><td>{assetsById.get(inspection.assetId)?.type ?? "Not provided"}</td><td>{inspection.method}</td><td className="source-cell">{inspection.source}</td><td className="finding-cell">{inspection.finding}</td><td><StatusBadge status={inspection.status} /><small className="inspection-condition-label">{inspection.condition}</small></td>
                <td><button aria-label={`View inspection record for ${inspection.assetId} on ${inspection.inspectedAt}`} className="row-detail-button" onClick={() => onSelect(inspection)} type="button">Details</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="module-pagination"><span>Page {Math.min(page + 1, pages)} of {pages}</span><div><button aria-label="Previous inspection page" disabled={page === 0} onClick={() => onPageChange(Math.max(0, page - 1))} type="button">Previous</button><button aria-label="Next inspection page" disabled={page + 1 >= pages} onClick={() => onPageChange(Math.min(pages - 1, page + 1))} type="button">Next</button></div></div>
    </section>
  );
}

export default function InspectionHistoryPage() {
  const [filters, setFilters] = useState<InspectionFilters>(EMPTY_FILTERS);
  const [page, setPage] = useState(0);
  const [selectedInspection, setSelectedInspection] = useState<DemoInspectionRecord | null>(null);
  const records = useMemo(() => selectInspections(filters), [filters]);

  function updateFilters(updates: Partial<InspectionFilters>) {
    setFilters((current) => ({ ...current, ...updates }));
    setPage(0);
  }

  return (
    <div className="module-content">
      <section className="module-page-heading">
        <div><p className="section-eyebrow">FIELD RECORDS</p><h2>Inspection History</h2><p>Review illustrative inspection records, outcomes, and recorded observations.</p></div>
        <span className="phase-label">ILLUSTRATIVE DEMO DATA</span>
      </section>

      <section aria-label="Inspection history filters" className="module-filter-bar inspection-filter-bar">
        <label><span>Site</span><select aria-label="Inspection site" onChange={(event) => updateFilters({ siteId: event.target.value })} value={filters.siteId}><option value="all">All sites</option>{DEMO_SITES.map((site) => <option key={site.id} value={site.id}>{site.name}</option>)}</select></label>
        <label className="module-search"><span>Search by asset ID</span><input aria-label="Search inspections by asset ID" onChange={(event) => updateFilters({ search: event.target.value })} placeholder="Asset ID (e.g. PV-1203)" type="search" value={filters.search} /></label>
        <label><span>Start date</span><input aria-label="Inspection start date" max={filters.endDate || undefined} onChange={(event) => updateFilters({ startDate: event.target.value })} type="date" value={filters.startDate} /></label>
        <label><span>End date</span><input aria-label="Inspection end date" min={filters.startDate || undefined} onChange={(event) => updateFilters({ endDate: event.target.value })} type="date" value={filters.endDate} /></label>
        <label><span>Method</span><select aria-label="Inspection method" onChange={(event) => updateFilters({ method: event.target.value as DemoInspectionMethod | "all" })} value={filters.method}><option value="all">All methods</option>{INSPECTION_METHODS.map((method) => <option key={method}>{method}</option>)}</select></label>
        <label><span>Status / condition</span><select aria-label="Inspection status or condition" onChange={(event) => updateFilters({ status: event.target.value as DemoInspectionStatus | AssetCondition | "all" })} value={filters.status}><option value="all">All statuses and conditions</option><optgroup label="Inspection status">{INSPECTION_STATUSES.map((status) => <option key={status}>{status}</option>)}</optgroup><optgroup label="Asset condition">{INSPECTION_CONDITIONS.map((condition) => <option key={condition}>{condition}</option>)}</optgroup></select></label>
      </section>

      <InspectionTable records={records} page={page} onPageChange={setPage} onSelect={setSelectedInspection} />
      <p className="module-demo-note"><strong>Demo Dataset:</strong> Dates, methods, findings, status, and the limited illustrative observations below are synthetic. Blank measurements mean no value is present in that fixture.</p>
      {selectedInspection && <InspectionDetailsDialog inspection={selectedInspection} onClose={() => setSelectedInspection(null)} />}
    </div>
  );
}
