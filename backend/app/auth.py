"""
Authentication: verify Firebase ID tokens, extract project roles, and exchange
for a short-lived PostgREST HS256 token via the CreateOS Labs Management UI.

The frontend signs in with Google via Firebase Auth and sends the resulting
Firebase ID token as `Authorization: Bearer <token>` on every API call.
Backend verifies the token with Firebase Admin SDK (no shared secret needed),
reads project_roles from the claims (set by the Management UI), then exchanges
the Firebase token for a PostgREST-compatible HS256 token.
"""
from __future__ import annotations

from contextvars import ContextVar
from functools import lru_cache

import requests as _requests
from fastapi import Depends, Header, HTTPException, status

from .config import Settings, get_settings

# Per-request PostgREST token — set in require_user, read by db.py
_postgrest_token_var: ContextVar[str | None] = ContextVar("postgrest_token", default=None)


def get_postgrest_token() -> str | None:
    return _postgrest_token_var.get()


class User(dict):
    @property
    def email(self) -> str:
        return self.get("email", "")

    @property
    def is_admin(self) -> bool:
        return bool(self.get("_is_admin"))

    @property
    def has_ma_access(self) -> bool:
        return bool(self.get("_has_ma_access"))


@lru_cache
def _firebase_app():
    import firebase_admin
    from firebase_admin import credentials

    s = get_settings()
    if not firebase_admin._apps:
        firebase_admin.initialize_app(credentials.ApplicationDefault(), {
            "projectId": s.firebase_project_id,
        })
    return firebase_admin.get_app()


def _exchange_firebase_token(firebase_token: str) -> str:
    """Exchange a Firebase ID token for a short-lived PostgREST HS256 token."""
    resp = _requests.post(
        "https://admin.create-os-labs.com/auth/firebase-login",
        json={"idToken": firebase_token, "slug": "metadata-decoder"},
        timeout=10,
    )
    resp.raise_for_status()
    data = resp.json()
    token = data.get("token") or data.get("access_token")
    if not token:
        # Some implementations return the token in a Set-Cookie
        cookie = resp.cookies.get("session") or resp.cookies.get("token")
        token = cookie
    if not token:
        raise RuntimeError(f"Token exchange returned no token: {data}")
    return token


def _verify_firebase_token(token: str, settings: Settings) -> tuple[User, str]:
    """Returns (User, firebase_id_token) so we can exchange after verification."""
    from firebase_admin import auth as fb_auth

    _firebase_app()
    try:
        claims = fb_auth.verify_id_token(token)
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Invalid sign-in token: {exc}",
        )

    email = (claims.get("email") or "").lower()
    if not email or not claims.get("email_verified", False):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token has no verified email.",
        )

    domain = email.split("@")[-1].lower()
    allowed = (
        email in settings.allowed_emails
        or (settings.allowed_email_domain and domain == settings.allowed_email_domain)
    )
    if not allowed:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Access is restricted to @{settings.allowed_email_domain} accounts.",
        )

    # Roles are set by the Management UI and embedded in the Firebase token claims.
    # project_roles.metadata_decoder is a list of role strings, e.g. ["admin", "mna_area"]
    project_roles: list[str] = (
        claims.get("project_roles", {}).get("metadata_decoder", [])
    )
    is_admin = "admin" in project_roles
    has_ma = is_admin or "mna_area" in project_roles

    user = User(
        email=email,
        name=claims.get("name", email),
        picture=claims.get("picture", ""),
        domain=domain,
        _is_admin=is_admin,
        _has_ma_access=has_ma,
    )
    return user, token


async def require_user(
    authorization: str | None = Header(default=None),
    settings: Settings = Depends(get_settings),
) -> User:
    if not settings.auth_enabled:
        _postgrest_token_var.set(settings.dev_postgrest_token or None)
        return User(
            email="local@dev", name="Local Dev", picture="", domain="dev",
            _is_admin=True, _has_ma_access=True,
        )

    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing bearer token.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    firebase_token = authorization.split(" ", 1)[1].strip()
    user, raw_token = _verify_firebase_token(firebase_token, settings)

    try:
        pg_token = _exchange_firebase_token(raw_token)
        _postgrest_token_var.set(pg_token)
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"Database token exchange failed: {exc}",
        )

    return user


async def require_ma_access(user: User = Depends(require_user)) -> User:
    if not user.has_ma_access:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="M&A Audit access is restricted to the Royalties team.",
        )
    return user


async def require_admin(user: User = Depends(require_user)) -> User:
    if not user.is_admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin access required.",
        )
    return user
