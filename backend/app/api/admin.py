"""Admin API — manage M&A access list. Admin-only (require_admin dependency)."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel

from ..auth import User, require_admin
from ..db import get_db

router = APIRouter(prefix="/api/admin", tags=["admin"])


class AccessBody(BaseModel):
    email: str


@router.get("/ma-access")
async def list_ma_access(user: User = Depends(require_admin)) -> dict:
    return {"emails": get_db().list_ma_access()}


@router.post("/ma-access", status_code=status.HTTP_201_CREATED)
async def grant_ma_access(body: AccessBody, user: User = Depends(require_admin)) -> dict:
    email = body.email.strip().lower()
    if not email or "@" not in email:
        raise HTTPException(status_code=400, detail="Invalid email address.")
    get_db().grant_ma_access(email)
    return {"granted": email}


@router.delete("/ma-access/{email}")
async def revoke_ma_access(email: str, user: User = Depends(require_admin)) -> dict:
    if not get_db().revoke_ma_access(email.lower()):
        raise HTTPException(status_code=404, detail="Email not found in access list.")
    return {"revoked": email.lower()}
