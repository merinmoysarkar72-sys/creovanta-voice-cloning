"""User-initiated account and data deletion for Google Play compliance."""
from __future__ import annotations

import os
from typing import Any

import httpx
from fastapi import APIRouter, Header, HTTPException

router = APIRouter(prefix="/api/v1", tags=["account"])
BUCKET = "voice-samples"


def _required_env(name: str) -> str:
    value = os.getenv(name, "").strip()
    if not value:
        raise HTTPException(status_code=503, detail=f"Server configuration missing: {name}")
    return value


def _bearer(authorization: str | None) -> str:
    if not authorization:
        raise HTTPException(status_code=401, detail="Sign in is required")
    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not token.strip():
        raise HTTPException(status_code=401, detail="A valid bearer token is required")
    return token.strip()


@router.delete("/account")
async def delete_account(authorization: str | None = Header(default=None)) -> dict[str, Any]:
    """Delete the authenticated account, its private voice samples, and database records."""
    user_token = _bearer(authorization)
    supabase_url = _required_env("SUPABASE_URL").rstrip("/")
    anon_key = _required_env("SUPABASE_ANON_KEY")
    service_key = _required_env("SUPABASE_SERVICE_ROLE_KEY")
    admin_headers = {
        "apikey": service_key,
        "Authorization": f"Bearer {service_key}",
        "Content-Type": "application/json",
    }
    user_headers = {"apikey": anon_key, "Authorization": f"Bearer {user_token}"}

    try:
        async with httpx.AsyncClient(
            timeout=httpx.Timeout(45.0, connect=10.0, write=20.0),
            follow_redirects=False,
        ) as client:
            identity = await client.get(f"{supabase_url}/auth/v1/user", headers=user_headers)
            if identity.status_code in (401, 403):
                raise HTTPException(status_code=401, detail="Your session is invalid or expired")
            identity.raise_for_status()
            user_id = str(identity.json().get("id") or "")
            if not user_id:
                raise HTTPException(status_code=401, detail="Could not verify your account")

            # Remove all private voice samples first; Supabase Auth refuses to delete
            # users who still own Storage objects.
            offset = 0
            while True:
                listing = await client.post(
                    f"{supabase_url}/storage/v1/object/list/{BUCKET}",
                    headers=admin_headers,
                    json={"prefix": f"{user_id}/", "limit": 1000, "offset": offset, "sortBy": {"column": "name", "order": "asc"}},
                )
                listing.raise_for_status()
                items = listing.json()
                paths = [
                    f"{user_id}/{item['name']}"
                    for item in items
                    if isinstance(item, dict) and item.get("name") and item.get("id") is not None
                ]
                if paths:
                    removal = await client.delete(
                        f"{supabase_url}/storage/v1/object/{BUCKET}",
                        headers=admin_headers,
                        json={"prefixes": paths},
                    )
                    removal.raise_for_status()
                if len(items) < 1000:
                    break
                offset += 1000

            # Auth-user deletion cascades to Creovanta's voice_profiles,
            # voice_consents, voice_generations, and usage_events tables.
            deletion = await client.delete(
                f"{supabase_url}/auth/v1/admin/users/{user_id}",
                headers=admin_headers,
            )
            if deletion.status_code not in (200, 204):
                deletion.raise_for_status()

            return {
                "status": "deleted",
                "message": "Your Creovanta account, database records, and private voice samples have been deleted.",
                "external_processing_note": "Copies previously sent to external speech providers are governed by those providers' retention policies.",
            }
    except HTTPException:
        raise
    except httpx.HTTPStatusError as exc:
        status = exc.response.status_code
        if status in (401, 403):
            raise HTTPException(status_code=502, detail="Account deletion was blocked by the data service; contact support before retrying") from exc
        raise HTTPException(status_code=502, detail="Account data could not be fully deleted. Please retry or contact support.") from exc
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail="Could not reach the account data service. Please retry.") from exc
