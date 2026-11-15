# Creovanta

**AI Voice Cloning & Text-to-Speech Platform**

Creovanta is a web platform for creating speech from text using a user's own voice or a voice they have explicit permission to use.

## Project status

The Next.js frontend supports Supabase email authentication, private voice-sample upload, consent recording, and a user-scoped Voice Library. The Render FastAPI service is live and includes a server-to-server GPU worker client and sanitized worker health reporting.

**Cartesia text-to-speech backend integration is staged.** `POST /api/v1/tts` uses the server-side Cartesia key and voice ID, validates the Supabase session, restricts use to the configured owner account, and checks profile ownership plus accepted consent before generating Bengali MP3 audio. The browser must never receive the Cartesia API key.

## Architecture

- **Web:** Next.js frontend, deployed on Vercel
- **API:** Python FastAPI, deployed on Render
- **Auth / database / storage:** Supabase
- **Speech engine:** Cartesia hosted TTS API; Modal GPU worker remains available as a separate, currently inactive experiment

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


## Cartesia TTS configuration

Set these variables on the Render API service (never in the browser):

- `CARTESIA_API_KEY`: Cartesia API key
- `CARTESIA_VOICE_ID`: the existing cloned Cartesia voice ID
- `SUPABASE_URL`: Supabase project URL
- `SUPABASE_ANON_KEY`: Supabase publishable/anon key (server-side use only here)
- `CARTESIA_OWNER_USER_ID`: the Supabase Auth user UUID allowed to use this private voice

The TTS endpoint accepts a JSON body containing `voice_profile_id` and `text`, plus the signed-in user's Supabase access token in the Authorization header. It returns MP3 bytes. The owner UUID must match the authenticated user, and the profile must have an accepted consent row visible under RLS.
