"""Authenticated, per-profile Cartesia voice cloning and Bengali TTS."""
from __future__ import annotations

import os
from urllib.parse import quote
from uuid import UUID

import httpx
from fastapi import APIRouter, Header, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel, Field

router = APIRouter(prefix="/api/v1", tags=["speech"])

CARTESIA_URL = "https://api.cartesia.ai"
CARTESIA_VERSION = "2026-03-01"
VOICE_BUCKET = "voice-samples"


class TTSRequest(BaseModel):
    voice_profile_id: UUID
    text: str = Field(min_length=1, max_length=2000)


class CloneRequest(BaseModel):
    voice_profile_id: UUID


def _required_env(name: str) -> str:
    value = os.getenv(name, "").strip()
    if not value:
        raise HTTPException(status_code=503, detail=f"Server configuration missing: {name}")
    return value


def _bearer_token(authorization: str | None) -> str:
    if not authorization:
        raise HTTPException(status_code=401, detail="Sign in is required")
    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not token.strip():
        raise HTTPException(status_code=401, detail="A valid bearer token is required")
    return token.strip()


def _user_headers(anon_key: str, token: str) -> dict[str, str]:
    return {"apikey": anon_key, "Authorization": f"Bearer {token}"}


async def _authenticated_user(client: httpx.AsyncClient, supabase_url: str, headers: dict[str, str]) -> str:
    response = await client.get(f"{supabase_url}/auth/v1/user", headers=headers)
    if response.status_code == 401:
        raise HTTPException(status_code=401, detail="Your session is invalid or expired")
    response.raise_for_status()
    user_id = response.json().get("id")
    if not user_id:
        raise HTTPException(status_code=401, detail="Could not verify the signed-in account")
    return user_id


async def _record_status(
    client: httpx.AsyncClient,
    supabase_url: str,
    service_key: str,
    profile_id: UUID,
    user_id: str,
    values: dict[str, str | None],
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
        json=values,
    )
    response.raise_for_status()


@router.post("/voices/clone")
async def clone_voice(
    request: CloneRequest,
    authorization: str | None = Header(default=None),
) -> dict[str, str]:
    """Clone only a profile owned by the authenticated user with accepted consent."""
    token = _bearer_token(authorization)
    supabase_url = _required_env("SUPABASE_URL").rstrip("/")
    anon_key = _required_env("SUPABASE_ANON_KEY")
    service_key = _required_env("SUPABASE_SERVICE_ROLE_KEY")
    cartesia_key = _required_env("CARTESIA_API_KEY")
    user_headers = _user_headers(anon_key, token)

    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(90.0), follow_redirects=False) as client:
            user_id = await _authenticated_user(client, supabase_url, user_headers)

            profile_response = await client.get(
                f"{supabase_url}/rest/v1/voice_profiles",
                params={
                    "id": f"eq.{request.voice_profile_id}",
                    "user_id": f"eq.{user_id}",
                    "select": "id,name,description,source_audio_path,status,provider_voice_id,language_code",
                },
                headers={**user_headers, "Accept": "application/json"},
            )
            profile_response.raise_for_status()
            profiles = profile_response.json()
            if not profiles:
                raise HTTPException(status_code=404, detail="Voice profile not found for this account")
            profile = profiles[0]
            if profile.get("provider_voice_id") and profile.get("status") == "ready":
                return {"status": "ready", "message": "Voice profile is already ready"}

            consent_response = await client.get(
                f"{supabase_url}/rest/v1/voice_consents",
                params={
                    "voice_profile_id": f"eq.{request.voice_profile_id}",
                    "user_id": f"eq.{user_id}",
                    "accepted": "eq.true",
                    "select": "id",
                },
                headers={**user_headers, "Accept": "application/json"},
            )
            consent_response.raise_for_status()
            if not consent_response.json():
                raise HTTPException(status_code=403, detail="Accepted voice consent is required")

            object_path = str(profile.get("source_audio_path") or "")
            if not object_path or not object_path.startswith(f"{user_id}/"):
                raise HTTPException(status_code=403, detail="Voice sample path is not owned by this account")

            storage_url = (
                f"{supabase_url}/storage/v1/object/authenticated/"
                f"{VOICE_BUCKET}/{quote(object_path, safe='/')}"
            )
            sample_response = await client.get(storage_url, headers=user_headers)
            if sample_response.status_code in (401, 403, 404):
                raise HTTPException(status_code=404, detail="Private voice sample could not be accessed")
            sample_response.raise_for_status()
            if not sample_response.content or len(sample_response.content) > 50 * 1024 * 1024:
                raise HTTPException(status_code=400, detail="Voice sample is empty or exceeds 50 MB")

            filename = object_path.rsplit("/", 1)[-1]
            content_type = sample_response.headers.get("content-type", "application/octet-stream")
            clone_response = await client.post(
                f"{CARTESIA_URL}/voices/clone",
                headers={
                    "Authorization": f"Bearer {cartesia_key}",
                    "Cartesia-Version": CARTESIA_VERSION,
                },
                data={
                    "name": str(profile.get("name") or "Creovanta Voice"),
                    "language": str(profile.get("language_code") or "bn"),
                    "description": str(profile.get("description") or "Private Creovanta voice profile"),
                    "access[type]": "private",
                },
                files={"clip": (filename, sample_response.content, content_type)},
            )
            if clone_response.status_code == 401:
                raise HTTPException(status_code=502, detail="Cartesia rejected the server API key")
            if clone_response.status_code == 403:
                raise HTTPException(status_code=502, detail="Cartesia voice cloning permission or plan is unavailable")
            if clone_response.status_code == 429:
                raise HTTPException(status_code=429, detail="Cartesia voice cloning rate limit reached")
            if not clone_response.is_success:
                raise HTTPException(status_code=502, detail=f"Cartesia voice cloning failed (HTTP {clone_response.status_code})")
            provider_voice_id = clone_response.json().get("id")
            if not provider_voice_id:
                raise HTTPException(status_code=502, detail="Cartesia did not return a voice ID")

            try:
                await _record_status(
                    client,
                    supabase_url,
                    service_key,
                    request.voice_profile_id,
                    user_id,
                    {"provider_voice_id": provider_voice_id, "status": "ready"},
                )
            except httpx.HTTPError:
                # Avoid leaving an untracked provider voice if the database write fails.
                await client.delete(
                    f"{CARTESIA_URL}/voices/{quote(str(provider_voice_id), safe='')}",
                    headers={"Authorization": f"Bearer {cartesia_key}", "Cartesia-Version": CARTESIA_VERSION},
                )
                raise HTTPException(status_code=502, detail="Voice was created but could not be safely linked to your profile")

            return {"status": "ready", "message": "Your private voice profile is ready"}
    except HTTPException as exc:
        # A failed clone remains retryable; status updates are best-effort only.
        if exc.status_code not in (401, 403, 404):
            try:
                service_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "").strip()
                if service_key:
                    async with httpx.AsyncClient(timeout=httpx.Timeout(10.0)) as status_client:
                        auth_headers = _user_headers(anon_key, token)
                        user_id = await _authenticated_user(status_client, supabase_url, auth_headers)
                        await _record_status(
                            status_client, supabase_url, service_key,
                            request.voice_profile_id, user_id,
                            {"status": "failed"},
                        )
            except Exception:
                pass
        raise
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail="Could not reach Supabase or the speech provider") from exc


