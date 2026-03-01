from __future__ import annotations

import math
import re
from typing import Iterable

from app.services.fetcher import clean_text, trim_input

_SENTENCE_SPLIT_RE = re.compile(r"(?<=[.!?])\s+|\n+")
_WORD_RE = re.compile(r"\b[\wÀ-ÿ'-]+\b", flags=re.UNICODE)
_NOISE_RE = re.compile(r"^(page\s+\d+|\d+|https?://\S+)$", flags=re.IGNORECASE)

_MODE_PROMPTS = {
    "general": "Découpe en utiles, actions concrètes et points flous.",
    "dev": "Lis comme une doc technique: prérequis, breaking changes, limites, actions d'implémentation.",
    "sales": "Lis comme une landing page: promesse, objections, éléments à vérifier avant action.",
    "buyer": "Lis comme une fiche produit: bénéfices, éléments manquants, risques d'achat.",
    "legal": "Lis comme un texte contractuel: obligations, clauses sensibles, ambiguïtés.",
}

_MODE_ACTION_FALLBACKS = {
    "general": ["Vérifier la source complète avant de décider."],
    "dev": ["Valider les prérequis techniques avant implémentation."],
    "sales": ["Comparer la promesse affichée avec l'offre réelle."],
    "buyer": ["Contrôler prix final, retour et conditions avant achat."],
    "legal": ["Faire relire les clauses sensibles avant validation."],
}

_MODE_RISK_HINTS = {
    "general": ["warning", "attention", "limite", "beta", "experimental", "subject to", "may", "peut"],
    "dev": ["deprecated", "breaking", "experimental", "beta", "migration", "unsupported", "limit"],
    "sales": ["conditions", "pricing", "tarif", "preuve", "sans garantie", "may"],
    "buyer": ["warranty", "garantie", "return", "retour", "subscription", "abonnement", "shipping", "livraison"],
    "legal": ["termination", "résiliation", "liability", "responsabilité", "arbitration", "renouvellement", "consent", "données"],
}

_ACTION_PATTERNS = [
    r"\bmust\b", r"\bshould\b", r"\brequired\b", r"\bneed to\b", r"\bverify\b", r"\bcheck\b",
    r"\bconfigure\b", r"\binstall\b", r"\benable\b", r"\bdisable\b", r"\breview\b",
    r"\bdoit\b", r"\bdevez\b", r"\bnécessaire\b", r"\bverifier\b", r"\bvérifier\b",
    r"\bconfigurer\b", r"\binstaller\b", r"\bactiver\b", r"\bdésactiver\b", r"\bdesactiver\b",
]


def summarize_payload(*, title: str | None, url: str | None, mode: str, source_text: str, source_kind: str, settings, llm_client, logger=None):
    raw_text = clean_text(source_text)
    llm_input = trim_input(raw_text, settings.max_input_chars)
    if logger:
        logger.info(
            "Nettoyage entrée | raw_chars=%s clean_chars=%s llm_input_chars=%s max_input_chars=%s",
            len(source_text or ""),
            len(raw_text or ""),
            len(llm_input or ""),
            settings.max_input_chars,
        )
    local = _build_local_summary(title=title, url=url, mode=mode, text=raw_text, source_kind=source_kind)

    llm_text = _llm_excerpt(llm_input)
    llm_payload = {
        "mode": mode,
        "title": clean_text(title),
        "url": clean_text(url),
        "source_kind": source_kind,
        "instruction": _MODE_PROMPTS.get(mode, _MODE_PROMPTS["general"]),
        "text": llm_text,
    }

    if logger:
        logger.info(
            "Résumé heuristique prêt | words=%s tldr_len=%s llm_text_chars=%s",
            local.get("word_count"),
            len(local.get("tldr") or ""),
            len(llm_text or ""),
        )

    enriched = llm_client.summarize(llm_payload, local, logger=logger)
    return enriched


