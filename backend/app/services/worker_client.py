"""Authenticated server-to-server client for the separate GPU worker.

Do not call this from browser code. The API must validate the Supabase user,
voice ownership, consent, and quotas before invoking this client.
"""
from __future__ import annotations

import os
from typing import Any
from urllib.parse import urlparse

import httpx
from pydantic import BaseModel, Field


class WorkerNotConfigured(RuntimeError):
    pass


class WorkerUnavailable(RuntimeError):
    pass


class GenerationDispatch(BaseModel):
    generation_id: str = Field(min_length=8, max_length=128)
    voice_profile_id: str = Field(min_length=8, max_length=128)
    text: str = Field(min_length=1, max_length=2000)
    reference_audio_url: str = Field(min_length=1, max_length=4096)


def _worker_config() -> tuple[str, str]:
    base_url = os.getenv("VOICE_ENGINE_URL", "").strip().rstrip("/")
    token = os.getenv("VOICE_ENGINE_API_KEY", "").strip()
    if not base_url or not token:
        raise WorkerNotConfigured("GPU worker URL/token is not configured")

    parsed = urlparse(base_url)
    if parsed.scheme != "https" and parsed.hostname not in {"localhost", "127.0.0.1"}:
        raise WorkerNotConfigured("GPU worker URL must use HTTPS")
    if parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise WorkerNotConfigured("GPU worker URL contains unsupported components")
    return base_url, token


async def worker_health() -> dict[str, Any]:
    """Return a sanitized worker status; never expose secrets or full error bodies."""
    try:
        base_url, token = _worker_config()
    except WorkerNotConfigured:
        return {"configured": False, "reachable": False, "model_status": "unknown"}

    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(5.0)) as client:
            response = await client.get(
                f"{base_url}/health",
                headers={"Authorization": f"Bearer {token}"},
            )
            response.raise_for_status()
            payload = response.json()
            return {
                "configured": True,
                "reachable": True,
                "model_status": payload.get("model_status", "unknown"),
                "generation_enabled": bool(payload.get("generation_enabled", False)),
            }
    except (httpx.HTTPError, ValueError):
        return {"configured": True, "reachable": False, "model_status": "unknown"}


async def dispatch_generation(request: GenerationDispatch) -> dict[str, Any]:
    """Dispatch a job only after API-layer identity/consent/ownership checks."""
    base_url, token = _worker_config()
    try:
        async with httpx.AsyncClient(
            timeout=httpx.Timeout(connect=10.0, read=900.0, write=30.0, pool=10.0),
            follow_redirects=False,
        ) as client:
            response = await client.post(
                f"{base_url}/v1/generate",
                json=request.model_dump(),
                headers={"Authorization": f"Bearer {token}"},
            )
            response.raise_for_status()
            return response.json()
    except httpx.HTTPStatusError as exc:
        # Do not forward upstream response bodies, which may contain sensitive data.
        raise WorkerUnavailable(
            f"GPU worker rejected the request with HTTP {exc.response.status_code}"
        ) from exc
    except httpx.HTTPError as exc:
        raise WorkerUnavailable("GPU worker could not be reached") from exc
