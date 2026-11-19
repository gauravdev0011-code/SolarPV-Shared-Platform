import {
  DEMO_PREVIOUS_PERIOD,
  type AssetType,
} from "./demoData";
import type { DashboardFilters, DashboardViewModel } from "./dashboardModel";

type KpiTone = "teal" | "green" | "red" | "amber";

interface KpiCardProps {
  label: string;
  value: string;
  detail: string;
  tone: KpiTone;
  delta?: string;
  deltaDirection?: "up" | "down";
  icon: "array" | "inspection" | "finding" | "action";
}

function KpiIcon({ name }: { name: KpiCardProps["icon"] }) {
  const common = {
    fill: "none",
    stroke: "currentColor",
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    strokeWidth: 1.8,
  };

  switch (name) {
    case "array":
      return <svg aria-hidden="true" viewBox="0 0 32 32" {...common}><path d="m4 11 4-7h17l4 7H4Zm1 2h22l-2 14H7L5 13Z" /><path d="M11 13v14m6-14v14m6-14v14M7 19h18" /></svg>;
    case "inspection":
      return <svg aria-hidden="true" viewBox="0 0 32 32" {...common}><path d="M10 5h12l2 3h3v20H5V8h3l2-3Z" /><path d="m11 17 3 3 7-7m-8-3h6" /></svg>;
    case "finding":
      return <svg aria-hidden="true" viewBox="0 0 32 32" {...common}><path d="M16 4 3.5 27h25L16 4Z" /><path d="M16 12v7m0 4h.01" /></svg>;
    case "action":
      return <svg aria-hidden="true" viewBox="0 0 32 32" {...common}><path d="M20 5a8 8 0 0 0-9 10L4 22l6 6 7-7a8 8 0 0 0 10-9l-5 5-5-2-2-5 5-5Z" /></svg>;
  }
}

function KpiCard({
  label,
  value,
  detail,
  tone,
  delta,
  deltaDirection,
  icon,
}: KpiCardProps) {
  return (
    <article aria-label={`${label}: ${value}`} className={`kpi-card kpi-${tone}`}>
      <div className="kpi-icon"><KpiIcon name={icon} /></div>
      <div className="kpi-copy">
        <h3>{label}</h3>
        <div className="kpi-value-row">
          <strong>{value}</strong>
          {delta && (
            <span className={`kpi-delta delta-${deltaDirection ?? "up"}`}>{delta}</span>
          )}
        </div>
        <p>{detail}</p>
      </div>
    </article>
  );
}

function countType(dashboard: DashboardViewModel, type: AssetType): number {
  return dashboard.assets.filter((asset) => asset.type === type).length;
}

function numberLabel(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

function referenceDeltas(dashboard: DashboardViewModel, filters: DashboardFilters) {
  const isReferenceView =
    filters.siteId === DEMO_PREVIOUS_PERIOD.siteId &&
    filters.dateRange === "reference" &&
    filters.search.trim() === "" &&
    dashboard.totalAssets === DEMO_PREVIOUS_PERIOD.totalAssets + 26;

  if (!isReferenceView || dashboard.inspectionCoverage === null) return null;

  const previousCoverage =
    (DEMO_PREVIOUS_PERIOD.inspectedAssets / DEMO_PREVIOUS_PERIOD.totalAssets) * 100;
  const coverageChange = dashboard.inspectionCoverage - previousCoverage;
  const findingChange =
    ((dashboard.findings.length - DEMO_PREVIOUS_PERIOD.openFindings) /
      DEMO_PREVIOUS_PERIOD.openFindings) * 100;
  const actionChange =
    ((dashboard.priorityActions.length - DEMO_PREVIOUS_PERIOD.priorityActions) /
      DEMO_PREVIOUS_PERIOD.priorityActions) * 100;

  return {
    assets: `↑ +${(((dashboard.totalAssets - DEMO_PREVIOUS_PERIOD.totalAssets) / DEMO_PREVIOUS_PERIOD.totalAssets) * 100).toFixed(1)}%`,
    coverage: `↑ +${coverageChange.toFixed(1)} pp`,
    findings: `↓ ${Math.abs(findingChange).toFixed(0)}%`,
    actions: `↓ ${Math.abs(actionChange).toFixed(0)}%`,
  };
}

export default function KpiCards({
  dashboard,
  filters,
}: {
  dashboard: DashboardViewModel;
  filters: DashboardFilters;
}) {
  const deltas = referenceDeltas(dashboard, filters);
  const coverage = dashboard.inspectionCoverage === null
    ? "—"
    : `${dashboard.inspectionCoverage.toFixed(1)}%`;
  const assetTypeSummary = [
    `${numberLabel(countType(dashboard, "PV Module"))} PV modules`,
    `${numberLabel(countType(dashboard, "Inverter"))} inverters`,
    `${numberLabel(countType(dashboard, "Transformer"))} transformers`,
  ].join(" · ");

  return (
    <section aria-label="Portfolio key performance indicators" className="kpi-grid">
      <KpiCard
        detail={assetTypeSummary}
        delta={deltas?.assets}
        deltaDirection="up"
        icon="array"
        label="Total Assets"
        tone="teal"
        value={numberLabel(dashboard.totalAssets)}
      />
      <KpiCard
        detail={`${numberLabel(dashboard.inspectedAssets)} / ${numberLabel(dashboard.totalAssets)} assets inspected in range`}
        delta={deltas?.coverage}
        deltaDirection="up"
        icon="inspection"
        label="Inspection Coverage"
        tone="green"
        value={coverage}
      />
      <KpiCard
        detail="Open anomalies requiring review"
        delta={deltas?.findings}
        deltaDirection="down"
        icon="finding"
        label="Open Findings"
        tone="red"
        value={numberLabel(dashboard.findings.length)}
      />
      <KpiCard
        detail="High-priority items in the work queue"
        delta={deltas?.actions}
        deltaDirection="down"
        icon="action"
        label="Priority Actions"
        tone="amber"
        value={numberLabel(dashboard.priorityActions.length)}
      />
    </section>
  );
}
