export type AssetCondition = "Healthy" | "Warning" | "Critical";
export type AssetType = "PV Module" | "Inverter" | "Transformer" | "String" | "Combiner Box";

export interface DemoSite {
  id: string;
  name: string;
}

export interface DemoAsset {
  id: string;
  name: string;
  siteId: string;
  type: AssetType;
  condition: AssetCondition;
  lastInspectionAt: string;
  manufacturer: string | null;
  model: string | null;
  serialNumber: string | null;
  commissionedOn: string | null;
  location: string | null;
}

export interface DemoFinding {
  id: string;
  siteId: string;
  assetId: string;
  createdAt: string;
  summary: string;
}

export interface DemoWorkItem {
  id: string;
  siteId: string;
  assetId: string;
  createdAt: string;
  summary: string;
  evidenceCount: number;
  severity: "P1" | "P2";
  assignedTo: string;
  nextAction: string;
}

export interface DemoInspectionActivity {
  id: string;
  siteId: string;
  assetId: string;
  inspectedAt: string;
  finding: string;
  measurement: number | null;
  unit: string | null;
  source: string;
}

export type DemoInspectionMethod = "Thermal imaging" | "Electrical performance review" | "Visual inspection";
export type DemoInspectionStatus = "Complete" | "Attention" | "Follow-up required";

export interface DemoObservation {
  id: string;
  parameter: string;
  value: number;
  unit: string;
  quality: string;
  source: string;
}

export interface DemoInspectionRecord {
  id: string;
  siteId: string;
  assetId: string;
  inspectedAt: string;
  method: DemoInspectionMethod;
  finding: string;
  status: DemoInspectionStatus;
  condition: AssetCondition;
  source: string;
  observations: DemoObservation[];
}

export interface ChartPoint {
  date: string;
  value: number | null;
}

export interface ModuleTrendSeries {
  assetId: string;
  points: ChartPoint[];
}

export interface InverterTrendSeries {
  assetId: string;
  outputKw: ChartPoint[];
  performanceRatio: ChartPoint[];
}

export interface MapMarker {
  assetId: string;
  siteId: string;
  type: AssetType;
  condition: AssetCondition;
  x: number;
  y: number;
}

// These relationships are frontend-only demo fixtures. SQLite currently has no Sites table.
// siteId associates an illustrative asset with one of these fixtures; it is not a database FK.
export const DEMO_SITES: DemoSite[] = [
  { id: "north-ridge", name: "North Ridge Solar Farm" },
  { id: "south-mesa", name: "South Mesa Solar Park" },
];

const northRidgeConditionOverrides: Record<string, AssetCondition> = {
  "PV-1203": "Critical",
  "PV-1210": "Critical",
  "PV-1095": "Critical",
  "PV-1187": "Warning",
  "PV-1130": "Warning",
  "INV-03": "Warning",
  "INV-04": "Healthy",
  "TX-01": "Healthy",
};

const northRidgeInspectionDates: Record<string, string> = {
  "PV-1203": "2026-10-31",
  "PV-1187": "2026-10-31",
  "INV-03": "2026-10-30",
  "PV-1042": "2026-10-28",
  "TX-01": "2026-10-27",
  "PV-1095": "2026-10-27",
  "PV-1210": "2026-10-26",
  "PV-1130": "2026-10-25",
};

const southMesaInspectionDates: Record<string, string> = {
  "SM-PV-0014": "2026-10-29",
};

function createAssetSpecs(
  siteId: string,
  moduleCount: number,
  inverterCount: number,
  transformerCount: number,
  idPrefix = "",
  stringCount = 0,
  combinerBoxCount = 0,
): Array<Pick<DemoAsset, "id" | "siteId" | "type">> {
  const modules = Array.from({ length: moduleCount }, (_, index) => ({
    id: `${idPrefix}PV-${String(index + 1).padStart(4, "0")}`,
    siteId,
    type: "PV Module" as const,
  }));
  const inverters = Array.from({ length: inverterCount }, (_, index) => ({
    id: `${idPrefix}INV-${String(index + 1).padStart(2, "0")}`,
    siteId,
    type: "Inverter" as const,
  }));
  const transformers = Array.from({ length: transformerCount }, (_, index) => ({
    id: `${idPrefix}TX-${String(index + 1).padStart(2, "0")}`,
    siteId,
    type: "Transformer" as const,
  }));
  const strings = Array.from({ length: stringCount }, (_, index) => ({
    id: `${idPrefix}STR-${String(index + 1).padStart(2, "0")}`,
    siteId,
    type: "String" as const,
  }));
  const combinerBoxes = Array.from({ length: combinerBoxCount }, (_, index) => ({
    id: `${idPrefix}CB-${String(index + 1).padStart(2, "0")}`,
    siteId,
    type: "Combiner Box" as const,
  }));

  return [...modules, ...strings, ...combinerBoxes, ...inverters, ...transformers];
}

