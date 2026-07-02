import { useCallback, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../lib/api";
import type { MAFinding, MAScan, MASeverity } from "../../lib/types";
import { Button, Card, Spinner, Toast } from "../../components/ui";

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
    if (!file.name.toLowerCase().endsWith(".xlsx")) {
      setError("Please upload an .xlsx file.");
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
        accept=".xlsx"
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
          <p className="text-sm font-medium text-ink">Drop an .xlsx file here or click to upload</p>
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

  const filtered = findings.filter(f => {
    if (filter === "unreviewed") return !f.dismissed && !f.severity;
    if (filter === "reviewed")   return !f.dismissed && !!f.severity;
    if (filter === "dismissed")  return f.dismissed;
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
              {/* Filter tabs */}
              <div className="mb-3 flex gap-1">
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

      {totalReviewed === 0 && scans.length > 0 && (
        <p className="text-xs text-amber-700 bg-amber-50 rounded px-3 py-2 inline-block">
          Review and assign severities to at least one finding before generating the report.
        </p>
      )}

      {/* Upload zone */}
      <UploadZone
        acqId={id}
        onUploaded={() => qc.invalidateQueries({ queryKey: ["ma-acquisition", id] })}
      />

      {/* Scan sections */}
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

      {toast && <Toast message={toast.msg} tone={toast.tone} />}
    </div>
  );
}
