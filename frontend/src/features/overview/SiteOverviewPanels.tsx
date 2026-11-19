import { useMemo, useState, type KeyboardEvent } from "react";
import {
  DEMO_ASSETS,
  DEMO_MAP_MARKERS,
  type AssetCondition,
  type AssetType,
  type MapMarker,
} from "./demoData";
import type { DashboardViewModel } from "./dashboardModel";

const conditionColors: Record<AssetCondition, string> = {
  Healthy: "#0b9d50",
  Warning: "#f39a12",
  Critical: "#df2626",
};

const fieldBlocks = [
  { x: 22, y: 27, width: 316, height: 81 },
  { x: 355, y: 27, width: 294, height: 81 },
  { x: 665, y: 27, width: 143, height: 81 },
  { x: 22, y: 139, width: 255, height: 89 },
  { x: 294, y: 139, width: 355, height: 89 },
  { x: 665, y: 139, width: 143, height: 89 },
];

function PanelRows({ x, y, width, height }: (typeof fieldBlocks)[number]) {
  const rows = 4;
  const columns = Math.max(4, Math.floor(width / 37));
  const gap = 3;
  const cellWidth = (width - (columns - 1) * gap) / columns;
  const cellHeight = (height - (rows - 1) * gap) / rows;

  return (
    <g>
      {Array.from({ length: rows * columns }, (_, index) => {
        const row = Math.floor(index / columns);
        const column = index % columns;
        return (
          <rect
            key={`${x}-${y}-${index}`}
            x={x + column * (cellWidth + gap)}
            y={y + row * (cellHeight + gap)}
            width={cellWidth}
            height={cellHeight}
            rx="1.5"
            fill="url(#pv-panel)"
            stroke="#6da3b1"
            strokeWidth="0.6"
          />
        );
      })}
    </g>
  );
}

function MapMarkerGlyph({
  marker,
  showLabel,
  onSelect,
}: {
  marker: MapMarker;
  showLabel: boolean;
  onSelect: (assetId: string) => void;
}) {
  const color = conditionColors[marker.condition];
  const labelWidth = Math.max(48, marker.assetId.length * 6 + 12);

  function onKeyDown(event: KeyboardEvent<SVGGElement>) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onSelect(marker.assetId);
    }
  }

  return (
    <g
      aria-label={`${marker.assetId}, ${marker.type}, ${marker.condition}`}
      className="map-marker"
      onClick={() => onSelect(marker.assetId)}
      onKeyDown={onKeyDown}
      role="button"
      tabIndex={0}
      transform={`translate(${marker.x} ${marker.y})`}
    >
      <title>{`${marker.assetId} · ${marker.condition} · illustrative placement`}</title>
      <path d="M0 13c-1-2-10-11-10-17a10 10 0 1 1 20 0c0 6-9 15-10 17Z" fill={color} stroke="#fff" strokeWidth="2" />
      <circle cy="-4" r="3.2" fill="#fff" />
      {showLabel && (
        <g transform={`translate(${-labelWidth / 2} 16)`}>
          <rect width={labelWidth} height="17" rx="4" fill="#fff" stroke="#cdd6df" />
          <text x={labelWidth / 2} y="11.5" textAnchor="middle">{marker.assetId}</text>
        </g>
      )}
    </g>
  );
}

function MapLegend() {
  return (
    <div aria-label="Asset condition legend" className="map-legend">
      <strong>Asset Condition</strong>
      <span><i className="legend-dot healthy-dot" />Healthy</span>
      <span><i className="legend-dot warning-dot" />Warning</span>
      <span><i className="legend-dot critical-dot" />Critical</span>
      <div className="legend-divider" />
      <span className="legend-type"><i className="type-symbol module-symbol" />PV module</span>
      <span className="legend-type"><i className="type-symbol inverter-symbol" />Inverter / transformer</span>
      <span className="legend-type"><i className="type-symbol module-symbol" />String / combiner box</span>
      <span className="legend-type"><i className="road-symbol" />Access road</span>
    </div>
  );
}

