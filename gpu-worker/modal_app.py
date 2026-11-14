"""Creovanta GPU worker deployment scaffold.

This service deliberately refuses generation until a reviewed model adapter is
installed. It must never report a fake successful synthesis.
"""
import os
from fastapi import FastAPI, Header, HTTPException
from urllib.parse import urlparse
from pydantic import BaseModel, Field
import modal

APP_NAME = "creovanta-voice-worker"
GPU_TYPE = os.getenv("CREOVANTA_GPU", "").strip() or None
app = modal.App(APP_NAME)
image = modal.Image.debian_slim(python_version="3.11").pip_install(
    "fastapi==0.115.12",
    "pydantic==2.10.6",
    "httpx==0.28.1",
)
model_cache = modal.Volume.from_name("creovanta-model-cache", create_if_missing=True)

web = FastAPI(title="Creovanta GPU Worker", version="0.1.0")


class GenerateRequest(BaseModel):
    generation_id: str = Field(min_length=8, max_length=128)
    voice_profile_id: str = Field(min_length=8, max_length=128)
    text: str = Field(min_length=1, max_length=2000)
    reference_audio_url: str = Field(min_length=1, max_length=4096)



def validate_reference_audio_url(value: str) -> None:
    """Allow only signed objects from this project's private voice-samples bucket."""
    configured = os.environ.get("SUPABASE_URL", "").strip().rstrip("/")
    if not configured:
        raise HTTPException(status_code=503, detail="Storage origin is not configured")
    expected = urlparse(configured)
    supplied = urlparse(value)
    expected_prefix = "/storage/v1/object/sign/voice-samples/"
    if (
        expected.scheme != "https"
        or not expected.hostname
        or supplied.scheme != "https"
        or supplied.hostname != expected.hostname
        or supplied.port not in (None, 443)
        or supplied.username
        or supplied.password
        or not supplied.path.startswith(expected_prefix)
        or not supplied.query
    ):
        raise HTTPException(status_code=400, detail="Invalid private voice sample URL")

def require_worker_token(authorization: str | None) -> None:
    expected = os.environ.get("CREOVANTA_WORKER_TOKEN")
    if not expected:
        raise HTTPException(status_code=503, detail="Worker authentication is not configured")
    if authorization != f"Bearer {expected}":
        raise HTTPException(status_code=401, detail="Unauthorized")


@web.get("/health")
async def health(authorization: str | None = Header(default=None)):
    require_worker_token(authorization)
    # This is infrastructure health, not proof that a voice model is loaded.
    return {
        "status": "ok",
        "service": APP_NAME,
        "gpu": GPU_TYPE or "none (CPU-only)",
        "model_status": "not_configured",
        "generation_enabled": False,
    }


@web.post("/v1/generate")
async def generate(
    request: GenerateRequest,
    authorization: str | None = Header(default=None),
):
    require_worker_token(authorization)
    validate_reference_audio_url(request.reference_audio_url)
    # Fail closed until license review, pinned model artifacts, audio validation,
    # consent checks, and the Chatterbox adapter have all passed.
    raise HTTPException(
        status_code=503,
        detail="Voice generation is disabled: the Bangla model adapter is not installed.",
    )


@app.function(
    image=image,
    gpu=GPU_TYPE,
    volumes={"/model-cache": model_cache},
    secrets=[modal.Secret.from_name("creovanta-worker")],
    timeout=900,
    scaledown_window=300,
    max_containers=2,
)
@modal.asgi_app()
def serve():
    return web
