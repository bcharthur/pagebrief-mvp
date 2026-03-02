from __future__ import annotations

import math
import re
from collections import Counter
from typing import Iterable

from app.services.fetcher import clean_text, trim_input

_SENTENCE_SPLIT_RE = re.compile(r"(?<=[.!?])\s+|\n+")
_WORD_RE = re.compile(r"\b[\wÀ-ÿ'-]+\b", flags=re.UNICODE)
_YEAR_RE = re.compile(r"\b(1\d{3}|20\d{2}|21\d{2})\b")
_PROPER_NAME_RE = re.compile(r"\b[A-ZÀ-Ý][a-zà-ÿ]+(?:\s+[A-ZÀ-Ý][a-zà-ÿ]+){0,2}\b")

FORMAT_PROFILES = {
    "express": {
        "label": "Express",
        "panel_title": "Vue Express",
        "section_labels": {
            "intro": "Introduction",
            "points": "Points clés",
            "conclusion": "Conclusion",
            "annex": "Blocs utiles",
        },
        "instruction": "Vue rapide : situe le document, donne 3 à 5 points clés, puis une conclusion brève.",
    },
    "analytic": {
        "label": "Analytique",
        "panel_title": "Vue Analytique",
        "section_labels": {
            "intro": "Vue d'ensemble",
            "points": "Analyse",
            "conclusion": "Synthèse",
            "annex": "Blocs d'analyse",
        },
        "instruction": "Explique la structure probable, les éléments importants et ce qu'il faut relire pour comprendre correctement.",
    },
    "decision": {
        "label": "Décision",
        "panel_title": "Vue Décision",
        "section_labels": {
            "intro": "Contexte",
            "points": "Décision rapide",
            "conclusion": "Recommandation",
            "annex": "Blocs décisionnels",
        },
        "instruction": "Aide à décider : fais ressortir actions, risques, zones floues et ce qu'il faut vérifier avant de trancher.",
    },
    "study": {
        "label": "Étude",
        "panel_title": "Vue Étude",
        "section_labels": {
            "intro": "Mise en contexte",
            "points": "Notions à retenir",
            "conclusion": "Synthèse d'étude",
            "annex": "Blocs pédagogiques",
        },
        "instruction": "Aide à apprendre : mets en avant notions, définitions, repères et questions de révision.",
    },
}

_STOPWORDS = {
    "le", "la", "les", "de", "des", "du", "un", "une", "et", "ou", "au", "aux", "en", "dans", "sur",
    "pour", "par", "avec", "sans", "ce", "ces", "cet", "cette", "qui", "que", "quoi", "dont", "est",
    "sont", "été", "être", "the", "and", "for", "with", "from", "that", "this", "into", "your", "vous",
    "nous", "ils", "elles", "elle", "il", "their", "them", "mais", "plus", "moins", "comme", "ainsi",
    "also", "than", "then", "when", "where", "have", "has", "had", "can", "may", "must", "should",
}

_ACTION_HINTS = [
    r"\bmust\b", r"\bshould\b", r"\brequired\b", r"\bneed to\b", r"\bverify\b", r"\bcheck\b",
    r"\bconfigure\b", r"\binstall\b", r"\benable\b", r"\bdisable\b", r"\breview\b",
    r"\bdoit\b", r"\bdevez\b", r"\bnécessaire\b", r"\bverifier\b", r"\bvérifier\b",
    r"\bconfigurer\b", r"\binstaller\b", r"\bactiver\b", r"\bdésactiver\b", r"\bdesactiver\b",
    r"\bmettre en place\b", r"\bprévoir\b", r"\brelire\b",
]

_RISK_HINTS = [
    "warning", "attention", "limite", "beta", "experimental", "subject to", "may", "peut",
    "risk", "risque", "flou", "ambigu", "incertain", "condition", "limitation", "contrainte",
]


