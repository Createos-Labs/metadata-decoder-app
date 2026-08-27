"""
Metadata + decision persistence — PostgREST (PostgreSQL).

Tables: scans, leave_artist, leave_isrc, ma_acquisitions, ma_scans, ma_access

The PostgREST token is obtained per-request by auth.py (via the Management UI
token exchange endpoint) and stored in a ContextVar. No JWT_SECRET needed here.
"""
from __future__ import annotations

import requests

from .config import get_settings


def _get_url() -> str:
    return get_settings().postgrest_url.rstrip("/")


def _headers() -> dict:
    from .auth import get_postgrest_token

    token = get_postgrest_token()
    if not token:
        raise RuntimeError(
            "No PostgREST token in context — was require_user called for this request?"
        )
    return {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
        "Prefer": "return=representation",
    }


def _get(path: str, params: dict | None = None) -> list[dict]:
    r = requests.get(f"{_get_url()}/{path}", headers=_headers(), params=params, timeout=15)
    r.raise_for_status()
    return r.json()


def _post(path: str, data: dict) -> dict:
    r = requests.post(f"{_get_url()}/{path}", headers=_headers(), json=data, timeout=15)
    r.raise_for_status()
    rows = r.json()
    return rows[0] if isinstance(rows, list) and rows else data


def _patch(path: str, params: dict, data: dict) -> None:
    h = {**_headers(), "Prefer": ""}
    r = requests.patch(f"{_get_url()}/{path}", headers=h, params=params, json=data, timeout=15)
    r.raise_for_status()


def _delete(path: str, params: dict) -> None:
    h = {**_headers(), "Prefer": ""}
    r = requests.delete(f"{_get_url()}/{path}", headers=h, params=params, timeout=15)
    r.raise_for_status()


class Database:
    # ---- Scans ---------------------------------------------------------------

    def create_scan(self, scan: dict) -> None:
        _post("scans", scan)

    def get_scan(self, scan_id: str) -> dict | None:
        rows = _get("scans", {"id": f"eq.{scan_id}"})
        return rows[0] if rows else None

    def list_scans(self) -> list[dict]:
        return _get("scans", {"order": "created_at.desc"})

    def update_scan(self, scan_id: str, fields: dict) -> None:
        _patch("scans", {"id": f"eq.{scan_id}"}, fields)

    def delete_scan(self, scan_id: str) -> bool:
        if not self.get_scan(scan_id):
            return False
        _delete("scans", {"id": f"eq.{scan_id}"})
        return True

    # ---- LEAVE ---------------------------------------------------------------

    def list_leave(self, kind: str) -> list[dict]:
        rows = _get(kind)
        return [r["data"] for r in rows]

    def add_leave(self, kind: str, records: list[dict]) -> int:
        for rec in records:
            _post(kind, {"data": rec})
        return len(records)

    # ---- M&A Acquisitions ----------------------------------------------------

    def create_acquisition(self, acq: dict) -> None:
        _post("ma_acquisitions", acq)

    def get_acquisition(self, acq_id: str) -> dict | None:
        rows = _get("ma_acquisitions", {"id": f"eq.{acq_id}"})
        return rows[0] if rows else None

    def list_acquisitions(self) -> list[dict]:
        return _get("ma_acquisitions", {"order": "created_at.desc"})

    def update_acquisition(self, acq_id: str, fields: dict) -> None:
        _patch("ma_acquisitions", {"id": f"eq.{acq_id}"}, fields)

    def delete_acquisition(self, acq_id: str) -> bool:
        if not self.get_acquisition(acq_id):
            return False
        _delete("ma_acquisitions", {"id": f"eq.{acq_id}"})
        return True

    # ---- M&A Scans -----------------------------------------------------------

    def create_ma_scan(self, scan: dict) -> None:
        _post("ma_scans", scan)

    def get_ma_scan(self, scan_id: str) -> dict | None:
        rows = _get("ma_scans", {"id": f"eq.{scan_id}"})
        return rows[0] if rows else None

    def list_ma_scans_for_acquisition(self, acq_id: str) -> list[dict]:
        rows = _get("ma_scans", {"acquisition_id": f"eq.{acq_id}", "order": "created_at.asc"})
        return rows

    def update_ma_scan(self, scan_id: str, fields: dict) -> None:
        _patch("ma_scans", {"id": f"eq.{scan_id}"}, fields)

    def delete_ma_scan(self, scan_id: str) -> bool:
        if not self.get_ma_scan(scan_id):
            return False
        _delete("ma_scans", {"id": f"eq.{scan_id}"})
        return True

    # ---- M&A access control --------------------------------------------------

    def has_ma_access(self, email: str) -> bool:
        rows = _get("ma_access", {"email": f"eq.{email.lower()}"})
        return bool(rows)

    def list_ma_access(self) -> list[str]:
        rows = _get("ma_access")
        return [r["email"] for r in rows]

    def grant_ma_access(self, email: str) -> None:
        _post("ma_access", {"email": email.lower()})

    def revoke_ma_access(self, email: str) -> bool:
        if not self.has_ma_access(email):
            return False
        _delete("ma_access", {"email": f"eq.{email.lower()}"})
        return True


_db: Database | None = None


def get_db() -> Database:
    global _db
    if _db is None:
        _db = Database()
    return _db
