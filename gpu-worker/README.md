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

## Deploy

Requires a Modal account and local CLI authentication. Do not put credentials
in this repository or send them in chat.

```bash
python -m pip install -r gpu-worker/requirements.txt
modal setup
modal secret create creovanta-worker CREOVANTA_WORKER_TOKEN="$(python -c 'import secrets; print(secrets.token_urlsafe(48))')"
modal deploy gpu-worker/modal_app.py
```

Set the same `CREOVANTA_WORKER_TOKEN` as a protected environment secret in the
Render API service before allowing Render to call this endpoint. Never expose
the token to the browser.

The default GPU is L4 and the container cap is two. GPU selection and spending
limits must be reviewed in the Modal dashboard before production use. The model
cache volume is persistent; model weights are not committed to Git.

## API contract

- `GET /health`: infrastructure status; does not imply model readiness.
- `POST /v1/generate`: bearer-authenticated JSON containing
  `generation_id`, `voice_profile_id`, `text`, and a short-lived private
  `reference_audio_url`. Currently returns 503 until the model adapter and
  safety checks are implemented.

The Render API must call this endpoint server-to-server only. The browser must
never receive the worker token or a Supabase service-role key.
