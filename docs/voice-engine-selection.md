# Creovanta Voice Engine Selection

Status: OmniVoice ZeroGPU adapter implemented; production audio test is still pending.

## Current free engine: k2-fsa/OmniVoice

- Public Hugging Face Space: https://huggingface.co/spaces/k2-fsa/OmniVoice
- Model: https://huggingface.co/k2-fsa/OmniVoice
- Supports Bengali (bn) among 600+ languages and zero-shot cloning from reference audio.
- The public Space is currently running on Hugging Face ZeroGPU.
- The model weights are licensed CC-BY-NC. Keep Creovanta non-commercial unless the model authors grant separate commercial permission. A future paid plan, ads, or other monetization must not be enabled under this model license without permission.
- Each request uses the signed-in user's own Hugging Face Read token; no shared service token is used. Users are subject to their own Hugging Face ZeroGPU allowance (currently a small daily allowance, not unlimited capacity).

## Request flow

1. Browser signs in to Creovanta with Supabase and connects a Hugging Face Read token in memory.
2. Render validates the Supabase session, voice-profile ownership, stored consent, and reference transcript.
3. Render retrieves the user's private reference audio from Supabase.
4. Render calls the public OmniVoice Gradio Space with that user's Hugging Face token.
5. The Space returns generated audio; Render converts the returned PCM payload to WAV and returns it to the browser.
6. Render marks the voice profile ready only after successful generation.

## Important limitations

- Hugging Face ZeroGPU is quota-limited and can be busy; free access is not guaranteed to be instant or unlimited.
- The public Space is operated by a third party. Its uptime, queue, model changes, and retention are outside Creovanta's control.
- The OmniVoice model weights are non-commercial. Do not enable ads, paid plans, or revenue-generating use without explicit rights clearance.
- Do not clone another person's voice without their explicit permission.

## Previous engine

Maya 2 Native was the previous integration. Its public Space returned a hidden upstream Gradio exception (show_error=False) during cloning, so it has been replaced in the application code by the OmniVoice ZeroGPU adapter. The old Maya integration documents are retained only as historical notes.
