import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import InspectionCsvImport from "./InspectionCsvImport";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it("requires explicit confirmation for the current preview and opens the saved panel visit", async () => {
  const row = { line: 2, panel_id: "H-04-T", inspected_at: "2026-11-14T10:00:00Z", data_source: "Lab",
    measurement: "module_temperature", quantity: "temperature", value: "", unit: "degC", finding: "Unavailable" };
  const preview = { filename: "measurements.csv", confirmation: "preview-token", rows: [row],
    errors: [], inspection_count: 1 };
  const receipt = { import_id: "1", filename: preview.filename, measurement_count: 1, origin: "synthetic",
    created_at: "2026-11-18 12:00:00", inspections: [{ inspection_id: 25, panel_id: row.panel_id, inspected_at: row.inspected_at }] };
  let committed = false;
  vi.stubGlobal("fetch", vi.fn(async (url: string, options: RequestInit) => {
    if (url.includes("/preview?")) return Response.json({ preview, receipt: null });
    if (url.includes("/commit?")) {
      expect((options.body as FormData).get("confirmed_digest")).toBe(preview.confirmation);
      committed = true;
      return Response.json({ preview, receipt });
    }
    return Response.json({ imports: committed ? [receipt] : [] });
  }));
  const open = vi.fn();
  render(<InspectionCsvImport mode="demo" workspace="" onOpenPanel={open} onImported={vi.fn()} />);
  await screen.findByText("No inspection imports yet.");
  fireEvent.change(screen.getByLabelText("Inspection CSV"), {
    target: { files: [new File(["example"], preview.filename, { type: "text/csv" })] },
  });
  fireEvent.click(screen.getByRole("button", { name: "Preview CSV" }));
  await screen.findByText("Missing");
  const confirm = screen.getByRole("button", { name: "Import inspections" }) as HTMLButtonElement;
  expect(confirm.disabled).toBe(true);
  fireEvent.click(screen.getByRole("checkbox", { name: "Confirm synthetic import" }));
  expect(confirm.disabled).toBe(false);
  fireEvent.click(confirm);
  await screen.findByText(/Import saved/);
  fireEvent.click(await screen.findByRole("button", { name: "Open H-04-T" }));
  await waitFor(() => expect(open).toHaveBeenCalledWith("H-04-T", 25));
});
