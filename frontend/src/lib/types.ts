export type Row = Record<string, unknown>;

export interface Counts {
  artistTypos: number;
  isrcConflicts: number;
  isrcConflictGroups: number;
  missingFields: number;
  formatIssues: number;
  splitErrors: number;
  idMismatches: number;
  splitsIssues: number;
  total: number;
}

export interface Scan {
  id: string;
  filename: string;
  created_at: string;
  updated_at: string;
  uploaded_by: string;
  tracks_sheet: string;
  sheets_scanned: string[];
  detected_format: string;
  detection_low_confidence: boolean;
  other_sheets: string[];
  is_rescan: boolean;
  status: string;
  counts: Counts;
  keys: Record<string, string>;
}

export interface Results {
  stats: Row;
  issues: Row[];
  artistClusters: Row[];
  isrcConflicts: Row[];
  missingSummary: Row[];
  missingCells: Row[];
  formatColumns: Row[];
  formatRows: Row[];
  formatCorrections: Row[];
  splitsReview: Row[];
  splitErrors: Row[];
  idMismatches: Row[];
  detectedFormat: string;
}

export interface ScanDetail {
  scan: Scan;
  results: Results;
}

// ---- M&A Audit types -------------------------------------------------------

export type MASeverity = "BLOCKER" | "HIGH" | "MEDIUM" | "LOW" | "INFO";

export interface MAFinding {
  id: string;
  sheet: string;
  field: string;
  check_type: string;
  title: string;
  finding: string;
  why_it_matters: string;
  detail: Record<string, unknown>;
  severity: MASeverity | null;
  dismissed: boolean;
  _severity_hint: MASeverity;
}

export interface MAScan {
  id: string;
  acquisition_id: string;
  filename: string;
  created_at: string;
  updated_at: string;
  uploaded_by: string;
  sheets_scanned: string[];
  total_findings: number;
  reviewed_count: number;
  dismissed_count: number;
  sheet_stats: Record<string, { rows: number; columns: string[]; findings: number }>;
}

export interface MAAcquisition {
  id: string;
  name: string;
  company: string;
  status: "Active" | "On Hold" | "Closed" | "Passed";
  created_at: string;
  updated_at: string;
  created_by: string;
  scan_ids: string[];
}

export interface AppConfig {
  authEnabled: boolean;
  oauthClientId: string;
  allowedDomain: string;
}

export interface AppUser {
  email: string;
  name: string;
  picture: string;
}
