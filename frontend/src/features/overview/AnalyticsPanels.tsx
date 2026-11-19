import { useState } from "react";
import {
  DEMO_INVERTER_TRENDS,
  DEMO_MODULE_TRENDS,
  type ChartPoint,
} from "./demoData";
import { isInDateRange, type DashboardViewModel } from "./dashboardModel";

const chartColors = ["#1375e8", "#0ba84e", "#f28c0b", "#8056d8"];
const plot = { left: 58, top: 18, width: 478, height: 164 };

function dateLabel(value: string): string {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" })
    .format(new Date(`${value}T00:00:00Z`));
}

function pointX(index: number, count: number): number {
  return count <= 1 ? plot.left + plot.width / 2 : plot.left + (index / (count - 1)) * plot.width;
}

function moduleY(value: number): number {
  return plot.top + plot.height - (value / 25) * plot.height;
}

function selectedPoints(points: ChartPoint[], dashboard: DashboardViewModel): ChartPoint[] {
  return points.filter((point) => point.value !== null && isInDateRange(point.date, dashboard.dateBounds));
}

function ModuleChart({ dashboard }: { dashboard: DashboardViewModel }) {
  const availableSeries = DEMO_MODULE_TRENDS.filter((series) => dashboard.assetIds.has(series.assetId));
  const [selectedId, setSelectedId] = useState("all");
  const plottedSeries = selectedId === "all"
    ? availableSeries
    : availableSeries.filter((series) => series.assetId === selectedId);
  const seriesPoints = plottedSeries.map((series) => ({
    assetId: series.assetId,
    points: selectedPoints(series.points, dashboard),
  })).filter((series) => series.points.length > 0);

  if (seriesPoints.length === 0) {
    return <div className="chart-no-data">No module trend data matches the selected site, dates, and search.</div>;
  }

  return (
    <div className="chart-content">
      <div className="chart-toolbar">
        <p>Temperature delta above ambient (illustrative fixture)</p>
        <label>
          <span className="sr-only">Temperature trend series</span>
          <select aria-label="Temperature trend series" onChange={(event) => setSelectedId(event.target.value)} value={selectedId}>
            <option value="all">Compare visible modules</option>
            {availableSeries.map((series) => <option key={series.assetId} value={series.assetId}>{series.assetId}</option>)}
          </select>
        </label>
      </div>
      <div className="chart-svg-wrap">
        <svg aria-label="Illustrative module temperature delta trend in degrees Celsius" className="line-chart" role="img" viewBox="0 0 700 238">
          <text className="axis-title axis-title-y" transform="translate(17 111) rotate(-90)" textAnchor="middle">ΔT (°C)</text>
          {[0, 5, 10, 15, 20, 25].map((tick) => {
            const y = moduleY(tick);
            return (
              <g key={tick}>
                <line className="chart-grid-line" x1={plot.left} x2={plot.left + plot.width} y1={y} y2={y} />
                <text className="axis-tick" textAnchor="end" x={plot.left - 9} y={y + 3}>{tick}</text>
              </g>
            );
          })}
          <line className="chart-axis-line" x1={plot.left} x2={plot.left} y1={plot.top} y2={plot.top + plot.height} />
          <line className="chart-axis-line" x1={plot.left} x2={plot.left + plot.width} y1={plot.top + plot.height} y2={plot.top + plot.height} />
          {seriesPoints.map((series) => {
            const color = chartColors[DEMO_MODULE_TRENDS.findIndex((item) => item.assetId === series.assetId)] ?? chartColors[0];
            const path = series.points.map((point, index) => {
              const x = pointX(index, series.points.length);
              const y = moduleY(point.value ?? 0);
              return `${index === 0 ? "M" : "L"} ${x} ${y}`;
            }).join(" ");
            return (
              <g key={series.assetId}>
                <path className="trend-line" d={path} stroke={color} />
                {series.points.map((point, index) => (
                  <circle
                    key={`${series.assetId}-${point.date}`}
                    cx={pointX(index, series.points.length)}
                    cy={moduleY(point.value ?? 0)}
                    fill="#fff"
                    r="3.4"
                    stroke={color}
                    strokeWidth="2"
                  >
                    <title>{`${series.assetId} · ${dateLabel(point.date)} · ${point.value} °C ΔT · illustrative`}</title>
                  </circle>
                ))}
              </g>
            );
          })}
          {seriesPoints[0]?.points.map((point, index) => (
            <text className="axis-tick" key={point.date} textAnchor="middle" x={pointX(index, seriesPoints[0].points.length)} y={plot.top + plot.height + 19}>
              {dateLabel(point.date)}
            </text>
          ))}
          <text className="axis-title" textAnchor="middle" x={plot.left + plot.width / 2} y="225">Inspection date</text>
        </svg>
        <div aria-label="Temperature chart legend" className="chart-legend">
          {seriesPoints.map((series) => {
            const color = chartColors[DEMO_MODULE_TRENDS.findIndex((item) => item.assetId === series.assetId)] ?? chartColors[0];
            return <span key={series.assetId}><i style={{ background: color }} />{series.assetId}</span>;
          })}
        </div>
      </div>
      <p className="chart-note">Synthetic demonstration values · not actual equipment readings.</p>
    </div>
  );
}

function performanceY(value: number): number {
  return plot.top + plot.height - ((value - 85) / 15) * plot.height;
}

function outputY(value: number): number {
  return plot.top + plot.height - (value / 1250) * plot.height;
}

