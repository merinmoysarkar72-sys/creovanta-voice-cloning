from __future__ import annotations

from typing import Any
import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic_settings import BaseSettings, SettingsConfigDict

from app.services.worker_client import worker_health
from app.services.cartesia_tts import router as cartesia_router


class Settings(BaseSettings):
    app_env: str = "development"
    cors_origins: str = "http://localhost:3000"

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    @property
    def allowed_origins(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]


settings = Settings()

app = FastAPI(
    title="Creovanta API",
    description="Backend API for the Creovanta voice platform.",
    version="0.2.0",
)

app.include_router(cartesia_router)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)


@app.get("/")
async def root() -> dict[str, str]:
    return {"name": "Creovanta API", "status": "running", "docs": "/docs"}


@app.get("/health")
async def health() -> dict[str, Any]:
    worker = await worker_health()
    return {
        "ok": True,
        "service": "creovanta-api",
        "environment": settings.app_env,
        "voice_engine": "cartesia_configured" if all(os.getenv(key) for key in ("CARTESIA_API_KEY", "CARTESIA_VOICE_ID", "SUPABASE_URL", "SUPABASE_ANON_KEY", "CARTESIA_OWNER_USER_ID")) else "cartesia_configuration_incomplete",
        "gpu_worker": worker,
    }


@app.get("/api/v1")
async def api_info() -> dict[str, str]:
    return {
        "name": "Creovanta",
        "api_version": "v1",
        "status": "integration_scaffold",
        "message": "GPU worker client is staged; user authentication, consent checks, job persistence, and model inference must be completed before generation is enabled.",
    }
