from __future__ import annotations

import json
import logging

import httpx

from app.core.config import get_settings


logger = logging.getLogger("app.llm")


def _prompt_for(format_name: str, text: str, title: str, strategy: str) -> str:
    instructions = {
        "express": "Retourne une vue d'ensemble brève: intro, points clés, conclusion.",
        "analytique": "Retourne une vue structurée: intro, structure, nuances, conclusion.",
        "decision": "Retourne: contexte, actions, risques, zones floues, recommandation.",
        "etude": "Retourne: intro pédagogique, définitions, notions, repères, conclusion.",
    }
    rule = instructions.get(format_name, instructions["express"])
    return (
        "Tu es le moteur de synthèse de PageBrief. "
        "Retourne uniquement un JSON valide avec les clés: "
        "panel_title, analysis_basis, source_note, intro_lines, key_points, conclusion, "
        "annex_blocks, confidence. "
        "Chaque champ doit être fidèle au texte fourni. "
        "N'invente aucune date, aucun fait absent. "
        f"{rule}\n"
        f"Titre: {title or 'Document'}\n"
        f"Stratégie: {strategy}\n\n"
        f"Texte:\n{text}"
    )


def generate_summary(format_name: str, text: str, title: str, strategy: str) -> dict:
    settings = get_settings()
    prompt = _prompt_for(format_name, text, title, strategy)
    body = {
        "model": settings.ollama_model,
        "prompt": prompt,
        "stream": False,
        "format": {
            "type": "object",
            "properties": {
                "panel_title": {"type": "string"},
                "analysis_basis": {"type": "string"},
                "source_note": {"type": "string"},
                "intro_lines": {"type": "array", "items": {"type": "string"}},
                "key_points": {"type": "array", "items": {"type": "string"}},
                "conclusion": {"type": "string"},
                "annex_blocks": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "title": {"type": "string"},
                            "items": {"type": "array", "items": {"type": "string"}}
                        },
                        "required": ["title", "items"]
                    }
                },
                "confidence": {"type": "string"}
            },
            "required": ["panel_title", "analysis_basis", "source_note", "intro_lines", "key_points", "conclusion", "annex_blocks", "confidence"]
        },
        "options": {"num_predict": 520}
    }
    endpoint = settings.ollama_base_url.rstrip("/") + "/api/generate"
    with httpx.Client(timeout=settings.ollama_timeout_s) as client:
        response = client.post(endpoint, json=body)
        response.raise_for_status()
        payload = response.json()

    content = (payload.get("response") or "").strip()
    if content.startswith("```json"):
        content = content[7:]
    if content.startswith("```"):
        content = content[3:]
    if content.endswith("```"):
        content = content[:-3]
    content = content.strip()

    if payload.get("done_reason") == "length":
        raise ValueError("Réponse LLM tronquée (done_reason=length).")

    try:
        return json.loads(content)
    except json.JSONDecodeError as exc:
        logger.warning("Réponse LLM invalide, fallback heuristique.")
        raise ValueError("Réponse LLM invalide.") from exc
