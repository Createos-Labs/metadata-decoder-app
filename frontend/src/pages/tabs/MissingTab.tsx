import { useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { api } from "../../lib/api";
import type { Results, Row, ScanDetail } from "../../lib/types";
import { Button, ConfirmDialog, Input } from "../../components/ui";
import { DataTable, EditHead, Td, Th } from "../../components/Table";

function rowKey(r: Row): string {
  return `${r["Excel Row"]}|${r.Column}`;
}

export function MissingTab({
  scanId,
  results,
  onApplied,
  notify,
}: {
  scanId: string;
  results: Results;
  onApplied: (d: ScanDetail) => void;
  notify: (msg: string, tone?: "ok" | "error") => void;
}) {
  const cells = results.missingCells;
  const initial = useMemo(
    () => Object.fromEntries(cells.map((c) => [rowKey(c), String(c["Fill Value"] ?? "")])),
    [cells]
  );
  const [values, setValues] = useState<Record<string, string>>(() => ({ ...initial }));
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [colFilter, setColFilter] = useState<string | null>(null);

  const colCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const c of cells) {
      const col = String(c.Column ?? "");
      counts[col] = (counts[col] ?? 0) + 1;
    }
    return counts;
  }, [cells]);

  const sortedCols = useMemo(
    () => Object.entries(colCounts).sort((a, b) => b[1] - a[1]).map(([col]) => col),
    [colCounts]
  );

  const visibleCells = colFilter ? cells.filter(c => String(c.Column ?? "") === colFilter) : cells;

  const fillCount = useMemo(
    () => cells.filter((c) => (values[rowKey(c)] ?? "").trim()).length,
    [cells, values]
  );

  const apply = useMutation({
    mutationFn: () => {
      const payload = cells.map((c) => ({
        excel_row: Number(c["Excel Row"]),
        column: String(c.Column ?? ""),
        title: String(c["Track Title"] ?? ""),
        artist: String(c["Track Display Artist"] ?? ""),
        suggested: String(c["Suggested Fill"] ?? ""),
        fill_value: values[rowKey(c)] ?? "",
        source: String(c["Suggestion source"] ?? ""),
      }));
      return api.applyMissing(scanId, payload);
    },
    onSuccess: (d) => {
      onApplied(d);
      const a = (d as ScanDetail & { applied?: { fills: number } }).applied;
      notify(`Filled ${a?.fills ?? 0} cell(s).`);
    },
    onError: (e: Error) => {
      setConfirmOpen(false);
      notify(e.message, "error");
    },
  });

  if (cells.length === 0) {
    return <p className="py-8 text-center text-sm text-muted">No missing required fields.</p>;
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">
        One row per blank required cell. <span className="font-medium">Fill value</span> is
        pre-filled where the scanner can infer it confidently — confirm or override, clear to skip.
      </p>
      {/* Column filter pills */}
      {sortedCols.length > 1 && (
        <div className="flex flex-wrap gap-1">
          {colFilter && (
            <button
              onClick={() => setColFilter(null)}
              className="rounded-full bg-navy/10 px-3 py-1 text-xs font-medium text-navy hover:bg-navy/20"
            >
              ✕ show all columns
            </button>
          )}
          {sortedCols.map(col => (
            <button
              key={col}
              onClick={() => setColFilter(f => f === col ? null : col)}
              className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                colFilter === col
                  ? "bg-navy text-white"
                  : "bg-slate-100 text-muted hover:bg-slate-200"
              }`}
            >
              {col}
              <span className={`ml-1 ${colFilter === col ? "text-blue-200" : "text-slate-400"}`}>
                {colCounts[col]}
              </span>
            </button>
          ))}
        </div>
      )}

      <DataTable
        scroll
        head={
          <>
            <Th>Row</Th>
            <Th>Column</Th>
            <Th>Track</Th>
            <Th>Reason</Th>
            <EditHead>Fill value</EditHead>
            <Th>Source</Th>
          </>
        }
      >
        {visibleCells.map((c: Row) => {
          const k = rowKey(c);
          return (
            <tr key={k} className="hover:bg-slate-50">
              <Td className="text-xs text-muted">{String(c["Excel Row"] ?? "")}</Td>
              <Td className="text-xs font-medium">{String(c.Column ?? "")}</Td>
              <Td className="max-w-[14rem] truncate text-xs">{String(c["Track Title"] ?? "")}</Td>
              <Td className="text-xs text-muted">{String(c["Reason for missing"] ?? "")}</Td>
              <Td className="w-56">
                <Input
                  value={values[k] ?? ""}
                  changed={(values[k] ?? "") !== (initial[k] ?? "")}
                  placeholder="—"
                  onChange={(e) => setValues((p) => ({ ...p, [k]: e.target.value }))}
                />
              </Td>
              <Td className="max-w-[16rem] truncate text-[11px] text-slate-400">
                {String(c["Suggestion source"] ?? "")}
              </Td>
            </tr>
          );
        })}
      </DataTable>
      <div className="flex justify-end">
        <Button onClick={() => setConfirmOpen(true)} disabled={apply.isPending}>
          Apply fills
        </Button>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        title="Fill missing fields?"
        pending={apply.isPending}
        confirmLabel="Apply fills"
        onCancel={() => setConfirmOpen(false)}
        onConfirm={() => apply.mutate()}
        message={
          <>
            <span className="font-medium text-ink">{fillCount}</span> cell(s) will be filled with
            the values shown. Empty rows are skipped.
          </>
        }
      />
    </div>
  );
}
