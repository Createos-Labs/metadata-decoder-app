# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Deploy

Push to `main` → GitHub Actions auto-deploys to Cloud Run (keyless via Workload Identity Federation — no secrets needed locally).

- **Live URL:** https://metadata-decoder-fymjasojvq-uc.a.run.app
- **Repo:** https://github.com/Createos-Labs/metadata-decoder
- **Image:** `us-central1-docker.pkg.dev/lab-create-os/create-os-backend/metadata-decoder`

Env vars are managed via the Management UI secrets tab (https://admin.create-os-labs.com/projects/metadata-decoder?tab=secrets) and wired into the deploy step in `.github/workflows/deploy.yml` via `--set-env-vars`. Never use gcloud Secret Manager IAM bindings locally — they 403.

## Local development

**Backend** (Python 3.11+):
```bash
cd backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```
`ENV=local` disables auth and uses `backend/.local_data/` for storage + DB. Copy `.env.example` → `.env` to tweak.

**Frontend** (Node 20+):
```bash
cd frontend
npm install
npm run dev   # http://localhost:5173 — proxies /api/* to :8000
```

**Build SPA** (to mimic prod):
```bash
cd frontend && npm run build   # outputs frontend/dist
```
The Dockerfile copies `frontend/dist` → `backend/static`; FastAPI serves it for all non-`/api` routes.

## Architecture

One Cloud Run service serves everything. FastAPI handles `/api/*` and serves the built React SPA for all other routes.

```
Browser (React/Vite) → FastAPI
                          ├── /api/scans/*       → EngineService → vendored engine (scan_metadata, apply_*)
                          ├── /api/ma/*           → MAService     → build_mapping engine
                          └── /*                  → serves frontend/dist (static SPA)

Storage:  Google Cloud Storage (xlsx + results.json per scan)
          Local fallback: backend/.local_data/
Database: Firestore (scan metadata, LEAVE decisions, MA acquisitions)
          Local fallback: backend/.local_data/ JSON files
Auth:     Google sign-in → Firebase ID token → verified by backend on every request
          Local: auth disabled by default
```

### Key backend modules

- **`backend/app/engine_service.py`** — bridges the web API to the vendored engine. Runs scans, applies all four correction types, materializes Firestore LEAVE decisions into a temp dir the engine reads.
- **`backend/app/ma_service.py`** — M&A mapping service. Manages acquisitions and per-acquisition mapping state stored as `ma/{acq_id}/mapping_state.json` in GCS.
- **`backend/engine/build_mapping.py`** — the M&A mapping engine. Detects file types by header fingerprint (`_HEADER_FINGERPRINTS`), loads each source file into state, and renders a multi-band XLSX. All state is a plain dict serialized to GCS JSON between uploads.
- **`backend/app/storage.py`** / **`backend/app/db.py`** — thin wrappers around GCS and Firestore with no local fallback logic (that's in `get_storage()` / `get_db()` factory functions).
- **`backend/app/api/`** — three routers: `scans.py` (metadata scan workflow), `ma.py` (M&A mapping), `admin.py`.

### Vendored engine (`backend/engine/`)

The engine scripts (`scan_metadata.py`, `apply_corrections.py`, `apply_isrc_corrections.py`, `apply_missing_corrections.py`, `apply_format_corrections.py`) are ported verbatim from the original desktop tool. `backend/engine/__init__.py` puts this directory on `sys.path` so their absolute imports resolve. The one intentional change: `scan_metadata.analyze()` accepts an optional `project_dir` so the backend can point LEAVE-record lookups at a temp dir materialized from Firestore.

### M&A mapping state machine

Each acquisition accumulates state across sequential file uploads. `apply_files_to_state(state, files, ...)` detects each file's type, runs the appropriate loader, and merges results into the state dict. `render_state_to_xlsx()` reads the full state and builds the output. State is saved to GCS as `ma/{acq_id}/mapping_state.json` after each upload. The 32 MB Cloud Run request body limit means large files must be chunked client-side before upload.

### Frontend

React + Vite + TypeScript + Tailwind. Two main page areas:
- **`src/pages/`** — `HomePage` (upload + scan dashboard), `ScanDetailPage` (four correction tabs), `ma/MADetailPage` (M&A mapping UI)
- **`src/lib/`** — API client, auth context (`AuthContext`), shared types (`types.ts`)

`MAMappingStatus` in `types.ts` must stay in sync with `state_summary()` in `build_mapping.py`.

## Infrastructure (CreateOS Labs)

- **Database (PostgREST):** https://postgrest-metadata-decoder-595303106724.us-central1.run.app
- **Auth:** Firebase project `lab-create-os` — `apiKey: AIzaSyDWI18_-uh9byfX8DeUJFDf6TAxjHzMrRw`
- **Management UI:** https://admin.create-os-labs.com
- **Analytics:** `G-QH8GCYCNW5`

PostgREST uses HS256 (`JWT_SECRET`), not raw Firebase RS256 tokens. Mint a short-lived HS256 token server-side after verifying the Firebase token, or use the token exchange endpoint: `POST https://admin.create-os-labs.com/auth/firebase-login` with `{ idToken, slug }`.

Access control: `montserrat.munoz@createmusicgroup.com` has Full access (admin). All `@createmusicgroup.com` accounts currently have No access by default — grant via the Management UI Access tab.

## Configuration reference

| Variable | Default | Purpose |
|---|---|---|
| `ENV` | `local` | `local` or `prod` — controls CORS + auth defaults |
| `AUTH_ENABLED` | `false` local / on prod | Require Google sign-in |
| `OAUTH_CLIENT_ID` | — | Google OAuth Web client ID |
| `ALLOWED_EMAIL_DOMAIN` | `createmusicgroup.com` | Domain gate |
| `ALLOWED_EMAILS` | — | Comma-separated extra allowlist |
| `GOOGLE_CLOUD_PROJECT` | — | Set → use Firestore; empty → local JSON |
| `GCS_BUCKET` | — | Set → use Cloud Storage; empty → local filesystem |
| `MA_ADMIN_EMAIL` | — | Email that gets M&A tool access |
