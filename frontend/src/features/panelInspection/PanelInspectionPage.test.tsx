import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import PanelInspectionPage from "./PanelInspectionPage";
import { demoLabel, type Layout } from "./panelTypes";

afterEach(() => { cleanup(); sessionStorage.clear(); vi.unstubAllGlobals(); });

it("searches the verified panel registry and displays visit-specific evidence", async () => {
  const layout: Layout = { source: "Workbook.xlsx", sheet: "SOLAR FARM", panels: [
    { id: "H-04-T", row: "H", position: 4, layer: "T", block: "right", cell: "IC15",
      column: 237, sheet_row: 15, source_mark: true, inferred_number: false, x: 170, y: 20, width: 28, height: 48, number_y: 85 },
    { id: "H-04-B", row: "H", position: 4, layer: "B", block: "right", cell: "IC19",
      column: 237, sheet_row: 19, source_mark: false, inferred_number: false, x: 170, y: 100, width: 28, height: 48, number_y: 85 },
  ] };
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    if (url.endsWith("/layout")) return Response.json(layout);
    if (url.includes("/coverage")) return Response.json({ with_inspections: 1, without_inspections: 1 });
    if (url.endsWith("/inverters")) return Response.json({ items: [], markers: [], plan_source: "Engineering plan" });
    const panel = layout.panels[url.includes("H-04-T") ? 0 : 1];
    return Response.json({ panel, maintenance: [], inspections: panel.layer === "T" ? [
      { inspection_id: 1, inspected_at: "2026-11-12T16:24:00Z", data_source: demoLabel, data_origin: "synthetic",
        attachments: [], measurements: [{ observation_type: "module_temperature", value: 36.72, unit: "°C", data_quality: "unknown" }] },
      { inspection_id: 2, inspected_at: "2026-10-28T16:24:00Z", data_source: demoLabel, data_origin: "synthetic",
        attachments: [], measurements: [] },
    ] : [] });
  }));
  render(<PanelInspectionPage live={false} workspace="" />);
  await screen.findByText("SOLAR FARM · IC15");
  expect(await screen.findByText("Demo inspection recorded")).toBeTruthy();
  expect(screen.getByText("Condition not assessed")).toBeTruthy();
  expect(within(screen.getByRole("region", { name: "Latest readings" })).getByText("36.72 °C")).toBeTruthy();
  expect(screen.getByRole("button", { name: /H-04-T.*source annotation/ }).getAttribute("aria-pressed")).toBe("true");
  fireEvent.click(screen.getByRole("button", { name: "Read Numbers" }));
  expect(document.querySelectorAll(".pi-position-number")).toHaveLength(1);
  expect(document.querySelector(".pi-position-number")?.getAttribute("x")).toBe("184");
  expect(document.querySelector(".pi-position-number")?.getAttribute("y")).toBe("85");
  fireEvent.change(screen.getByLabelText("Layer"), { target: { value: "T" } });
  expect(screen.queryByRole("button", { name: "H-04-B" })).toBeNull();
  const search = screen.getByRole("textbox", { name: "Search Panel" });
  fireEvent.change(search, { target: { value: "H-99-T" } });
  fireEvent.click(screen.getByRole("button", { name: "Find panel" }));
  expect(screen.getByRole("alert").textContent).toMatch(/No matching module/);
  fireEvent.change(search, { target: { value: "h4b" } });
  fireEvent.click(screen.getByRole("button", { name: "Find panel" }));
  await screen.findByRole("heading", { name: "H-04-B" });
  expect(screen.getByRole("button", { name: "H-04-B" }).getAttribute("aria-pressed")).toBe("true");
  await waitFor(() => expect(screen.getByText("No inspections recorded")).toBeTruthy());
  fireEvent.click(screen.getByRole("button", { name: /H-04-T.*source annotation/ }));
  fireEvent.click(screen.getByRole("button", { name: "Inspections" }));
  await screen.findByRole("button", { name: "Simulated Thermal" });
  fireEvent.click(screen.getByRole("button", { name: "Measurements" }));
  const comparison = screen.getByRole("region", { name: "Compare two inspections" });
  const temperature = within(comparison).getByRole("row", { name: /Module temperature/ });
  expect(temperature.textContent).toContain("Not measured");
  expect(temperature.textContent).toContain("36.72 °C");
  fireEvent.change(within(comparison).getByLabelText("First inspection"), { target: { value: "1" } });
  expect(within(comparison).getByRole("status").textContent).toMatch(/different inspections/);
  fireEvent.click(screen.getByRole("button", { name: "2026-10-28" }));
  expect(screen.getByRole("heading", { name: /Visit 2/ })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Return to selected module" }));
  expect(document.activeElement?.id).toBe("array-module-H-04-T");
  fireEvent.click(screen.getByRole("button", { name: "Fit Site" }));
  expect(document.querySelector(".pi-position-number")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Clear selection" }));
  expect(screen.queryByRole("heading", { name: "H-04-T" })).toBeNull();
});
