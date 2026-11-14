# Creovanta

**AI Voice Cloning & Text-to-Speech Platform**

Creovanta is a web platform for creating speech from text using a user's own voice or a voice they have explicit permission to use.

## Project status

This repository now contains the initial API scaffold. The API health service is the first deployable milestone. Voice-model inference is not yet connected.

## Planned architecture

- **Web:** Next.js frontend, deployed on Vercel
- **API:** Python FastAPI, deployed on Render
- **Auth / database / storage:** Supabase
- **Speech engine:** a separately hosted open-source inference service; GPU availability and operating cost must be evaluated before production use

## Safety

Voice cloning must only be enabled for the account owner's voice or a voice for which the uploader has documented permission. Do not upload or generate speech impersonating someone without their consent.

## Backend local development

```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload
```

The API listens on http://127.0.0.1:8000. Health check: `GET /health`.

## Required configuration

See `backend/.env.example`. Never commit real credentials, Supabase service-role keys, model-provider keys, or private voice recordings.

## Current limitations

- Authentication and Supabase data access are not wired yet.
- Voice upload, consent persistence, and speech generation are not active yet.
- No voice model is bundled in this repository.
- A successful API deployment does not mean voice cloning is operational.
