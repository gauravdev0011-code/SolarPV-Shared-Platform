import { memo, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import type { Panel } from "./panelTypes";

const Module = memo(function Module({ panel, selected, active }: { panel: Panel; selected: boolean; active: boolean }) {
  return <rect id={`array-module-${panel.id}`} data-panel={panel.id} x={panel.x} y={panel.y}
    width={panel.width} height={panel.height} role="button" tabIndex={active ? 0 : -1}
    aria-label={panel.id + (panel.source_mark ? " · workbook source annotation" : "")}
    aria-pressed={selected} className={`pi-module${panel.source_mark ? " marked" : ""}${selected ? " selected" : ""}`}>
    <title>{panel.id} · {panel.cell}</title>
  </rect>;
});

export default memo(function ArrayMap({ panels, selected, reveal, onSelect }: {
  panels: Panel[];
  selected: Panel | undefined;
  reveal: number;
  onSelect: (panel: Panel) => void;
}) {
  const viewport = useRef<HTMLDivElement>(null);
  const diagram = useRef<SVGSVGElement>(null);
  const drag = useRef<{ x: number; y: number; left: number; top: number; moved: boolean } | null>(null);
  const [zoom, setZoom] = useState(1);
  const [row, setRow] = useState("");
  const [layer, setLayer] = useState("");

  const geometry = useMemo(() => ({
    width: Math.max(...panels.map((panel) => panel.x + panel.width)) + 24,
    height: Math.max(...panels.map((panel) => panel.y + panel.height)) + 24,
    top: Math.min(...panels.map((panel) => panel.y)) - 40,
    rows: [...new Set(panels.map((panel) => panel.row))],
    byId: new Map(panels.map((panel) => [panel.id, panel])),
  }), [panels]);
  const visible = useMemo(() => panels.filter((panel) => (!row || panel.row === row) && (!layer || panel.layer === layer)),
    [panels, row, layer]);
  const numbered = useMemo(() => panels.filter((panel) => panel.layer === "T" && (!row || panel.row === row)), [panels, row]);
  const rowLabels = numbered.filter((panel) => panel.position === 1);
  const active = selected && visible.includes(selected) ? selected : visible[0];

  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const zoomWheel = (event: WheelEvent) => {
      if (!event.shiftKey || !event.deltaY) return;
      event.preventDefault();
      setZoom((value) => Math.min(8, Math.max(1, value * (event.deltaY < 0 ? 2 : 0.5))));
    };
    element.addEventListener("wheel", zoomWheel, { passive: false });
    return () => element.removeEventListener("wheel", zoomWheel);
  }, []);

  useEffect(() => {
    if (reveal > 0) setZoom(8);
  }, [reveal]);

  useEffect(() => {
    if (!selected) return;
    setRow((value) => value && value !== selected.row ? "" : value);
    setLayer((value) => value && value !== selected.layer ? "" : value);
  }, [selected, reveal]);

  useEffect(() => {
    const view = viewport.current;
    const svg = diagram.current;
    if (!selected || !view || !svg || zoom === 1) return;
    const scale = svg.clientWidth / geometry.width;
    view.scrollLeft = (selected.x + selected.width / 2) * scale - view.clientWidth / 2;
    view.scrollTop = (selected.y - geometry.top + selected.height / 2) * scale - view.clientHeight / 2;
  }, [selected, reveal, zoom, geometry]);

  function targetPanel(target: EventTarget) {
    return target instanceof Element ? geometry.byId.get(target.closest("[data-panel]")?.getAttribute("data-panel") ?? "") : undefined;
  }

  function move(event: KeyboardEvent) {
    const panel = targetPanel(event.target);
    if (!panel) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onSelect(panel);
      return;
    }
    const horizontal = event.key === "ArrowLeft" || event.key === "ArrowRight";
    if (!horizontal && event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    event.preventDefault();
    const direction = event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 1;
    const track = visible.filter((item) => horizontal
      ? item.row === panel.row && item.layer === panel.layer
      : item.block === panel.block && item.position === panel.position);
    const next = track[track.indexOf(panel) + direction];
    if (next) {
      onSelect(next);
      document.getElementById(`array-module-${next.id}`)?.focus();
    }
  }

  function reset() {
    setZoom(1);
    setRow("");
    setLayer("");
    if (viewport.current) {
      viewport.current.scrollLeft = 0;
      viewport.current.scrollTop = 0;
    }
  }

  return <>
    <div className="pi-map-tools">
      <label>Row <select value={row} onChange={(event) => setRow(event.target.value)}>
        <option value="">All rows</option>
        {geometry.rows.map((item) => <option key={item}>{item}</option>)}
      </select></label>
      <label>Layer <select value={layer} onChange={(event) => setLayer(event.target.value)}>
        <option value="">Top &amp; bottom</option><option value="T">Top (T)</option><option value="B">Bottom (B)</option>
      </select></label>
      <div className="pi-zoom">
        <button type="button" className="pi-primary" aria-pressed={zoom === 8} onClick={() => setZoom(8)}>Read Numbers</button>
        <button type="button" onClick={reset}>Fit Site</button>
        <button type="button" aria-label="Zoom out" disabled={zoom === 1} onClick={() => setZoom(Math.max(1, zoom / 2))}>−</button>
        <output aria-label="Array zoom" className="pi-zoom-level">{zoom * 100}%</output>
        <button type="button" aria-label="Zoom in" disabled={zoom === 8} onClick={() => setZoom(Math.min(8, zoom * 2))}>+</button>
      </div>
    </div>
    <div ref={viewport} className="pi-viewport" aria-label="Scrollable array layout" tabIndex={0}
      onPointerDown={(event) => {
        if (event.pointerType !== "mouse" || event.button !== 0) return;
        drag.current = { x: event.clientX, y: event.clientY, left: event.currentTarget.scrollLeft,
          top: event.currentTarget.scrollTop, moved: false };
      }}
      onPointerMove={(event) => {
        const start = drag.current;
        if (!start || event.buttons !== 1) return;
        const dx = event.clientX - start.x, dy = event.clientY - start.y;
        if (!start.moved && Math.hypot(dx, dy) < 5) return;
        if (!start.moved && event.currentTarget.setPointerCapture) event.currentTarget.setPointerCapture(event.pointerId);
        start.moved = true;
        event.currentTarget.scrollLeft = start.left - dx;
        event.currentTarget.scrollTop = start.top - dy;
      }}
      onPointerCancel={() => { drag.current = null; }}
      onClickCapture={(event) => {
        if (drag.current?.moved && event.detail > 0) event.stopPropagation();
        drag.current = null;
      }}>
      <svg ref={diagram} className="pi-array" viewBox={`0 ${geometry.top} ${geometry.width} ${geometry.height - geometry.top}`}
        style={{ width: `${zoom * 100}%`, minWidth: zoom === 8 ? geometry.width : undefined }}
        aria-label="Workbook map of rows A to P" onKeyDown={move} onDoubleClick={(event) => {
          const panel = targetPanel(event.target);
          if (panel) { onSelect(panel); setZoom(8); }
        }} onClick={(event) => {
          const panel = targetPanel(event.target);
          if (panel) onSelect(panel);
        }}>
        <g aria-hidden="true">
          {rowLabels.map((panel) => <g key={panel.row} className="pi-map-label" textAnchor="end">
            <text className="pi-row-letter" x={panel.x - 7} y={panel.number_y} dominantBaseline="central">{panel.row}</text>
            {layer !== "B" && <text x={panel.x - 7} y={panel.y + panel.height / 2} dominantBaseline="central">T</text>}
            {layer !== "T" && <text x={panel.x - 7} y={(geometry.byId.get(panel.id.replace(/T$/, "B")) ?? panel).y + panel.height / 2} dominantBaseline="central">B</text>}
          </g>)}
          {zoom >= 4 && numbered.map((panel) => <text key={panel.id} className="pi-position-number"
            data-row={panel.row} data-position={panel.position}
            x={panel.x + panel.width / 2} y={panel.number_y} textAnchor="middle" dominantBaseline="central">
            {panel.position}{panel.inferred_number ? "*" : ""}
          </text>)}
        </g>
        {visible.map((panel) => <Module key={panel.id} panel={panel} selected={selected === panel} active={active === panel} />)}
        {selected && visible.includes(selected) && <rect className="pi-selection-ring" pointerEvents="none"
          x={selected.x - 2} y={selected.y - 2} width={selected.width + 4} height={selected.height + 4} />}
      </svg>
    </div>
    <div className="pi-legend"><span><i /> Module</span><span><i className="marked" /> Reported damaged · workbook</span>
      <span><i className="selected" /> Selected</span><span>T Top · B Bottom</span><span>Drag to pan · Shift + scroll to zoom</span>
      {zoom >= 4 && <span>* Position inferred from neighboring labels</span>}</div>
  </>;
});
