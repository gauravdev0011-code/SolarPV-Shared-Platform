import {
  DEMO_ASSETS,
  DEMO_FINDINGS,
  DEMO_RECENT_INSPECTIONS,
  DEMO_SITES,
  DEMO_WORK_ITEMS,
  type AssetCondition,
  type DemoAsset,
  type DemoFinding,
  type DemoInspectionActivity,
  type DemoWorkItem,
} from "./demoData";

export type DateRangeId = "reference" | "30-days" | "60-days" | "all";

export interface DashboardFilters {
  siteId: string;
  dateRange: DateRangeId;
  search: string;
}

export interface DateBounds {
  start: string | null;
  end: string;
}

export interface DashboardViewModel {
  siteName: string;
  assets: DemoAsset[];
  assetIds: ReadonlySet<string>;
  findings: DemoFinding[];
  priorityActions: DemoWorkItem[];
  inspections: DemoInspectionActivity[];
  totalAssets: number;
  inspectedAssets: number;
  inspectionCoverage: number | null;
  conditions: Record<AssetCondition, number>;
  dateBounds: DateBounds;
  dateRange: DateRangeId;
}

export const DATE_RANGE_OPTIONS: Array<{ id: DateRangeId; label: string }> = [
  { id: "reference", label: "Aug 1, 2026 – Oct 31, 2026" },
  { id: "30-days", label: "Last 30 days" },
  { id: "60-days", label: "Last 60 days" },
  { id: "all", label: "All available dates" },
];

export function getDateBounds(range: DateRangeId): DateBounds {
  switch (range) {
    case "30-days":
      return { start: "2026-10-02", end: "2026-10-31" };
    case "60-days":
      return { start: "2026-09-02", end: "2026-10-31" };
    case "all":
      return { start: null, end: "2026-10-31" };
    case "reference":
    default:
      return { start: "2026-08-01", end: "2026-10-31" };
  }
}

export function isInDateRange(value: string | null | undefined, bounds: DateBounds): boolean {
  if (!value) return false;
  const date = value.slice(0, 10);
  return (!bounds.start || date >= bounds.start) && date <= bounds.end;
}

function matchesSearch(asset: DemoAsset, query: string): boolean {
  if (!query) return true;
  return asset.id.toLocaleLowerCase().includes(query) || asset.type.toLocaleLowerCase().includes(query);
}

export function getDashboardViewModel(filters: DashboardFilters): DashboardViewModel {
  const query = filters.search.trim().toLocaleLowerCase();
  const dateBounds = getDateBounds(filters.dateRange);
  const sites = filters.siteId === "all"
    ? DEMO_SITES
    : DEMO_SITES.filter((site) => site.id === filters.siteId);
  const siteIds = new Set(sites.map((site) => site.id));
  const assets = DEMO_ASSETS.filter(
    (asset) => siteIds.has(asset.siteId) && matchesSearch(asset, query),
  );
  const assetIds = new Set(assets.map((asset) => asset.id));
  const inspectedAssets = assets.filter((asset) => isInDateRange(asset.lastInspectionAt, dateBounds)).length;
  const findings = DEMO_FINDINGS.filter(
    (finding) => assetIds.has(finding.assetId) && isInDateRange(finding.createdAt, dateBounds),
  );
  const priorityActions = DEMO_WORK_ITEMS.filter(
    (item) => assetIds.has(item.assetId) && isInDateRange(item.createdAt, dateBounds),
  );
  const inspections = DEMO_RECENT_INSPECTIONS
    .filter((inspection) => assetIds.has(inspection.assetId) && isInDateRange(inspection.inspectedAt, dateBounds))
    .sort((left, right) => right.inspectedAt.localeCompare(left.inspectedAt))
    .slice(0, 8);
  const conditions: Record<AssetCondition, number> = {
    Healthy: assets.filter((asset) => asset.condition === "Healthy").length,
    Warning: assets.filter((asset) => asset.condition === "Warning").length,
    Critical: assets.filter((asset) => asset.condition === "Critical").length,
  };
  const siteName = filters.siteId === "all"
    ? "All Sites"
    : DEMO_SITES.find((site) => site.id === filters.siteId)?.name ?? "Selected Site";

  return {
    siteName,
    assets,
    assetIds,
    findings,
    priorityActions,
    inspections,
    totalAssets: assets.length,
    inspectedAssets,
    inspectionCoverage: assets.length === 0 ? null : (inspectedAssets / assets.length) * 100,
    conditions,
    dateBounds,
    dateRange: filters.dateRange,
  };
}
