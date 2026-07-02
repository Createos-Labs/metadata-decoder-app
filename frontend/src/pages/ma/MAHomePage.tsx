import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../../lib/api";
import type { MAAcquisition } from "../../lib/types";
import { Button, Card, Spinner } from "../../components/ui";

const STATUS_COLORS: Record<string, string> = {
  Active:    "bg-clean text-clean-ink",
  "On Hold": "bg-amber-100 text-amber-700",
  Closed:    "bg-slate-100 text-slate-600",
  Passed:    "bg-red-50 text-red-600",
};

function timeAgo(iso: string) {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function NewAcquisitionModal({ onClose, onCreated }: {
  onClose: () => void;
  onCreated: (acq: MAAcquisition) => void;
}) {
  const [name, setName] = useState("");
  const [company, setCompany] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) { setError("Acquisition name is required."); return; }
    setLoading(true);
    try {
      const acq = await api.createAcquisition(name.trim(), company.trim());
      onCreated(acq);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to create acquisition.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <Card className="w-full max-w-md p-6">
        <h2 className="text-base font-semibold text-ink">New Acquisition</h2>
        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-muted">Acquisition name *</label>
            <input
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-navy/40"
              placeholder="e.g. Glassnote — June 2026"
              value={name}
              onChange={e => setName(e.target.value)}
              autoFocus
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted">Company / target (optional)</label>
            <input
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-navy/40"
              placeholder="e.g. Glassnote Records"
              value={company}
              onChange={e => setCompany(e.target.value)}
            />
          </div>
          {error && <p className="text-xs text-red-600">{error}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" type="button" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={loading}>
              {loading ? "Creating…" : "Create acquisition"}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}

export function MAHomePage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [showModal, setShowModal] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["ma-acquisitions"],
    queryFn: api.listAcquisitions,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.deleteAcquisition(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["ma-acquisitions"] }),
  });

  function handleCreated(acq: MAAcquisition) {
    qc.invalidateQueries({ queryKey: ["ma-acquisitions"] });
    setShowModal(false);
    navigate(`/ma/${acq.id}`);
  }

  const acquisitions = data?.acquisitions ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-ink">M&A Audit</h1>
          <p className="mt-0.5 text-sm text-muted">
            Group files by acquisition and identify data gaps before integration.
          </p>
        </div>
        <Button onClick={() => setShowModal(true)}>+ New acquisition</Button>
      </div>

      {isLoading ? (
        <div className="grid place-items-center py-16">
          <Spinner className="h-6 w-6" />
        </div>
      ) : acquisitions.length === 0 ? (
        <Card className="p-12 text-center">
          <p className="text-sm font-medium text-ink">No acquisitions yet</p>
          <p className="mt-1 text-sm text-muted">
            Create an acquisition to start grouping and auditing files.
          </p>
          <div className="mt-4">
            <Button onClick={() => setShowModal(true)}>+ New acquisition</Button>
          </div>
        </Card>
      ) : (
        <Card className="overflow-hidden p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-left">
                <th className="px-4 py-3 font-medium text-muted">Acquisition</th>
                <th className="px-4 py-3 font-medium text-muted">Status</th>
                <th className="px-4 py-3 font-medium text-muted">Files</th>
                <th className="px-4 py-3 font-medium text-muted">Updated</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {acquisitions.map((acq) => (
                <tr key={acq.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <Link
                      to={`/ma/${acq.id}`}
                      className="font-medium text-navy hover:underline"
                    >
                      {acq.name}
                    </Link>
                    {acq.company && (
                      <div className="text-xs text-muted">{acq.company}</div>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_COLORS[acq.status] ?? "bg-slate-100 text-slate-600"}`}>
                      {acq.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-muted">
                    {acq.scan_ids.length} {acq.scan_ids.length === 1 ? "file" : "files"}
                  </td>
                  <td className="px-4 py-3 text-muted">{timeAgo(acq.updated_at)}</td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => {
                        if (confirm(`Delete "${acq.name}"? This cannot be undone.`)) {
                          deleteMutation.mutate(acq.id);
                        }
                      }}
                      className="text-xs text-muted hover:text-red-600"
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {showModal && (
        <NewAcquisitionModal
          onClose={() => setShowModal(false)}
          onCreated={handleCreated}
        />
      )}
    </div>
  );
}
