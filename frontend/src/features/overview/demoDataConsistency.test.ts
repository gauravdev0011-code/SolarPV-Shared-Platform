import { describe, expect, it } from "vitest";
import {
  DEMO_ASSETS,
  DEMO_INSPECTION_RECORDS,
  DEMO_MAP_MARKERS,
  DEMO_SITES,
  DEMO_FINDINGS,
  DEMO_WORK_ITEMS,
  type AssetType,
} from "./demoData";

describe("shared demo data consistency", () => {
  it("covers all requested asset categories without changing the two site totals", () => {
    const types = new Set<AssetType>(DEMO_ASSETS.map((asset) => asset.type));
    expect(types).toEqual(new Set(["PV Module", "Inverter", "Transformer", "String", "Combiner Box"]));
    expect(DEMO_ASSETS.filter((asset) => asset.siteId === "north-ridge")).toHaveLength(1248);
    expect(DEMO_ASSETS.filter((asset) => asset.siteId === "south-mesa")).toHaveLength(186);
  });

  it("links each asset to exactly one inspection record in its frontend demo site", () => {
    const assetIds = new Set(DEMO_ASSETS.map((asset) => asset.id));
    const siteIds = new Set(DEMO_SITES.map((site) => site.id));
    const inspectionAssetIds = DEMO_INSPECTION_RECORDS.map((inspection) => inspection.assetId);

    expect(inspectionAssetIds).toHaveLength(assetIds.size);
    expect(new Set(inspectionAssetIds).size).toBe(assetIds.size);
    for (const inspection of DEMO_INSPECTION_RECORDS) {
      expect(assetIds.has(inspection.assetId)).toBe(true);
      expect(siteIds.has(inspection.siteId)).toBe(true);
      expect(DEMO_ASSETS.find((asset) => asset.id === inspection.assetId)?.siteId).toBe(inspection.siteId);
      expect(inspection.inspectedAt).toBe(DEMO_ASSETS.find((asset) => asset.id === inspection.assetId)?.lastInspectionAt);
    }
  });

  it("only exposes explicitly recorded non-null observations and valid illustrative map markers", () => {
    const observationCount = DEMO_INSPECTION_RECORDS.reduce((total, inspection) => total + inspection.observations.length, 0);
    expect(observationCount).toBe(2);
    expect(DEMO_INSPECTION_RECORDS.flatMap((inspection) => inspection.observations).every((observation) => Number.isFinite(observation.value) && observation.quality.includes("Illustrative demo value"))).toBe(true);
    expect(DEMO_MAP_MARKERS.every((marker) => DEMO_ASSETS.some((asset) => asset.id === marker.assetId && asset.siteId === marker.siteId && asset.type === marker.type && asset.condition === marker.condition))).toBe(true);
    expect([...DEMO_FINDINGS, ...DEMO_WORK_ITEMS].every((item) => DEMO_ASSETS.some((asset) => asset.id === item.assetId && asset.siteId === item.siteId))).toBe(true);
  });
});