function dateAtOffset(startDate: string, offsetDays: number): string {
  const date = new Date(`${startDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}

function distributeInspectionDates(
  specs: Array<Pick<DemoAsset, "id" | "siteId" | "type">>,
  inspectedCount: number,
  forcedDates: Record<string, string> = {},
  historicalDate = "2026-07-15",
): Map<string, string> {
  const inspectedIds = new Set(specs.slice(0, inspectedCount).map((asset) => asset.id));

  for (const id of Object.keys(forcedDates)) {
    inspectedIds.add(id);
  }

  const excessCount = inspectedIds.size - inspectedCount;
  if (excessCount > 0) {
    for (const asset of [...specs].reverse()) {
      if (inspectedIds.has(asset.id) && !(asset.id in forcedDates)) {
        inspectedIds.delete(asset.id);
        if (inspectedIds.size === inspectedCount) break;
      }
    }
  }

  const activeAssets = specs.filter((asset) => inspectedIds.has(asset.id));
  const activeIndex = new Map(activeAssets.map((asset, index) => [asset.id, index]));
  const dates = new Map<string, string>();

  for (const asset of specs) {
    const index = activeIndex.get(asset.id);
    if (asset.id in forcedDates) {
      dates.set(asset.id, forcedDates[asset.id]);
    } else if (index === undefined) {
      dates.set(asset.id, historicalDate);
    } else {
      const dayOffset = Math.round((index / Math.max(activeAssets.length - 1, 1)) * 91);
      dates.set(asset.id, dateAtOffset("2026-08-01", dayOffset));
    }
  }

  return dates;
}

function assignConditions(
  specs: Array<Pick<DemoAsset, "id" | "siteId" | "type">>,
  totals: Record<AssetCondition, number>,
  overrides: Record<string, AssetCondition> = {},
): Map<string, AssetCondition> {
  const used = { Healthy: 0, Warning: 0, Critical: 0 };
  for (const condition of Object.values(overrides)) used[condition] += 1;

  const remaining = {
    Critical: totals.Critical - used.Critical,
    Warning: totals.Warning - used.Warning,
  };
  const conditions = new Map<string, AssetCondition>();

  for (const asset of specs) {
    let condition = overrides[asset.id];
    if (!condition && remaining.Critical > 0) {
      condition = "Critical";
      remaining.Critical -= 1;
    } else if (!condition && remaining.Warning > 0) {
      condition = "Warning";
      remaining.Warning -= 1;
    } else if (!condition) {
      condition = "Healthy";
    }
    conditions.set(asset.id, condition);
  }

  return conditions;
}

function buildSiteAssets({
  siteId,
  moduleCount,
  inverterCount,
  transformerCount,
  inspectedCount,
  stringCount,
  combinerBoxCount,
  conditions,
  overrides,
  idPrefix,
}: {
  siteId: string;
  moduleCount: number;
  inverterCount: number;
  transformerCount: number;
  inspectedCount: number;
  stringCount: number;
  combinerBoxCount: number;
  conditions: Record<AssetCondition, number>;
  overrides?: Record<string, AssetCondition>;
  idPrefix?: string;
}): DemoAsset[] {
  const specs = createAssetSpecs(siteId, moduleCount, inverterCount, transformerCount, idPrefix, stringCount, combinerBoxCount);
  const conditionById = assignConditions(specs, conditions, overrides);
  const inspectionDates = distributeInspectionDates(
    specs,
    inspectedCount,
    siteId === "north-ridge" ? northRidgeInspectionDates : southMesaInspectionDates,
  );

  return specs.map((asset) => ({
    ...asset,
    name: `${asset.type} ${asset.id.split("-").at(-1)}`,
    condition: conditionById.get(asset.id) ?? "Healthy",
    lastInspectionAt: inspectionDates.get(asset.id) ?? "2026-07-15",
    manufacturer: "Illustrative fixture",
    model: `${asset.type} demo model`,
    serialNumber: null,
    commissionedOn: null,
    location: asset.type === "PV Module" ? "Array block A (illustrative)" : "Electrical yard (illustrative)",
  }));
}

export const DEMO_ASSETS: DemoAsset[] = [
  ...buildSiteAssets({
    siteId: "north-ridge",
    moduleCount: 1210,
    inverterCount: 20,
    transformerCount: 8,
    stringCount: 5,
    combinerBoxCount: 5,
    inspectedCount: 1208,
    conditions: { Healthy: 1203, Warning: 27, Critical: 18 },
    overrides: northRidgeConditionOverrides,
  }),
  ...buildSiteAssets({
    siteId: "south-mesa",
    moduleCount: 178,
    inverterCount: 4,
    transformerCount: 2,
    stringCount: 1,
    combinerBoxCount: 1,
    inspectedCount: 180,
    conditions: { Healthy: 170, Warning: 12, Critical: 4 },
    idPrefix: "SM-",
  }),
];

const northRidgeCriticalAssets = DEMO_ASSETS.filter(
  (asset) => asset.siteId === "north-ridge" && asset.condition === "Critical",
);
const southMesaCriticalAssets = DEMO_ASSETS.filter(
  (asset) => asset.siteId === "south-mesa" && asset.condition === "Critical",
);

export const DEMO_FINDINGS: DemoFinding[] = [
  ...northRidgeCriticalAssets.map((asset, index) => ({
    id: `NR-F-${String(index + 1).padStart(3, "0")}`,
    siteId: asset.siteId,
    assetId: asset.id,
    createdAt: asset.lastInspectionAt < "2026-08-01" ? "2026-10-15" : asset.lastInspectionAt,
    summary: asset.id === "PV-1203"
      ? "Elevated temperature delta; hotspot review"
      : "Critical condition requires field review",
  })),
  ...southMesaCriticalAssets.map((asset, index) => ({
    id: `SM-F-${String(index + 1).padStart(3, "0")}`,
    siteId: asset.siteId,
    assetId: asset.id,
    createdAt: asset.lastInspectionAt,
    summary: "Critical condition requires field review",
  })),
];

const northRidgePriorityAssetIds = [
  "PV-1203",
  "PV-1187",
  "INV-03",
  "PV-1095",
  "PV-1130",
  "PV-1210",
  "PV-0007",
];

const workItemDetails: Record<string, Pick<DemoWorkItem, "summary" | "evidenceCount" | "severity" | "assignedTo" | "nextAction">> = {
  "PV-1203": { summary: "Elevated ΔT (18.4 °C), hotspot", evidenceCount: 2, severity: "P1", assignedTo: "Unassigned", nextAction: "Schedule inspection" },
  "PV-1187": { summary: "Rising ΔT trend (+6.1 °C, 2 inspections)", evidenceCount: 1, severity: "P1", assignedTo: "Team A", nextAction: "Field verification" },
  "INV-03": { summary: "Performance ratio drop (−3.2 pp)", evidenceCount: 1, severity: "P2", assignedTo: "Team B", nextAction: "Check communications" },
  "PV-1095": { summary: "Multiple cell anomalies", evidenceCount: 3, severity: "P2", assignedTo: "Unassigned", nextAction: "Inspect and confirm" },
  "PV-1130": { summary: "ΔT above site average (+4.8 °C)", evidenceCount: 1, severity: "P2", assignedTo: "Team A", nextAction: "Routine inspection" },
  "PV-1210": { summary: "Persistent temperature rise", evidenceCount: 2, severity: "P2", assignedTo: "Team C", nextAction: "Review trend" },
  "PV-0007": { summary: "Thermal anomaly requires confirmation", evidenceCount: 1, severity: "P2", assignedTo: "Unassigned", nextAction: "Confirm on site" },
};

export const DEMO_WORK_ITEMS: DemoWorkItem[] = northRidgePriorityAssetIds.map((assetId, index) => {
  const asset = DEMO_ASSETS.find((candidate) => candidate.id === assetId);
  const details = workItemDetails[assetId];
  return {
    id: `NR-W-${String(index + 1).padStart(3, "0")}`,
    siteId: "north-ridge",
    assetId,
    createdAt: asset?.lastInspectionAt ?? "2026-10-15",
    ...details,
  };
});

export const DEMO_RECENT_INSPECTIONS: DemoInspectionActivity[] = [
  { id: "NR-I-1031-1203", siteId: "north-ridge", assetId: "PV-1203", inspectedAt: "2026-10-31", finding: "ΔT = 18.4 °C, hotspot", measurement: 18.4, unit: "°C", source: "Import: inspection_1031.csv" },
  { id: "NR-I-1031-1187", siteId: "north-ridge", assetId: "PV-1187", inspectedAt: "2026-10-31", finding: "ΔT = 12.1 °C, elevated", measurement: 12.1, unit: "°C", source: "Import: inspection_1031.csv" },
  { id: "NR-I-1030-INV03", siteId: "north-ridge", assetId: "INV-03", inspectedAt: "2026-10-30", finding: "Performance ratio drop (−3.2 pp)", measurement: null, unit: null, source: "Field: mobile app" },
  { id: "NR-I-1028-1042", siteId: "north-ridge", assetId: "PV-1042", inspectedAt: "2026-10-28", finding: "Normal, no anomaly", measurement: null, unit: null, source: "Import: inspection_1028.csv" },
  { id: "NR-I-1027-TX01", siteId: "north-ridge", assetId: "TX-01", inspectedAt: "2026-10-27", finding: "Temperature normal", measurement: null, unit: null, source: "Field: service form" },
  { id: "SM-I-1029-0014", siteId: "south-mesa", assetId: "SM-PV-0014", inspectedAt: "2026-10-29", finding: "Normal, no anomaly", measurement: null, unit: null, source: "Import: south_mesa_1029.csv" },
];

const recentActivityByAssetId = new Map(DEMO_RECENT_INSPECTIONS.map((activity) => [activity.assetId, activity]));

function methodForAsset(type: AssetType): DemoInspectionMethod {
  if (type === "PV Module") return "Thermal imaging";
  if (type === "Inverter" || type === "Transformer") return "Electrical performance review";
  return "Visual inspection";
}

function statusForCondition(condition: AssetCondition): DemoInspectionStatus {
  if (condition === "Critical") return "Follow-up required";
  if (condition === "Warning") return "Attention";
  return "Complete";
}

// One synthetic latest-inspection row per asset keeps inventory and history in sync.
// Only the two pre-existing fixture readings are observations; other values remain absent.
export const DEMO_INSPECTION_RECORDS: DemoInspectionRecord[] = DEMO_ASSETS.map((asset) => {
  const activity = recentActivityByAssetId.get(asset.id);
  const source = activity?.source ?? "Synthetic frontend fixture";
  const observations = activity?.measurement !== null && activity?.measurement !== undefined && activity.unit
    ? [{
        id: `${activity.id}-obs-1`,
        parameter: "Module temperature delta",
        value: activity.measurement,
        unit: activity.unit,
        quality: "Illustrative demo value; not a field measurement",
        source,
      }]
    : [];

  return {
    id: activity?.id ?? `DEMO-${asset.siteId}-${asset.id}`,
    siteId: asset.siteId,
    assetId: asset.id,
    inspectedAt: asset.lastInspectionAt,
    method: methodForAsset(asset.type),
    finding: activity?.finding ?? "No narrative finding recorded",
    status: statusForCondition(asset.condition),
    condition: asset.condition,
    source,
    observations,
  };
});

export const TREND_DATES = [
  "2026-08-01",
  "2026-08-15",
  "2026-09-01",
  "2026-09-15",
  "2026-10-01",
  "2026-10-15",
  "2026-10-31",
];

function points(values: number[]): ChartPoint[] {
  return TREND_DATES.map((date, index) => ({ date, value: values[index] ?? null }));
}

export const DEMO_MODULE_TRENDS: ModuleTrendSeries[] = [
  { assetId: "PV-1042", points: points([2.7, 3.8, 4.3, 5.1, 6.0, 7.4, 8.1]) },
  { assetId: "PV-1187", points: points([4.8, 6.0, 8.7, 10.0, 11.2, 12.1, 12.1]) },
  { assetId: "PV-1203", points: points([6.2, 8.5, 11.3, 14.1, 16.4, 18.4, 18.4]) },
  { assetId: "PV-1210", points: points([7.4, 9.0, 12.2, 15.0, 17.3, 19.1, 20.1]) },
];

export const DEMO_INVERTER_TRENDS: InverterTrendSeries[] = [
  {
    assetId: "INV-03",
    outputKw: points([760, 900, 830, 1000, 970, 1120, 1050]),
    performanceRatio: points([90.8, 91.5, 91.8, 94.0, 93.2, 95.2, 94.5]),
  },
  {
    assetId: "INV-04",
    outputKw: points([800, 880, 850, 960, 1010, 1070, 1110]),
    performanceRatio: points([92.0, 92.4, 92.7, 93.1, 94.0, 94.2, 94.6]),
  },
];

export const DEMO_MAP_MARKERS: MapMarker[] = [
  { assetId: "PV-1042", siteId: "north-ridge", type: "PV Module", condition: "Healthy", x: 175, y: 106 },
  { assetId: "PV-0720", siteId: "north-ridge", type: "PV Module", condition: "Healthy", x: 129, y: 157 },
  { assetId: "PV-1187", siteId: "north-ridge", type: "PV Module", condition: "Warning", x: 278, y: 127 },
  { assetId: "PV-1203", siteId: "north-ridge", type: "PV Module", condition: "Critical", x: 477, y: 91 },
  { assetId: "PV-1210", siteId: "north-ridge", type: "PV Module", condition: "Critical", x: 588, y: 165 },
  { assetId: "PV-1095", siteId: "north-ridge", type: "PV Module", condition: "Critical", x: 382, y: 204 },
  { assetId: "PV-1130", siteId: "north-ridge", type: "PV Module", condition: "Warning", x: 697, y: 112 },
  { assetId: "PV-0890", siteId: "north-ridge", type: "PV Module", condition: "Healthy", x: 744, y: 202 },
  { assetId: "PV-0502", siteId: "north-ridge", type: "PV Module", condition: "Healthy", x: 91, y: 213 },
  { assetId: "INV-03", siteId: "north-ridge", type: "Inverter", condition: "Warning", x: 430, y: 166 },
  { assetId: "INV-04", siteId: "north-ridge", type: "Inverter", condition: "Healthy", x: 505, y: 174 },
  { assetId: "TX-01", siteId: "north-ridge", type: "Transformer", condition: "Healthy", x: 466, y: 220 },
  { assetId: "STR-01", siteId: "north-ridge", type: "String", condition: "Healthy", x: 345, y: 105 },
  { assetId: "CB-01", siteId: "north-ridge", type: "Combiner Box", condition: "Healthy", x: 442, y: 219 },
  { assetId: "SM-PV-0014", siteId: "south-mesa", type: "PV Module", condition: "Warning", x: 175, y: 106 },
  { assetId: "SM-PV-0032", siteId: "south-mesa", type: "PV Module", condition: "Healthy", x: 278, y: 127 },
  { assetId: "SM-INV-01", siteId: "south-mesa", type: "Inverter", condition: "Healthy", x: 430, y: 166 },
  { assetId: "SM-TX-01", siteId: "south-mesa", type: "Transformer", condition: "Healthy", x: 466, y: 220 },
  { assetId: "SM-STR-01", siteId: "south-mesa", type: "String", condition: "Healthy", x: 345, y: 105 },
  { assetId: "SM-CB-01", siteId: "south-mesa", type: "Combiner Box", condition: "Healthy", x: 442, y: 219 },
];

export const DEMO_PREVIOUS_PERIOD = {
  siteId: "north-ridge",
  totalAssets: 1222,
  inspectedAssets: 1166,
  openFindings: 24,
  priorityActions: 10,
};
