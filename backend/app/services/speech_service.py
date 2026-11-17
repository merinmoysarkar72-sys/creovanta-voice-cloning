"""Per-user OmniVoice integration through Hugging Face ZeroGPU.

The caller supplies their own Hugging Face Personal Access Token (PAT).
It is verified for each request and passed only to the public OmniVoice Space so
ZeroGPU usage is charged to that caller, never to a shared service token.
"""
from __future__ import annotations

import asyncio
import io
import os
import tempfile
import wave
from pathlib import Path
from typing import Any, Literal
from urllib.parse import quote
from uuid import UUID

import httpx
from fastapi import APIRouter, Header, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel, Field

router = APIRouter(prefix="/api/v1/speech", tags=["creovanta-speech"])

HF_WHOAMI_URL = "https://huggingface.co/api/whoami-v2"
HF_SPACE_ID = "k2-fsa/OmniVoice"
HF_SPACE_URL = "https://k2-fsa-omnivoice.hf.space"
VOICE_BUCKET = "voice-samples"
MAX_REFERENCE_BYTES = 50 * 1024 * 1024
MAX_TEXT_CHARS = 1200


class SpeechRequest(BaseModel):
    voice_profile_id: UUID
    text: str = Field(min_length=1, max_length=MAX_TEXT_CHARS)


class CloneRequest(BaseModel):
    voice_profile_id: UUID


class VoiceStatusRequest(BaseModel):
    voice_profile_id: UUID
    status: Literal["ready", "failed"]


def _required_env(name: str) -> str:
    value = os.getenv(name, "").strip()
    if not value:
        raise HTTPException(status_code=503, detail=f"Server configuration missing: {name}")
    return value


def _bearer_token(authorization: str | None) -> str:
    if not authorization:
        raise HTTPException(status_code=401, detail="Creovanta sign-in is required")
    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not token.strip():
        raise HTTPException(status_code=401, detail="A valid Creovanta bearer token is required")
    return token.strip()


def _hf_token(value: str | None) -> str:
    token = (value or "").strip()
    if (
        not token
        or len(token) > 4096
        or not token.startswith("hf_")
        or token.startswith("hf_oauth_")
    ):
        raise HTTPException(status_code=401, detail="Connect a Hugging Face Read token first")
    return token


def _user_headers(anon_key: str, token: str) -> dict[str, str]:
    return {"apikey": anon_key, "Authorization": f"Bearer {token}"}


async def _authenticated_user(
    client: httpx.AsyncClient, supabase_url: str, headers: dict[str, str]
) -> str:
    response = await client.get(f"{supabase_url}/auth/v1/user", headers=headers)
    if response.status_code == 401:
        raise HTTPException(status_code=401, detail="Your Creovanta session is invalid or expired")
    response.raise_for_status()
    user_id = response.json().get("id")
    if not user_id:
        raise HTTPException(status_code=401, detail="Could not verify your Creovanta account")
    return user_id


async def _verify_hf_token(client: httpx.AsyncClient, token: str) -> None:
    response = await client.get(
        HF_WHOAMI_URL, headers={"Authorization": f"Bearer {token}"}
    )
    if response.status_code in (401, 403):
        raise HTTPException(status_code=401, detail="Your Hugging Face Read token is invalid or revoked. Connect a valid Read token.")
    if not response.is_success:
        raise HTTPException(status_code=502, detail="Could not verify the generation account")


async def _get_owned_profile(
    client: httpx.AsyncClient,
    supabase_url: str,
    user_headers: dict[str, str],
    profile_id: UUID,
    user_id: str,
) -> dict[str, Any]:
    response = await client.get(
        f"{supabase_url}/rest/v1/voice_profiles",
        params={
            "id": f"eq.{profile_id}",
            "user_id": f"eq.{user_id}",
            "select": "id,name,source_audio_path,status,reference_text,language_code",
        },
        headers={**user_headers, "Accept": "application/json"},
    )
    response.raise_for_status()
    rows = response.json()
    if not rows:
        raise HTTPException(status_code=404, detail="Voice profile not found for this account")
    profile = rows[0]
    if not str(profile.get("reference_text") or "").strip():
        raise HTTPException(status_code=422, detail="The exact reference-audio transcript is required")
    return profile


