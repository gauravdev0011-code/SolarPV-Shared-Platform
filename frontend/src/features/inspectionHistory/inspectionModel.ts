import {
  DEMO_ASSETS,
  DEMO_INSPECTION_RECORDS,
  type AssetCondition,
  type DemoInspectionMethod,
  type DemoInspectionRecord,
  type DemoInspectionStatus,
} from "../overview/demoData";

export interface InspectionFilters {
  siteId: string;
  search: string;
  startDate: string;
  endDate: string;
  method: DemoInspectionMethod | "all";
  status: DemoInspectionStatus | AssetCondition | "all";
}

export const INSPECTION_METHODS: DemoInspectionMethod[] = [
  "Thermal imaging",
  "Electrical performance review",
  "Visual inspection",
];

export const INSPECTION_STATUSES: DemoInspectionStatus[] = ["Complete", "Attention", "Follow-up required"];
export const INSPECTION_CONDITIONS: AssetCondition[] = ["Healthy", "Warning", "Critical"];

export function selectInspections(filters: InspectionFilters): DemoInspectionRecord[] {
  const query = filters.search.trim().toLocaleLowerCase();
  const knownAssetIds = new Set(DEMO_ASSETS.map((asset) => asset.id));

  return DEMO_INSPECTION_RECORDS
    .filter((record) =>
      knownAssetIds.has(record.assetId) &&
      (filters.siteId === "all" || record.siteId === filters.siteId) &&
      (!query || record.assetId.toLocaleLowerCase().includes(query)) &&
      (!filters.startDate || record.inspectedAt >= filters.startDate) &&
      (!filters.endDate || record.inspectedAt <= filters.endDate) &&
      (filters.method === "all" || record.method === filters.method) &&
      (filters.status === "all" || record.status === filters.status || record.condition === filters.status),
    )
    .sort((left, right) => right.inspectedAt.localeCompare(left.inspectedAt) || left.assetId.localeCompare(right.assetId, undefined, { numeric: true }));
}
