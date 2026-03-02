from __future__ import annotations

from dataclasses import dataclass

from app.config import SUPPORTED_FORMATS

VALID_FORMATS = set(SUPPORTED_FORMATS)
VALID_SCOPES = {"document", "selection"}
_FORMAT_ALIASES = {
    "general": "express",
    "dev": "analytic",
    "sales": "decision",
    "buyer": "decision",
    "legal": "decision",
}


@dataclass(slots=True)
class SummarizeRequest:
    url: str | None = None
    title: str | None = None
    page_text: str | None = None
    view_format: str = "express"
    scope: str = "document"
    focus_hint: str | None = None

    @classmethod
    def from_dict(cls, data: dict | None) -> "SummarizeRequest":
        payload = data or {}
        raw_format = payload.get("format", payload.get("view_format", payload.get("mode", "express")))
        view_format = str(raw_format or "express").strip().lower()
        view_format = _FORMAT_ALIASES.get(view_format, view_format)
        if view_format not in VALID_FORMATS:
            view_format = "express"

        scope = str(payload.get("scope") or "document").strip().lower()
        if scope not in VALID_SCOPES:
            scope = "document"

        return cls(
            url=_clean_optional(payload.get("url")),
            title=_clean_optional(payload.get("title")),
            page_text=_clean_optional(payload.get("page_text")),
            view_format=view_format,
            scope=scope,
            focus_hint=_clean_optional(payload.get("focus_hint")),
        )


def _clean_optional(value: object) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None