async def _check_consent(
    client: httpx.AsyncClient,
    supabase_url: str,
    user_headers: dict[str, str],
    profile_id: UUID,
    user_id: str,
) -> None:
    response = await client.get(
        f"{supabase_url}/rest/v1/voice_consents",
        params={
            "voice_profile_id": f"eq.{profile_id}",
            "user_id": f"eq.{user_id}",
            "accepted": "eq.true",
            "select": "id",
        },
        headers={**user_headers, "Accept": "application/json"},
    )
    response.raise_for_status()
    if not response.json():
        raise HTTPException(status_code=403, detail="Accepted voice ownership consent is required")


async def _download_reference(
    client: httpx.AsyncClient,
    supabase_url: str,
    user_headers: dict[str, str],
    profile: dict[str, Any],
    user_id: str,
) -> tuple[bytes, str]:
    object_path = str(profile.get("source_audio_path") or "")
    if not object_path or not object_path.startswith(f"{user_id}/"):
        raise HTTPException(status_code=403, detail="Voice sample path is not owned by this account")
    storage_url = (
        f"{supabase_url}/storage/v1/object/authenticated/"
        f"{VOICE_BUCKET}/{quote(object_path, safe='/')}"
    )
    response = await client.get(storage_url, headers=user_headers)
    if response.status_code in (401, 403, 404):
        raise HTTPException(status_code=404, detail="Private voice sample could not be accessed")
    response.raise_for_status()
    if not response.content or len(response.content) > MAX_REFERENCE_BYTES:
        raise HTTPException(status_code=400, detail="Voice sample is empty or exceeds 50 MB")
    suffix = Path(object_path).suffix or ".audio"
    return response.content, suffix


def _call_speech_clone(
    hf_token: str,
    audio_path: str,
    text: str,
    reference_text: str,
    reference_language: str,
) -> tuple[bytes, float]:
    """Call the public OmniVoice ZeroGPU Space and encode its WAV result."""
    from gradio_client import Client
    import numpy as np

    language = "Bengali" if reference_language.lower() in {"bn", "bn-bd", "bengali"} else reference_language
    client = Client(
        HF_SPACE_ID,
        token=hf_token,
        verbose=False,
        analytics_enabled=False,
        httpx_kwargs={"timeout": 240},
    )
    try:
        # The official Space's first Gradio event is Voice Clone. Its inputs
        # follow the Voice Clone tab: text, language, ref audio, transcript,
        # instruction, steps, guidance, denoise, speed, duration, preprocess,
        # postprocess. The Gradio client uploads the local reference file.
        result = client.predict(
            text,
            language,
            audio_path,
            reference_text or "",
            "",
            32,
            2.0,
            True,
            1.0,
            None,
            True,
            True,
            fn_index=0,
        )
    finally:
        close = getattr(client, "close", None)
        if callable(close):
            close()

    if not isinstance(result, (tuple, list)) or len(result) < 1 or result[0] is None:
        status = str(result[1]) if isinstance(result, (tuple, list)) and len(result) > 1 else "No audio returned"
        raise RuntimeError(f"OmniVoice did not return audio: {status}")

    audio = result[0]
    if not isinstance(audio, (tuple, list)) or len(audio) != 2:
        raise RuntimeError(f"OmniVoice returned an unexpected audio payload: {type(audio).__name__}")

    sample_rate = int(audio[0])
    samples = np.asarray(audio[1])
    if sample_rate <= 0 or samples.size == 0:
        raise RuntimeError("OmniVoice returned an empty audio waveform")

    if samples.ndim > 1:
        if samples.shape[-1] <= 2:
            samples = samples.mean(axis=-1)
        else:
            samples = samples.reshape(-1)
    duration = float(samples.shape[0] / sample_rate)
    if np.issubdtype(samples.dtype, np.integer):
        # The official Space already returns int16 PCM; do not normalize it twice.
        pcm = samples.astype("<i2", copy=False)
    else:
        samples = np.nan_to_num(samples.astype(np.float32), copy=False)
        pcm = (np.clip(samples, -1.0, 1.0) * 32767.0).astype("<i2")

    output = io.BytesIO()
    with wave.open(output, "wb") as wav_file:
        wav_file.setnchannels(1)
        wav_file.setsampwidth(2)
        wav_file.setframerate(sample_rate)
        wav_file.writeframes(pcm.tobytes())

    return output.getvalue(), duration


