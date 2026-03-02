from __future__ import annotations

import json
import time
from typing import Any

import httpx


class PageBriefLlmClient:
    def __init__(self, settings) -> None:
        self.settings = settings

    def summarize(self, payload: dict[str, Any], fallback: dict[str, Any], logger=None) -> dict[str, Any]:
        if not self.settings.llm_enabled:
            if logger:
                logger.info("LLM désactivé via config -> fallback heuristique")
            return fallback
        if self.settings.llm_provider != "ollama":
            if logger:
                logger.warning("Provider LLM non supporté (%s) -> fallback heuristique", self.settings.llm_provider)
            return fallback

        prompt = _build_prompt(payload)
        body = {
            "model": self.settings.llm_model,
            "prompt": prompt,
            "stream": False,
            "keep_alive": self.settings.llm_keep_alive,
            "format": {
                "type": "object",
                "properties": {
                    "intro_lines": {
                        "type": "array",
                        "items": {"type": "string"},
                        "minItems": 2,
                        "maxItems": 3,
                    },
                    "key_points": {
                        "type": "array",
                        "items": {"type": "string"},
                        "minItems": 3,
                        "maxItems": 6,
                    },
                    "conclusion": {"type": "string"},
                    "annex_blocks": {
                        "type": "array",
                        "minItems": 1,
                        "maxItems": 3,
                        "items": {
                            "type": "object",
                            "properties": {
                                "title": {"type": "string"},
                                "items": {
                                    "type": "array",
                                    "items": {"type": "string"},
                                    "minItems": 1,
                                    "maxItems": 5,
                                },
                            },
                            "required": ["title", "items"],
                            "additionalProperties": False,
                        },
                    },
                },
                "required": ["intro_lines", "key_points", "conclusion", "annex_blocks"],
                "additionalProperties": False,
            },
            "options": {
                "temperature": 0.1,
                "num_predict": self.settings.llm_max_output_tokens,
            },
        }

        try:
            started = time.perf_counter()
            endpoint = f"{self.settings.llm_base_url.rstrip('/')}/api/generate"
            if logger:
                logger.info(
                    "Appel LLM -> %s | provider=%s model=%s prompt_chars=%s max_output=%s timeout=%ss format=%s strategy=%s",
                    endpoint,
                    self.settings.llm_provider,
                    self.settings.llm_model,
                    len(prompt),
                    self.settings.llm_max_output_tokens,
                    self.settings.llm_timeout_s,
                    payload.get("view_format"),
                    payload.get("analysis_strategy"),
                )
            timeout = httpx.Timeout(connect=5.0, read=self.settings.llm_timeout_s, write=30.0, pool=5.0)
            with httpx.Client(timeout=timeout) as client:
                response = client.post(endpoint, json=body)
                response.raise_for_status()
                data = response.json()
            if logger:
                logger.info(
                    "Réponse LLM reçue | status=%s | %.1f ms | prompt_eval=%s eval=%s done_reason=%s",
                    response.status_code,
                    (time.perf_counter() - started) * 1000,
                    data.get("prompt_eval_count"),
                    data.get("eval_count"),
                    data.get("done_reason"),
                )

            content = _extract_json_payload((data.get("response") or "").strip())
            if data.get("done_reason") == "length":
                if logger:
                    logger.warning("Réponse LLM tronquée (done_reason=length) -> fallback | raw=%r", content[:400])
                return fallback

            parsed = json.loads(content) if content else {}
            intro_lines = _normalize_list(parsed.get("intro_lines"), limit=3)
            key_points = _normalize_list(parsed.get("key_points"), limit=6)
            conclusion = str(parsed.get("conclusion") or "").strip()
            annex_blocks = _normalize_blocks(parsed.get("annex_blocks"), limit=3)

            if len(intro_lines) < 2 or len(key_points) < 3 or not conclusion or not annex_blocks:
                if logger:
                    logger.warning(
                        "Réponse LLM incomplète -> fallback | intro=%s points=%s conclusion=%s annex=%s raw=%r",
                        len(intro_lines),
                        len(key_points),
                        bool(conclusion),
                        len(annex_blocks),
                        content[:300],
                    )
                return fallback

            merged = dict(fallback)
            merged.update(
                {
                    "intro_lines": intro_lines,
                    "key_points": key_points,
                    "conclusion": conclusion,
                    "annex_blocks": annex_blocks,
                    "summary_points": key_points,
                    "tldr": conclusion,
                    "engine": "llm",
                }
            )
            confidence_label, confidence_reason = _confidence_for(
                scope=str(fallback.get("scope") or "document"),
                analysis_strategy=str(fallback.get("analysis_strategy") or "full"),
            )
            merged["confidence_label"] = confidence_label
            merged["confidence_reason"] = confidence_reason
            if logger:
                logger.info("Réponse LLM valide -> engine=llm")
            return merged
        except Exception as exc:
            if logger:
                logger.exception("Échec appel/parsing LLM -> fallback heuristique (%s)", exc)
            return fallback


