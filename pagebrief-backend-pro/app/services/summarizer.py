from __future__ import annotations

import math
import re
from collections import Counter
from typing import Any

from app.core.config import get_settings
from app.services.fetcher import ExtractedDocument, ExtractedPage, clean_text, trim_input
from app.services.llm import generate_summary


_SENTENCE_SPLIT_RE = re.compile(r"(?<=[.!?])\s+")
_WORD_RE = re.compile(r"[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ\-']+")
_PERSON_RE = re.compile(r"\b(?:M\.|Mme|Monsieur|Madame)?\s?([A-Z][A-Za-zÀ-ÿ'\-]{2,}(?:\s+[A-Z][A-Za-zÀ-ÿ'\-]{2,}){0,2})\b")
_STOPWORDS = {
    "le", "la", "les", "de", "des", "du", "un", "une", "et", "en", "pour", "dans", "sur", "avec",
    "par", "que", "qui", "au", "aux", "ce", "cet", "cette", "à", "d", "l", "a", "est", "ou", "the",
    "of", "to", "and", "il", "elle", "ils", "elles", "nous", "vous", "je", "tu", "ne", "pas", "plus",
}


def reading_time_minutes(raw_text: str) -> int:
    words = len((raw_text or "").split())
    return max(1, math.ceil(words / 220))


def detect_document_kind(title: str, text: str, source_type: str) -> str:
    sample = clean_text(f"{title} {text[:3000]}").lower()
    if source_type == "pdf" and any(token in sample for token in ["chapitre", "roman", "première partie", "deuxième partie", "victor hugo"]):
        return "literary"
    if any(token in sample for token in ["article", "blog", "actualit", "news"]):
        return "article"
    if any(token in sample for token in ["api", "installation", "configuration", "endpoint", "docker", "python", "javascript"]):
        return "technical"
    if any(token in sample for token in ["contrat", "clause", "obligation", "responsabilit", "conditions générales"]):
        return "legal"
    if any(token in sample for token in ["abstract", "méthodologie", "résultats", "conclusion", "bibliographie"]):
        return "academic"
    if any(token in sample for token in ["offre", "tarif", "bénéfice", "inscrivez-vous", "démo"]):
        return "marketing"
    return "generic"


def chunk_text(text: str, chunk_size: int = 2800, overlap: int = 250) -> list[str]:
    cleaned = clean_text(text)
    if len(cleaned) <= chunk_size:
        return [cleaned]

    chunks: list[str] = []
    start = 0
    while start < len(cleaned):
        end = min(len(cleaned), start + chunk_size)
        if end < len(cleaned):
            boundary = cleaned.rfind(" ", start, end)
            if boundary > start + 1000:
                end = boundary
        chunk = cleaned[start:end].strip()
        if chunk:
            chunks.append(chunk)
        if end >= len(cleaned):
            break
        start = max(0, end - overlap)
    return chunks


def select_relevant_text(
    *,
    scope: str,
    source_type: str,
    extracted_document: ExtractedDocument | None,
    raw_text: str,
    selected_text: str | None,
    page_number: int | None,
    page_from: int | None,
    page_to: int | None,
    max_chars: int,
) -> tuple[str, str, list[str]]:
    warnings: list[str] = []

    if selected_text and scope == "selection":
        return trim_input(selected_text, max_chars), "selection", warnings

    if source_type == "pdf" and extracted_document:
        if extracted_document.noise_ratio >= 0.35:
            warnings.append("Extraction PDF partiellement bruitée")

        if scope == "page":
            pages = _select_pages(extracted_document, page_number, page_from, page_to)
            joined = "\n\n".join(page.cleaned_text for page in pages if page.cleaned_text)
            if not joined.strip():
                raise ValueError("Aucune page exploitable trouvée pour la portée demandée.")
            if len(pages) == 1:
                return trim_input(joined, max_chars), f"page_{pages[0].page_number}", warnings
            return trim_input(joined, max_chars), f"pages_{pages[0].page_number}_{pages[-1].page_number}", warnings

        sampled = _sample_document_pages(extracted_document, max_chars=max_chars)
        return trim_input(sampled, max_chars), "document_sampled", warnings

    return trim_input(raw_text, max_chars), "document_full", warnings


def _select_pages(
    extracted_document: ExtractedDocument,
    page_number: int | None,
    page_from: int | None,
    page_to: int | None,
) -> list[ExtractedPage]:
    if page_number is not None:
        pages = [page for page in extracted_document.pages if page.page_number == page_number]
    else:
        start = page_from or 1
        end = page_to or start
        pages = [page for page in extracted_document.pages if start <= page.page_number <= end]

    pages = [page for page in pages if page.cleaned_text]
    if not pages:
        raise ValueError("La page demandée ne contient pas de texte exploitable.")
    return pages


