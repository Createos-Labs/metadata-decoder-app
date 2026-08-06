import { useCallback, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../lib/api";
import type { MAFinding, MAScan, MASeverity } from "../../lib/types";
import { Button, Card, Spinner, Toast } from "../../components/ui";

// ---------------------------------------------------------------------------
// Stage 2 — Mapping Template
// ---------------------------------------------------------------------------

const DETECTED_TYPES: Record<string, { label: string; required: boolean; hint: string }> = {
  catalog:        { label: "Products / Tracks catalog",           required: true,  hint: "e.g. Products_Tracks_20260603.xlsx" },
  isrc_links:     { label: "Contracts w/ Albums & Tracks",        required: true,  hint: "e.g. Artist_Contracts_wAlbumsTracks.xls" },
  contract_terms: { label: "Contracts Terms",                     required: false, hint: "e.g. Artist_Contracts_Terms.xlsx" },
  payees:         { label: "Payees",                              required: false, hint: "e.g. Artist_Payees.xls" },
  statement_zip:  { label: "Statement files",                     required: false, hint: "ZIP files containing Sales CSVs or Statement XLSXs" },
  unknown:        { label: "Unrecognised",                        required: false, hint: "" },
};

function detectType(filename: string): string {
  const n = filename.toLowerCase();
  if (n.endsWith(".zip")) return "statement_zip";
  if (n.includes("walbum") || n.includes("w_album")) return "isrc_links";
  if (n.includes("terms") && n.includes("contract")) return "contract_terms";
  if (n.includes("payee")) return "payees";
  if (n.includes("product") || (n.includes("track") && !n.includes("contract"))) return "catalog";
  return "unknown";
}

function MappingStage({ acqId, acqName }: { acqId: string; acqName: string }) {
  const [files, setFiles] = useState<File[]>([]);
  const [dragging, setDragging] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  function addFiles(incoming: FileList | null) {
    if (!incoming) return;
    setFiles(prev => {
      const existing = new Set(prev.map(f => f.name));
      const newOnes = Array.from(incoming).filter(f => !existing.has(f.name));
      return [...prev, ...newOnes];
    });
    setDone(false);
    setError("");
  }

  function removeFile(name: string) {
    setFiles(prev => prev.filter(f => f.name !== name));
    setDone(false);
  }

  const grouped = files.reduce<Record<string, File[]>>((acc, f) => {
    const t = detectType(f.name);
    acc[t] = [...(acc[t] ?? []), f];
    return acc;
  }, {});

  const hasRequired = grouped["catalog"]?.length > 0 && grouped["isrc_links"]?.length > 0;

  async function handleGenerate() {
    setLoading(true);
    setError("");
    try {
      await api.generateMapping(acqId, files, acqName);
      setDone(true);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Generation failed.");
    } finally {
      setLoading(false);
    }
  }

  async function handleBlankTemplate() {
    try {
      await api.downloadBlankTemplate();
    } catch {
      setError("Failed to download blank template.");
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm text-muted">
            Drop your seller's export files below. The tool auto-detects each file type from
            the filename, joins them, and generates a colour-coded ISRC × rate mapping XLSX
            ready to review and push into Label Engine.
          </p>
          <p className="mt-1 text-xs text-muted">
            Required: <span className="font-medium text-ink">Products/Tracks catalog</span> +{" "}
            <span className="font-medium text-ink">Contracts w/Albums & Tracks</span>.
            All other files are optional but enrich the output.
          </p>
        </div>
        <button
          onClick={handleBlankTemplate}
          className="shrink-0 text-xs font-medium text-navy underline-offset-2 hover:underline"
        >
          Download blank template
        </button>
      </div>

      {/* Drop zone */}
      <div
        onDragOver={e => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={e => { e.preventDefault(); setDragging(false); addFiles(e.dataTransfer.files); }}
        onClick={() => inputRef.current?.click()}
        className={`cursor-pointer rounded-lg border-2 border-dashed px-6 py-6 text-center transition-colors ${
          dragging ? "border-navy bg-navy/5" : "border-slate-300 hover:border-navy/50"
        }`}
      >
        <input
          ref={inputRef}
          type="file"
          multiple
          accept=".xlsx,.xls,.csv,.zip"
          className="hidden"
          onChange={e => addFiles(e.target.files)}
        />
        <p className="text-sm font-medium text-ink">
          Drop all your export files here or click to select
        </p>
        <p className="mt-1 text-xs text-muted">
          Accepts .xlsx, .xls, .csv, .zip — add as many files as you have
        </p>
      </div>

      {/* File list grouped by detected type */}
      {files.length > 0 && (
        <Card className="overflow-hidden p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50">
                <th className="px-4 py-2 text-left text-xs font-medium text-muted">File</th>
                <th className="px-4 py-2 text-left text-xs font-medium text-muted">Detected type</th>
                <th className="px-4 py-2 text-left text-xs font-medium text-muted">Required?</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {files.map(f => {
                const t = detectType(f.name);
                const info = DETECTED_TYPES[t] ?? DETECTED_TYPES["unknown"];
                return (
                  <tr key={f.name} className="hover:bg-slate-50">
                    <td className="px-4 py-2 font-mono text-xs text-ink">{f.name}</td>
                    <td className="px-4 py-2">
                      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                        t === "unknown"
                          ? "bg-slate-100 text-slate-500"
                          : "bg-emerald-50 text-emerald-700"
                      }`}>
                        {info.label}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-xs text-muted">
                      {info.required ? (
                        <span className="font-medium text-rose-600">Required</span>
                      ) : (
                        <span className="text-slate-400">Optional</span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-right">
                      <button
                        onClick={e => { e.stopPropagation(); removeFile(f.name); }}
                        className="text-xs text-muted hover:text-red-600"
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}

      {/* Required files checklist */}
      {files.length > 0 && (
        <div className="flex gap-4 text-xs">
          {["catalog", "isrc_links"].map(t => (
            <span key={t} className={`flex items-center gap-1 ${grouped[t]?.length > 0 ? "text-emerald-700" : "text-rose-600"}`}>
              {grouped[t]?.length > 0 ? "✓" : "✗"} {DETECTED_TYPES[t].label}
            </span>
          ))}
        </div>
      )}

      {error && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>
      )}

      {done && (
        <p className="rounded-md bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
          Mapping template downloaded successfully.
        </p>
      )}

      <div className="flex gap-2">
        <Button
          onClick={handleGenerate}
          disabled={!hasRequired || loading || files.length === 0}
        >
          {loading ? (
            <span className="flex items-center gap-2">
              <Spinner className="h-4 w-4" /> Generating…
            </span>
          ) : (
            "Generate mapping template"
          )}
        </Button>
        {files.length > 0 && (
          <Button variant="secondary" onClick={() => { setFiles([]); setDone(false); setError(""); }}>
            Clear files
          </Button>
        )}
      </div>
    </div>
  );
}

const SEVERITIES: MASeverity[] = ["BLOCKER", "HIGH", "MEDIUM", "LOW", "INFO"];

const SEV_COLORS: Record<string, string> = {
  BLOCKER: "bg-red-900 text-white",
  HIGH:    "bg-red-500 text-white",
  MEDIUM:  "bg-amber-400 text-black",
  LOW:     "bg-yellow-200 text-black",
  INFO:    "bg-blue-200 text-black",
};

const SEV_HINT_COLORS: Record<string, string> = {
  BLOCKER: "border-red-200 bg-red-50",
  HIGH:    "border-orange-200 bg-orange-50",
  MEDIUM:  "border-amber-200 bg-amber-50",
  LOW:     "border-yellow-100 bg-yellow-50",
  INFO:    "border-blue-100 bg-blue-50",
};

// ---- Upload dropzone -------------------------------------------------------

function UploadZone({ acqId, onUploaded }: { acqId: string; onUploaded: () => void }) {
  const [dragging, setDragging] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleFile(file: File) {
    const name = file.name.toLowerCase();
    if (!name.endsWith(".xlsx") && !name.endsWith(".csv")) {
      setError("Please upload an .xlsx or .csv file.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      await api.uploadMAScan(acqId, file);
      onUploaded();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      onDragOver={e => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={e => {
        e.preventDefault();
        setDragging(false);
        const f = e.dataTransfer.files[0];
        if (f) handleFile(f);
      }}
      onClick={() => inputRef.current?.click()}
      className={`cursor-pointer rounded-lg border-2 border-dashed px-6 py-8 text-center transition-colors ${
        dragging ? "border-navy bg-navy/5" : "border-slate-300 hover:border-navy/50"
      }`}
    >
      <input
        ref={inputRef}
        type="file"
        accept=".xlsx,.csv"
        className="hidden"
        onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
      />
      {loading ? (
        <div className="flex items-center justify-center gap-2">
          <Spinner className="h-4 w-4" />
          <span className="text-sm text-muted">Scanning…</span>
        </div>
      ) : (
        <>
          <p className="text-sm font-medium text-ink">Drop an .xlsx or .csv file here or click to upload</p>
          <p className="mt-1 text-xs text-muted">All sheets will be scanned automatically</p>
        </>
      )}
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
    </div>
  );
}

// ---- Finding row -----------------------------------------------------------

function FindingRow({
  finding,
  onChange,
}: {
  finding: MAFinding;
  onChange: (id: string, severity: MASeverity | null, dismissed: boolean) => void;
}) {
  const hintStyle = SEV_HINT_COLORS[finding._severity_hint] ?? "border-slate-200 bg-white";

  return (
    <div className={`rounded-lg border px-4 py-3 ${finding.dismissed ? "opacity-40" : hintStyle}`}>
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-muted">{finding.sheet}</span>
            <span className="text-xs text-slate-300">›</span>
            <span className="text-xs font-semibold text-ink">{finding.field}</span>
          </div>
          <p className="mt-0.5 text-sm font-medium text-ink">{finding.finding}</p>
          <p className="mt-1 text-xs text-muted">{finding.why_it_matters}</p>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {/* Severity selector */}
          <select
            value={finding.severity ?? ""}
            disabled={finding.dismissed}
            onChange={e => onChange(
              finding.id,
              (e.target.value as MASeverity) || null,
              finding.dismissed,
            )}
            className="rounded border border-slate-300 px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-navy/40 disabled:opacity-40"
          >
            <option value="">— assign severity —</option>
            {SEVERITIES.map(s => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>

          {/* Severity badge (shown when assigned) */}
          {finding.severity && !finding.dismissed && (
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${SEV_COLORS[finding.severity]}`}>
              {finding.severity}
            </span>
          )}

          {/* Dismiss toggle */}
          <button
            onClick={() => onChange(finding.id, finding.severity, !finding.dismissed)}
            className={`text-xs ${finding.dismissed ? "text-navy font-medium" : "text-muted hover:text-red-600"}`}
            title={finding.dismissed ? "Restore finding" : "Dismiss (not relevant)"}
          >
            {finding.dismissed ? "Restore" : "Dismiss"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---- Scan section ----------------------------------------------------------

function ScanSection({
  scan,
  onDeleted,
}: {
  scan: MAScan;
  onDeleted: () => void;
}) {
  const qc = useQueryClient();
  const [expanded, setExpanded] = useState(true);
  const [localFindings, setLocalFindings] = useState<MAFinding[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [filter, setFilter] = useState<"all" | "unreviewed" | "reviewed" | "dismissed">("all");
  const [fieldFilter, setFieldFilter] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["ma-scan", scan.id],
    queryFn: () => api.getMAScan(scan.id),
  });

  const findings: MAFinding[] = localFindings ?? data?.findings ?? [];

  const handleChange = useCallback((id: string, severity: MASeverity | null, dismissed: boolean) => {
    setLocalFindings(prev => {
      const base = prev ?? data?.findings ?? [];
      return base.map(f => f.id === id ? { ...f, severity, dismissed } : f);
    });
  }, [data?.findings]);

  async function handleSave() {
    if (!localFindings) return;
    setSaving(true);
    try {
      const updates = localFindings.map(f => ({ id: f.id, severity: f.severity, dismissed: f.dismissed }));
      await api.reviewFindings(scan.id, updates);
      qc.invalidateQueries({ queryKey: ["ma-scan", scan.id] });
      qc.invalidateQueries({ queryKey: ["ma-acquisition"] });
      setLocalFindings(null);
    } finally {
      setSaving(false);
    }
  }

  // Build field counts across all findings (not affected by current filters)
  const fieldCounts = findings.reduce<Record<string, number>>((acc, f) => {
    acc[f.field] = (acc[f.field] ?? 0) + 1;
    return acc;
  }, {});
  const sortedFields = Object.entries(fieldCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([field]) => field);

  const filtered = findings.filter(f => {
    if (filter === "unreviewed") { if (f.dismissed || f.severity) return false; }
    else if (filter === "reviewed")  { if (f.dismissed || !f.severity) return false; }
    else if (filter === "dismissed") { if (!f.dismissed) return false; }
    if (fieldFilter && f.field !== fieldFilter) return false;
    return true;
  });

  const unreviewedCount = findings.filter(f => !f.dismissed && !f.severity).length;
  const hasUnsaved = localFindings !== null;

  return (
    <div className="rounded-lg border border-slate-200">
      {/* Header */}
      <div
        className="flex cursor-pointer items-center justify-between px-4 py-3"
        onClick={() => setExpanded(v => !v)}
      >
        <div className="flex items-center gap-3">
          <span className="text-sm font-semibold text-ink">{scan.filename}</span>
          <span className="text-xs text-muted">{scan.sheets_scanned.length} sheets</span>
          {unreviewedCount > 0 && (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700">
              {unreviewedCount} unreviewed
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          {hasUnsaved && (
            <Button
              variant="secondary"
              onClick={e => { e.stopPropagation(); handleSave(); }}
              disabled={saving}
            >
              {saving ? "Saving…" : "Save review"}
            </Button>
          )}
          <button
            onClick={e => {
              e.stopPropagation();
              if (confirm(`Remove "${scan.filename}" from this acquisition?`)) onDeleted();
            }}
            className="text-xs text-muted hover:text-red-600"
          >
            Remove
          </button>
          <span className="text-muted">{expanded ? "▲" : "▼"}</span>
        </div>
      </div>

      {expanded && (
        <div className="border-t border-slate-100 px-4 py-4">
          {isLoading ? (
            <div className="flex justify-center py-6"><Spinner className="h-5 w-5" /></div>
          ) : findings.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted">No findings — this file looks clean.</p>
          ) : (
            <>
              {/* Status filter tabs */}
              <div className="mb-2 flex flex-wrap gap-1">
                {(["all", "unreviewed", "reviewed", "dismissed"] as const).map(f => (
                  <button
                    key={f}
                    onClick={() => setFilter(f)}
                    className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                      filter === f
                        ? "bg-navy text-white"
                        : "bg-slate-100 text-muted hover:bg-slate-200"
                    }`}
                  >
                    {f.charAt(0).toUpperCase() + f.slice(1)}
                    {f === "all" && ` (${findings.length})`}
                    {f === "unreviewed" && unreviewedCount > 0 && ` (${unreviewedCount})`}
                  </button>
                ))}
              </div>

              {/* Field filter pills */}
              {sortedFields.length > 1 && (
                <div className="mb-3 flex flex-wrap gap-1">
                  {fieldFilter && (
                    <button
                      onClick={() => setFieldFilter(null)}
                      className="rounded-full bg-navy/10 px-3 py-1 text-xs font-medium text-navy hover:bg-navy/20"
                    >
                      ✕ clear field filter
                    </button>
                  )}
                  {sortedFields.map(field => (
                    <button
                      key={field}
                      onClick={() => setFieldFilter(f => f === field ? null : field)}
                      className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                        fieldFilter === field
                          ? "bg-rose-600 text-white"
                          : "bg-slate-100 text-muted hover:bg-slate-200"
                      }`}
                    >
                      {field}
                      <span className={`ml-1 ${fieldFilter === field ? "text-rose-200" : "text-slate-400"}`}>
                        {fieldCounts[field]}
                      </span>
                    </button>
                  ))}
                </div>
              )}

              <div className="space-y-2">
                {filtered.map(f => (
                  <FindingRow key={f.id} finding={f} onChange={handleChange} />
                ))}
                {filtered.length === 0 && (
                  <p className="py-4 text-center text-xs text-muted">No findings in this filter.</p>
                )}
              </div>

              {hasUnsaved && (
                <div className="mt-4 flex justify-end">
                  <Button onClick={handleSave} disabled={saving}>
                    {saving ? "Saving…" : "Save review"}
                  </Button>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ---- Main page -------------------------------------------------------------

export function MADetailPage() {
  const { id = "" } = useParams();
  const qc = useQueryClient();
  const [toast, setToast] = useState<{ msg: string; tone: "ok" | "error" } | null>(null);
  const [editingStatus, setEditingStatus] = useState(false);
  const [stage, setStage] = useState<"audit" | "mapping">("audit");

  const { data, isLoading, isError } = useQuery({
    queryKey: ["ma-acquisition", id],
    queryFn: () => api.getAcquisition(id),
  });

  const updateMutation = useMutation({
    mutationFn: (fields: Parameters<typeof api.updateAcquisition>[1]) =>
      api.updateAcquisition(id, fields),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ma-acquisition", id] });
      setEditingStatus(false);
    },
  });

  const deleteScanMutation = useMutation({
    mutationFn: (scanId: string) => api.deleteMAScan(id, scanId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["ma-acquisition", id] }),
  });

  async function handleDownloadReport() {
    try {
      await api.downloadMAReport(id, data?.acquisition.name ?? "Acquisition");
    } catch {
      setToast({ msg: "Report generation failed.", tone: "error" });
    }
  }

  if (isLoading) {
    return <div className="grid place-items-center py-20"><Spinner className="h-6 w-6" /></div>;
  }
  if (isError || !data) {
    return (
      <Card className="p-8 text-center">
        <p className="text-sm text-red-600">Acquisition not found.</p>
        <Link to="/ma" className="mt-3 inline-block text-sm font-medium text-navy">← Back to M&A Audit</Link>
      </Card>
    );
  }

  const { acquisition, scans } = data;
  const STATUS_OPTIONS = ["Active", "On Hold", "Closed", "Passed"] as const;

  const totalFindings = scans.reduce((s, sc) => s + sc.total_findings, 0);
  const totalReviewed = scans.reduce((s, sc) => s + sc.reviewed_count, 0);
  const totalDismissed = scans.reduce((s, sc) => s + sc.dismissed_count, 0);

  return (
    <div className="space-y-6">
      <div>
        <Link to="/ma" className="text-sm font-medium text-muted hover:text-navy">
          ← M&A Audit
        </Link>
      </div>

      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-ink">{acquisition.name}</h1>
          {acquisition.company && (
            <p className="mt-0.5 text-sm text-muted">{acquisition.company}</p>
          )}
          <div className="mt-2 flex items-center gap-2">
            {editingStatus ? (
              <select
                defaultValue={acquisition.status}
                onChange={e => updateMutation.mutate({ status: e.target.value as typeof acquisition.status })}
                onBlur={() => setEditingStatus(false)}
                autoFocus
                className="rounded border border-slate-300 px-2 py-1 text-xs"
              >
                {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            ) : (
              <button
                onClick={() => setEditingStatus(true)}
                className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600 hover:bg-slate-200"
              >
                {acquisition.status} ▾
              </button>
            )}
            <span className="text-xs text-muted">
              {scans.length} {scans.length === 1 ? "file" : "files"} ·{" "}
              {totalFindings} findings · {totalReviewed} reviewed · {totalDismissed} dismissed
            </span>
          </div>
        </div>
        <Button onClick={handleDownloadReport} disabled={totalReviewed === 0}>
          Generate report
        </Button>
      </div>

      {/* Stage tabs */}
      <div className="flex gap-1 border-b border-slate-200 pb-0">
        {(["audit", "mapping"] as const).map(s => (
          <button
            key={s}
            onClick={() => setStage(s)}
            className={`rounded-t-md px-4 py-2 text-sm font-medium transition-colors ${
              stage === s
                ? "border border-b-white border-slate-200 bg-white text-navy -mb-px"
                : "text-muted hover:text-ink"
            }`}
          >
            {s === "audit" ? "Stage 1 — Data Gap Audit" : "Stage 2 — Mapping Template"}
          </button>
        ))}
      </div>

      {stage === "audit" ? (
        <>
          {totalReviewed === 0 && scans.length > 0 && (
            <p className="text-xs text-amber-700 bg-amber-50 rounded px-3 py-2 inline-block">
              Review and assign severities to at least one finding before generating the report.
            </p>
          )}

          <UploadZone
            acqId={id}
            onUploaded={() => qc.invalidateQueries({ queryKey: ["ma-acquisition", id] })}
          />

          {scans.length === 0 ? (
            <Card className="p-8 text-center">
              <p className="text-sm text-muted">No files uploaded yet. Drop your first file above.</p>
            </Card>
          ) : (
            <div className="space-y-4">
              {scans.map(scan => (
                <ScanSection
                  key={scan.id}
                  scan={scan}
                  onDeleted={() => deleteScanMutation.mutate(scan.id)}
                />
              ))}
            </div>
          )}
        </>
      ) : (
        <MappingStage acqId={id} acqName={acquisition.name} />
      )}

      {toast && <Toast message={toast.msg} tone={toast.tone} />}
    </div>
  );
}
