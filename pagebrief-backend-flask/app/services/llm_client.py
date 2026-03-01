from __future__ import annotations

import json
import re
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
                    "summary_points": {
                        "type": "array",
                        "items": {"type": "string"},
                        "minItems": 3,
                        "maxItems": 4,
                    },
                    "actions": {
                        "type": "array",
                        "items": {"type": "string"},
                        "minItems": 1,
                        "maxItems": 3,
                    },
                    "risks": {
                        "type": "array",
                        "items": {"type": "string"},
                        "minItems": 1,
                        "maxItems": 3,
                    },
                    "tldr": {"type": "string"},
                },
                "required": ["summary_points", "actions", "risks", "tldr"],
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
                    "Appel LLM -> %s | provider=%s model=%s prompt_chars=%s max_output=%s timeout=%ss",
                    endpoint,
                    self.settings.llm_provider,
                    self.settings.llm_model,
                    len(prompt),
                    self.settings.llm_max_output_tokens,
                    self.settings.llm_timeout_s,
                )
            timeout = httpx.Timeout(connect=5.0, read=self.settings.llm_timeout_s, write=30.0, pool=5.0)
            with httpx.Client(timeout=timeout) as client:
                response = client.post(endpoint, json=body)
                response.raise_for_status()
                data = response.json()
            done_reason = data.get("done_reason")
            if logger:
                logger.info(
                    "Réponse LLM reçue | status=%s | %.1f ms | prompt_eval=%s eval=%s done_reason=%s",
                    response.status_code,
                    (time.perf_counter() - started) * 1000,
                    data.get("prompt_eval_count"),
                    data.get("eval_count"),
                    done_reason,
                )
            content = _extract_json_object(_strip_code_fences((data.get("response") or "").strip()))
            if done_reason == "length":
                if logger:
                    logger.warning("Réponse LLM tronquée (done_reason=length) -> fallback | raw=%r", content[:400])
                return fallback

            parsed = json.loads(content) if content else {}
            summary_points = _normalize_list(parsed.get("summary_points"), limit=4)
            actions = _normalize_list(parsed.get("actions"), limit=3)
            risks = _normalize_list(parsed.get("risks"), limit=3)
            tldr = str(parsed.get("tldr") or "").strip()
            if len(summary_points) < 3 or not actions or not risks or not tldr:
                if logger:
                    logger.warning(
                        "Réponse LLM incomplète -> fallback | summary_points=%s actions=%s risks=%s tldr=%s raw=%r",
                        len(summary_points),
                        len(actions),
                        len(risks),
                        bool(tldr),
                        content[:300],
                    )
                return fallback
            if not _looks_grounded(payload.get("text") or "", summary_points, actions, risks, tldr):
                if logger:
                    logger.warning("Réponse LLM suspecte (ancrage faible) -> fallback | raw=%r", content[:400])
                return fallback
            merged = dict(fallback)
            merged.update(
                {
                    "summary_points": summary_points,
                    "actions": actions,
                    "risks": risks,
                    "tldr": tldr,
                    "engine": "llm",
                }
            )
            if logger:
                logger.info("Réponse LLM valide -> engine=llm")
            return merged
        except Exception as exc:
            if logger:
                logger.exception("Échec appel/parsing LLM -> fallback heuristique (%s)", exc)
            return fallback


def _normalize_list(value: Any, limit: int) -> list[str]:
    raw_items = value if isinstance(value, list) else []
    out: list[str] = []
    seen: set[str] = set()
    for item in raw_items:
        text = str(item or "").strip()
        if not text:
            continue
        text = re.sub(r"\s+", " ", text)
        key = text.casefold()
        if key in seen:
            continue
        seen.add(key)
        out.append(text)
        if len(out) >= limit:
            break
    return out


def _build_prompt(payload: dict[str, Any]) -> str:
    title = str(payload.get("title") or "").strip()
    url = str(payload.get("url") or "").strip()
    source_kind = str(payload.get("source_kind") or "").strip()
    mode = str(payload.get("mode") or "general").strip()
    instruction = str(payload.get("instruction") or "").strip()
    text = str(payload.get("text") or "").strip()
    meta = {
        "mode": mode,
        "title": title,
        "url": url,
        "source_kind": source_kind,
        "instruction": instruction,
    }
    return (
        "Tu résumes un document pour une décision rapide.\n"
        "Règles absolues : n'invente rien, n'infère aucune date, aucun chiffre, aucune ratification ou causalité si ce n'est pas explicitement écrit.\n"
        "Si une information n'est pas explicitement présente, écris une formulation prudente ou 'Non précisé'.\n"
        "Style : français clair, phrases courtes, utiles, orientées décision.\n"
        "Retourne uniquement un JSON valide respectant le schéma demandé. Aucun markdown.\n"
        "Contraintes de concision :\n"
        "- summary_points: 3 à 4 éléments, 1 phrase courte chacun, max 18 mots\n"
        "- actions: 1 à 3 éléments, max 14 mots\n"
        "- risks: 1 à 3 éléments, max 14 mots\n"
        "- tldr: 1 phrase, max 24 mots\n\n"
        f"META:\n{json.dumps(meta, ensure_ascii=False)}\n\n"
        f"TEXTE:\n{text}"
    )


def _strip_code_fences(content: str) -> str:
    content = content.strip()
    if content.startswith("```json"):
        content = content[7:]
    elif content.startswith("```"):
        content = content[3:]
    if content.endswith("```"):
        content = content[:-3]
    return content.strip()


def _extract_json_object(content: str) -> str:
    if not content:
        return content
    start = content.find("{")
    end = content.rfind("}")
    if start != -1 and end != -1 and end > start:
        return content[start:end + 1]
    return content


def _looks_grounded(source_text: str, summary_points: list[str], actions: list[str], risks: list[str], tldr: str) -> bool:
    source = (source_text or "").lower()
    generated = " ".join([*summary_points, *actions, *risks, tldr]).lower()
    source_years = set(re.findall(r"\b(1[89]\d{2}|20\d{2})\b", source))
    generated_years = set(re.findall(r"\b(1[89]\d{2}|20\d{2})\b", generated))
    if generated_years - source_years:
        return False
    if "ratification" in generated and "ratification" not in source and "ratifi" not in source:
        return False
    if "obligatoire" in generated and "obligatoire" not in source and "contraignant" not in source:
        return False
    return True
