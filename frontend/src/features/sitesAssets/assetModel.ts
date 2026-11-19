import { DEMO_ASSETS, DEMO_SITES, type AssetCondition, type AssetType, type DemoAsset } from "../overview/demoData";

export type AssetSort = "assetId" | "name" | "type" | "condition" | "lastInspection";

export interface AssetFilters {
  siteId: string;
  search: string;
  type: AssetType | "all";
  condition: AssetCondition | "all";
  sort: AssetSort;
}

export const ASSET_TYPES: AssetType[] = ["PV Module", "Inverter", "Transformer", "String", "Combiner Box"];

export function selectAssets(filters: AssetFilters): DemoAsset[] {
  const query = filters.search.trim().toLocaleLowerCase();
  const assets = DEMO_ASSETS.filter((asset) =>
    (filters.siteId === "all" || asset.siteId === filters.siteId) &&
    (filters.type === "all" || asset.type === filters.type) &&
    (filters.condition === "all" || asset.condition === filters.condition) &&
    (!query || asset.id.toLocaleLowerCase().includes(query) || asset.name.toLocaleLowerCase().includes(query)),
  );

  return assets.sort((left, right) => {
    switch (filters.sort) {
      case "name": return left.name.localeCompare(right.name, undefined, { numeric: true });
      case "type": return left.type.localeCompare(right.type) || left.id.localeCompare(right.id, undefined, { numeric: true });
      case "condition": return left.condition.localeCompare(right.condition) || left.id.localeCompare(right.id, undefined, { numeric: true });
      case "lastInspection": return right.lastInspectionAt.localeCompare(left.lastInspectionAt) || left.id.localeCompare(right.id, undefined, { numeric: true });
      case "assetId":
      default: return left.id.localeCompare(right.id, undefined, { numeric: true });
    }
  });
}

export function getAssetSiteSummary(siteId: string) {
  const assets = DEMO_ASSETS.filter((asset) => siteId === "all" || asset.siteId === siteId);
  const conditions: Record<AssetCondition, number> = {
    Healthy: assets.filter((asset) => asset.condition === "Healthy").length,
    Warning: assets.filter((asset) => asset.condition === "Warning").length,
    Critical: assets.filter((asset) => asset.condition === "Critical").length,
  };

  return {
    assets,
    siteCount: siteId === "all" ? DEMO_SITES.length : Number(DEMO_SITES.some((site) => site.id === siteId)),
    conditions,
  };
}
