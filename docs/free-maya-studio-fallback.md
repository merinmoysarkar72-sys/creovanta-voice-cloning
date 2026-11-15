# Free Maya 2 Native Studio fallback

## What is available now

Creovanta's frontend offers a link to the public [Maya 2 Native Studio](https://huggingface.co/spaces/maya-research/maya2-native-studio). The Space is maintained under the `maya-research` Hugging Face namespace and its model card links to `maya-research/maya2-native`. Its README documents Bengali, built-in voices, reference-audio cloning, and Hugging Face ZeroGPU execution.

## Free usage limits

Hugging Face's current ZeroGPU documentation says:
- Public ZeroGPU Spaces can be used free by all users.
- A free signed-in account has 5 minutes of GPU quota per day.
- Hosting a personal ZeroGPU Space requires a verified email and an account older than 30 days; that hosting restriction does not prevent using an existing public ZeroGPU Space.
- The daily quota is limited and is not a 24/7 production server.

## Privacy and consent

The Maya Studio is an external public Space. A voice sample uploaded there is sent to and processed by that Space; it is not uploaded through Creovanta's private Supabase bucket and is not protected by Creovanta's per-user Voice Library controls. Users must upload only their own voice or a recording for which they have explicit permission. Do not send private or third-party recordings to the external demo without permission.

## Runtime smoke test

A live inference smoke test succeeded through the Hugging Face MCP-enabled Space [hugging-apps/maya2-native](https://huggingface.co/spaces/hugging-apps/maya2-native): a short Bengali sentence was generated using the built-in **Jahnavi** voice and returned a WAV file URL. This confirms that the Maya 2 Native inference path can produce Bengali audio on Hugging Face's shared GPU infrastructure.

This test used a built-in synthetic voice. It did **not** test zero-shot cloning with a user's reference recording, long-form generation, concurrency, Creovanta account authorization, or storage of generated files in Creovanta. Those remain separate validation tasks.

## Production integration status

This fallback does not change the Render API, Cartesia endpoints, Supabase schema, or Modal worker. The current Modal L4 deployment is blocked by Modal's payment-method requirement. Do not retry or change Modal billing for the free route.

The official Studio uses Gradio server APIs with Hugging Face OAuth and ZeroGPU quota attribution to the visitor. A backend-to-backend integration cannot safely impersonate each Creovanta user with the Space owner's quota. A proper product integration would need a user-authorized Hugging Face OAuth flow, secure per-user quota attribution, server-side voice-sample transfer, consent checks, and a tested API contract. Until those gates are met, keep the external Studio link clearly labeled as an external demo and do not claim that it is integrated into Creovanta's private workflow.