def _sample_document_pages(extracted_document: ExtractedDocument, *, max_chars: int) -> str:
    pages = extracted_document.usable_pages or extracted_document.pages
    if not pages:
        return extracted_document.merged_text

    selected: list[ExtractedPage] = []
    indices = {0, max(0, len(pages) // 4), max(0, len(pages) // 2), max(0, (3 * len(pages)) // 4), len(pages) - 1}
    for idx in sorted(indices):
        page = pages[idx]
        if page not in selected:
            selected.append(page)

    selected = sorted(selected, key=lambda page: (-page.quality_score, page.page_number))[:6]
    selected = sorted(selected, key=lambda page: page.page_number)

    parts: list[str] = []
    budget = max_chars + 2000
    used = 0
    for page in selected:
        excerpt = trim_input(page.cleaned_text, min(2500, budget - used))
        if not excerpt:
            continue
        block = f"[Page {page.page_number}]\n{excerpt}"
        used += len(block)
        parts.append(block)
        if used >= budget:
            break

    return "\n\n".join(parts).strip() or extracted_document.merged_text[:budget]


def _sentence_tokenize(text: str) -> list[str]:
    normalized = clean_text(text)
    if not normalized:
        return []
    sentences = [sentence.strip() for sentence in _SENTENCE_SPLIT_RE.split(normalized) if sentence.strip()]
    return [sentence for sentence in sentences if len(sentence) >= 30]


def _tokenize(text: str) -> list[str]:
    return [token.lower() for token in _WORD_RE.findall(text) if token.lower() not in _STOPWORDS and len(token) >= 3]


def _extractive_sentences(text: str, limit: int) -> list[str]:
    sentences = _sentence_tokenize(text)
    if not sentences:
        return []
    frequencies = Counter(_tokenize(text))
    ranked = []
    for index, sentence in enumerate(sentences):
        tokens = _tokenize(sentence)
        score = sum(frequencies[token] for token in tokens) / max(1, len(tokens))
        ranked.append((score, index, sentence))
    ranked.sort(key=lambda item: (-item[0], item[1]))
    best = sorted(ranked[:limit], key=lambda item: item[1])
    return [sentence[:240] for _, _, sentence in best]


def _top_keywords(text: str, limit: int = 6) -> list[str]:
    counts = Counter(_tokenize(text))
    return [word for word, _ in counts.most_common(limit)] or ["relire le contenu source"]


def _extract_entities(text: str) -> dict[str, list[str]]:
    people = []
    seen = set()
    for match in _PERSON_RE.findall(text[:12000]):
        candidate = clean_text(match)
        if not candidate or candidate.lower() in _STOPWORDS:
            continue
        if candidate in seen:
            continue
        if len(candidate.split()) > 4:
            continue
        seen.add(candidate)
        people.append(candidate)
        if len(people) >= 6:
            break
    return {
        "people": people,
        "places": [],
        "organizations": [],
    }


def compute_confidence(
    *,
    used_llm: bool,
    extraction_quality: float,
    noise_ratio: float,
    selected_chars: int,
    fallback_used: bool,
) -> str:
    score = 0.0
    if used_llm:
        score += 0.35
    if not fallback_used:
        score += 0.10
    score += extraction_quality * 0.30
    score += max(0.0, 1.0 - noise_ratio) * 0.20
    if selected_chars >= 2500:
        score += 0.10
    elif selected_chars < 600:
        score -= 0.20

    if score >= 0.78:
        return "élevée"
    if score >= 0.48:
        return "moyenne"
    return "faible"


def _heuristic_result(
    *,
    format_name: str,
    text: str,
    title: str,
    strategy: str,
    document_kind: str,
    warnings: list[str],
    confidence: str,
) -> dict[str, Any]:
    selected = _extractive_sentences(text, limit=6)
    intro_lines = selected[:2] or ["Synthèse générée à partir du contenu extrait."]
    key_points = selected[2:6] or selected[:4] or ["Aucun point saillant clairement détecté."]
    themes = _top_keywords(text)

    annex_map = {
        "express": [{"title": "Repères", "items": themes}],
        "analytique": [{"title": "Angles à creuser", "items": themes}],
        "decision": [{"title": "Points de vigilance", "items": themes}],
        "etude": [{"title": "Notions à retenir", "items": themes}],
    }

    panel_titles = {
        "express": "Vue Express",
        "analytique": "Vue Analytique",
        "decision": "Vue Décision",
        "etude": "Vue Étude",
    }

    return {
        "panel_title": panel_titles.get(format_name, "Vue Express"),
        "analysis_basis": strategy,
        "source_note": "Résumé heuristique généré sans modèle, à vérifier sur le contenu source.",
        "intro_lines": intro_lines,
        "key_points": key_points,
        "conclusion": key_points[-1][:260],
        "annex_blocks": annex_map.get(format_name, annex_map["express"]),
        "confidence": confidence,
        "document_kind": document_kind,
        "warnings": warnings,
        "themes": themes,
        "entities": _extract_entities(text),
    }


def _ensure_summary_shape(result: dict[str, Any], *, format_name: str, strategy: str, document_kind: str, warnings: list[str], confidence: str) -> dict[str, Any]:
    panel_titles = {
        "express": "Vue Express",
        "analytique": "Vue Analytique",
        "decision": "Vue Décision",
        "etude": "Vue Étude",
    }
    result.setdefault("panel_title", panel_titles.get(format_name, "Vue Express"))
    result.setdefault("analysis_basis", strategy)
    result.setdefault("source_note", "Analyse générée.")
    result.setdefault("intro_lines", [])
    result.setdefault("key_points", [])
    result.setdefault("conclusion", "")
    result.setdefault("annex_blocks", [])
    result.setdefault("warnings", warnings)
    result.setdefault("themes", [])
    result.setdefault("entities", {"people": [], "places": [], "organizations": []})
    result["document_kind"] = result.get("document_kind") or document_kind
    result["confidence"] = confidence

    result["intro_lines"] = [clean_text(item)[:220] for item in result.get("intro_lines", []) if clean_text(item)][:3]
    result["key_points"] = [clean_text(item)[:240] for item in result.get("key_points", []) if clean_text(item)][:5]
    result["conclusion"] = clean_text(result.get("conclusion"))[:320]
    result["themes"] = [clean_text(item)[:80] for item in result.get("themes", []) if clean_text(item)][:6]
    result["warnings"] = [clean_text(item)[:140] for item in result.get("warnings", []) if clean_text(item)][:4]

    entities = result.get("entities") or {}
    result["entities"] = {
        "people": [clean_text(item)[:80] for item in entities.get("people", []) if clean_text(item)][:6],
        "places": [clean_text(item)[:80] for item in entities.get("places", []) if clean_text(item)][:6],
        "organizations": [clean_text(item)[:80] for item in entities.get("organizations", []) if clean_text(item)][:6],
    }
    return result


def summarize_document(
    *,
    format_name: str,
    raw_text: str,
    title: str,
    source_type: str,
    scope: str,
    selected_text: str | None = None,
    page_number: int | None = None,
    page_from: int | None = None,
    page_to: int | None = None,
    extracted_document: ExtractedDocument | None = None,
) -> tuple[dict[str, Any], int]:
    settings = get_settings()
    full_reading_time = reading_time_minutes(raw_text)
    document_kind = detect_document_kind(title, raw_text, source_type)
    extraction_quality = extracted_document.quality_score if extracted_document else 0.80
    noise_ratio = extracted_document.noise_ratio if extracted_document else 0.05

    analysis_text, strategy, warnings = select_relevant_text(
        scope=scope,
        source_type=source_type,
        extracted_document=extracted_document,
        raw_text=raw_text,
        selected_text=selected_text,
        page_number=page_number,
        page_from=page_from,
        page_to=page_to,
        max_chars=settings.max_input_chars,
    )

    llm_text = trim_input(analysis_text, settings.max_input_chars)
    fallback_used = False

    try:
        if len(llm_text) > settings.max_input_chars:
            llm_text = trim_input(llm_text, settings.max_input_chars)
        result = generate_summary(
            format_name=format_name,
            text=llm_text,
            title=title,
            strategy=strategy,
            document_kind=document_kind,
            scope=scope,
            warnings=warnings,
        )
    except Exception:
        fallback_used = True
        result = _heuristic_result(
            format_name=format_name,
            text=llm_text,
            title=title,
            strategy=strategy,
            document_kind=document_kind,
            warnings=warnings,
            confidence="faible",
        )

    confidence = compute_confidence(
        used_llm=not fallback_used,
        extraction_quality=extraction_quality,
        noise_ratio=noise_ratio,
        selected_chars=len(llm_text),
        fallback_used=fallback_used,
    )
    result = _ensure_summary_shape(
        result,
        format_name=format_name,
        strategy=strategy,
        document_kind=document_kind,
        warnings=warnings,
        confidence=confidence,
    )
    return result, full_reading_time
