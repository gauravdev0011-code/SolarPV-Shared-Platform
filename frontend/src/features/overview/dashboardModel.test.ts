import { describe, expect, it } from "vitest";
import { getDashboardViewModel } from "./dashboardModel";

describe("demo dashboard model", () => {
  it("keeps North Ridge totals and condition categories consistent", () => {
    const dashboard = getDashboardViewModel({
      siteId: "north-ridge",
      dateRange: "reference",
      search: "",
    });

    expect(dashboard.totalAssets).toBe(1248);
    expect(dashboard.inspectedAssets).toBe(1208);
    expect(dashboard.inspectionCoverage).toBeCloseTo(96.8, 1);
    expect(dashboard.conditions).toEqual({ Healthy: 1203, Warning: 27, Critical: 18 });
    expect(Object.values(dashboard.conditions).reduce((total, value) => total + value, 0)).toBe(dashboard.totalAssets);
    expect(dashboard.findings).toHaveLength(18);
    expect(dashboard.priorityActions).toHaveLength(7);
  });

  it("recomputes counts for site, date-range, and asset search filters", () => {
    const southMesa = getDashboardViewModel({ siteId: "south-mesa", dateRange: "reference", search: "" });
    const recentNorthRidge = getDashboardViewModel({ siteId: "north-ridge", dateRange: "30-days", search: "" });
    const searchedAsset = getDashboardViewModel({ siteId: "north-ridge", dateRange: "reference", search: "PV-1203" });

    expect(southMesa.totalAssets).toBe(186);
    expect(recentNorthRidge.inspectedAssets).toBeLessThan(1208);
    expect(recentNorthRidge.inspectedAssets).toBeGreaterThan(0);
    expect(searchedAsset.totalAssets).toBe(1);
    expect(searchedAsset.conditions.Critical).toBe(1);
    expect(searchedAsset.findings).toHaveLength(1);
    expect(searchedAsset.priorityActions).toHaveLength(1);
  });

  it("returns an empty result instead of fabricating values for an unmatched query", () => {
    const dashboard = getDashboardViewModel({
      siteId: "north-ridge",
      dateRange: "reference",
      search: "NO-SUCH-ASSET",
    });

    expect(dashboard.totalAssets).toBe(0);
    expect(dashboard.inspectionCoverage).toBeNull();
    expect(dashboard.inspectedAssets).toBe(0);
    expect(dashboard.findings).toHaveLength(0);
    expect(dashboard.priorityActions).toHaveLength(0);
  });
});
