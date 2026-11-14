# Creovanta Voice Engine Selection

Status: candidate selected for technical evaluation; not production-approved yet.

## Primary candidate: EMTIAZZ/chatterbox-bangla-tts

Model card: https://huggingface.co/EMTIAZZ/chatterbox-bangla-tts
Training repository: https://github.com/EMTIAZZ/chatterbox-bangla-tts

Why it is the current lead:
- Explicit Bangla fine-tuning and Bangla tokenizer adaptation.
- Documents zero-shot voice cloning from a short reference recording.
- Documents the inference interface: ChatterboxTTS.generate(text=..., audio_prompt_path=...).
- The model card labels the fine-tuned model MIT and says it follows the base Chatterbox license.

Important release gates:
1. The model card says to refer to Resemble AI's terms for commercial use. Verify the exact current license/terms for the base model and every bundled component before enabling paid or public production use.
2. Verify the provenance and redistribution rights for the fine-tuning dataset and checkpoint with the model author. A model-card license label alone does not settle dataset rights.
3. Run a human listening evaluation with consented Bangladeshi Bengali samples: pronunciation, accent, intelligibility, similarity, latency, and failure cases.
4. Pin and checksum the exact checkpoint and tokenizer. Do not download mutable `main` assets at runtime.
5. Never accept or clone a voice unless the uploader confirms they own it or have explicit permission.

## Why not deploy it on the current Render API service

The current Render service is a lightweight FastAPI API service on the Free plan. The Chatterbox stack requires PyTorch, model weights, and preferably CUDA GPU inference. Installing it into the existing small API service would create a large, fragile deployment and likely exceed practical memory/CPU limits.

Keep responsibilities separate:
- Vercel: Next.js user interface.
- Render: authenticated API, authorization, usage limits, job state, and orchestration.
- Dedicated GPU worker/provider: load Chatterbox once and perform inference.
- Supabase: private voice reference storage and generation metadata.

## Proposed request flow

1. The browser authenticates with Supabase.
2. The API validates the Supabase access token and checks that the selected voice belongs to that user and has accepted consent.
3. The API creates a queued generation record and obtains a short-lived signed URL for the private reference audio.
4. The GPU worker fetches the audio, validates file type/duration/size, and calls the pinned Bangla Chatterbox model.
5. The worker writes the generated audio to private storage and updates the generation record.
6. The browser polls generation status and plays/downloads only an authorized output.

## Current implementation status

- The Render FastAPI service now has a server-to-server GPU worker client and a sanitized `/health` status section. Its latest deploy is live at commit `64ffa1b088e16637d19ea877fd7f9ffdfa3f25db`.
- The API health status reports `voice_engine: disabled_until_model_validation`; the worker URL/token are not configured yet.
- No Chatterbox/PyTorch dependencies have been added to the Render service.
- No model weights have been downloaded or loaded, and no real audio inference has been tested.
- A separate Modal GPU worker scaffold exists under `gpu-worker/` with bearer authentication, Supabase signed-URL host/path validation, a persistent model-cache volume, an L4 default GPU, and a two-container cap.
- Worker health is explicitly separate from model readiness. Generation returns HTTP 503 until the reviewed Bangla model adapter and safety checks are implemented.
- A manual GitHub Actions deployment workflow is ready at `.github/workflows/deploy-gpu-worker.yml`; it requires four repository secrets before it can run.
- The worker has not been deployed to Modal; no Modal account, credentials, GPU allocation, or inference test has been confirmed.
- Next: configure the four deployment secrets, deploy the worker, set the Render worker URL/token, then implement the model adapter after rights review and test with consented samples.

## Alternative candidates / constraints

- `ehzawad/indicf5-bangla-tts`: Bangladeshi Bengali voice, but its current model license is research-only/non-commercial and explicitly prohibits production hosting without written permission. Not suitable for Creovanta production without permission.
- `EMTIAZZ/xtts-bangla-finetuned`: Bangla voice-cloning fine-tune, but gated and based on Coqui XTTS v2's non-commercial model license. Not suitable for commercial production without separate rights.
