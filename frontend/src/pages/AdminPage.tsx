import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { Button, Card, Spinner } from "../components/ui";

export function AdminPage() {
  const qc = useQueryClient();
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["ma-access"],
    queryFn: api.listMaAccess,
  });

  const grantMutation = useMutation({
    mutationFn: (e: string) => api.grantMaAccess(e),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ma-access"] });
      setEmail("");
      setError("");
    },
    onError: (e: Error) => setError(e.message),
  });

  const revokeMutation = useMutation({
    mutationFn: (e: string) => api.revokeMaAccess(e),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["ma-access"] }),
    onError: (e: Error) => setError(e.message),
  });

  function handleGrant(ev: React.FormEvent) {
    ev.preventDefault();
    const trimmed = email.trim().toLowerCase();
    if (!trimmed || !trimmed.includes("@")) {
      setError("Enter a valid email address.");
      return;
    }
    grantMutation.mutate(trimmed);
  }

  const emails = data?.emails ?? [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-ink">Admin</h1>
        <p className="mt-0.5 text-sm text-muted">Manage who can access the M&A Audit area.</p>
      </div>

      <Card className="p-6">
        <h2 className="text-sm font-semibold text-ink">M&A Audit access</h2>
        <p className="mt-1 text-xs text-muted">
          Users below can view and use the M&A Audit section. Everyone else only sees LE Ingestion.
        </p>

        <form onSubmit={handleGrant} className="mt-4 flex gap-2">
          <input
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder="name@createmusicgroup.com"
            className="flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-navy/40"
          />
          <Button type="submit" disabled={grantMutation.isPending}>
            {grantMutation.isPending ? "Granting…" : "Grant access"}
          </Button>
        </form>
        {error && <p className="mt-2 text-xs text-red-600">{error}</p>}

        <div className="mt-5">
          {isLoading ? (
            <div className="flex justify-center py-6"><Spinner className="h-5 w-5" /></div>
          ) : emails.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted">No users have M&A access yet.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left">
                  <th className="pb-2 font-medium text-muted">Email</th>
                  <th className="pb-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {emails.map(e => (
                  <tr key={e}>
                    <td className="py-2.5 text-ink">{e}</td>
                    <td className="py-2.5 text-right">
                      <button
                        onClick={() => {
                          if (confirm(`Revoke M&A access for ${e}?`)) {
                            revokeMutation.mutate(e);
                          }
                        }}
                        className="text-xs text-muted hover:text-red-600"
                      >
                        Revoke
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </Card>
    </div>
  );
}
