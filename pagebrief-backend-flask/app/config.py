from __future__ import annotations

import os
from dataclasses import dataclass, field

from dotenv import load_dotenv

load_dotenv()


SUPPORTED_FORMATS = ("express", "analytic", "decision", "study")


def _parse_allowed_origins() -> list[str]:
    raw = os.getenv("ALLOWED_ORIGINS", "*")
    parts = [item.strip() for item in raw.split(",") if item.strip()]
    return parts or ["*"]


def _env_bool(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


@dataclass(slots=True)
class Settings:
    app_host: str = field(default_factory=lambda: os.getenv("APP_HOST", "0.0.0.0"))
    app_port: int = field(default_factory=lambda: int(os.getenv("APP_PORT", "8000")))
    allowed_origins: list[str] = field(default_factory=_parse_allowed_origins)

    llm_enabled: bool = field(default_factory=lambda: _env_bool("LLM_ENABLED", True))
    llm_provider: str = field(default_factory=lambda: os.getenv("LLM_PROVIDER", "ollama"))
    llm_base_url: str = field(default_factory=lambda: os.getenv("LLM_BASE_URL", "http://localhost:11434"))
    llm_model: str = field(default_factory=lambda: os.getenv("LLM_MODEL", "llama3.2:3b"))
    llm_timeout_s: float = field(default_factory=lambda: float(os.getenv("LLM_TIMEOUT_S", "180")))
    llm_max_output_tokens: int = field(default_factory=lambda: int(os.getenv("LLM_MAX_OUTPUT_TOKENS", "520")))
    llm_keep_alive: str = field(default_factory=lambda: os.getenv("LLM_KEEP_ALIVE", "10m"))

    fetch_timeout_s: float = field(default_factory=lambda: float(os.getenv("FETCH_TIMEOUT_S", "20")))
    max_input_chars: int = field(default_factory=lambda: int(os.getenv("MAX_INPUT_CHARS", "7000")))
    llm_excerpt_head_chars: int = field(default_factory=lambda: int(os.getenv("LLM_EXCERPT_HEAD_CHARS", "2400")))
    llm_excerpt_tail_chars: int = field(default_factory=lambda: int(os.getenv("LLM_EXCERPT_TAIL_CHARS", "1100")))
    max_selection_chars: int = field(default_factory=lambda: int(os.getenv("MAX_SELECTION_CHARS", "12000")))
    pdf_overview_threshold_chars: int = field(default_factory=lambda: int(os.getenv("PDF_OVERVIEW_THRESHOLD_CHARS", "50000")))
    pdf_overview_head_chars: int = field(default_factory=lambda: int(os.getenv("PDF_OVERVIEW_HEAD_CHARS", "12000")))
    user_agent: str = field(default_factory=lambda: os.getenv("PAGEBRIEF_USER_AGENT", "PageBriefBot/0.3"))
    log_level: str = field(default_factory=lambda: os.getenv("LOG_LEVEL", "INFO"))


settings = Settings()
