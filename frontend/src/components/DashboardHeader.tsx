import type { ReactNode } from "react";
import { DEMO_SITES } from "../features/overview/demoData";
import { DATE_RANGE_OPTIONS, type DashboardFilters, type DateRangeId } from "../features/overview/dashboardModel";
import type { DataMode } from "./WorkspaceControls";

interface DashboardHeaderProps {
  filters: DashboardFilters;
  onFiltersChange: (updates: Partial<DashboardFilters>) => void;
  showFilters?: boolean;
  mode?: DataMode;
  title?: string;
  subtitle?: string;
  workspaceControl?: ReactNode;
}

function HeaderAction({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <button
      aria-label={`${label} — not available in this local application`}
      className="header-action"
      disabled
      title="This action is not available in this local application."
      type="button"
    >
      {children}
    </button>
  );
}

function HeaderActions() {
  return (
    <div aria-label="Account and help actions" className="header-actions">
      <HeaderAction label="Notifications">
        <svg aria-hidden="true" fill="none" viewBox="0 0 24 24">
          <path d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9Zm-8 12h4" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
        </svg>
      </HeaderAction>
      <HeaderAction label="Help">
        <svg aria-hidden="true" fill="none" viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.8" />
          <path d="M9.7 9a2.4 2.4 0 1 1 4.1 1.7c-1.1 1-1.8 1.3-1.8 2.8m0 3h.01" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
        </svg>
      </HeaderAction>
      <HeaderAction label="User account">
        <svg aria-hidden="true" fill="none" viewBox="0 0 24 24">
          <circle cx="12" cy="8" r="4" stroke="currentColor" strokeWidth="1.8" />
          <path d="M4 21c.8-4 3.5-6 8-6s7.2 2 8 6" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
        </svg>
      </HeaderAction>
    </div>
  );
}

function FilterBar({ filters, onFiltersChange }: DashboardHeaderProps) {
  return (
    <section aria-label="Portfolio filters" className="filter-bar">
      <label className="filter-control site-filter">
        <svg aria-hidden="true" fill="none" viewBox="0 0 24 24">
          <rect height="16" rx="1.5" stroke="currentColor" strokeWidth="1.7" width="17" x="3.5" y="4" />
          <path d="M8 8h3v3H8zm5 0h3v3h-3zm-5 5h3v3H8zm5 0h3v3h-3zM5 20h14" stroke="currentColor" strokeWidth="1.5" />
        </svg>
        <select
          aria-label="Site"
          onChange={(event) => onFiltersChange({ siteId: event.target.value })}
          value={filters.siteId}
        >
          <option value="all">All Sites</option>
          {DEMO_SITES.map((site) => (
            <option key={site.id} value={site.id}>{site.name}</option>
          ))}
        </select>
        <span aria-hidden="true" className="select-chevron" />
      </label>

      <label className="filter-control date-filter">
        <svg aria-hidden="true" fill="none" viewBox="0 0 24 24">
          <rect height="17" rx="2" stroke="currentColor" strokeWidth="1.7" width="17" x="3.5" y="4.5" />
          <path d="M7.5 2.5v4m9-4v4M4 9h16" stroke="currentColor" strokeLinecap="round" strokeWidth="1.7" />
        </svg>
        <select
          aria-label="Date range"
          onChange={(event) => onFiltersChange({ dateRange: event.target.value as DateRangeId })}
          value={filters.dateRange}
        >
          {DATE_RANGE_OPTIONS.map((option) => (
            <option key={option.id} value={option.id}>{option.label}</option>
          ))}
        </select>
        <span aria-hidden="true" className="select-chevron" />
      </label>

      <label className="filter-control search-filter">
        <svg aria-hidden="true" fill="none" viewBox="0 0 24 24">
          <circle cx="10.8" cy="10.8" r="6.8" stroke="currentColor" strokeWidth="1.8" />
          <path d="m16 16 4.5 4.5" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
        </svg>
        <input
          aria-label="Search assets"
          onChange={(event) => onFiltersChange({ search: event.target.value })}
          placeholder="Search assets (e.g., PV-1042, INV-03)"
          value={filters.search}
          type="search"
        />
      </label>

      <div aria-label="Database synchronization status" className="sync-status" role="status">
        <svg aria-hidden="true" fill="none" viewBox="0 0 24 24">
          <ellipse cx="12" cy="5" rx="7.5" ry="3" stroke="currentColor" strokeWidth="1.7" />
          <path d="M4.5 5v14c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3V5M4.5 10c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3m-15 5c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3" stroke="currentColor" strokeWidth="1.7" />
        </svg>
        <span className="sync-dot" />
        <span>Sync status: not connected</span>
      </div>
    </section>
  );
}

function LiveFilterBar({ filters, onFiltersChange }: DashboardHeaderProps) {
  return <section aria-label="Live workspace status" className="filter-bar"><label className="filter-control date-filter"><span>Date range</span><select aria-label="Live date range" value={filters.dateRange} onChange={(event) => onFiltersChange({ dateRange: event.target.value as DateRangeId })}><option value="reference">Last 90 days</option><option value="30-days">Last 30 days</option><option value="60-days">Last 60 days</option><option value="all">All available dates</option></select></label><div className="sync-status" role="status"><span className="sync-dot" /><span>Live data is limited to the selected workspace; no demo fixtures are queried.</span></div></section>;
}

export default function DashboardHeader({ filters, onFiltersChange, showFilters = true, mode = "sample", title, subtitle, workspaceControl }: DashboardHeaderProps) {
  return (
    <header className="dashboard-header">
      <div className="header-main-row">
        <div className="header-title-block">
          <h1>{title ?? "Solar Asset Operations"}</h1>
          <p>{subtitle ?? "Asset monitoring, inspection history, and condition analytics"}</p>
        </div>
        <div className="header-right">
          {workspaceControl ?? <div className={`source-notice${mode === "live" ? " live-notice" : ""}`}>
            <span className="source-notice-label">{mode === "live" ? "LIVE WORKSPACE" : "DEMO DATASET"}</span>
            <span className="source-notice-divider" aria-hidden="true">|</span>
            <span>{mode === "live" ? "Workspace records only; unavailable values are not inferred" : "Illustrative data for development and demonstration only"}</span>
          </div>}
          <HeaderActions />
        </div>
      </div>
      {showFilters && (mode === "live" ? <LiveFilterBar filters={filters} onFiltersChange={onFiltersChange} /> : <FilterBar filters={filters} onFiltersChange={onFiltersChange} />)}
    </header>
  );
}
