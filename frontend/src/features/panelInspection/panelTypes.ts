export interface Panel {
  id: string;
  row: string;
  position: number;
  layer: "T" | "B";
  block: "left" | "right";
  cell: string;
  column: number;
  sheet_row: number;
  source_mark: boolean;
  inferred_number: boolean;
  x: number;
  y: number;
  width: number;
  height: number;
  number_y: number;
}

export interface Layout {
  sheet: string;
  source: string;
  panels: Panel[];
}

export interface Inspection {
  inspection_id: number;
  inspected_at: string;
  data_source: string | null;
  data_origin: string;
  inspection_method?: string | null;
  measurements: { observation_type: string; value: number | null; unit: string | null; data_quality: string;
    source_reference?: string | null; recorded_at?: string | null; finding?: string | null; measurement_status?: string | null }[];
  attachments: { original_name: string; path: string; media_type: string; kind?: string | null }[];
}

export interface PanelEvidence {
  panel: Panel;
  inspections: Inspection[];
  maintenance: MaintenanceRecord[];
  module_model?: string | null;
  serial_number?: string | null;
  equipment_source?: string | null;
  manufacturer?: string | null;
  asset_id?: number | null;
  inverter?: string | null;
  string?: string | null;
  combiner?: string | null;
}

export interface MaintenanceRecord {
  maintenance_id: number;
  performed_at: string | null;
  maintenance_type: string;
  description: string;
  data_origin: string;
  status?: string | null;
  related_inspection_id?: number | null;
  status_history: { revision: number; status: string; notes: string; recorded_at: string }[];
}

export const demoLabel = "DEMO DATA — NOT REAL DRONE MEASUREMENTS";
