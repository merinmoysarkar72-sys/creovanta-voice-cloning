"""Authenticated Cartesia TTS integration.

The Cartesia key and cloned voice ID stay server-side. Requests are restricted
to the configured owner account and require an owned profile with recorded consent.
"""
from __future__ import annotations

import os
from uuid import UUID

import httpx
from fastapi import APIRouter, Header, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel, Field

router = APIRouter(prefix="/api/v1", tags=["speech"])

CARTESIA_URL = "https://api.cartesia.ai/tts/bytes"
CARTESIA_VERSION = "2026-03-01"


class TTSRequest(BaseModel):
    voice_profile_id: UUID
    text: str = Field(min_length=1, max_length=2000)


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


@router.post("/tts")
async def generate_speech(
    request: TTSRequest,
    authorization: str | None = Header(default=None),
) -> Response:
    token = _bearer_token(authorization)
    supabase_url = _required_env("SUPABASE_URL").rstrip("/")
    anon_key = _required_env("SUPABASE_ANON_KEY")
    owner_id = _required_env("CARTESIA_OWNER_USER_ID")
    cartesia_key = _required_env("CARTESIA_API_KEY")
    voice_id = _required_env("CARTESIA_VOICE_ID")

    try:
        UUID(owner_id)
    except ValueError as exc:
        raise HTTPException(status_code=503, detail="CARTESIA_OWNER_USER_ID must be a UUID") from exc

    user_headers = {"apikey": anon_key, "Authorization": f"Bearer {token}"}
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(15.0)) as client:
            auth_response = await client.get(f"{supabase_url}/auth/v1/user", headers=user_headers)
            if auth_response.status_code == 401:
                raise HTTPException(status_code=401, detail="Your session is invalid or expired")
            auth_response.raise_for_status()
            user = auth_response.json()
            user_id = user.get("id")
            if user_id != owner_id:
                raise HTTPException(status_code=403, detail="This voice is restricted to its owner")

            profile_response = await client.get(
                f"{supabase_url}/rest/v1/voice_profiles",
                params={
                    "id": f"eq.{request.voice_profile_id}",
                    "user_id": f"eq.{user_id}",
                    "select": "id",
                },
                headers={**user_headers, "Accept": "application/json"},
            )
            profile_response.raise_for_status()
            if not profile_response.json():
                raise HTTPException(status_code=404, detail="Voice profile not found for this account")

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
                CARTESIA_URL,
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
