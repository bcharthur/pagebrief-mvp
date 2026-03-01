from __future__ import annotations

from flask import Flask
from flask_cors import CORS

from app.config import settings
from app.routes import api_bp
from app.services.llm_client import PageBriefLlmClient


def create_app() -> Flask:
    app = Flask(__name__)
    app.config["SETTINGS"] = settings
    app.config["LLM_CLIENT"] = PageBriefLlmClient(settings)

    CORS(
        app,
        resources={r"/*": {"origins": settings.allowed_origins or ["*"]}},
        supports_credentials=False,
    )

    app.register_blueprint(api_bp)
    return app
