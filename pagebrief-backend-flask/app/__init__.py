from __future__ import annotations

import logging
import time
from uuid import uuid4

from flask import Flask, g, request
from flask_cors import CORS

from app.config import settings
from app.routes import api_bp
from app.services.llm_client import PageBriefLlmClient


def _setup_logging(app: Flask) -> None:
    level_name = str(settings.log_level or "INFO").upper()
    level = getattr(logging, level_name, logging.INFO)
    logging.basicConfig(
        level=level,
        format="%(asctime)s | %(levelname)s | %(name)s | %(message)s",
        force=True,
    )
    app.logger.setLevel(level)
    app.logger.info(
        "PageBrief backend initialisé | host=%s port=%s llm_enabled=%s provider=%s model=%s base_url=%s timeout=%ss max_input=%s max_output=%s",
        settings.app_host,
        settings.app_port,
        settings.llm_enabled,
        settings.llm_provider,
        settings.llm_model,
        settings.llm_base_url,
        settings.llm_timeout_s,
        settings.max_input_chars,
        settings.llm_max_output_tokens,
    )


def create_app() -> Flask:
    app = Flask(__name__)
    app.config["SETTINGS"] = settings
    app.config["LLM_CLIENT"] = PageBriefLlmClient(settings)

    _setup_logging(app)

    CORS(
        app,
        resources={r"/*": {"origins": settings.allowed_origins or ["*"]}},
        supports_credentials=False,
    )

    @app.before_request
    def _before_request() -> None:
        g.request_id = uuid4().hex[:8]
        g.request_started_at = time.perf_counter()
        app.logger.info(
            "[%s] -> %s %s | ip=%s",
            g.request_id,
            request.method,
            request.path,
            request.remote_addr,
        )

    @app.after_request
    def _after_request(response):
        started = getattr(g, "request_started_at", None)
        elapsed_ms = 0.0
        if started is not None:
            elapsed_ms = (time.perf_counter() - started) * 1000
        app.logger.info(
            "[%s] <- %s %s | status=%s | %.1f ms",
            getattr(g, "request_id", "--------"),
            request.method,
            request.path,
            response.status_code,
            elapsed_ms,
        )
        response.headers["X-Request-Id"] = getattr(g, "request_id", "")
        return response

    app.register_blueprint(api_bp)
    return app
