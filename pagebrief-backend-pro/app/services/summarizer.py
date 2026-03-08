from __future__ import annotations

import math
from typing import Any

from app.core.config import get_settings
from app.services.fetcher import clean_text, trim_input
from app.services.llm import generate_summary


def reading_time_minutes(raw_text: str) -> int:
    words = len((raw_text or "").split())
    return max(1, math.ceil(words / 220))


def _overview_text(text: str) -> str:
    lines = [line.strip() for line in (text or "").splitlines() if line.strip()]
    head = lines[:60]
    return "\n".join(head)


def _heuristic_result(format_name: str, text: str, title: str, strategy: str) -> dict[str, Any]:
    cleaned = clean_text(text)
    lines = [line.strip() for line in cleaned.split(". ") if line.strip()]
    intro_lines = lines[:3] or ["Aperçu rapide du document."]
    key_points = lines[3:8] or lines[:5] or ["Aucun point saillant détecté."]
    confidence = "moyenne" if len(cleaned) > 1000 else "faible"

    annex_map = {
        "express": [{"title": "Repères", "items": _top_keywords(cleaned)}],
        "analytique": [{"title": "Angles à creuser", "items": _top_keywords(cleaned)}],
        "decision": [{"title": "Vérifications avant action", "items": _top_keywords(cleaned)}],
        "etude": [{"title": "Notions à retenir", "items": _top_keywords(cleaned)}],
    }

    panel_titles = {
        "express": "Vue Express",
        "analytique": "Vue Analytique",
        "decision": "Vue Décision",
        "etude": "Vue Étude",
    }

    source_note = "Analyse basée sur une vue d'ensemble du contenu." if strategy == "overview" else "Analyse basée sur le contenu extrait."
    return {
        "panel_title": panel_titles.get(format_name, "Vue Express"),
        "analysis_basis": "Vue d'ensemble" if strategy == "overview" else "Analyse complète",
        "source_note": source_note,
        "intro_lines": [item[:220] for item in intro_lines],
        "key_points": [item[:220] for item in key_points],
        "conclusion": (lines[8] if len(lines) > 8 else intro_lines[0])[:260],
        "annex_blocks": annex_map.get(format_name, annex_map["express"]),
        "confidence": confidence,
    }


def _top_keywords(text: str) -> list[str]:
    stopwords = {
        "le", "la", "les", "de", "des", "du", "un", "une", "et", "en", "pour",
        "dans", "sur", "avec", "par", "que", "qui", "au", "aux", "ce", "cet",
        "cette", "à", "d", "l", "a", "est", "ou", "the", "of", "to", "and"
    }
    counts: dict[str, int] = {}
    for token in clean_text(text).lower().replace(",", " ").replace(";", " ").split():
        token = token.strip(".:!?()[]{}\"'")
        if len(token) < 4 or token in stopwords:
            continue
        counts[token] = counts.get(token, 0) + 1
    ranked = sorted(counts.items(), key=lambda item: (-item[1], item[0]))
    return [word for word, _ in ranked[:6]] or ["relire le contenu source"]


def summarize_document(format_name: str, raw_text: str, title: str, source_type: str) -> tuple[dict[str, Any], int]:
    settings = get_settings()
    full_reading_time = reading_time_minutes(raw_text)
    strategy = "full"

    analysis_text = raw_text
    if source_type == "pdf" and len(raw_text) > settings.pdf_overview_threshold:
        strategy = "overview"
        analysis_text = _overview_text(raw_text)

    llm_text = trim_input(analysis_text, settings.max_input_chars)

    try:
        result = generate_summary(format_name, llm_text, title, strategy)
        result.setdefault("panel_title", f"Vue {format_name.capitalize()}")
        result.setdefault("analysis_basis", "Vue d'ensemble" if strategy == "overview" else "Analyse complète")
        result.setdefault("source_note", "Analyse générée.")
        result.setdefault("intro_lines", [])
        result.setdefault("key_points", [])
        result.setdefault("conclusion", "")
        result.setdefault("annex_blocks", [])
        result.setdefault("confidence", "moyenne")
    except Exception:
        result = _heuristic_result(format_name, llm_text, title, strategy)

    return result, full_reading_time
