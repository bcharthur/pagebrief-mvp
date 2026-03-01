from __future__ import annotations

from flask import Blueprint, current_app, jsonify, request

from app.schemas import SummarizeRequest
from app.services.fetcher import fetch_pdf_text_from_url, is_probable_pdf_url
from app.services.summarizer import summarize_payload

api_bp = Blueprint("api", __name__)


@api_bp.get("/")
def root():
    current_app.logger.info("Route racine appelée")
    return health()


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
            "llm_base_url": settings.llm_base_url,
            "llm_timeout_s": settings.llm_timeout_s,
            "llm_max_output_tokens": settings.llm_max_output_tokens,
            "max_input_chars": settings.max_input_chars,
            "log_level": settings.log_level,
        }
    )


@api_bp.post("/v1/pagebrief/summarize")
def summarize_page():
    settings = current_app.config["SETTINGS"]
    llm_client = current_app.config["LLM_CLIENT"]

    raw_json = request.get_json(silent=True) or {}
    payload = SummarizeRequest.from_dict(raw_json)

    current_app.logger.info(
        "Résumé demandé | mode=%s title=%r url=%r page_text_len=%s llm_enabled=%s provider=%s model=%s",
        payload.mode,
        (payload.title or "")[:80],
        payload.url,
        len((payload.page_text or "").strip()),
        settings.llm_enabled,
        settings.llm_provider,
        settings.llm_model,
    )

    source_text = (payload.page_text or "").strip()
    source_kind = "html"

    if not source_text and payload.url and is_probable_pdf_url(payload.url):
        current_app.logger.info("Aucun texte HTML fourni, tentative extraction PDF distante")
        try:
            source_text = fetch_pdf_text_from_url(payload.url, settings)
            source_kind = "pdf"
            current_app.logger.info("Extraction PDF réussie | chars=%s", len(source_text))
        except ValueError as exc:
            current_app.logger.warning("Extraction PDF invalide: %s", exc)
            return jsonify({"ok": False, "error": str(exc)}), 422
        except Exception as exc:
            current_app.logger.exception("Échec de lecture du PDF")
            return jsonify({"ok": False, "error": f"Échec de lecture du PDF: {exc}"}), 502

    if not source_text:
        current_app.logger.warning("Aucun texte exploitable reçu après extraction")
        return jsonify(
            {
                "ok": False,
                "error": "Aucun texte exploitable reçu. Sur une page HTML, l'extension doit envoyer page_text. Sur un PDF public, l'URL doit être directe.",
            }
        ), 422

    current_app.logger.info("Préparation du résumé | source_kind=%s source_chars=%s", source_kind, len(source_text))

    result = summarize_payload(
        title=payload.title,
        url=payload.url,
        mode=payload.mode,
        source_text=source_text,
        source_kind=source_kind,
        settings=settings,
        llm_client=llm_client,
        logger=current_app.logger,
    )
    current_app.logger.info(
        "Résumé prêt | engine=%s reading_time=%s summary_points=%s actions=%s risks=%s",
        result.get("engine"),
        result.get("reading_time_min"),
        len(result.get("summary_points") or []),
        len(result.get("actions") or []),
        len(result.get("risks") or []),
    )
    return jsonify({"ok": True, **result})