function InverterChart({ dashboard }: { dashboard: DashboardViewModel }) {
  const availableSeries = DEMO_INVERTER_TRENDS.filter((series) => dashboard.assetIds.has(series.assetId));
  const [selectedId, setSelectedId] = useState("INV-03");
  const selectedSeries = availableSeries.find((series) => series.assetId === selectedId) ?? availableSeries[0];
  const output = selectedSeries ? selectedPoints(selectedSeries.outputKw, dashboard) : [];
  const ratio = selectedSeries ? selectedPoints(selectedSeries.performanceRatio, dashboard) : [];

  if (!selectedSeries || output.length === 0 || ratio.length === 0) {
    return <div className="chart-no-data">No inverter performance data matches the selected site, dates, and search.</div>;
  }

  const ratioPath = ratio.map((point, index) => {
    const x = pointX(index, ratio.length);
    const y = performanceY(point.value ?? 85);
    return `${index === 0 ? "M" : "L"} ${x} ${y}`;
  }).join(" ");

  return (
    <div className="chart-content">
      <div className="chart-toolbar">
        <p>AC output and performance ratio (illustrative fixture)</p>
        <label>
          <span className="sr-only">Inverter performance series</span>
          <select aria-label="Inverter performance series" disabled={availableSeries.length === 0} onChange={(event) => setSelectedId(event.target.value)} value={selectedSeries.assetId}>
            {availableSeries.map((series) => <option key={series.assetId} value={series.assetId}>{series.assetId}</option>)}
          </select>
        </label>
      </div>
      <div className="chart-svg-wrap">
        <svg aria-label={`${selectedSeries.assetId} illustrative output in kilowatts and performance ratio percent`} className="line-chart combo-chart" role="img" viewBox="0 0 700 238">
          <text className="axis-title axis-title-y" transform="translate(16 111) rotate(-90)" textAnchor="middle">AC Output (kW)</text>
          {[0, 250, 500, 750, 1000, 1250].map((tick) => {
            const y = outputY(tick);
            return (
              <g key={tick}>
                <line className="chart-grid-line" x1={plot.left} x2={plot.left + plot.width} y1={y} y2={y} />
                <text className="axis-tick" textAnchor="end" x={plot.left - 8} y={y + 3}>{tick.toLocaleString("en-US")}</text>
              </g>
            );
          })}
          {[85, 90, 95, 100].map((tick) => (
            <text className="axis-tick" key={tick} textAnchor="start" x={plot.left + plot.width + 8} y={performanceY(tick) + 3}>{tick}</text>
          ))}
          <line className="chart-axis-line" x1={plot.left} x2={plot.left} y1={plot.top} y2={plot.top + plot.height} />
          <line className="chart-axis-line" x1={plot.left} x2={plot.left + plot.width} y1={plot.top + plot.height} y2={plot.top + plot.height} />
          <line className="chart-axis-line" x1={plot.left + plot.width} x2={plot.left + plot.width} y1={plot.top} y2={plot.top + plot.height} />
          {output.map((point, index) => {
            const x = pointX(index, output.length);
            const y = outputY(point.value ?? 0);
            return (
              <rect className="output-bar" key={point.date} x={x - 13} y={y} width="26" height={plot.top + plot.height - y} rx="3">
                <title>{`${selectedSeries.assetId} · ${dateLabel(point.date)} · ${point.value} kW AC output · illustrative`}</title>
              </rect>
            );
          })}
          <path className="performance-line" d={ratioPath} />
          {ratio.map((point, index) => (
            <circle className="performance-point" key={point.date} cx={pointX(index, ratio.length)} cy={performanceY(point.value ?? 85)} r="3.5">
              <title>{`${selectedSeries.assetId} · ${dateLabel(point.date)} · ${point.value}% performance ratio · illustrative`}</title>
            </circle>
          ))}
          {output.map((point, index) => (
            <text className="axis-tick" key={`date-${point.date}`} textAnchor="middle" x={pointX(index, output.length)} y={plot.top + plot.height + 19}>{dateLabel(point.date)}</text>
          ))}
          <text className="axis-title" textAnchor="middle" x={plot.left + plot.width / 2} y="225">Inspection date</text>
          <text className="axis-title" transform={`translate(${plot.left + plot.width + 46} 108) rotate(-90)`} textAnchor="middle">Performance Ratio (%)</text>
        </svg>
        <div aria-label="Inverter chart legend" className="chart-legend inverter-legend">
          <span><i className="legend-bar" />AC Output (kW)</span>
          <span><i className="legend-line" />Performance Ratio (PR)</span>
        </div>
      </div>
      <p className="chart-note">Synthetic demonstration values · not actual equipment readings.</p>
    </div>
  );
}

export default function AnalyticsPanels({ dashboard }: { dashboard: DashboardViewModel }) {
  return (
    <section aria-label="Illustrative analytics" className="analytics-grid">
      <article aria-labelledby="temperature-trend-title" className="panel-card analytics-panel">
        <div className="panel-heading">
          <div className="panel-title-wrap">
            <h3 id="temperature-trend-title">Module Temperature Delta (ΔT) Trend</h3>
            <span className="panel-info" title="Illustrative synthetic series; no engineering threshold is implied.">i</span>
          </div>
        </div>
        <ModuleChart dashboard={dashboard} />
      </article>
      <article aria-labelledby="inverter-performance-title" className="panel-card analytics-panel">
        <div className="panel-heading">
          <div className="panel-title-wrap">
            <h3 id="inverter-performance-title">Inverter Output / Performance</h3>
            <span className="panel-info" title="Illustrative synthetic series; not measured equipment performance.">i</span>
          </div>
        </div>
        <InverterChart dashboard={dashboard} />
      </article>
    </section>
  );
}
