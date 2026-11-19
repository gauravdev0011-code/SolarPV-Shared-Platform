import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import App from "../../App";

afterEach(cleanup);

function openInspections() {
  render(<App />);
  fireEvent.click(screen.getByRole("link", { name: "Inspection History" }));
}

describe("Inspection History page", () => {
  it("navigates to inspection history and applies site, date, method, and status filters", () => {
    openInspections();

    expect(screen.getByRole("heading", { name: "Inspection History" })).toBeTruthy();
    fireEvent.change(screen.getByRole("searchbox", { name: "Search inspections by asset ID" }), { target: { value: "PV-1203" } });
    fireEvent.change(screen.getByRole("combobox", { name: "Inspection site" }), { target: { value: "north-ridge" } });
    fireEvent.change(screen.getByLabelText("Inspection start date"), { target: { value: "2026-10-31" } });
    fireEvent.change(screen.getByLabelText("Inspection end date"), { target: { value: "2026-10-31" } });
    fireEvent.change(screen.getByRole("combobox", { name: "Inspection method" }), { target: { value: "Thermal imaging" } });
    fireEvent.change(screen.getByRole("combobox", { name: "Inspection status or condition" }), { target: { value: "Follow-up required" } });

    expect(screen.getByText("PV-1203")).toBeTruthy();
    expect(screen.getByText("1 matching records")).toBeTruthy();
  });

  it("opens an inspection detail with observation value, unit, quality, and source", () => {
    openInspections();
    fireEvent.change(screen.getByRole("searchbox", { name: "Search inspections by asset ID" }), { target: { value: "PV-1203" } });
    fireEvent.click(screen.getByRole("button", { name: "View inspection record for PV-1203 on 2026-10-31" }));

    expect(screen.getByRole("dialog", { name: /PV-1203/ })).toBeTruthy();
    expect(screen.getByText("18.4 °C")).toBeTruthy();
    expect(screen.getByText("Illustrative demo value; not a field measurement")).toBeTruthy();
    expect(screen.getAllByText("Import: inspection_1031.csv").length).toBeGreaterThan(1);
  });

  it("distinguishes a missing measurement from numerical zero", () => {
    openInspections();
    fireEvent.change(screen.getByRole("searchbox", { name: "Search inspections by asset ID" }), { target: { value: "PV-1042" } });
    fireEvent.click(screen.getByRole("button", { name: "View inspection record for PV-1042 on 2026-10-28" }));

    expect(screen.getByText("No measurement was recorded for this synthetic inspection. Missing data is not represented as zero.")).toBeTruthy();
    expect(screen.queryByText("0 °C")).toBeNull();
    expect(document.querySelector(".observation-table")).toBeNull();
  });

  it("shows an empty state when the filters match no inspection", () => {
    openInspections();
    fireEvent.change(screen.getByRole("searchbox", { name: "Search inspections by asset ID" }), { target: { value: "not-an-asset" } });
    expect(screen.getByText("No inspection records match these filters")).toBeTruthy();
  });

  it("filters using an asset condition as well as an inspection status", () => {
    openInspections();
    fireEvent.change(screen.getByRole("combobox", { name: "Inspection status or condition" }), { target: { value: "Critical" } });
    expect(screen.getByText("PV-1203")).toBeTruthy();
    expect(screen.getByText("PV-1210")).toBeTruthy();
    expect(screen.queryByText("PV-1042")).toBeNull();
  });
});
