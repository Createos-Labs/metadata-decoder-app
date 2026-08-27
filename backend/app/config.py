"""
Runtime configuration, read from environment variables.
"""
from __future__ import annotations

import os
from functools import lru_cache


def _bool(name: str, default: bool) -> bool:
    raw = os.environ.get(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


class Settings:
    def __init__(self) -> None:
        self.gcp_project: str = os.environ.get("GOOGLE_CLOUD_PROJECT", "").strip()
        self.gcs_bucket: str = os.environ.get("GCS_BUCKET", "").strip()

        self.firebase_project_id: str = os.environ.get("FIREBASE_PROJECT_ID", "lab-create-os").strip()
        self.jwt_secret: str = os.environ.get("JWT_SECRET", "").strip()
        self.postgrest_url: str = os.environ.get(
            "POSTGREST_URL",
            "https://postgrest-metadata-decoder-595303106724.us-central1.run.app",
        ).strip()

        self.auth_enabled: bool = _bool("AUTH_ENABLED", default=True)
        self.allowed_email_domain: str = os.environ.get(
            "ALLOWED_EMAIL_DOMAIN", "createmusicgroup.com"
        ).strip().lower()
        self.allowed_emails: set[str] = {
            e.strip().lower()
            for e in os.environ.get("ALLOWED_EMAILS", "").split(",")
            if e.strip()
        }

        self.static_dir: str = os.environ.get(
            "STATIC_DIR", os.path.join(os.path.dirname(os.path.dirname(__file__)), "static")
        )

        self.max_upload_bytes: int = int(os.environ.get("MAX_UPLOAD_BYTES", str(25 * 1024 * 1024)))

        self.ma_admin_email: str = os.environ.get("MA_ADMIN_EMAIL", "").strip().lower()


@lru_cache
def get_settings() -> Settings:
    return Settings()
