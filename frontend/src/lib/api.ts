import type { AppConfig, AppUser, MAAcquisition, MAFinding, MAScan, Scan, ScanDetail } from "./types";

// The auth layer injects the current Google ID token here so every request
// carries it. Kept module-level so non-React code (downloads) can read it too.
let authToken: string | null = null;
export function setAuthToken(token: string | null) {
  authToken = token;
}

class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const headers = new Headers(opts.headers);
  if (authToken) headers.set("Authorization", `Bearer ${authToken}`);
  const res = await fetch(path, { ...opts, headers });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      detail = body.detail ?? detail;
    } catch {
      /* non-JSON error */
    }
    throw new ApiError(res.status, detail);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  return request<T>(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export const api = {
  getConfig: () => request<AppConfig>("/api/config"),
  getMe: () => request<AppUser>("/api/me"),

  listScans: () => request<{ scans: Scan[] }>("/api/scans"),
  getScan: (id: string) => request<ScanDetail>(`/api/scans/${id}`),
  deleteScan: (id: string) => request<{ deleted: string }>(`/api/scans/${id}`, { method: "DELETE" }),

  createScan: (file: File) => {
    const form = new FormData();
    form.append("file", file);
    return request<ScanDetail>("/api/scans", { method: "POST", body: form });
  },

  applyArtist: (id: string, clusters: unknown[]) =>
    postJson<ScanDetail>(`/api/scans/${id}/corrections/artist`, { clusters }),
  applyIsrc: (id: string, rows: unknown[]) =>
    postJson<ScanDetail>(`/api/scans/${id}/corrections/isrc`, { rows }),
  applyMissing: (id: string, fills: unknown[]) =>
    postJson<ScanDetail>(`/api/scans/${id}/corrections/missing`, { fills }),
  applyFormat: (id: string, cell_corrections: unknown[], split_rows: unknown[]) =>
    postJson<ScanDetail>(`/api/scans/${id}/corrections/format`, { cell_corrections, split_rows }),

  // ---- M&A Audit ----------------------------------------------------------
  listAcquisitions: () =>
    request<{ acquisitions: MAAcquisition[] }>("/api/ma/acquisitions"),

  createAcquisition: (name: string, company: string) =>
    postJson<MAAcquisition>("/api/ma/acquisitions", { name, company }),

  getAcquisition: (id: string) =>
    request<{ acquisition: MAAcquisition; scans: MAScan[] }>(`/api/ma/acquisitions/${id}`),

  updateAcquisition: (id: string, fields: Partial<Pick<MAAcquisition, "name" | "company" | "status">>) =>
    request<MAAcquisition>(`/api/ma/acquisitions/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(fields),
    }),

  deleteAcquisition: (id: string) =>
    request<{ deleted: string }>(`/api/ma/acquisitions/${id}`, { method: "DELETE" }),

  uploadMAScan: (acqId: string, file: File) => {
    const form = new FormData();
    form.append("file", file);
    return request<{ scan: MAScan; findings: MAFinding[] }>(
      `/api/ma/acquisitions/${acqId}/scans`,
      { method: "POST", body: form },
    );
  },

  getMAScan: (scanId: string) =>
    request<{ scan: MAScan; findings: MAFinding[] }>(`/api/ma/scans/${scanId}`),

  reviewFindings: (scanId: string, updates: { id: string; severity?: string | null; dismissed?: boolean }[]) =>
    postJson<{ findings: MAFinding[] }>(`/api/ma/scans/${scanId}/findings`, { updates }),

  deleteMAScan: (acqId: string, scanId: string) =>
    request<{ deleted: string }>(`/api/ma/acquisitions/${acqId}/scans/${scanId}`, { method: "DELETE" }),

  // ---- Admin ------------------------------------------------------------------
  listMaAccess: () =>
    request<{ emails: string[] }>("/api/admin/ma-access"),

  grantMaAccess: (email: string) =>
    postJson<{ granted: string }>("/api/admin/ma-access", { email }),

  revokeMaAccess: (email: string) =>
    request<{ revoked: string }>(`/api/admin/ma-access/${encodeURIComponent(email)}`, { method: "DELETE" }),

  downloadBlankTemplate: async () => {
    const headers = new Headers();
    if (authToken) headers.set("Authorization", `Bearer ${authToken}`);
    const res = await fetch("/api/ma/mapping/blank-template", { headers });
    if (!res.ok) throw new ApiError(res.status, "Download failed");
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "MA Mapping Template - Blank.xlsx";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  },

  generateMapping: async (
    acqId: string,
    files: File[],
    acqName: string,
  ): Promise<{ isrc_count: number; row_count: number; artists_with_balance: number }> => {
    const headers = new Headers();
    if (authToken) headers.set("Authorization", `Bearer ${authToken}`);
    const form = new FormData();
    for (const f of files) form.append("files", f);
    const res = await fetch(`/api/ma/acquisitions/${acqId}/mapping`, {
      method: "POST",
      headers,
      body: form,
    });
    if (!res.ok) {
      let detail = res.statusText;
      try {
        const body = await res.json();
        detail = body.detail ?? detail;
      } catch { /* non-JSON */ }
      throw new ApiError(res.status, detail);
    }
    // Response is the XLSX blob — trigger download and return stats from headers
    const blob = await res.blob();
    const safe = acqName.replace(/[/\\]/g, "-").slice(0, 50);
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `MA Mapping Template - ${safe}.xlsx`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    // Stats aren't in headers for a streaming response — return placeholder
    return { isrc_count: 0, row_count: 0, artists_with_balance: 0 };
  },

  downloadMAReport: async (acqId: string, acqName: string) => {
    const headers = new Headers();
    if (authToken) headers.set("Authorization", `Bearer ${authToken}`);
    const res = await fetch(`/api/ma/acquisitions/${acqId}/report`, { method: "POST", headers });
    if (!res.ok) throw new ApiError(res.status, "Report generation failed");
    const blob = await res.blob();
    const safe = acqName.replace(/[/\\]/g, "-").slice(0, 50);
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${safe} — Data Gaps Report.xlsx`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  },
};

/** Fetch an output workbook with the auth header and trigger a browser download. */
export async function downloadFile(id: string, which: "issues" | "annotated" | "original") {
  const headers = new Headers();
  if (authToken) headers.set("Authorization", `Bearer ${authToken}`);
  const res = await fetch(`/api/scans/${id}/files/${which}`, { headers });
  if (!res.ok) throw new ApiError(res.status, "Download failed");
  const blob = await res.blob();
  const disposition = res.headers.get("Content-Disposition") || "";
  const match = disposition.match(/filename="(.+?)"/);
  const name = match ? match[1] : `${which}.xlsx`;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export { ApiError };