async def _generate_speech_audio(
    client: httpx.AsyncClient,
    hf_token: str,
    sample: bytes,
    suffix: str,
    text: str,
    reference_text: str,
    reference_language: str,
) -> tuple[bytes, float]:
    with tempfile.TemporaryDirectory(prefix="creovanta-speech-") as folder:
        audio_path = str(Path(folder) / f"reference{suffix}")
        Path(audio_path).write_bytes(sample)
        try:
            return await asyncio.to_thread(
                _call_speech_clone,
                hf_token,
                audio_path,
                text,
                reference_text,
                reference_language,
            )
        except Exception as exc:
            diagnostic = str(exc).replace(hf_token, "[redacted]")[:800]
            print(f"[creovanta-speech] OmniVoice generation failed: {type(exc).__name__}: {diagnostic}", flush=True)
            message = str(exc).lower()
            if "quota" in message or "exceeded" in message or "gpu minutes" in message:
                raise HTTPException(
                    status_code=429,
                    detail="Your Hugging Face ZeroGPU allowance may be exhausted. Try again after it resets.",
                ) from exc
            raise HTTPException(
                status_code=502,
                detail="Creovanta could not generate audio with OmniVoice. Please retry later.",
            ) from exc


async def _set_profile_status(
    client: httpx.AsyncClient,
    supabase_url: str,
    service_key: str,
    profile_id: UUID,
    user_id: str,
    status: str,
) -> None:
    # Supabase secret API keys are opaque API keys, not JWTs.
    # Send the privileged key only in apikey; never as Authorization: Bearer.
    headers = {
        "apikey": service_key,
        "Content-Type": "application/json",
        "Prefer": "return=minimal",
    }
    # Legacy service_role keys are JWTs and must also be sent as Bearer.
    # New sb_secret_* keys are opaque API keys and must remain apikey-only.
    if service_key.startswith("eyJ"):
        headers["Authorization"] = f"Bearer {service_key}"
    response = await client.patch(
        f"{supabase_url}/rest/v1/voice_profiles",
        params={"id": f"eq.{profile_id}", "user_id": f"eq.{user_id}"},
        headers=headers,
        json={"status": status},
    )
    response.raise_for_status()


@router.post("/voices/status")
async def update_voice_status(
    request: VoiceStatusRequest,
    authorization: str | None = Header(default=None),
    hf_token_header: str | None = Header(default=None, alias="X-HF-Token"),
) -> dict[str, str]:
    """Record the result of a browser-side, user-attributed Maya clone test."""
    token = _bearer_token(authorization)
    hf_token = _hf_token(hf_token_header)
    supabase_url = _required_env("SUPABASE_URL").rstrip("/")
    anon_key = _required_env("SUPABASE_ANON_KEY")
    service_key = _required_env("SUPABASE_SERVICE_ROLE_KEY")
    user_headers = _user_headers(anon_key, token)

    async with httpx.AsyncClient(timeout=httpx.Timeout(30.0, connect=10.0)) as client:
        user_id = await _authenticated_user(client, supabase_url, user_headers)
        await _verify_hf_token(client, hf_token)
        profile = await _get_owned_profile(
            client, supabase_url, user_headers, request.voice_profile_id, user_id
        )
        await _check_consent(
            client, supabase_url, user_headers, request.voice_profile_id, user_id
        )
        if request.status == "ready" and (
            not profile.get("source_audio_path") or not profile.get("reference_text")
        ):
            raise HTTPException(status_code=422, detail="A private reference clip and exact transcript are required")
        await _set_profile_status(
            client, supabase_url, service_key, request.voice_profile_id, user_id, request.status
        )
    return {"status": request.status, "message": "Voice profile status updated"}


