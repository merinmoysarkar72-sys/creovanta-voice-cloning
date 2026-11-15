# Creovanta speech integration

## Request path

- Creovanta is the product and user-facing brand.
- The browser signs in to Hugging Face using OAuth PKCE. The access token stays in React memory and is never persisted by Creovanta.
- Speech inference is initiated from the user's browser through the Gradio JavaScript client. The browser connects to the public Maya Research Studio Space and sends the user's OAuth token with the request. This keeps the ZeroGPU request on the user-facing path so Hugging Face can attach its per-request identity header and apply the visitor's own quota.
- Render remains responsible for verifying the Supabase session, voice-profile ownership, accepted consent, and profile status. After the browser receives a valid clone-test audio file, it calls the protected status endpoint so Render can mark only that user's profile ready.
- The private reference recording is downloaded from the user's Supabase private bucket in the browser and uploaded to the speech-processing Space for inference. It remains private in Creovanta storage, but a copy is sent to the external service for processing.

## Hugging Face OAuth

Creovanta publishes a Client ID Metadata Document at:

`https://creovanta-omega.vercel.app/.well-known/oauth-cimd`

It uses the Hugging Face-supported public OAuth + PKCE flow, with the production homepage as the exact redirect URI. No client secret is required. The browser requests `openid profile inference-api` scopes so the connected account can authorize inference requests.

If the production domain changes, update the canonical URL in both this route and the browser's `connectGenerationAccount` function, then register/allow the new redirect URI according to Hugging Face's current OAuth rules.

## Speech API contract

The public Studio exposes `/clone_speak` with eight positional inputs:

1. Text to generate
2. Reference audio file
3. Exact reference transcript
4. Reference clip language
5. Output language
6. Normalize numbers
7. Seed
8. Randomize seed

Creovanta calls it from the browser with Bengali output language (`bn`). The JavaScript client handles the file upload. Generated audio is downloaded from the Space's own file endpoint and saved only in the browser's local audio history.

Render exposes `POST /api/v1/speech/voices/status` to record `ready` or `failed` after the browser-side clone smoke test. The endpoint re-checks the Supabase user, profile ownership, transcript, consent record, and Hugging Face token before changing status.

## Database

The live project schema has the final Creovanta-only profile shape:
- `reference_text` stores the exact transcript.
- The old provider label and provider voice ID are absent.
- `guard_voice_profile_status` protects readiness changes from ordinary authenticated clients.
- Voice profiles, consent, generation and usage tables have RLS enabled with account-scoped policies.

The live schema already reflects the last two repository migrations, but the Supabase migration ledger currently lists only through `20261115160346`. Do not re-run the later DDL migrations blindly; reconcile migration history separately if a clean migration ledger is required.

## Limits and privacy

- Maya Studio supports Bengali and other Indic languages, with a maximum text length of 1,200 characters per request.
- The reference clip should be 3–10 seconds, clear, and contain one speaker.
- Free Hugging Face ZeroGPU usage is limited and shared capacity may be unavailable; unlimited generation is not promised.
- The Hugging Face OAuth token stays in page memory and is cleared on refresh, disconnect, or sign-out.
- The sample audio, transcript, and generated text are processed by the external Space. Its operator controls runtime retention; Creovanta cannot guarantee deletion from that external runtime.

## Verification still required

1. Confirm the Vercel build passes after the Gradio JavaScript client dependency is installed.
2. Confirm Render deploys the protected profile-status endpoint.
3. Complete one end-to-end clone test with a 3–10 second voice sample and exact transcript.
4. Generate and download Bengali WAV audio from a profile marked ready.
5. Confirm that the user's Hugging Face quota is charged as expected.
