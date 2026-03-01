from __future__ import annotations

from flask import Blueprint, current_app, jsonify, request

from app.schemas import SummarizeRequest
from app.services.fetcher import fetch_pdf_text_from_url, is_probable_pdf_url
from app.services.summarizer import summarize_payload

api_bp = Blueprint("api", __name__)


@api_bp.get("/health")
def health():
    settings = current_app.config["SETTINGS"]
    return jsonify(
        {
            "status": "ok",
            "service": "pagebrief",
            "llm_enabled": settings.llm_enabled,
            "llm_provider": settings.llm_provider,
            "llm_model": settings.llm_model,
        }
    )


@api_bp.post("/v1/pagebrief/summarize")
def summarize_page():
    settings = current_app.config["SETTINGS"]
    llm_client = current_app.config["LLM_CLIENT"]

    payload = SummarizeRequest.from_dict(request.get_json(silent=True) or {})

    source_text = (payload.page_text or "").strip()
    source_kind = "html"

    if not source_text and payload.url and is_probable_pdf_url(payload.url):
        try:
            source_text = fetch_pdf_text_from_url(payload.url, settings)
            source_kind = "pdf"
        except ValueError as exc:
            return jsonify({"ok": False, "error": str(exc)}), 422
        except Exception as exc:
            return jsonify({"ok": False, "error": f"Échec de lecture du PDF: {exc}"}), 502

    if not source_text:
        return jsonify(
            {
                "ok": False,
                "error": "Aucun texte exploitable reçu. Sur une page HTML, l'extension doit envoyer page_text. Sur un PDF public, l'URL doit être directe.",
            }
        ), 422

    result = summarize_payload(
        title=payload.title,
        url=payload.url,
        mode=payload.mode,
        source_text=source_text,
        source_kind=source_kind,
        settings=settings,
        llm_client=llm_client,
    )
    return jsonify({"ok": True, **result})
