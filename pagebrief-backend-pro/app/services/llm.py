from __future__ import annotations

import json
import logging
from typing import Any

import httpx

from app.core.config import get_settings


logger = logging.getLogger("app.llm")


def _format_specific_instruction(format_name: str) -> str:
    instructions = {
        "express": (
            "Produit une synthèse courte et utile : 2 à 3 lignes d'introduction, 3 à 5 points clés, "
            "une conclusion nette, et 1 bloc annexe maximum."
        ),
        "analytique": (
            "Produit une synthèse structurée : angle général, structure du contenu, nuances importantes, "
            "éléments remarquables, conclusion, et 2 blocs annexes maximum."
        ),
        "decision": (
            "Produit une synthèse orientée action : contexte, signaux importants, risques, zones floues, "
            "recommandation, et 2 blocs annexes maximum."
        ),
        "etude": (
            "Produit une synthèse pédagogique : idée directrice, notions utiles, définitions éventuelles, "
            "repères de compréhension, conclusion, et 2 blocs annexes maximum."
        ),
    }
    return instructions.get(format_name, instructions["express"])


def _prompt_for(
    *,
    format_name: str,
    text: str,
    title: str,
    strategy: str,
    document_kind: str,
    scope: str,
    warnings: list[str] | None = None,
) -> str:
    warning_text = " | ".join(warnings or []) or "aucun"
    return f"""
Tu es le moteur de synthèse professionnel de PageBrief.

Objectif :
produire un résumé fiable, clair, directement utile à un utilisateur payant.

Règles impératives :
- retourne uniquement un JSON valide ; aucun markdown, aucune explication hors JSON ;
- reformule le contenu : ne recopie pas brutalement le texte source ;
- ignore les métadonnées parasites : couverture, mentions d'édition, pagination, URL, crédits, notes légales, en-têtes répétés ;
- si le texte semble partiel, bruité ou ambigu, indique-le brièvement dans source_note et baisse confidence ;
- ne fais aucune invention ;
- rédige en français naturel, professionnel et lisible.

Contexte de synthèse :
- titre : {title or 'Document'}
- stratégie : {strategy}
- genre détecté : {document_kind}
- portée demandée : {scope}
- avertissements extraction : {warning_text}

Attendus métier :
{_format_specific_instruction(format_name)}

Adaptation selon le genre :
- literary : résume le cadre, les personnages, les thèmes et la dynamique narrative ;
- article/technical/academic : résume l'idée principale, les arguments, les éléments marquants ;
- marketing : résume la promesse, les bénéfices, les objections, les appels à l'action ;
- legal : résume les obligations, risques, zones floues.

Schéma JSON attendu :
{{
  "panel_title": "string",
  "analysis_basis": "string",
  "source_note": "string",
  "intro_lines": ["string", "string"],
  "key_points": ["string", "string", "string"],
  "conclusion": "string",
  "annex_blocks": [{{"title": "string", "items": ["string"]}}],
  "confidence": "faible|moyenne|élevée",
  "document_kind": "string",
  "warnings": ["string"],
  "themes": ["string"],
  "entities": {{"people": ["string"], "places": ["string"], "organizations": ["string"]}}
}}

Texte à synthétiser :
{text}
""".strip()


def _response_schema() -> dict[str, Any]:
    return {
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
                        "items": {"type": "array", "items": {"type": "string"}},
                    },
                    "required": ["title", "items"],
                },
            },
            "confidence": {"type": "string"},
            "document_kind": {"type": "string"},
            "warnings": {"type": "array", "items": {"type": "string"}},
            "themes": {"type": "array", "items": {"type": "string"}},
            "entities": {
                "type": "object",
                "properties": {
                    "people": {"type": "array", "items": {"type": "string"}},
                    "places": {"type": "array", "items": {"type": "string"}},
                    "organizations": {"type": "array", "items": {"type": "string"}},
                },
                "required": ["people", "places", "organizations"],
            },
        },
        "required": [
            "panel_title",
            "analysis_basis",
            "source_note",
            "intro_lines",
            "key_points",
            "conclusion",
            "annex_blocks",
            "confidence",
            "document_kind",
            "warnings",
            "themes",
            "entities",
        ],
    }


def generate_summary(
    *,
    format_name: str,
    text: str,
    title: str,
    strategy: str,
    document_kind: str,
    scope: str,
    warnings: list[str] | None = None,
) -> dict[str, Any]:
    settings = get_settings()
    prompt = _prompt_for(
        format_name=format_name,
        text=text,
        title=title,
        strategy=strategy,
        document_kind=document_kind,
        scope=scope,
        warnings=warnings,
    )
    body = {
        "model": settings.ollama_model,
        "prompt": prompt,
        "stream": False,
        "format": _response_schema(),
        "options": {
            "temperature": 0.2,
            "num_predict": 900,
        },
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
        parsed = json.loads(content)
    except json.JSONDecodeError as exc:
        logger.warning("Réponse LLM invalide, fallback heuristique.")
        raise ValueError("Réponse LLM invalide.") from exc

    if not isinstance(parsed, dict):
        raise ValueError("Réponse LLM invalide : objet JSON attendu.")
    return parsed
