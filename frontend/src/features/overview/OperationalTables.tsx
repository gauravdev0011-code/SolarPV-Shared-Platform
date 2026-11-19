import { useState } from "react";
import type { DashboardViewModel } from "./dashboardModel";

function ConditionBadge({ condition }: { condition: string | undefined }) {
  if (!condition) return <span className="condition-badge condition-unknown">—</span>;
  return <span className={`condition-badge condition-${condition.toLowerCase()}`}>{condition}</span>;
}

function RecentInspectionsTable({ dashboard }: { dashboard: DashboardViewModel }) {
  const [showAll, setShowAll] = useState(false);
  const rows = showAll ? dashboard.inspections : dashboard.inspections.slice(0, 5);
  const assetsById = new Map(dashboard.assets.map((asset) => [asset.id, asset]));

  return (
    <section aria-labelledby="recent-inspections-title" className="panel-card operations-panel">
      <div className="panel-heading table-panel-heading">
        <div className="panel-title-wrap">
          <h3 id="recent-inspections-title">Recent Inspection Activity</h3>
          <span className="table-count">{dashboard.inspections.length}</span>
        </div>
        {dashboard.inspections.length > 5 && (
          <button
            aria-expanded={showAll}
            className="table-toggle"
            onClick={() => setShowAll((value) => !value)}
            type="button"
          >
            {showAll ? "Show less ↑" : "View all →"}
          </button>
        )}
      </div>
      <div className="table-scroll-region">
        <table className="operations-table inspection-table">
          <caption className="sr-only">Recent synthetic inspection activity for the selected filters</caption>
          <thead>
            <tr>
              <th scope="col">Asset ID</th>
              <th scope="col">Asset Type</th>
              <th scope="col">Inspection Date</th>
              <th scope="col">Findings</th>
              <th scope="col">Condition</th>
              <th scope="col">Source</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td className="table-empty-cell" colSpan={6}>No inspection activity matches the current filters.</td></tr>
            ) : rows.map((inspection) => {
              const asset = assetsById.get(inspection.assetId);
              return (
                <tr key={inspection.id}>
                  <td className="asset-id-cell">{inspection.assetId}</td>
                  <td>{asset?.type ?? "—"}</td>
                  <td>{new Date(`${inspection.inspectedAt}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })}</td>
                  <td className="finding-cell">{inspection.finding || "—"}</td>
                  <td><ConditionBadge condition={asset?.condition} /></td>
                  <td className="source-cell">{inspection.source || "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function PriorityWorkQueue({ dashboard }: { dashboard: DashboardViewModel }) {
  const [showAll, setShowAll] = useState(false);
  const rows = showAll ? dashboard.priorityActions : dashboard.priorityActions.slice(0, 5);

  return (
    <section aria-labelledby="priority-work-queue-title" className="panel-card operations-panel" id="priority-work-queue">
      <div className="panel-heading table-panel-heading">
        <div className="panel-title-wrap">
          <h3 id="priority-work-queue-title">Priority Work Queue</h3>
          <span className="table-count">{dashboard.priorityActions.length} items</span>
        </div>
        {dashboard.priorityActions.length > 5 && (
          <button
            aria-expanded={showAll}
            className="table-toggle"
            onClick={() => setShowAll((value) => !value)}
            type="button"
          >
            {showAll ? "Show less ↑" : "View all →"}
          </button>
        )}
      </div>
      <div className="table-scroll-region">
        <table className="operations-table queue-table">
          <caption className="sr-only">Synthetic priority work queue for the selected filters</caption>
          <thead>
            <tr>
              <th scope="col">#</th>
              <th scope="col">Asset</th>
              <th scope="col">Issue / Finding</th>
              <th scope="col">Evidence</th>
              <th scope="col">Severity</th>
              <th scope="col">Assigned</th>
              <th scope="col">Next Action</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td className="table-empty-cell" colSpan={7}>No priority actions match the current filters.</td></tr>
            ) : rows.map((item, index) => (
              <tr key={item.id}>
                <td className="row-number-cell">{index + 1}</td>
                <td className="asset-id-cell">{item.assetId}</td>
                <td className="finding-cell">{item.summary || "—"}</td>
                <td className="evidence-cell">{item.evidenceCount > 0 ? `${item.evidenceCount} refs` : "—"}</td>
                <td><span className={`severity-badge severity-${item.severity.toLowerCase()}`}>{item.severity}</span></td>
                <td>{item.assignedTo || "Unassigned"}</td>
                <td><span className="next-action-label">{item.nextAction}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export default function OperationalTables({ dashboard }: { dashboard: DashboardViewModel }) {
  return (
    <section aria-label="Operational activity" className="operational-grid">
      <RecentInspectionsTable dashboard={dashboard} />
      <PriorityWorkQueue dashboard={dashboard} />
    </section>
  );
}
