import { useMemo, useState } from "react";
import { DEMO_ASSETS, DEMO_INSPECTION_RECORDS, DEMO_SITES, type AssetCondition, type AssetType, type DemoAsset } from "../overview/demoData";
import { ASSET_TYPES, getAssetSiteSummary, selectAssets, type AssetFilters, type AssetSort } from "./assetModel";

const PAGE_SIZE = 24;
const EMPTY_FILTERS: AssetFilters = { siteId: "all", search: "", type: "all", condition: "all", sort: "assetId" };

function displayDate(value: string | null): string {
  if (!value) return "Not provided";
  return new Date(`${value}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

function ConditionBadge({ condition }: { condition: AssetCondition }) {
  return <span className={`condition-badge condition-${condition.toLowerCase()}`}>{condition}</span>;
}

function AssetDetailsDialog({ asset, onClose }: { asset: DemoAsset; onClose: () => void }) {
  const site = DEMO_SITES.find((item) => item.id === asset.siteId);
  const history = DEMO_INSPECTION_RECORDS
    .filter((inspection) => inspection.assetId === asset.id)
    .sort((left, right) => right.inspectedAt.localeCompare(left.inspectedAt));

  return (
    <div className="detail-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section aria-labelledby="asset-detail-title" aria-modal="true" className="detail-dialog" role="dialog">
        <div className="detail-dialog-heading">
          <div>
            <p className="section-eyebrow">ILLUSTRATIVE ASSET RECORD</p>
            <h2 id="asset-detail-title">{asset.id}</h2>
            <p>{asset.name} <span aria-hidden="true">·</span> {site?.name ?? "Unknown demo site"}</p>
          </div>
          <button aria-label="Close asset details" className="detail-close" onClick={onClose} type="button">×</button>
        </div>

        <div className="detail-badges"><span className="type-badge">{asset.type}</span><ConditionBadge condition={asset.condition} /></div>

        <section aria-labelledby="asset-metadata-title" className="detail-section">
          <h3 id="asset-metadata-title">Asset metadata</h3>
          <dl className="metadata-grid">
            <div><dt>Manufacturer</dt><dd>{asset.manufacturer ?? "Not provided"}</dd></div>
            <div><dt>Model</dt><dd>{asset.model ?? "Not provided"}</dd></div>
            <div><dt>Serial number</dt><dd>{asset.serialNumber ?? "Not provided"}</dd></div>
            <div><dt>Commissioned</dt><dd>{displayDate(asset.commissionedOn)}</dd></div>
            <div><dt>Location</dt><dd>{asset.location ?? "Not provided"}</dd></div>
            <div><dt>Last inspection</dt><dd>{displayDate(asset.lastInspectionAt)}</dd></div>
          </dl>
        </section>

        <section aria-labelledby="asset-inspection-history-title" className="detail-section">
          <div className="detail-section-title"><h3 id="asset-inspection-history-title">Inspection history</h3><span>{history.length} record{history.length === 1 ? "" : "s"}</span></div>
          {history.length === 0 ? <p className="module-empty-state">No inspection history is available for this asset.</p> : (
            <ul className="asset-history-list">
              {history.map((inspection) => (
                <li key={inspection.id}>
                  <span className="history-date">{displayDate(inspection.inspectedAt)}</span>
                  <span><strong>{inspection.method}</strong><small>{inspection.finding}</small></span>
                  <ConditionBadge condition={inspection.condition} />
                </li>
              ))}
            </ul>
          )}
        </section>
        <p className="fixture-footnote">All displayed metadata and classifications are frontend demo fixtures.</p>
      </section>
    </div>
  );
}

function SiteSelector({ siteId, onSelect }: { siteId: string; onSelect: (siteId: string) => void }) {
  return (
    <section aria-label="Demonstration sites" className="site-selector-grid">
      <button aria-pressed={siteId === "all"} className={`site-select-card${siteId === "all" ? " selected" : ""}`} onClick={() => onSelect("all")} type="button">
        <span className="site-card-icon" aria-hidden="true">▦</span>
        <span className="site-card-main"><strong>All demonstration sites</strong><small>Frontend-only site relationships</small></span>
        <span className="site-card-count">{DEMO_ASSETS.length.toLocaleString("en-US")} assets</span>
      </button>
      {DEMO_SITES.map((site) => {
        const summary = getAssetSiteSummary(site.id);
        return (
          <button aria-pressed={siteId === site.id} className={`site-select-card${siteId === site.id ? " selected" : ""}`} key={site.id} onClick={() => onSelect(site.id)} type="button">
            <span className="site-card-icon" aria-hidden="true">⌂</span>
            <span className="site-card-main"><strong>{site.name}</strong><small>Illustrative site fixture</small></span>
            <span className="site-card-count">{summary.assets.length.toLocaleString("en-US")} assets</span>
          </button>
        );
      })}
    </section>
  );
}

function AssetTable({ assets, page, onPageChange, onSelect }: {
  assets: DemoAsset[];
  page: number;
  onPageChange: (page: number) => void;
  onSelect: (asset: DemoAsset) => void;
}) {
  const pages = Math.max(1, Math.ceil(assets.length / PAGE_SIZE));
  const rows = assets.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  return (
    <section aria-labelledby="asset-inventory-title" className="panel-card module-table-panel">
      <div className="module-table-heading">
        <div><h3 id="asset-inventory-title">Asset Inventory</h3><span>{assets.length.toLocaleString("en-US")} matching assets</span></div>
        <span className="phase-label">DEMO DATASET</span>
      </div>
      <div className="module-table-scroll">
        <table className="operations-table module-data-table">
          <caption className="sr-only">Illustrative inventory for the selected demo sites</caption>
          <thead><tr><th scope="col">Asset ID</th><th scope="col">Name</th><th scope="col">Type</th><th scope="col">Condition</th><th scope="col">Last inspection</th><th scope="col"><span className="sr-only">Details</span></th></tr></thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td className="module-empty-cell" colSpan={6}><strong>No assets match these filters</strong><span>Try another site, search value, asset type, or condition.</span></td></tr>
            ) : rows.map((asset) => (
              <tr key={asset.id}>
                <td className="asset-id-cell">{asset.id}</td><td>{asset.name}</td><td><span className="type-badge">{asset.type}</span></td><td><ConditionBadge condition={asset.condition} /></td><td>{displayDate(asset.lastInspectionAt)}</td>
                <td><button aria-label={`View details for ${asset.id}`} className="row-detail-button" onClick={() => onSelect(asset)} type="button">Details</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="module-pagination"><span>Page {Math.min(page + 1, pages)} of {pages}</span><div><button aria-label="Previous asset page" disabled={page === 0} onClick={() => onPageChange(Math.max(0, page - 1))} type="button">Previous</button><button aria-label="Next asset page" disabled={page + 1 >= pages} onClick={() => onPageChange(Math.min(pages - 1, page + 1))} type="button">Next</button></div></div>
    </section>
  );
}

export default function SitesAssetsPage() {
  const [filters, setFilters] = useState<AssetFilters>(EMPTY_FILTERS);
  const [page, setPage] = useState(0);
  const [selectedAsset, setSelectedAsset] = useState<DemoAsset | null>(null);
  const assets = useMemo(() => selectAssets(filters), [filters]);
  const summary = getAssetSiteSummary(filters.siteId);

  function updateFilters(updates: Partial<AssetFilters>) {
    setFilters((current) => ({ ...current, ...updates }));
    setPage(0);
  }

  return (
    <div className="module-content">
      <section className="module-page-heading">
        <div><p className="section-eyebrow">ASSET REGISTER</p><h2>Sites &amp; Assets</h2><p>Browse demonstration sites and their associated solar equipment.</p></div>
        <span className="phase-label">ILLUSTRATIVE DEMO DATA</span>
      </section>

      <SiteSelector siteId={filters.siteId} onSelect={(siteId) => updateFilters({ siteId })} />

      <section aria-label="Selected site summary" className="site-summary-grid">
        <article><span>Selected scope</span><strong>{filters.siteId === "all" ? `${summary.siteCount} sites` : DEMO_SITES.find((site) => site.id === filters.siteId)?.name}</strong><small>Frontend fixture relationship; no SQLite Sites table</small></article>
        <article><span>Assets in scope</span><strong>{summary.assets.length.toLocaleString("en-US")}</strong><small>Across {summary.siteCount} demonstration site{summary.siteCount === 1 ? "" : "s"}</small></article>
        <article><span>Condition summary</span><strong>{summary.conditions.Healthy.toLocaleString("en-US")} healthy <i>·</i> {summary.conditions.Warning} warning <i>·</i> {summary.conditions.Critical} critical</strong><small>Illustrative classifications</small></article>
      </section>

      <section aria-label="Asset inventory filters" className="module-filter-bar">
        <label><span>Site</span><select aria-label="Asset site" onChange={(event) => updateFilters({ siteId: event.target.value })} value={filters.siteId}><option value="all">All sites</option>{DEMO_SITES.map((site) => <option key={site.id} value={site.id}>{site.name}</option>)}</select></label>
        <label className="module-search"><span>Search assets</span><input aria-label="Search assets by ID or name" onChange={(event) => updateFilters({ search: event.target.value })} placeholder="Asset ID or name" type="search" value={filters.search} /></label>
        <label><span>Asset type</span><select aria-label="Asset type" onChange={(event) => updateFilters({ type: event.target.value as AssetType | "all" })} value={filters.type}><option value="all">All types</option>{ASSET_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}</select></label>
        <label><span>Condition</span><select aria-label="Asset condition" onChange={(event) => updateFilters({ condition: event.target.value as AssetCondition | "all" })} value={filters.condition}><option value="all">All conditions</option><option>Healthy</option><option>Warning</option><option>Critical</option></select></label>
        <label><span>Sort by</span><select aria-label="Sort assets by" onChange={(event) => updateFilters({ sort: event.target.value as AssetSort })} value={filters.sort}><option value="assetId">Asset ID</option><option value="name">Name</option><option value="type">Type</option><option value="condition">Condition</option><option value="lastInspection">Last inspection</option></select></label>
      </section>

      <AssetTable assets={assets} page={page} onPageChange={setPage} onSelect={setSelectedAsset} />
      <p className="module-demo-note"><strong>Demo Dataset:</strong> Asset labels, metadata, site associations, and condition classifications are illustrative frontend fixtures, not database records or research findings.</p>
      {selectedAsset && <AssetDetailsDialog asset={selectedAsset} onClose={() => setSelectedAsset(null)} />}
    </div>
  );
}
