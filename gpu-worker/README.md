# Creovanta GPU Worker — Maya 2 Native

This is the existing Modal app `creovanta-voice-worker`, now prepared to run
Maya 2 Native for Bengali text-to-speech and consented voice cloning.

## Current deployment state

- The Modal app name and private worker-token authentication are preserved.
- The worker loads `maya-research/maya2-native` on an NVIDIA L4 GPU by default.
- Model, Mimi codec and ECAPA files are cached in the persistent
  `creovanta-model-cache` Modal Volume.
- The worker scales down after 300 seconds and is limited to one container.
- `GET /health` reports `model_status: ready` only after the model has loaded.
- `POST /v1/generate` returns a WAV file encoded in JSON as `audio_base64`.
- Render is not yet switched to this worker. Do not connect this inactive worker to production until a real end-to-end model test succeeds.

## Model and voice mode

Model: `maya-research/maya2-native`  
Language: Bengali (`bn`)  
Audio output: 24 kHz, mono, PCM 16-bit WAV.

The current Creovanta upload flow does not collect the exact transcript of the
reference recording. Therefore the worker uses Maya's `spk` (speaker-embedding
only) mode, which does not invent a transcript. For the strongest cloning
conditioning, a future UI update should collect the exact spoken transcript and
use Maya's `icl_spk` mode.

Use only the account owner's voice or a voice with explicit documented consent.
Tell listeners when generated speech is synthetic.

## Model installation

The Modal image installs the upstream Maya 2 Native repository and its
CUDA 12.8 dependencies. The Hugging Face model and supporting assets download
on first container startup and persist in `creovanta-model-cache`.

The default GPU is `L4`. The released model's documentation reports a 9.2 GB
peak for one seat plus CUDA context; an L4 provides room for this configuration.
The worker uses one generation seat and one maximum container to limit usage.

## Automated deployment

The GitHub Actions workflow is manually triggered from Actions →
**Deploy Creovanta GPU Worker** → **Run workflow**.

Required repository Actions secrets:

- `MODAL_TOKEN_ID`
- `MODAL_TOKEN_SECRET`
- `CREOVANTA_WORKER_TOKEN`
- `SUPABASE_URL`

The workflow creates/updates the Modal secret named `creovanta-worker` and
deploys `gpu-worker/modal_app.py`. Never paste any of these secrets into chat
or commit them to Git.

## Render integration — do not switch yet

After a successful Modal smoke test, copy the deployed Modal endpoint URL into
Render's protected `VOICE_ENGINE_URL` variable. Set `VOICE_ENGINE_API_KEY`
to the same secret value as `CREOVANTA_WORKER_TOKEN`.

The Render worker client must then be updated to decode `audio_base64` and
return the WAV response. This integration is intentionally not part of this
staged worker change. Do not direct production traffic here before the smoke
test and the Render adapter are complete.

## API contract

All endpoints require `Authorization: Bearer <CREOVANTA_WORKER_TOKEN>`.

### `GET /health`

Reports infrastructure and model readiness. It does not expose credentials.

### `POST /v1/generate`

JSON request:

```json
{
  "generation_id": "a-unique-generation-id",
  "voice_profile_id": "the-owned-voice-profile-id",
  "text": "বাংলা লেখা এখানে",
  "reference_audio_url": "a-short-lived-private-Supabase-signed-URL"
}
```

The signed URL must point to this project's private `voice-samples` bucket.
Reference audio must decode successfully and be 3–30 seconds long; 3–10
seconds is recommended.

Successful response includes:

- `status: ok`
- `format: wav`
- `sample_rate: 24000`
- `channels: 1`
- `audio_base64`: base64-encoded PCM 16-bit WAV.

The Render API must call this endpoint server-to-server only. The browser must
never receive the worker token or a Supabase service-role key.

## Licensing and attribution

Maya 2 Native's engine and model are distributed under Apache-2.0 according to
the upstream repository/model card. The bundled Mimi component is CC-BY-4.0;
preserve its required attribution and all upstream license notices when
redistributing. Review every upstream component's license before public
commercial launch.

Upstream: https://github.com/MayaResearch/maya2-native  
Model: https://huggingface.co/maya-research/maya2-native

## Cost

Modal GPU time is not unlimited or guaranteed to be free. Check the current
workspace credit balance and GPU pricing before deployment. Scale-down limits
idle time but does not remove charges for startup, model loading, or generation.