function SiteMapPanel({ dashboard }: { dashboard: DashboardViewModel }) {
  const [assetType, setAssetType] = useState<AssetType | "all">("all");
  const [condition, setCondition] = useState<AssetCondition | "all">("all");
  const [showLabels, setShowLabels] = useState(true);
  const [zoom, setZoom] = useState(1);
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null);
  const markers = useMemo(
    () => DEMO_MAP_MARKERS.filter((marker) =>
      dashboard.assetIds.has(marker.assetId) &&
      (assetType === "all" || marker.type === assetType) &&
      (condition === "all" || marker.condition === condition),
    ),
    [assetType, condition, dashboard.assetIds],
  );
  const selectedAsset = selectedAssetId
    ? DEMO_ASSETS.find((asset) => asset.id === selectedAssetId)
    : undefined;

  return (
    <section aria-labelledby="site-map-title" className="panel-card map-panel">
      <div className="panel-heading map-panel-heading">
        <div className="panel-title-wrap">
          <h3 id="site-map-title">Site Map <span>— {dashboard.siteName}</span></h3>
          <span className="panel-info" aria-label="Map is illustrative, not geographic data" title="Illustrative site layout only; no geographic coordinates are used.">i</span>
        </div>
        <div className="map-filters">
          <label>
            <span className="sr-only">Map asset type</span>
            <select aria-label="Map asset type" onChange={(event) => setAssetType(event.target.value as AssetType | "all")} value={assetType}>
              <option value="all">Asset Type: All</option>
              <option value="PV Module">PV Modules</option>
              <option value="Inverter">Inverters</option>
              <option value="Transformer">Transformers</option>
              <option value="String">Strings</option>
              <option value="Combiner Box">Combiner boxes</option>
            </select>
          </label>
          <label>
            <span className="sr-only">Map condition</span>
            <select aria-label="Map condition" onChange={(event) => setCondition(event.target.value as AssetCondition | "all")} value={condition}>
              <option value="all">Condition: All</option>
              <option value="Healthy">Healthy</option>
              <option value="Warning">Warning</option>
              <option value="Critical">Critical</option>
            </select>
          </label>
          <label className="map-label-toggle">
            <input checked={showLabels} onChange={(event) => setShowLabels(event.target.checked)} type="checkbox" />
            Show Labels
          </label>
        </div>
      </div>

      <div className="map-illustration-wrap">
        <div className="map-disclaimer">ILLUSTRATIVE LAYOUT · NOT GEOGRAPHIC DATA</div>
        <div className="map-zoom-controls" aria-label="Map zoom controls">
          <button aria-label="Zoom in" onClick={() => setZoom((value) => Math.min(1.35, value + 0.1))} type="button">+</button>
          <button aria-label="Zoom out" onClick={() => setZoom((value) => Math.max(0.85, value - 0.1))} type="button">−</button>
          <button aria-label="Reset map zoom" onClick={() => setZoom(1)} type="button">⌗</button>
        </div>
        <div className="map-scene-viewport">
          <svg
            aria-label={`Illustrative, non-geographic solar farm layout for ${dashboard.siteName}; ${markers.length} representative markers visible`}
            className="site-map-scene"
            role="img"
            style={{ transform: `scale(${zoom})` }}
            viewBox="0 0 830 260"
          >
            <defs>
              <linearGradient id="map-grass" x1="0" x2="1" y1="0" y2="1">
                <stop offset="0" stopColor="#346d3e" />
                <stop offset="0.5" stopColor="#6d9852" />
                <stop offset="1" stopColor="#315f39" />
              </linearGradient>
              <linearGradient id="pv-panel" x1="0" x2="1" y1="0" y2="1">
                <stop offset="0" stopColor="#254f6b" />
                <stop offset="0.5" stopColor="#39718b" />
                <stop offset="1" stopColor="#1e4662" />
              </linearGradient>
              <pattern id="grass-stripe" width="32" height="32" patternUnits="userSpaceOnUse" patternTransform="rotate(24)">
                <path d="M0 0v32" stroke="#a4bf6f" strokeOpacity="0.15" strokeWidth="8" />
              </pattern>
            </defs>
            <rect width="830" height="260" fill="url(#map-grass)" />
            <rect width="830" height="260" fill="url(#grass-stripe)" />
            <path d="M0 121H830M345 0v260M658 0v260" stroke="#c8b98b" strokeWidth="20" />
            <path d="M0 121H830M345 0v260M658 0v260" stroke="#e2d8bd" strokeWidth="1.5" strokeDasharray="8 6" />
            {fieldBlocks.map((block) => <PanelRows key={`${block.x}-${block.y}`} {...block} />)}
            <g className="map-equipment">
              <rect x="372" y="132" width="46" height="26" rx="2" />
              <path d="M379 138h31M379 145h31M379 152h31" />
              <rect x="433" y="132" width="48" height="26" rx="2" />
              <path d="M440 138h34M440 145h34M440 152h34" />
              <rect x="397" y="184" width="58" height="28" rx="2" />
              <path d="M405 190h42M405 198h42M405 206h42" />
            </g>
            <g className="map-road-labels">
              <text x="366" y="119">SERVICE ROAD</text>
              <text x="12" y="133">ACCESS ROAD</text>
            </g>
            {markers.map((marker) => (
              <MapMarkerGlyph
                key={marker.assetId}
                marker={marker}
                onSelect={setSelectedAssetId}
                showLabel={showLabels}
              />
            ))}
          </svg>
        </div>
        <MapLegend />
        {selectedAsset && (
          <div className="map-selection" role="status">
            <strong>{selectedAsset.id}</strong>
            <span>{selectedAsset.type}</span>
            <span className={`condition-text condition-${selectedAsset.condition.toLowerCase()}`}>{selectedAsset.condition}</span>
          </div>
        )}
        <div className="illustrative-scale" aria-hidden="true">
          <span>SCHEMATIC</span>
          <span className="scale-line" />
          <span>NOT TO SCALE</span>
        </div>
      </div>
      {markers.length === 0 && (
        <p className="map-empty-message">No representative assets match the selected filters.</p>
      )}
    </section>
  );
}