def summarize_payload(*, title: str | None, url: str | None, view_format: str, source_text: str, source_kind: str, scope: str, focus_hint: str | None, settings, llm_client, logger=None):
    profile = FORMAT_PROFILES.get(view_format, FORMAT_PROFILES["express"])

    full_text = clean_text(source_text)
    full_word_count = _word_count(full_text)
    analysis_text, analysis_strategy, analysis_basis = _pick_analysis_text(
        source_text=source_text,
        cleaned_full_text=full_text,
        source_kind=source_kind,
        scope=scope,
        title=title,
        view_format=view_format,
        settings=settings,
    )
    cleaned_text = trim_input(analysis_text, settings.max_input_chars)
    if logger:
        logger.info(
            "Nettoyage entrée | raw_chars=%s analysis_chars=%s trimmed_chars=%s max_input_chars=%s scope=%s strategy=%s",
            len(source_text or ""),
            len(analysis_text or ""),
            len(cleaned_text or ""),
            settings.max_input_chars,
            scope,
            analysis_strategy,
        )

    local = _build_local_summary(
        title=title,
        url=url,
        view_format=view_format,
        profile=profile,
        text=cleaned_text,
        full_text=full_text,
        full_word_count=full_word_count,
        source_kind=source_kind,
        scope=scope,
        focus_hint=focus_hint,
        analysis_strategy=analysis_strategy,
        analysis_basis=analysis_basis,
    )

    llm_text = _llm_excerpt(
        cleaned_text,
        head=settings.llm_excerpt_head_chars,
        tail=settings.llm_excerpt_tail_chars,
    )
    llm_payload = {
        "view_format": view_format,
        "format_label": profile["label"],
        "title": clean_text(title),
        "url": clean_text(url),
        "source_kind": source_kind,
        "scope": scope,
        "focus_hint": clean_text(focus_hint),
        "analysis_strategy": analysis_strategy,
        "analysis_basis": analysis_basis,
        "instruction": profile["instruction"],
        "section_labels": profile["section_labels"],
        "text": llm_text,
    }

    if logger:
        logger.info(
            "Résumé heuristique prêt | words=%s conclusion_len=%s llm_text_chars=%s format=%s",
            local.get("word_count"),
            len(local.get("conclusion") or ""),
            len(llm_text or ""),
            view_format,
        )

    enriched = llm_client.summarize(llm_payload, local, logger=logger)
    return enriched


def _pick_analysis_text(*, source_text: str, cleaned_full_text: str, source_kind: str, scope: str, title: str | None, view_format: str, settings) -> tuple[str, str, str]:
    if source_kind != "pdf" or scope != "document":
        basis = "Passage ciblé" if scope == "selection" else "Texte extrait de l'onglet"
        return cleaned_full_text, "focused" if scope == "selection" else "full", basis

    if len(cleaned_full_text) < settings.pdf_overview_threshold_chars:
        return cleaned_full_text, "full", "Texte extrait du PDF complet"

    head = trim_input(cleaned_full_text, settings.pdf_overview_head_chars)
    title_line = clean_text(title)
    intro = f"Titre: {title_line}.\n\n" if title_line else ""
    overview = f"{intro}{head}".strip()
    if view_format == "express":
        basis = "Titre + premières pages du PDF (vue d'ensemble)"
    else:
        basis = "Premières pages du PDF (analyse large, non exhaustive)"
    return overview, "overview", basis


def _llm_excerpt(text: str, head: int = 2400, tail: int = 1100) -> str:
    text = clean_text(text)
    if len(text) <= head + tail + 96:
        return text
    left = text[:head].rsplit(" ", 1)[0].strip()
    right = text[-tail:].split(" ", 1)[-1].strip()
    return f"{left}\n\n[... contenu tronqué pour accélérer l'analyse ...]\n\n{right}"


