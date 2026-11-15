# Creovanta

**Creovanta Voice Cloning — Your voice, your creation.**

Creovanta is a voice creation platform for generating Bengali speech with a voice the user owns or has explicit permission to use.

## Current architecture

- **Product and brand:** Creovanta
- **Web application:** Next.js, deployed on Vercel
- **Private API:** FastAPI, deployed on Render
- **Authentication, database and private audio storage:** Supabase
- **Speech workflow:** Creovanta's private voice-profile API, connected to a Hugging Face-hosted speech processing service

The application UI and product credits use the Creovanta brand. Third-party infrastructure is disclosed in the Privacy Policy because it may process account, audio, and generation data; infrastructure disclosure is not product or channel credit.

## User privacy and voice ownership

- Users may upload only their own voice or a voice they have explicit permission to use.
- Reference audio and exact transcript are stored in account-scoped private storage.
- Voice cloning and speech generation require a signed-in Creovanta account, an owned profile, and accepted consent.
- Hugging Face authorization is held in the current browser page memory and is not intentionally persisted by Creovanta.
- Render must have `SUPABASE_SERVICE_ROLE_KEY` configured privately for protected profile status updates and complete account deletion.
- Generated audio history is stored locally on the user's device.
- Account deletion is available in the app and at `/delete-account`.

## Known limitations

- The connected external speech service has not yet passed a reliable end-to-end voice-cloning test through the Creovanta API. Do not describe generation as fully operational until a real user-account test succeeds.
- Free inference capacity is limited and may be exhausted; no unlimited generation is promised.
- Older voice profiles created with the retired provider must be re-uploaded with an exact reference transcript before they can be used in the current workflow.
- The Modal GPU worker is an inactive experiment and is not the current speech-generation path.
- Audio history is device-local, not cloud-synced.

## Backend local development

```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload
```

The API listens on `http://127.0.0.1:8000`. Health check: `GET /health`.

Never commit credentials, Supabase service-role keys, worker tokens, or private voice recordings.
