"""Creovanta GPU worker powered by Maya 2 Native.

The worker accepts only authenticated server-to-server requests. Render remains
responsible for Supabase JWT verification, profile ownership, consent and quotas.
"""
from __future__ import annotations

import asyncio
import base64
import hmac
import os
import subprocess
import tempfile
from pathlib import Path
from urllib.parse import urlparse

import httpx
import modal
from fastapi import FastAPI, Header, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

APP_NAME = "creovanta-voice-worker"
MODEL_ID = "maya-research/maya2-native"
GPU_TYPE = os.getenv("CREOVANTA_GPU", "L4").strip() or "L4"
MAX_REFERENCE_BYTES = 50 * 1024 * 1024
MAX_REFERENCE_SECONDS = 30.0
MIN_REFERENCE_SECONDS = 3.0

app = modal.App(APP_NAME)
model_cache = modal.Volume.from_name("creovanta-model-cache", create_if_missing=True)

# Install the upstream inference engine with its documented CUDA 12.8 wheels.
image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("git", "ffmpeg")
    .pip_install(
        "fastapi==0.115.12",
        "pydantic==2.10.6",
        "httpx==0.28.1",
    )
    .run_commands(
        "git clone --depth 1 https://github.com/MayaResearch/maya2-native /opt/maya3",
        "cd /opt/maya3 && python -m pip install --no-cache-dir -e '.[server]' --extra-index-url https://download.pytorch.org/whl/cu128",
    )
    .env({"HF_HOME": "/model-cache/huggingface", "HF_HUB_CACHE": "/model-cache/huggingface/hub"})
)


class GenerateRequest(BaseModel):
    generation_id: str = Field(min_length=8, max_length=128)
    voice_profile_id: str = Field(min_length=8, max_length=128)
    text: str = Field(min_length=1, max_length=2000)
    reference_audio_url: str = Field(min_length=1, max_length=4096)


def require_worker_token(authorization: str | None) -> None:
    expected = os.environ.get("CREOVANTA_WORKER_TOKEN", "")
    if not expected:
        raise HTTPException(status_code=503, detail="Worker authentication is not configured")
    supplied = authorization or ""
    if not hmac.compare_digest(supplied, f"Bearer {expected}"):
        raise HTTPException(status_code=401, detail="Unauthorized")


def validate_reference_audio_url(value: str) -> None:
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
        or supplied.fragment
        or not supplied.path.startswith(expected_prefix)
        or not supplied.query
    ):
        raise HTTPException(status_code=400, detail="Invalid private voice sample URL")


@app.function(
    image=image,
    gpu=GPU_TYPE,
    volumes={"/model-cache": model_cache},
    secrets=[modal.Secret.from_name("creovanta-worker")],
    timeout=900,
    scaledown_window=300,
    max_containers=1,
)
@modal.asgi_app()
def serve():
    # Loading happens inside the GPU container. The persistent volume caches
    # model weights, Mimi and ECAPA assets between scale-to-zero restarts.
    from maya3 import Maya3TTS
    import soundfile as sf

    os.environ.setdefault("HF_HOME", "/model-cache/huggingface")
    tts = Maya3TTS.from_pretrained(MODEL_ID, max_seats=1)
    model_cache.commit()

    api = FastAPI(title="Creovanta Maya 2 Native Worker", version="1.0.0")

    @api.get("/health")
    async def health(authorization: str | None = Header(default=None)):
        require_worker_token(authorization)
        return {
            "status": "ok",
            "service": APP_NAME,
            "gpu": GPU_TYPE,
            "model": MODEL_ID,
            "model_status": "ready",
            "generation_enabled": True,
        }

    @api.post("/v1/generate")
    async def generate(
        request: GenerateRequest,
        authorization: str | None = Header(default=None),
    ):
        require_worker_token(authorization)
        validate_reference_audio_url(request.reference_audio_url)
        if not request.text.strip():
            raise HTTPException(status_code=400, detail="Text must not be empty")

        try:
            async with httpx.AsyncClient(
                timeout=httpx.Timeout(90.0),
                follow_redirects=False,
            ) as client:
                sample_response = await client.get(request.reference_audio_url)
                sample_response.raise_for_status()
                sample_bytes = sample_response.content

            if not sample_bytes or len(sample_bytes) > MAX_REFERENCE_BYTES:
                raise HTTPException(status_code=400, detail="Voice sample is empty or exceeds 50 MB")

            with tempfile.TemporaryDirectory(prefix="creovanta-maya-") as temp_dir:
                source_path = Path(temp_dir) / "reference.upload"
                wav_path = Path(temp_dir) / "reference.wav"
                source_path.write_bytes(sample_bytes)

                conversion = subprocess.run(
                    [
                        "ffmpeg", "-nostdin", "-v", "error", "-y",
                        "-i", str(source_path), "-vn", "-ac", "1", "-ar", "24000",
                        "-c:a", "pcm_s16le", str(wav_path),
                    ],
                    capture_output=True,
                    text=True,
                    timeout=60,
                    check=False,
                )
                if conversion.returncode != 0 or not wav_path.exists():
                    raise HTTPException(status_code=400, detail="Voice sample could not be decoded")

                info = sf.info(str(wav_path))
                if info.duration < MIN_REFERENCE_SECONDS or info.duration > MAX_REFERENCE_SECONDS:
                    raise HTTPException(
                        status_code=400,
                        detail="Voice sample must be 3–30 seconds; 3–10 seconds is recommended",
                    )

                # The current Creovanta upload flow does not collect a transcript.
                # Use Maya's speaker-embedding-only mode until transcript capture
                # is added to the product; it does not fabricate reference text.
                audio = await asyncio.to_thread(
                    tts.generate,
                    request.text.strip(),
                    lang="bn",
                    ref_audio=str(wav_path),
                    ref_lang="bn",
                    mode="spk",
                    normalize=True,
                )

                if audio is None or len(audio) == 0:
                    raise HTTPException(status_code=502, detail="Maya returned empty audio")

                import io
                output = io.BytesIO()
                sf.write(output, audio, 24000, format="WAV", subtype="PCM_16")
                wav_bytes = output.getvalue()

            return JSONResponse(
                {
                    "status": "ok",
                    "generation_id": request.generation_id,
                    "voice_profile_id": request.voice_profile_id,
                    "model": MODEL_ID,
                    "format": "wav",
                    "sample_rate": 24000,
                    "channels": 1,
                    "audio_base64": base64.b64encode(wav_bytes).decode("ascii"),
                },
                headers={"Cache-Control": "no-store"},
            )
        except HTTPException:
            raise
        except httpx.HTTPError as exc:
            raise HTTPException(status_code=502, detail="Could not download the private voice sample") from exc
        except subprocess.TimeoutExpired as exc:
            raise HTTPException(status_code=400, detail="Voice sample conversion timed out") from exc
        except Exception as exc:
            # Keep provider internals and sample contents out of public responses.
            raise HTTPException(status_code=502, detail="Maya voice generation failed") from exc

    return api