def _extract_json_payload(raw: str) -> str:
    text = raw.strip()
    if text.startswith("```json"):
        text = text[7:]
    if text.startswith("```"):
        text = text[3:]
    if text.endswith("```"):
        text = text[:-3]
    text = text.strip()

    if text.startswith("{") and text.endswith("}"):
        return text

    start = text.find("{")
    if start < 0:
        return text

    depth = 0
    in_string = False
    escaped = False
    for idx, char in enumerate(text[start:], start=start):
        if in_string:
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == '"':
                in_string = False
            continue

        if char == '"':
            in_string = True
        elif char == '{':
            depth += 1
        elif char == '}':
            depth -= 1
            if depth == 0:
                return text[start: idx + 1]
    return text


def _normalize_list(value: Any, limit: int) -> list[str]:
    raw_items = value if isinstance(value, list) else []
    out: list[str] = []
    seen: set[str] = set()
    for item in raw_items:
        text = str(item or "").strip()
        if not text:
            continue
        key = text.casefold()
        if key in seen:
            continue
        seen.add(key)
        out.append(text)
        if len(out) >= limit:
            break
    return out


def _normalize_blocks(value: Any, limit: int) -> list[dict[str, Any]]:
    raw_items = value if isinstance(value, list) else []
    blocks: list[dict[str, Any]] = []
    seen_titles: set[str] = set()
    for item in raw_items:
        if not isinstance(item, dict):
            continue
        title = str(item.get("title") or "").strip()
        items = _normalize_list(item.get("items"), limit=5)
        if not title or not items:
            continue
        key = title.casefold()
        if key in seen_titles:
            continue
        seen_titles.add(key)
        blocks.append({"title": title, "items": items})
        if len(blocks) >= limit:
            break
    return blocks


def _confidence_for(*, scope: str, analysis_strategy: str) -> tuple[str, str]:
    if scope == "selection" and analysis_strategy != "overview":
        return "Élevée", "Passage ciblé + synthèse LLM sur une portée réduite."
    if analysis_strategy == "overview":
        return "Moyenne", "Vue large fondée sur un aperçu : utile pour situer, pas pour trancher seul."
    return "Moyenne", "Synthèse LLM utile, mais à confirmer sur les passages sensibles."


def _build_prompt(payload: dict[str, Any]) -> str:
    title = str(payload.get("title") or "").strip()
    url = str(payload.get("url") or "").strip()
    source_kind = str(payload.get("source_kind") or "").strip()
    view_format = str(payload.get("view_format") or "express").strip()
    format_label = str(payload.get("format_label") or view_format).strip()
    scope = str(payload.get("scope") or "document").strip()
    focus_hint = str(payload.get("focus_hint") or "").strip()
    instruction = str(payload.get("instruction") or "").strip()
    analysis_strategy = str(payload.get("analysis_strategy") or "full").strip()
    analysis_basis = str(payload.get("analysis_basis") or "").strip()
    section_labels = payload.get("section_labels") or {}
    text = str(payload.get("text") or "").strip()
    meta = {
        "format": view_format,
        "format_label": format_label,
        "scope": scope,
        "title": title,
        "url": url,
        "source_kind": source_kind,
        "focus_hint": focus_hint,
        "analysis_strategy": analysis_strategy,
        "analysis_basis": analysis_basis,
        "section_labels": section_labels,
        "instruction": instruction,
    }
    return (
        "Tu prépares une synthèse visuelle pour une extension Chrome affichée en panneau latéral.\n"
        "Respect absolu: n'invente rien, n'infère pas des dates, chiffres, ratifications, causalités ou conclusions non explicites.\n"
        "Si une information n'est pas clairement présente, reste général et indique implicitement la prudence dans les blocs annexes.\n"
        "Retourne uniquement un JSON valide conforme au schéma.\n"
        "Produit attendu: 2 à 3 lignes d'introduction, 3 à 6 points, 1 conclusion, 1 à 3 blocs annexes utiles.\n"
        "Chaque item doit être très court, concret et lisible en interface.\n"
        "Si analysis_strategy vaut overview, traite le texte comme une vue d'ensemble non exhaustive.\n\n"
        f"META:\n{json.dumps(meta, ensure_ascii=False)}\n\n"
        f"TEXTE:\n{text}"
    )