def _build_local_summary(*, title: str | None, url: str | None, view_format: str, profile: dict, text: str, full_text: str, full_word_count: int, source_kind: str, scope: str, focus_hint: str | None, analysis_strategy: str, analysis_basis: str) -> dict:
    sentences = _candidate_sentences(text)
    reading_time_min = max(1, int(math.ceil(full_word_count / 220))) if full_word_count else 1

    key_limit = 4 if view_format == "express" else 5
    key_points = _pick_summary_points(sentences, limit=key_limit)
    intro_lines = _build_intro_lines(
        title=title,
        key_points=key_points,
        sentences=sentences,
        scope=scope,
        view_format=view_format,
        analysis_strategy=analysis_strategy,
        analysis_basis=analysis_basis,
    )
    actions = _pick_actions(sentences, limit=4)
    risks = _pick_risks(sentences, limit=4)
    conclusion = _build_conclusion(
        title=title,
        key_points=key_points,
        scope=scope,
        view_format=view_format,
        analysis_strategy=analysis_strategy,
    )
    annex_blocks = _build_annex_blocks(
        view_format=view_format,
        full_text=full_text,
        actions=actions,
        risks=risks,
        scope=scope,
        focus_hint=focus_hint,
        analysis_basis=analysis_basis,
        analysis_strategy=analysis_strategy,
    )
    confidence_label, confidence_reason = _confidence_for(engine="heuristic", scope=scope, analysis_strategy=analysis_strategy)
    source_note = _source_note(source_kind=source_kind, scope=scope, analysis_strategy=analysis_strategy)

    return {
        "title": clean_text(title),
        "url": clean_text(url),
        "view_format": view_format,
        "format_label": profile["label"],
        "panel_title": profile["panel_title"],
        "section_labels": profile["section_labels"],
        "source_kind": source_kind,
        "scope": scope,
        "focus_hint": clean_text(focus_hint),
        "word_count": full_word_count,
        "reading_time_min": reading_time_min,
        "analysis_strategy": analysis_strategy,
        "analysis_basis": analysis_basis,
        "confidence_label": confidence_label,
        "confidence_reason": confidence_reason,
        "source_note": source_note,
        "intro_lines": intro_lines,
        "key_points": key_points,
        "conclusion": conclusion,
        "annex_blocks": annex_blocks,
        # legacy fields kept for compatibility
        "summary_points": key_points,
        "actions": actions,
        "risks": risks,
        "tldr": conclusion,
        "engine": "heuristic",
    }


def _candidate_sentences(text: str) -> list[str]:
    raw = [clean_text(part) for part in _SENTENCE_SPLIT_RE.split(text)]
    kept: list[str] = []
    seen: set[str] = set()
    for item in raw:
        if len(item) < 28:
            continue
        key = item.casefold()
        if key in seen:
            continue
        seen.add(key)
        kept.append(item)
    if kept:
        return kept

    fallback = [clean_text(line) for line in str(text or "").split("\n") if clean_text(line)]
    return fallback[:12]


def _pick_summary_points(sentences: list[str], limit: int) -> list[str]:
    picked: list[str] = []
    for sentence in sentences:
        short = _to_bullet(sentence, max_len=155)
        if short:
            picked.append(short)
        if len(picked) >= limit:
            break
    return picked or ["Le contenu est trop pauvre ou trop bruité pour une synthèse fiable."]


def _build_intro_lines(*, title: str | None, key_points: list[str], sentences: list[str], scope: str, view_format: str, analysis_strategy: str, analysis_basis: str) -> list[str]:
    label = "Ce passage" if scope == "selection" else "Ce document"
    lines: list[str] = []

    title_text = clean_text(title)
    if title_text:
        lines.append(f"{label} concerne « {title_text} »." )

    if analysis_strategy == "overview":
        lines.append(f"La synthèse repose sur {analysis_basis.lower()}. Elle vise surtout à situer le sujet.")
    elif view_format == "decision":
        lines.append("L'objectif ici est d'aider à décider vite, sans prétendre remplacer une lecture complète.")
    elif view_format == "study":
        lines.append("L'objectif ici est d'extraire des notions et des repères utiles pour comprendre ou réviser.")

    for sentence in sentences[:2]:
        line = _to_bullet(sentence, max_len=135)
        if not line or line in lines:
            continue
        lines.append(line)
        if len(lines) >= 3:
            break

    if not lines:
        lines = key_points[:2]
    return lines[:3]


