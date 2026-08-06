"""API routes for M&A Audit — acquisitions, scans, finding review, report."""
from __future__ import annotations

import io
from typing import List

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from ..auth import User, require_ma_access, require_user
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
    user: User = Depends(require_ma_access),
) -> dict:
    return get_ma_service().create_acquisition(
        name=body.name, company=body.company, user_email=user.email
    )


@router.get("/acquisitions")
async def list_acquisitions(user: User = Depends(require_ma_access)) -> dict:
    return {"acquisitions": get_ma_service().list_acquisitions()}


@router.get("/acquisitions/{acq_id}")
async def get_acquisition(acq_id: str, user: User = Depends(require_ma_access)) -> dict:
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
    user: User = Depends(require_ma_access),
) -> dict:
    svc = get_ma_service()
    if not svc.get_acquisition(acq_id):
        raise HTTPException(status_code=404, detail="Acquisition not found.")
    updated = svc.update_acquisition(acq_id, body.model_dump(exclude_none=True))
    return updated or {}


@router.delete("/acquisitions/{acq_id}")
async def delete_acquisition(acq_id: str, user: User = Depends(require_ma_access)) -> dict:
    if not get_ma_service().delete_acquisition(acq_id):
        raise HTTPException(status_code=404, detail="Acquisition not found.")
    return {"deleted": acq_id}


# ---- MA Scans --------------------------------------------------------------

@router.post("/acquisitions/{acq_id}/scans", status_code=status.HTTP_201_CREATED)
async def upload_ma_scan(
    acq_id: str,
    file: UploadFile,
    user: User = Depends(require_ma_access),
    settings: Settings = Depends(get_settings),
) -> dict:
    name = file.filename or "file.xlsx"
    if not (name.lower().endswith(".xlsx") or name.lower().endswith(".csv")):
        raise HTTPException(status_code=400, detail="Please upload an .xlsx or .csv file.")
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
async def get_ma_scan(scan_id: str, user: User = Depends(require_ma_access)) -> dict:
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
    user: User = Depends(require_ma_access),
) -> dict:
    svc = get_ma_service()
    if not svc.get_ma_scan(scan_id):
        raise HTTPException(status_code=404, detail="Scan not found.")
    findings = svc.update_findings(scan_id, [u.model_dump() for u in body.updates])
    return {"findings": findings}


@router.delete("/acquisitions/{acq_id}/scans/{scan_id}")
async def delete_ma_scan(
    acq_id: str, scan_id: str, user: User = Depends(require_ma_access)
) -> dict:
    if not get_ma_service().delete_ma_scan(scan_id, acq_id):
        raise HTTPException(status_code=404, detail="Scan not found.")
    return {"deleted": scan_id}


# ---- Report generation -----------------------------------------------------

# ---- Mapping template ------------------------------------------------------

@router.get("/mapping/blank-template")
async def download_blank_template(user: User = Depends(require_ma_access)):
    """Return a blank XLSX mapping template with column structure and Instructions tab."""
    import build_mapping as bm  # noqa: PLC0415

    data = bm.build_blank_template()
    return StreamingResponse(
        io.BytesIO(data),
        media_type=XLSX_MIME,
        headers={
            "Content-Disposition": 'attachment; filename="MA Mapping Template - Blank.xlsx"'
        },
    )


@router.post("/acquisitions/{acq_id}/mapping")
async def generate_mapping(
    acq_id: str,
    files: List[UploadFile] = File(...),
    user: User = Depends(require_ma_access),
):
    """
    Accept multiple Glassnote export files (catalog, contracts, statements).
    Auto-detect file types from filenames and generate an XLSX mapping template.
    """
    import build_mapping as bm  # noqa: PLC0415

    svc = get_ma_service()
    acq = svc.get_acquisition(acq_id)
    if not acq:
        raise HTTPException(status_code=404, detail="Acquisition not found.")

    classified: dict[str, bytes | list] = {}
    source_filenames: dict[str, str | list] = {}
    unknown_files: list[str] = []

    for upload in files:
        name = upload.filename or ""
        data = await upload.read()
        if not data:
            continue
        ftype = bm.detect_file_type(name)
        if ftype == "statement_zip":
            classified.setdefault("statement_zip", [])
            classified["statement_zip"].append(data)
            source_filenames.setdefault("statement_zip", [])
            source_filenames["statement_zip"].append(name)
        elif ftype != "unknown":
            classified[ftype] = data
            source_filenames[ftype] = name
        else:
            unknown_files.append(name)

    if "catalog" not in classified or "isrc_links" not in classified:
        missing = []
        if "catalog" not in classified:
            missing.append("Products/Tracks catalog export (.xlsx)")
        if "isrc_links" not in classified:
            missing.append("Contracts w/Albums & Tracks export (.xls)")
        raise HTTPException(
            status_code=422,
            detail=f"Missing required files: {'; '.join(missing)}. "
                   f"Unrecognised files: {unknown_files or 'none'}.",
        )

    try:
        xlsx_bytes, stats = bm.build_mapping(classified, source_filenames)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Mapping generation failed: {exc}")

    safe_name = acq["name"].replace("/", "-").replace("\\", "-")[:50]
    filename = f"MA Mapping Template - {safe_name}.xlsx"
    return StreamingResponse(
        io.BytesIO(xlsx_bytes),
        media_type=XLSX_MIME,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.post("/acquisitions/{acq_id}/report")
async def generate_report(acq_id: str, user: User = Depends(require_ma_access)):
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
