"""API routes for M&A Audit — acquisitions, scans, finding review, report."""
from __future__ import annotations

import io

from fastapi import APIRouter, Depends, HTTPException, UploadFile, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from ..auth import User, require_user
from ..config import Settings, get_settings
from ..ma_service import get_ma_service

router = APIRouter(prefix="/api/ma", tags=["ma"])

XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


# ---- Request bodies --------------------------------------------------------

class CreateAcquisition(BaseModel):
    name: str
    company: str = ""


class UpdateAcquisition(BaseModel):
    name: str | None = None
    company: str | None = None
    status: str | None = None


class FindingUpdate(BaseModel):
    id: str
    severity: str | None = None
    dismissed: bool = False


class FindingsReview(BaseModel):
    updates: list[FindingUpdate]


# ---- Acquisitions ----------------------------------------------------------

@router.post("/acquisitions", status_code=status.HTTP_201_CREATED)
async def create_acquisition(
    body: CreateAcquisition,
    user: User = Depends(require_user),
) -> dict:
    return get_ma_service().create_acquisition(
        name=body.name, company=body.company, user_email=user.email
    )


@router.get("/acquisitions")
async def list_acquisitions(user: User = Depends(require_user)) -> dict:
    return {"acquisitions": get_ma_service().list_acquisitions()}


@router.get("/debug/acquisitions")
async def debug_acquisitions() -> dict:
    """Temp: diagnose get_acquisition returning None when document exists."""
    from ..db import get_db, MA_ACQUISITIONS
    db = get_db()
    # List all docs via stream
    stream_docs = list(db._fs.collection(MA_ACQUISITIONS).stream())
    results = []
    for d in stream_docs:
        acq_id = d.id
        stored = d.to_dict()
        # Now try the exact same call used in get_acquisition
        direct = db._fs.collection(MA_ACQUISITIONS).document(acq_id).get()
        results.append({
            "firestore_key": acq_id,
            "stored_id": stored.get("id"),
            "name": stored.get("name"),
            "direct_get_exists": direct.exists,
            "service_get_result": db.get_acquisition(acq_id) is not None,
        })
    return {"count": len(stream_docs), "docs": results}


@router.get("/acquisitions/{acq_id}")
async def get_acquisition(acq_id: str, user: User = Depends(require_user)) -> dict:
    svc = get_ma_service()
    acq = svc.get_acquisition(acq_id)
    if not acq:
        raise HTTPException(status_code=404, detail="Acquisition not found.")
    scans = svc.list_scans_for_acquisition(acq_id)
    return {"acquisition": acq, "scans": scans}


@router.patch("/acquisitions/{acq_id}")
async def update_acquisition(
    acq_id: str,
    body: UpdateAcquisition,
    user: User = Depends(require_user),
) -> dict:
    svc = get_ma_service()
    if not svc.get_acquisition(acq_id):
        raise HTTPException(status_code=404, detail="Acquisition not found.")
    updated = svc.update_acquisition(acq_id, body.model_dump(exclude_none=True))
    return updated or {}


@router.delete("/acquisitions/{acq_id}")
async def delete_acquisition(acq_id: str, user: User = Depends(require_user)) -> dict:
    if not get_ma_service().delete_acquisition(acq_id):
        raise HTTPException(status_code=404, detail="Acquisition not found.")
    return {"deleted": acq_id}


# ---- MA Scans --------------------------------------------------------------

@router.post("/acquisitions/{acq_id}/scans", status_code=status.HTTP_201_CREATED)
async def upload_ma_scan(
    acq_id: str,
    file: UploadFile,
    user: User = Depends(require_user),
    settings: Settings = Depends(get_settings),
) -> dict:
    name = file.filename or "file.xlsx"
    if not name.lower().endswith(".xlsx"):
        raise HTTPException(status_code=400, detail="Please upload an .xlsx file.")
    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="Uploaded file is empty.")
    if len(data) > settings.max_upload_bytes:
        raise HTTPException(status_code=413, detail="File is too large.")
    try:
        return get_ma_service().create_ma_scan(
            acq_id=acq_id, data=data, filename=name, user_email=user.email
        )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"Could not scan this file: {exc}")


@router.get("/scans/{scan_id}")
async def get_ma_scan(scan_id: str, user: User = Depends(require_user)) -> dict:
    svc = get_ma_service()
    scan = svc.get_ma_scan(scan_id)
    if not scan:
        raise HTTPException(status_code=404, detail="Scan not found.")
    findings = svc.get_findings(scan_id) or []
    return {"scan": scan, "findings": findings}


@router.patch("/scans/{scan_id}/findings")
async def review_findings(
    scan_id: str,
    body: FindingsReview,
    user: User = Depends(require_user),
) -> dict:
    svc = get_ma_service()
    if not svc.get_ma_scan(scan_id):
        raise HTTPException(status_code=404, detail="Scan not found.")
    findings = svc.update_findings(scan_id, [u.model_dump() for u in body.updates])
    return {"findings": findings}


@router.delete("/acquisitions/{acq_id}/scans/{scan_id}")
async def delete_ma_scan(
    acq_id: str, scan_id: str, user: User = Depends(require_user)
) -> dict:
    if not get_ma_service().delete_ma_scan(scan_id, acq_id):
        raise HTTPException(status_code=404, detail="Scan not found.")
    return {"deleted": scan_id}


# ---- Report generation -----------------------------------------------------

@router.post("/acquisitions/{acq_id}/report")
async def generate_report(acq_id: str, user: User = Depends(require_user)):
    svc = get_ma_service()
    acq = svc.get_acquisition(acq_id)
    if not acq:
        raise HTTPException(status_code=404, detail="Acquisition not found.")
    data = svc.generate_report(acq_id)
    if data is None:
        raise HTTPException(status_code=500, detail="Report generation failed.")
    safe_name = acq["name"].replace("/", "-").replace("\\", "-")[:50]
    filename = f"{safe_name} — Data Gaps Report.xlsx"
    return StreamingResponse(
        io.BytesIO(data),
        media_type=XLSX_MIME,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