def _build_conclusion(*, title: str | None, key_points: list[str], scope: str, view_format: str, analysis_strategy: str) -> str:
    lead_map = {
        "express": "À retenir",
        "analytic": "En synthèse",
        "decision": "Recommandation rapide",
        "study": "À mémoriser",
    }
    lead = lead_map.get(view_format, "À retenir")
    if scope == "selection":
        lead = f"{lead} pour ce passage"
    if analysis_strategy == "overview":
        lead = f"{lead} (vue d'ensemble)"

    first = clean_text(key_points[0] if key_points else "")
    second = clean_text(key_points[1] if len(key_points) > 1 else "")
    if first and second and len(first) + len(second) < 180:
        return f"{lead}: {first} {second}"
    if first:
        return f"{lead}: {first}"
    if title:
        return f"{lead}: {clean_text(title)} mérite une lecture plus détaillée."
    return f"{lead}: relire la source pour confirmer le contexte exact."


def _build_annex_blocks(*, view_format: str, full_text: str, actions: list[str], risks: list[str], scope: str, focus_hint: str | None, analysis_basis: str, analysis_strategy: str) -> list[dict]:
    keywords = _extract_keywords(full_text, limit=5)
    years = _extract_years(full_text, limit=4)
    names = _extract_names(full_text, limit=4)
    blocks: list[dict[str, list[str] | str]] = []

    if view_format == "decision":
        if actions:
            blocks.append({"title": "Actions", "items": actions[:4]})
        if risks:
            blocks.append({"title": "Risques", "items": risks[:4]})
        flous = [
            "Confirmer les passages ambigus avant toute validation.",
            "Relire les sections normatives si le document engage une décision.",
        ]
        if analysis_strategy == "overview":
            flous.insert(0, "Document long : la décision doit être confirmée sur les sections détaillées.")
        blocks.append({"title": "Zones floues", "items": flous[:3]})
        return blocks[:3]

    if view_format == "study":
        notions = keywords[:3] or names[:3] or ["Relever les notions structurantes du document."]
        repères = (years + names)[:4] or [analysis_basis]
        questions = [
            "Quels sont les concepts récurrents ?",
            "Quels passages méritent une relecture lente ?",
        ]
        if scope == "selection" and focus_hint:
            questions.insert(0, f"Ciblage : {focus_hint}")
        blocks.extend(
            [
                {"title": "Définitions / notions", "items": notions[:4]},
                {"title": "Repères", "items": repères[:4]},
                {"title": "Questions à retenir", "items": questions[:3]},
            ]
        )
        return blocks[:3]

    if view_format == "analytic":
        structure = _build_structure_hints(full_text)
        if structure:
            blocks.append({"title": "Structure probable", "items": structure[:4]})
        repères = (keywords + years + names)[:5] or [analysis_basis]
        blocks.append({"title": "Repères clés", "items": repères[:5]})
        relire = []
        if analysis_strategy == "overview":
            relire.append("Analyse large : relire le sommaire et les sections clés pour confirmer la structure.")
        relire.extend(risks[:2] or ["Relire les passages qui portent les nuances et exceptions."])
        blocks.append({"title": "À relire", "items": relire[:3]})
        return blocks[:3]

    # express
    if scope == "selection" and focus_hint:
        blocks.append({"title": "Portée analysée", "items": [f"Passage ciblé : {focus_hint}", analysis_basis]})
    else:
        blocks.append({"title": "Portée analysée", "items": [analysis_basis]})
    repères = (keywords + years + names)[:5] or ["Identifier les mots-clés du document avant d'aller plus loin."]
    blocks.append({"title": "Repères clés", "items": repères[:5]})
    attention = []
    if analysis_strategy == "overview":
        attention.append("Vue d'ensemble uniquement : ce format ne couvre pas chaque détail du document.")
    attention.extend(risks[:2] or ["Relire le passage source avant toute décision importante."])
    blocks.append({"title": "Points d'attention", "items": attention[:3]})
    return blocks[:3]


def _build_structure_hints(full_text: str) -> list[str]:
    fragments = []
    for segment in re.split(r"(?<=[.:;])\s+", full_text[:2200]):
        cleaned = clean_text(segment)
        if not cleaned or len(cleaned) < 18:
            continue
        if len(cleaned.split()) > 12:
            cleaned = _to_bullet(cleaned, max_len=90)
        fragments.append(cleaned)
        if len(fragments) >= 4:
            break
    if not fragments:
        return []
    return fragments


