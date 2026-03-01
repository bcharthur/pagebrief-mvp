from __future__ import annotations

import json
from typing import Any

import httpx


class PageBriefLlmClient:
    def __init__(self, settings) -> None:
        self.settings = settings

    def summarize(self, payload: dict[str, Any], fallback: dict[str, Any]) -> dict[str, Any]:
        if not self.settings.llm_enabled:
            return fallback
        if self.settings.llm_provider != "ollama":
            return fallback

        body = {
            "model": self.settings.llm_model,
            "prompt": _build_prompt(payload),
            "stream": False,
            "format": {
                "type": "object",
                "properties": {
                    "summary_points": {
                        "type": "array",
                        "items": {"type": "string"},
                        "minItems": 3,
                        "maxItems": 5,
                    },
                    "actions": {
                        "type": "array",
                        "items": {"type": "string"},
                        "minItems": 1,
                        "maxItems": 5,
                    },
                    "risks": {
                        "type": "array",
                        "items": {"type": "string"},
                        "minItems": 1,
                        "maxItems": 5,
                    },
                    "tldr": {"type": "string"},
                },
                "required": ["summary_points", "actions", "risks", "tldr"],
                "additionalProperties": False,
            },
            "options": {"temperature": 0.2},
        }

        try:
            with httpx.Client(timeout=self.settings.llm_timeout_s) as client:
                response = client.post(f"{self.settings.llm_base_url.rstrip('/')}/api/generate", json=body)
                response.raise_for_status()
                data = response.json()
            content = (data.get("response") or "").strip()
            parsed = json.loads(content) if content else {}
            summary_points = _normalize_list(parsed.get("summary_points"), limit=5)
            actions = _normalize_list(parsed.get("actions"), limit=5)
            risks = _normalize_list(parsed.get("risks"), limit=5)
            tldr = str(parsed.get("tldr") or "").strip()
            if len(summary_points) < 3 or not actions or not risks or not tldr:
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
            return merged
        except Exception:
            return fallback


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


def _build_prompt(payload: dict[str, Any]) -> str:
    facts = json.dumps(payload, ensure_ascii=False, indent=2)
    return (
        "Tu es un assistant de synthèse orienté décision. "
        "Tu reçois un texte de page web déjà extrait par le navigateur. "
        "Tu ne dois rien inventer, ni extrapoler au-delà du texte reçu. "
        "Produis un JSON structuré avec exactement : summary_points (3 à 5), actions (1 à 5), risks (1 à 5), tldr. "
        "Le champ risks doit contenir soit des zones floues, soit des limites, soit des points à vérifier. "
        "Le ton doit être utile, concis, et orienté métier selon le mode fourni.\n\n"
        f"PAYLOAD:\n{facts}\n"
    )