function percent(value: number, total: number): string {
  return total === 0 ? "—" : `${((value / total) * 100).toFixed(1)}%`;
}

function SiteConditionPanel({ dashboard }: { dashboard: DashboardViewModel }) {
  const { Healthy: healthy, Warning: warning, Critical: critical } = dashboard.conditions;
  const total = dashboard.totalAssets;
  const healthyEnd = total === 0 ? 0 : (healthy / total) * 100;
  const warningEnd = total === 0 ? 0 : healthyEnd + (warning / total) * 100;
  const donutStyle = total === 0
    ? { background: "#e8edf2" }
    : {
        background: `conic-gradient(#14a84f 0 ${healthyEnd}%, #f59e0b ${healthyEnd}% ${warningEnd}%, #e52a2a ${warningEnd}% 100%)`,
      };

  return (
    <section aria-labelledby="condition-title" className="panel-card condition-panel">
      <div className="panel-heading">
        <div className="panel-title-wrap">
          <h3 id="condition-title">Site Condition <span>— {dashboard.siteName}</span></h3>
          <span className="panel-info" title="Condition groups are illustrative fixture classifications.">i</span>
        </div>
        <span className="condition-period">CURRENT CLASSIFICATION</span>
      </div>
      {total === 0 ? (
        <div className="condition-empty">No assets match the current site and search filters.</div>
      ) : (
        <>
          <div className="condition-overview">
            <div aria-label={`${healthy} healthy, ${warning} warning, ${critical} critical assets`} className="condition-donut" role="img" style={donutStyle}>
              <div className="donut-center">
                <strong>{dashboard.inspectionCoverage === null ? "—" : `${dashboard.inspectionCoverage.toFixed(1)}%`}</strong>
                <span>Inspected</span>
              </div>
            </div>
            <div className="condition-list">
              <div className="condition-row">
                <span><i className="legend-dot healthy-dot" />Healthy</span>
                <strong>{healthy.toLocaleString("en-US")}</strong>
                <small>{percent(healthy, total)}</small>
              </div>
              <div className="condition-row">
                <span><i className="legend-dot warning-dot" />Warning</span>
                <strong>{warning.toLocaleString("en-US")}</strong>
                <small>{percent(warning, total)}</small>
              </div>
              <div className="condition-row">
                <span><i className="legend-dot critical-dot" />Critical</span>
                <strong>{critical.toLocaleString("en-US")}</strong>
                <small>{percent(critical, total)}</small>
              </div>
            </div>
          </div>
          <a className="condition-summary-link" href="#priority-work-queue">
            <span className="summary-info-icon" aria-hidden="true">i</span>
            <span>
              <strong>Condition Summary</strong>
              <small>
                {dashboard.findings.length} open findings and {dashboard.priorityActions.length} priority actions in the selected view.
              </small>
            </span>
            <span className="summary-arrow" aria-hidden="true">→</span>
          </a>
        </>
      )}
    </section>
  );
}

export default function SiteOverviewPanels({ dashboard }: { dashboard: DashboardViewModel }) {
  return (
    <div className="site-overview-grid">
      <SiteMapPanel dashboard={dashboard} />
      <SiteConditionPanel dashboard={dashboard} />
    </div>
  );
}