def _llm_excerpt(text: str, head: int = 2200, tail: int = 1000) -> str:
    text = clean_text(text)
    if len(text) <= head + tail + 64:
        return text
    left = text[:head].rsplit(" ", 1)[0].strip()
    right = text[-tail:].split(" ", 1)[-1].strip()
    return f"{left}\n\n[... contenu tronqué pour accélérer l'analyse ...]\n\n{right}"


def _build_local_summary(*, title: str | None, url: str | None, mode: str, text: str, source_kind: str) -> dict:
    sentences = _candidate_sentences(text)
    words = _word_count(text)
    reading_time_min = max(1, int(math.ceil(words / 220))) if words else 1

    summary_points = _pick_summary_points(sentences, limit=5)
    actions = _pick_actions(sentences, mode=mode, limit=4)
    risks = _pick_risks(sentences, mode=mode, limit=4)
    tldr = _build_tldr(title=title, summary_points=summary_points)

    return {
        "title": clean_text(title),
        "url": clean_text(url),
        "mode": mode,
        "source_kind": source_kind,
        "word_count": words,
        "reading_time_min": reading_time_min,
        "summary_points": summary_points,
        "actions": actions,
        "risks": risks,
        "tldr": tldr,
        "engine": "heuristic",
    }


def _candidate_sentences(text: str) -> list[str]:
    raw = [clean_text(part) for part in _SENTENCE_SPLIT_RE.split(text)]
    kept: list[str] = []
    seen: set[str] = set()
    for item in raw:
        if len(item) < 40:
            continue
        if _looks_noisy(item):
            continue
        key = item.casefold()
        if key in seen:
            continue
        seen.add(key)
        kept.append(item)
    if kept:
        return kept

    fallback = [clean_text(line) for line in text.split("\n") if clean_text(line) and not _looks_noisy(clean_text(line))]
    return fallback[:12]


def _pick_summary_points(sentences: list[str], limit: int) -> list[str]:
    picked: list[str] = []
    for sentence in sentences:
        short = _to_bullet(sentence)
        if short:
            picked.append(short)
        if len(picked) >= limit:
            break
    return picked or ["Le contenu est trop pauvre ou trop bruité pour un résumé fiable."]


def _pick_actions(sentences: list[str], *, mode: str, limit: int) -> list[str]:
    out = _pick_by_patterns(sentences, _ACTION_PATTERNS, limit)
    if out:
        return out
    return list(_MODE_ACTION_FALLBACKS.get(mode, _MODE_ACTION_FALLBACKS["general"])[:limit])


def _pick_risks(sentences: list[str], *, mode: str, limit: int) -> list[str]:
    hints = _MODE_RISK_HINTS.get(mode, _MODE_RISK_HINTS["general"])
    patterns = [rf"\b{re.escape(token)}\b" for token in hints if token.isascii() and token.isalpha()] + [token for token in hints if not (token.isascii() and token.isalpha())]
    out = _pick_by_patterns(sentences, patterns, limit)
    if out:
        return out
    return ["Peu de signaux explicites : vérifier le texte complet et le contexte avant décision."]


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


def _to_bullet(sentence: str, max_len: int = 160) -> str:
    text = clean_text(sentence)
    if not text:
        return ""
    if len(text) <= max_len:
        return text
    trimmed = text[:max_len].rsplit(" ", 1)[0].strip()
    return trimmed + "…"


def _build_tldr(*, title: str | None, summary_points: list[str]) -> str:
    lead = clean_text(title)
    core = " ".join(summary_points[:2]).strip()
    if lead and core:
        return f"{lead} — {core}"
    if core:
        return core
    return "Aucun TL;DR exploitable."


def _word_count(text: str) -> int:
    return len(_WORD_RE.findall(text or ""))


def _looks_noisy(text: str) -> bool:
    sample = clean_text(text)
    if not sample:
        return True
    if _NOISE_RE.match(sample):
        return True
    words = _WORD_RE.findall(sample)
    if len(words) <= 3 and len(sample) < 30:
        return True
    return False
