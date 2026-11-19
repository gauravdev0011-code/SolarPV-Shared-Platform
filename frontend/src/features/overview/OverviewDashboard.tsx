import type { DashboardFilters, DashboardViewModel } from "./dashboardModel";
import KpiCards from "./KpiCards";
import SiteOverviewPanels from "./SiteOverviewPanels";
import AnalyticsPanels from "./AnalyticsPanels";
import OperationalTables from "./OperationalTables";

export default function OverviewDashboard({
  dashboard,
  filters,
}: {
  dashboard: DashboardViewModel;
  filters: DashboardFilters;
}) {
  return (
    <div className="overview-content">
      <section aria-labelledby="overview-title" className="overview-heading">
        <div>
          <p className="section-eyebrow">SOLAR ASSET OPERATIONS</p>
          <h2 id="overview-title">Portfolio Overview</h2>
          <p>Monitor fleet condition, inspection coverage, and work priorities.</p>
        </div>
        <span className="phase-label">ILLUSTRATIVE DEMO DATA</span>
      </section>

      <KpiCards dashboard={dashboard} filters={filters} />
      <SiteOverviewPanels dashboard={dashboard} />
      <AnalyticsPanels dashboard={dashboard} />
      <OperationalTables dashboard={dashboard} />

      <footer className="overview-footer">
        <span className="footer-status-dot demo-footer-dot" />
        <span>DEMO DATASET</span>
        <span className="footer-divider" aria-hidden="true">·</span>
        <span>All values are synthetic and illustrative; not actual equipment readings.</span>
      </footer>
    </div>
  );
}
