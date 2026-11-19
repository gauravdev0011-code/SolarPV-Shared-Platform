type NavigationIconName =
  | "overview"
  | "assets"
  | "inspections"
  | "condition"
  | "alerts"
  | "imports"
  | "reports"
  | "map"
  | "administration";

interface NavigationItem {
  label: string;
  icon: NavigationIconName;
  page?: AppPage;
}

export type AppPage = "overview" | "sites-assets" | "panel-inspection" | "inverters" | "inspection-history" | "condition-analysis" | "alerts-work-orders" | "data-imports" | "reports" | "map-explorer" | "administration";

interface AppSidebarProps {
  currentPage: AppPage;
  onNavigate: (page: AppPage) => void;
  liveMode?: boolean;
  apiConnected?: boolean;
  mode?: DataMode;
  workspaceId?: string;
  workspaces?: Workspace[];
  onModeChange?: (mode: DataMode) => void;
  onWorkspaceChange?: (id: string) => void;
  onCreateWorkspace?: (name: string) => void;
  onRenameWorkspace?: (name: string) => void;
  collapsed?: boolean;
  onToggle?: () => void;
}

const navigationItems: NavigationItem[] = [
  { label: "Sites & Assets", icon: "assets", page: "sites-assets" },
  { label: "Inverters", icon: "assets", page: "inverters" },
  { label: "Panel Inspection", icon: "map", page: "panel-inspection" },
  { label: "Inspection History", icon: "inspections", page: "inspection-history" },
  { label: "Condition Analysis", icon: "condition", page: "condition-analysis" },
  { label: "Alerts & Work Orders", icon: "alerts", page: "alerts-work-orders" },
  { label: "Data Imports", icon: "imports", page: "data-imports" },
  { label: "Reports", icon: "reports", page: "reports" },
  { label: "Map Explorer", icon: "map", page: "map-explorer" },
  { label: "Administration", icon: "administration", page: "administration" },
];

function BrandMark() {
  return (
    <svg aria-hidden="true" className="brand-mark" viewBox="0 0 48 48">
      <circle cx="17" cy="15" r="8" fill="#f5aa25" />
      <path
        d="M17 1v5M17 24v5M3 15h5M26 15h5M7.1 5.1l3.5 3.5m12.8-3.5-3.5 3.5"
        fill="none"
        stroke="#f5aa25"
        strokeLinecap="round"
        strokeWidth="2"
      />
      <path d="m7 30 4-9h27l-5 9H7Z" fill="#38b8df" />
      <path d="m10 36 4-8h24l-4 8H10Z" fill="#1699c1" />
      <path
        d="M18 22v8m9-8v8m-13 0v6m9-6v6m9-6v6"
        stroke="#d9f5ff"
        strokeWidth="1"
      />
    </svg>
  );
}

function NavigationIcon({ name }: { name: NavigationIconName }) {
  const common = {
    fill: "none",
    stroke: "currentColor",
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    strokeWidth: 1.7,
  };

  switch (name) {
    case "overview":
      return <svg aria-hidden="true" viewBox="0 0 24 24" {...common}><path d="m3 11 9-8 9 8M5.5 9.5V21h13V9.5M9.5 21v-7h5v7" /></svg>;
    case "assets":
      return <svg aria-hidden="true" viewBox="0 0 24 24" {...common}><rect height="16" rx="2" width="15" x="4.5" y="4" /><path d="M8 8h8M8 12h5M8 16h3m5 3v-4l2-2 2 2v4" /></svg>;
    case "inspections":
      return <svg aria-hidden="true" viewBox="0 0 24 24" {...common}><rect height="16" rx="2" width="17" x="3.5" y="5" /><path d="M7.5 3v4m9-4v4M4 9h16M8 13h3m-3 4h7" /></svg>;
    case "condition":
      return <svg aria-hidden="true" viewBox="0 0 24 24" {...common}><path d="M3 19h18M5 16l5-5 3 2 6-7" /><path d="M15 6h4v4" /></svg>;
    case "alerts":
      return <svg aria-hidden="true" viewBox="0 0 24 24" {...common}><path d="M12 3 2.8 20h18.4L12 3Z" /><path d="M12 9v5m0 3h.01" /></svg>;
    case "imports":
      return <svg aria-hidden="true" viewBox="0 0 24 24" {...common}><path d="M12 15V3m-4 4 4-4 4 4M4 14v6h16v-6" /></svg>;
    case "reports":
      return <svg aria-hidden="true" viewBox="0 0 24 24" {...common}><path d="M6 3.5h8l4 4V21H6V3.5Z" /><path d="M14 4v4h4M9 12h6m-6 4h6" /></svg>;
    case "map":
      return <svg aria-hidden="true" viewBox="0 0 24 24" {...common}><path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3V6Z" /><path d="M9 3v15m6-12v15" /></svg>;
    case "administration":
      return <svg aria-hidden="true" viewBox="0 0 24 24" {...common}><circle cx="12" cy="12" r="3" /><path d="m19.4 15 .1.1 1.1.8-1.1 1.9-1.3-.5a8 8 0 0 1-1.5.9l-.2 1.4h-2.2l-.3-1.4a8 8 0 0 1-1.6-.7l-1.2.6-1.3-1.8 1-1a7 7 0 0 1-.1-1.8l-1-1 .9-2 1.4.3c.4-.4 1-.8 1.5-1l.1-1.4h2.2l.4 1.3c.6.2 1.1.5 1.6.9l1.3-.5 1.1 1.9-1.1.8a7 7 0 0 1 .2 1.8Z" transform="translate(-1 -1)" /></svg>;
  }
}

