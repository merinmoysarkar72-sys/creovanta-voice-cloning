"""Per-user Maya 2 Native integration through Hugging Face ZeroGPU.

The caller supplies their own short-lived Hugging Face OAuth access token.
It is verified for each request and passed only to the public Maya Space so
ZeroGPU usage is charged to that caller, never to a shared service token.
"""
from __future__ import annotations

import asyncio
import os
import tempfile
from pathlib import Path
from typing import Any
from urllib.parse import quote, urljoin, urlparse
from uuid import UUID

import httpx
from fastapi import APIRouter, Header, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel, Field

router = APIRouter(prefix="/api/v1/speech", tags=["creovanta-speech"])

HF_WHOAMI_URL = "https://huggingface.co/api/whoami-v2"
HF_SPACE_ID = "maya-research/maya2-native-studio"
HF_SPACE_URL = "https://maya-research-maya2-native-studio.hf.space"
VOICE_BUCKET = "voice-samples"
MAX_REFERENCE_BYTES = 50 * 1024 * 1024
MAX_TEXT_CHARS = 1200


class SpeechRequest(BaseModel):
    voice_profile_id: UUID
    text: str = Field(min_length=1, max_length=MAX_TEXT_CHARS)


class CloneRequest(BaseModel):
    voice_profile_id: UUID


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
    if not token or len(token) > 4096 or not token.startswith("hf_"):
        raise HTTPException(status_code=401, detail="Connect your generation account first")
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
        raise HTTPException(status_code=401, detail="Your generation account connection expired. Connect again.")
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
) -> dict[str, Any]:
    """Blocking Gradio client call; run in a worker thread from async routes."""
    from gradio_client import Client, handle_file

    client = Client(HF_SPACE_ID, token=hf_token, verbose=False, analytics_enabled=False, httpx_kwargs={"timeout": 240})
    try:
        result = client.predict(
            text,
            handle_file(audio_path),
            reference_text,
            reference_language,
            "bn",
            True,
            0,
            True,
            api_name="/clone_speak",
        )
    finally:
        close = getattr(client, "close", None)
        if callable(close):
            close()

    if not isinstance(result, dict) or not result.get("audio_url"):
        raise RuntimeError("Creovanta speech service returned an unexpected audio result")
    return result


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
            result = await asyncio.to_thread(
                _call_speech_clone,
                hf_token,
                audio_path,
                text,
                reference_text,
                reference_language,
            )
        except Exception as exc:
            diagnostic = str(exc).replace(hf_token, "[redacted]")[:800]
            print(f"[creovanta-speech] generation failed: {type(exc).__name__}: {diagnostic}", flush=True)
            message = str(exc).lower()
            if "quota" in message or "exceeded" in message:
                raise HTTPException(
                    status_code=429,
                    detail="Your daily generation allowance may be exhausted. Try again after it resets.",
                ) from exc
            raise HTTPException(
                status_code=502,
                detail="Creovanta could not generate audio. Check the reference clip and transcript, then retry.",
            ) from exc

    audio_url = str(result["audio_url"])
    resolved_url = urljoin(HF_SPACE_URL + "/", audio_url)
    parsed = urlparse(resolved_url)
    if parsed.scheme != "https" or parsed.hostname != urlparse(HF_SPACE_URL).hostname:
        raise HTTPException(status_code=502, detail="Creovanta returned an invalid audio location")

    audio_response = await client.get(
        resolved_url, headers={"Authorization": f"Bearer {hf_token}"}
    )
    if not audio_response.is_success or not audio_response.content:
        raise HTTPException(status_code=502, detail="Creovanta generated audio but it could not be retrieved")
    return audio_response.content, float(result.get("duration") or 0)


async def _set_profile_status(
    client: httpx.AsyncClient,
    supabase_url: str,
    service_key: str,
    profile_id: UUID,
    user_id: str,
    status: str,
) -> None:
    headers = {
        "apikey": service_key,
        "Authorization": f"Bearer {service_key}",
        "Content-Type": "application/json",
        "Prefer": "return=minimal",
    }
    response = await client.patch(
        f"{supabase_url}/rest/v1/voice_profiles",
        params={"id": f"eq.{profile_id}", "user_id": f"eq.{user_id}"},
        headers=headers,
        json={"status": status},
    )
    response.raise_for_status()


@router.post("/voices/clone")
async def clone_voice(
    request: CloneRequest,
    authorization: str | None = Header(default=None),
    hf_token_header: str | None = Header(default=None, alias="X-HF-Token"),
) -> dict[str, str]:
    """Validate ownership/consent and run a real reference-audio cloning smoke test."""
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
            return {"status": "ready", "message": "Your Creovanta voice profile passed the cloning test"}
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
