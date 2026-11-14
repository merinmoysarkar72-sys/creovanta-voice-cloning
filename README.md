# Creovanta

**AI Voice Cloning & Text-to-Speech Platform**

Creovanta is a web platform for creating speech from text using a user's own voice or a voice they have explicit permission to use.

## Project status

The Next.js frontend supports Supabase email authentication, private voice-sample upload, consent recording, and a user-scoped Voice Library. The Render FastAPI service is live and includes a server-to-server GPU worker client and sanitized worker health reporting.

**Voice cloning and text-to-speech are not active yet.** The separate Modal GPU worker scaffold has not been deployed, and its generation endpoint intentionally returns HTTP 503 until model rights, model adapter, audio validation, and end-to-end safeguards are complete.

## Architecture

- **Web:** Next.js frontend, deployed on Vercel
- **API:** Python FastAPI, deployed on Render
- **Auth / database / storage:** Supabase
- **Speech engine:** separate Modal GPU worker (deployment workflow staged; model not connected)

## Safety

Voice cloning must only be enabled for the account owner's voice or a voice for which the uploader has documented permission. Do not upload or generate speech impersonating someone without their consent.

Never commit credentials, Supabase service-role keys, worker tokens, or private voice recordings.

## Backend local development

```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload
```

The API listens on http://127.0.0.1:8000. Health check: `GET /health`.

## GPU worker deployment

See [gpu-worker/README.md](gpu-worker/README.md) for the four required GitHub Actions secrets and the manual Modal deployment workflow.

## Current limitations

- Backend Supabase JWT verification, voice ownership/consent enforcement, generation-job persistence, and quotas are not wired yet.
- Render's worker URL and API token are not configured yet.
- Modal GPU worker deployment and actual model inference are not tested.
- The Bangla Chatterbox candidate requires commercial-rights and training-data provenance review before production.
- A successful API deployment does not mean voice cloning is operational.