export default function AppSidebar({ currentPage, onNavigate, liveMode = false, apiConnected = false, mode = "sample", workspaceId = "", workspaces = [], onModeChange, onWorkspaceChange, onCreateWorkspace, onRenameWorkspace, collapsed = false, onToggle }: AppSidebarProps) {
  return (
    <aside aria-label="SOLARIS application sidebar" className="app-sidebar">
      <a
        aria-label="SOLARIS Asset Intelligence overview"
        className="brand-lockup"
        href="#overview"
        onClick={(event) => { event.preventDefault(); onNavigate("overview"); }}
      >
        <BrandMark />
        <span className="brand-text">
          <span className="brand-name">SOLARIS</span>
          <span className="brand-divider" aria-hidden="true" />
          <span className="brand-subtitle">Asset Intelligence</span>
        </span>
      </a>
      {onToggle && <button className="panel-sidebar-toggle" type="button" aria-controls="solaris-primary-nav"
        aria-expanded={!collapsed} aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"} onClick={onToggle}>
        <span aria-hidden="true">{collapsed ? "»" : "«"}</span>
      </button>}

      <p className="sidebar-label">OPERATIONS</p>
      <nav id="solaris-primary-nav" aria-label="Primary navigation" className="sidebar-navigation">
        <a
          aria-current={currentPage === "overview" ? "page" : undefined}
          className={`sidebar-link${currentPage === "overview" ? " active" : ""}`}
          href="#overview"
          aria-label="Overview"
          title={collapsed ? "Overview" : undefined}
          onClick={(event) => { event.preventDefault(); onNavigate("overview"); }}
        >
          <NavigationIcon name="overview" />
          <span>Overview</span>
        </a>
        {navigationItems.map((item) => (
          item.page ? (
            <a
              aria-current={currentPage === item.page ? "page" : undefined}
              className={`sidebar-link${currentPage === item.page ? " active" : ""}`}
              href={`#${item.page}`}
              aria-label={item.label}
              title={collapsed ? item.label : undefined}
              key={item.label}
              onClick={(event) => { event.preventDefault(); onNavigate(item.page!); }}
            >
              <NavigationIcon name={item.icon} />
              <span>{item.label}</span>
            </a>
          ) : (
            <button
              aria-label={`${item.label}, planned for a later phase`}
              className="sidebar-link future-link"
              disabled
              key={item.label}
              title="Available in a later phase"
              type="button"
            >
              <NavigationIcon name={item.icon} />
              <span>{item.label}</span>
            </button>
          )
        ))}
      </nav>

      {onModeChange && onWorkspaceChange && onCreateWorkspace && onRenameWorkspace && (currentPage === "data-imports" ? <details className="sidebar-workspace-disclosure"><summary>Workspace settings</summary><WorkspaceControls mode={mode} workspaceId={workspaceId} workspaces={workspaces} onMode={onModeChange} onWorkspace={onWorkspaceChange} onCreate={onCreateWorkspace} onRename={onRenameWorkspace} /></details> : <WorkspaceControls mode={mode} workspaceId={workspaceId} workspaces={workspaces} onMode={onModeChange} onWorkspace={onWorkspaceChange} onCreate={onCreateWorkspace} onRename={onRenameWorkspace} />)}

      <section aria-label="Database connection status" className="database-status-card">
        <div className="database-status-heading">
          <svg aria-hidden="true" fill="none" viewBox="0 0 24 24">
            <ellipse cx="12" cy="5" rx="8" ry="3" stroke="currentColor" strokeWidth="1.6" />
            <path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 10c0 1.7 3.6 3 8 3s8-1.3 8-3m-16 5c0 1.7 3.6 3 8 3s8-1.3 8-3" stroke="currentColor" strokeWidth="1.6" />
          </svg>
          <div>
            <h2>Database Status</h2>
            <p><span className={`connection-dot${liveMode && apiConnected ? " connected" : ""}`} />{liveMode ? (apiConnected ? "API connected" : "API unavailable") : "Sample mode · offline ready"}</p>
          </div>
        </div>
        <div className="database-status-divider" />
        <p className="database-status-note">
          {liveMode ? "Workspace data is isolated by the selected workspace." : "Sample experience works without a backend connection."}
        </p>
      </section>

      <div className="sidebar-footer">
        <span className="sidebar-footer-mark" aria-hidden="true">S</span>
        <span>
          <strong>Research workspace</strong>
          <small>Data integrity first</small>
        </span>
      </div>
    </aside>
  );
}
import WorkspaceControls, { type DataMode } from "./WorkspaceControls";
import type { Workspace } from "../api/solaris";
