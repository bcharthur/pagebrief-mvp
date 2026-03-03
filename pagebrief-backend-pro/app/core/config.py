from __future__ import annotations

from functools import lru_cache
from typing import Annotated, List

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    app_env: str = "development"
    app_host: str = "0.0.0.0"
    app_port: int = 8000
    app_secret_key: str = "change-me"
    app_access_token_expire_minutes: int = 60 * 24

    database_url: str = "postgresql+psycopg://pagebrief:pagebrief@localhost:5432/pagebrief"
    redis_url: str = "redis://localhost:6379/0"
    celery_broker_url: str = "redis://localhost:6379/1"
    celery_result_backend: str = "redis://localhost:6379/2"

    ollama_base_url: str = "http://localhost:11434"
    ollama_model: str = "llama3.2:3b"
    ollama_timeout_s: int = 180

    free_daily_analyses: int = 5
    free_allowed_formats: Annotated[List[str], NoDecode] = Field(default_factory=lambda: ["express"])
    premium_allowed_formats: Annotated[List[str], NoDecode] = Field(default_factory=lambda: ["express", "analytique", "decision", "etude"])

    max_upload_mb: int = 25
    pdf_overview_threshold: int = 50000
    max_input_chars: int = 7000

    cors_allowed_origins: Annotated[List[str], NoDecode] = Field(default_factory=lambda: ["*"])
    storage_root: str = "/tmp/pagebrief-storage"
    log_level: str = "INFO"

    @field_validator("free_allowed_formats", "premium_allowed_formats", "cors_allowed_origins", mode="before")
    @classmethod
    def split_csv(cls, value):
        if isinstance(value, str):
            return [part.strip() for part in value.split(",") if part.strip()]
        return value


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
