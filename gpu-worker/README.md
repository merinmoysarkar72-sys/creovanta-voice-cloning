# Creovanta GPU Worker (staged scaffold)

This is a separate Modal GPU service. Keep the existing Render FastAPI service
lightweight; it remains responsible for Supabase JWT verification, ownership,
consent, quotas, and job orchestration.

## Current state

- Modal app and GPU-backed FastAPI endpoint scaffold are present.
- `GET /health` reports infrastructure status separately from model status.
- `POST /v1/generate` is authenticated and intentionally returns HTTP 503.
- No model is loaded and no audio is generated yet. Do not connect production
  traffic or advertise voice cloning as active.

## Why generation is disabled

The current candidate is `EMTIAZZ/chatterbox-bangla-tts`. Before enabling it:
1. Verify commercial-use rights for the base model and all bundled components.
2. Obtain confirmation of fine-tuning dataset provenance and checkpoint rights.
3. Pin exact model and tokenizer revisions and verify checksums.
4. Add a reviewed adapter and test using consented Bangladeshi Bengali samples.
5. Validate reference audio duration, size, codec, signed-URL host, output storage,
   job ownership, timeouts, and abuse limits end to end.

## Automated deployment

A GitHub Actions workflow is included at
`.github/workflows/deploy-gpu-worker.yml`. It runs only when manually started from the Actions **Run workflow** button.
This avoids a failed automatic deployment before account secrets are configured.

Before the first run, add these four repository Actions secrets in
GitHub → Settings → Secrets and variables → Actions:

- `MODAL_TOKEN_ID`: Modal account token ID.
- `MODAL_TOKEN_SECRET`: Modal account token secret.
- `CREOVANTA_WORKER_TOKEN`: a long random secret used only for API-to-worker
  authentication. Generate it locally with a password manager or a secure
  random generator. Use the exact same value for Render's
  `VOICE_ENGINE_API_KEY`.
- `SUPABASE_URL`: the project's public Supabase project URL; used only to
  restrict reference-audio URLs to the project's private Storage host.

The workflow creates/updates the Modal secret named `creovanta-worker` and
deploys `gpu-worker/modal_app.py`. The Modal token values are consumed only
by GitHub Actions and must never be committed or sent in chat.

## Render configuration after Modal deployment

After the workflow succeeds, copy the deployed Modal web endpoint URL into
Render's protected environment variable `VOICE_ENGINE_URL`, and set
`VOICE_ENGINE_API_KEY` to the same value as `CREOVANTA_WORKER_TOKEN`.
Do not add either value to the Next.js browser environment. Render will
redeploy when its environment is saved.

## API contract

- `GET /health`: infrastructure status; does not imply model readiness.
- `POST /v1/generate`: bearer-authenticated JSON containing
  `generation_id`, `voice_profile_id`, `text`, and a short-lived private
  `reference_audio_url`. Currently returns 503 until the model adapter and
  safety checks are implemented.

The Render API must call this endpoint server-to-server only. The browser must
never receive the worker token or a Supabase service-role key.

## Cost and rollout

The default GPU is L4, with a maximum of two containers and a 300-second
scale-down window. Review Modal workspace billing and GPU availability before
enabling production. The persistent model-cache volume is created by the app;
model weights are not committed to Git.
