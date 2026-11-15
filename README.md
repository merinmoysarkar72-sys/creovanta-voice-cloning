# Creovanta

**AI Voice Cloning & Text-to-Speech Platform**

Creovanta is a web platform for creating speech from text using a user's own voice or a voice they have explicit permission to use.

## Project status

The Next.js frontend supports Supabase email authentication, private voice-sample upload, consent recording, and a user-scoped Voice Library. The Render FastAPI service is live and includes a server-to-server GPU worker client and sanitized worker health reporting.

**Cartesia per-profile voice cloning and Bengali TTS are implemented in the multi-user feature branch.** Each voice profile is cloned privately through the server-side Cartesia API and stores its own provider voice ID. The API verifies the Supabase session, profile ownership, and accepted consent before cloning or generating speech. A server-side Supabase service-role key is required only for protected profile status/voice-ID updates; it must never be exposed to the browser. Production rollout still requires configuring that key on Render, confirming the Cartesia API key has voice-cloning permission, and running a real second-account test.

## Architecture

- **Web:** Next.js frontend, deployed on Vercel
- **API:** Python FastAPI, deployed on Render
- **Auth / database / storage:** Supabase
- **Speech engine:** Cartesia hosted voice cloning and TTS API, with a private provider voice ID stored per Creovanta profile; Modal GPU worker remains a separate, currently inactive experiment

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

- The multi-user voice-cloning feature requires a Render environment variable named `SUPABASE_SERVICE_ROLE_KEY`. Store the Supabase service-role key only on Render; never place it in frontend environment variables or Git.
- The Cartesia API key must have permission to create private voice clones. Provider plan limits and clone charges may apply.
- Real second-account isolation and live clone/TTS tests must be completed before public launch.
- Audio history remains local to the browser/device; cloud audio history is a separate planned feature.
- Modal GPU worker deployment and actual model inference remain inactive.

## Cartesia TTS configuration

Set these variables on the Render API service (never in the browser):

- `CARTESIA_API_KEY`: Cartesia API key
- `CARTESIA_VOICE_ID`: the existing cloned Cartesia voice ID
- `SUPABASE_URL`: Supabase project URL
- `SUPABASE_ANON_KEY`: Supabase publishable/anon key (server-side use only here)
- `CARTESIA_OWNER_USER_ID`: the Supabase Auth user UUID allowed to use this private voice

The TTS endpoint accepts a JSON body containing `voice_profile_id` and `text`, plus the signed-in user's Supabase access token in the Authorization header. It returns MP3 bytes. The owner UUID must match the authenticated user, and the profile must have an accepted consent row visible under RLS.