@router.post("/voices/clone")
async def clone_voice(
    request: CloneRequest,
    authorization: str | None = Header(default=None),
    hf_token_header: str | None = Header(default=None, alias="X-HF-Token"),
 ) -> Response:
    """Validate ownership/consent and return a real reference-audio cloning result."""
    token = _bearer_token(authorization)
    hf_token = _hf_token(hf_token_header)
    supabase_url = _required_env("SUPABASE_URL").rstrip("/")
    anon_key = _required_env("SUPABASE_ANON_KEY")
    service_key = _required_env("SUPABASE_SERVICE_ROLE_KEY")
    user_headers = _user_headers(anon_key, token)

    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(240.0, connect=10.0, write=60.0)) as client:
            user_id = await _authenticated_user(client, supabase_url, user_headers)
            await _verify_hf_token(client, hf_token)
            profile = await _get_owned_profile(
                client, supabase_url, user_headers, request.voice_profile_id, user_id
            )
            await _check_consent(
                client, supabase_url, user_headers, request.voice_profile_id, user_id
            )
            sample, suffix = await _download_reference(
                client, supabase_url, user_headers, profile, user_id
            )
            audio, _ = await _generate_speech_audio(
                client, hf_token, sample, suffix,
                "আমার কণ্ঠে বাংলা অডিও পরীক্ষা করা হচ্ছে।",
                str(profile["reference_text"]).strip(),
                str(profile.get("language_code") or "bn"),
            )
            if not audio:
                raise HTTPException(status_code=502, detail="Creovanta returned empty audio")
            await _set_profile_status(
                client, supabase_url, service_key, request.voice_profile_id, user_id, "ready"
            )
            return Response(
                content=audio,
                media_type="audio/wav",
                headers={
                    "Content-Disposition": 'inline; filename="creovanta-voice-preview.wav"',
                    "Cache-Control": "no-store",
                    "X-Content-Type-Options": "nosniff",
                    "X-Creovanta-Voice-Status": "ready",
                },
            )
    except HTTPException as exc:
        if exc.status_code not in (401, 403, 404, 409, 422):
            try:
                async with httpx.AsyncClient(timeout=httpx.Timeout(10.0)) as status_client:
                    user_id = await _authenticated_user(status_client, supabase_url, user_headers)
                    await _set_profile_status(
                        status_client, supabase_url, service_key,
                        request.voice_profile_id, user_id, "failed"
                    )
            except Exception:
                pass
        raise
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail="Could not reach Creovanta speech service or account data service") from exc


@router.post("/tts")
async def generate_speech(
    request: SpeechRequest,
    authorization: str | None = Header(default=None),
    hf_token_header: str | None = Header(default=None, alias="X-HF-Token"),
) -> Response:
    """Generate Bengali speech from the user's own consented Creovanta voice profile."""
    token = _bearer_token(authorization)
    hf_token = _hf_token(hf_token_header)
    supabase_url = _required_env("SUPABASE_URL").rstrip("/")
    anon_key = _required_env("SUPABASE_ANON_KEY")
    user_headers = _user_headers(anon_key, token)

    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(240.0, connect=10.0, write=60.0)) as client:
            user_id = await _authenticated_user(client, supabase_url, user_headers)
            await _verify_hf_token(client, hf_token)
            profile = await _get_owned_profile(
                client, supabase_url, user_headers, request.voice_profile_id, user_id
            )
            if profile.get("status") != "ready":
                raise HTTPException(status_code=409, detail="This Creovanta voice profile is not ready yet")
            await _check_consent(
                client, supabase_url, user_headers, request.voice_profile_id, user_id
            )
            sample, suffix = await _download_reference(
                client, supabase_url, user_headers, profile, user_id
            )
            audio, _ = await _generate_speech_audio(
                client, hf_token, sample, suffix, request.text,
                str(profile["reference_text"]).strip(),
                str(profile.get("language_code") or "bn"),
            )
            return Response(
                content=audio,
                media_type="audio/wav",
                headers={
                    "Content-Disposition": 'inline; filename="creovanta-speech.wav"',
                    "Cache-Control": "no-store",
                    "X-Content-Type-Options": "nosniff",
                },
            )
    except HTTPException:
        raise
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail="Could not reach Supabase or Hugging Face") from exc
