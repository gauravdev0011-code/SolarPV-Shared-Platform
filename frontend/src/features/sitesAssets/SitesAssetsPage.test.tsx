import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import App from "../../App";

afterEach(cleanup);

function openSites() {
  render(<App />);
  fireEvent.click(screen.getByRole("link", { name: "Sites & Assets" }));
}

describe("Sites & Assets page", () => {
  it("navigates to the page and selects a demonstration site", () => {
    openSites();

    expect(screen.getByRole("heading", { name: "Sites & Assets" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /South Mesa Solar Park/ }));
    expect(screen.getAllByText("South Mesa Solar Park", { selector: "strong" })).not.toHaveLength(0);
    expect((screen.getByRole("button", { name: /South Mesa Solar Park/ }) as HTMLButtonElement).getAttribute("aria-pressed")).toBe("true");
  });

  it("filters by ID or name, site, type, and condition", () => {
    openSites();

    fireEvent.change(screen.getByRole("combobox", { name: "Asset site" }), { target: { value: "south-mesa" } });
    fireEvent.change(screen.getByRole("combobox", { name: "Asset type" }), { target: { value: "String" } });
    expect(screen.getByText("SM-STR-01")).toBeTruthy();
    expect(screen.queryByText("SM-PV-0014")).toBeNull();

    fireEvent.change(screen.getByRole("searchbox", { name: "Search assets by ID or name" }), { target: { value: "String 01" } });
    expect(screen.getByText("SM-STR-01")).toBeTruthy();
    expect(screen.queryByText("SM-STR-02")).toBeNull();

    fireEvent.change(screen.getByRole("combobox", { name: "Asset type" }), { target: { value: "all" } });
    fireEvent.change(screen.getByRole("searchbox", { name: "Search assets by ID or name" }), { target: { value: "" } });
    fireEvent.change(screen.getByRole("combobox", { name: "Asset condition" }), { target: { value: "Critical" } });
    expect(screen.getByText("SM-PV-0001")).toBeTruthy();
    expect(screen.queryByText("SM-PV-0014")).toBeNull();
  });

  it("opens asset metadata and linked inspection history", () => {
    openSites();
    fireEvent.change(screen.getByRole("searchbox", { name: "Search assets by ID or name" }), { target: { value: "PV-1203" } });
    fireEvent.click(screen.getByRole("button", { name: "View details for PV-1203" }));

    expect(screen.getByRole("dialog", { name: /PV-1203/ })).toBeTruthy();
    expect(screen.getByText("PV Module 1203")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Inspection history" })).toBeTruthy();
    expect(screen.getByText("Thermal imaging")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Close asset details" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("shows a useful empty state for a search with no matching asset", () => {
    openSites();
    fireEvent.change(screen.getByRole("searchbox", { name: "Search assets by ID or name" }), { target: { value: "no-such-demo-asset" } });
    expect(screen.getByText("No assets match these filters")).toBeTruthy();
  });

  it("sorts the inventory by the selected asset name", () => {
    openSites();
    fireEvent.change(screen.getByRole("combobox", { name: "Sort assets by" }), { target: { value: "name" } });
    const firstDataRow = screen.getAllByRole("row")[1];
    expect(firstDataRow.querySelector("td")?.textContent).toBe("CB-01");
  });
});