def _pick_actions(sentences: list[str], limit: int) -> list[str]:
    out = _pick_by_patterns(sentences, _ACTION_HINTS, limit)
    if out:
        return out
    return [
        "Relire les passages qui contiennent des obligations ou étapes concrètes.",
        "Vérifier les prérequis et conditions avant application.",
    ][:limit]


def _pick_risks(sentences: list[str], limit: int) -> list[str]:
    patterns = [rf"\b{re.escape(token)}\b" if token.isascii() and token.isalpha() else token for token in _RISK_HINTS]
    out = _pick_by_patterns(sentences, patterns, limit)
    if out:
        return out
    return [
        "Peu de signaux explicites : vérifier le texte complet et le contexte avant décision.",
        "Les nuances et exceptions peuvent se trouver plus loin dans le document.",
    ][:limit]


def _pick_by_patterns(sentences: Iterable[str], patterns: list[str], limit: int) -> list[str]:
    out: list[str] = []
    seen: set[str] = set()
    for sentence in sentences:
        lower = sentence.lower()
        if not any(re.search(pattern, lower, flags=re.IGNORECASE) for pattern in patterns):
            continue
        bullet = _to_bullet(sentence)
        key = bullet.casefold()
        if key in seen:
            continue
        seen.add(key)
        out.append(bullet)
        if len(out) >= limit:
            break
    return out


def _extract_keywords(text: str, limit: int) -> list[str]:
    words = []
    for match in _WORD_RE.findall(text or ""):
        token = match.strip("-'\"").lower()
        if len(token) < 4 or token in _STOPWORDS or token.isdigit():
            continue
        words.append(token)
    counts = Counter(words)
    return [word for word, _ in counts.most_common(limit)]


def _extract_years(text: str, limit: int) -> list[str]:
    seen: list[str] = []
    for match in _YEAR_RE.findall(text or ""):
        if match not in seen:
            seen.append(match)
        if len(seen) >= limit:
            break
    return seen


def _extract_names(text: str, limit: int) -> list[str]:
    out: list[str] = []
    seen: set[str] = set()
    for match in _PROPER_NAME_RE.findall(text or ""):
        name = clean_text(match)
        if len(name) < 4:
            continue
        key = name.casefold()
        if key in seen:
            continue
        seen.add(key)
        out.append(name)
        if len(out) >= limit:
            break
    return out


def _confidence_for(*, engine: str, scope: str, analysis_strategy: str) -> tuple[str, str]:
    if engine == "llm" and scope == "selection" and analysis_strategy != "overview":
        return "Élevée", "Passage ciblé + synthèse LLM sur une portée réduite."
    if engine == "llm" and analysis_strategy != "overview":
        return "Moyenne", "Synthèse LLM utile, mais à confirmer sur les passages sensibles."
    if analysis_strategy == "overview":
        return "Moyenne", "Vue large fondée sur un aperçu : utile pour situer, pas pour trancher seul."
    return "Faible", "Résumé heuristique : bon pour repérer, moins fiable pour conclure seul."


def _source_note(*, source_kind: str, scope: str, analysis_strategy: str) -> str:
    if source_kind == "pdf" and analysis_strategy == "overview":
        return "Gros PDF : vue d'ensemble basée sur le titre et les premières pages."
    if source_kind == "pdf":
        return "PDF public : extraction via URL si nécessaire."
    if scope == "selection":
        return "Passage ciblé analysé depuis la page HTML."
    return "Page HTML analysée depuis l'onglet courant."


def _to_bullet(sentence: str, max_len: int = 160) -> str:
    text = clean_text(sentence)
    if not text:
        return ""
    if len(text) <= max_len:
        return text
    trimmed = text[:max_len].rsplit(" ", 1)[0].strip()
    return trimmed + "…"


def _word_count(text: str) -> int:
    return len(_WORD_RE.findall(text or ""))