@router.post("/tts")
async def generate_speech(
    request: TTSRequest,
    authorization: str | None = Header(default=None),
) -> Response:
    token = _bearer_token(authorization)
    supabase_url = _required_env("SUPABASE_URL").rstrip("/")
    anon_key = _required_env("SUPABASE_ANON_KEY")
    cartesia_key = _required_env("CARTESIA_API_KEY")
    user_headers = _user_headers(anon_key, token)

    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(60.0)) as client:
            user_id = await _authenticated_user(client, supabase_url, user_headers)

            profile_response = await client.get(
                f"{supabase_url}/rest/v1/voice_profiles",
                params={
                    "id": f"eq.{request.voice_profile_id}",
                    "user_id": f"eq.{user_id}",
                    "select": "id,provider_voice_id,status",
                },
                headers={**user_headers, "Accept": "application/json"},
            )
            profile_response.raise_for_status()
            profiles = profile_response.json()
            if not profiles:
                raise HTTPException(status_code=404, detail="Voice profile not found for this account")
            profile = profiles[0]
            voice_id = profile.get("provider_voice_id")
            if profile.get("status") != "ready" or not voice_id:
                raise HTTPException(status_code=409, detail="This voice profile is not ready yet")

            consent_response = await client.get(
                f"{supabase_url}/rest/v1/voice_consents",
                params={
                    "voice_profile_id": f"eq.{request.voice_profile_id}",
                    "user_id": f"eq.{user_id}",
                    "accepted": "eq.true",
                    "select": "id",
                },
                headers={**user_headers, "Accept": "application/json"},
            )
            consent_response.raise_for_status()
            if not consent_response.json():
                raise HTTPException(status_code=403, detail="Accepted voice consent is required")

            tts_response = await client.post(
                f"{CARTESIA_URL}/tts/bytes",
                headers={
                    "Authorization": f"Bearer {cartesia_key}",
                    "Cartesia-Version": CARTESIA_VERSION,
                    "Content-Type": "application/json",
                },
                json={
                    "model_id": "sonic-3.5",
                    "transcript": request.text,
                    "voice": {"mode": "id", "id": voice_id},
                    "language": "bn",
                    "output_format": {
                        "container": "wav",
                        "encoding": "pcm_s16le",
                        "sample_rate": 44100,
                    },
                },
            )
            if tts_response.status_code == 401:
                raise HTTPException(status_code=502, detail="Cartesia rejected the configured API key")
            if tts_response.status_code == 429:
                raise HTTPException(status_code=429, detail="Cartesia usage limit reached; try again later")
            if not tts_response.is_success:
                raise HTTPException(status_code=502, detail=f"Cartesia generation failed (HTTP {tts_response.status_code})")

            return Response(
                content=tts_response.content,
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
        raise HTTPException(status_code=502, detail="Could not reach the speech provider or Supabase") from exc
