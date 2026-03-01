from __future__ import annotations

from dataclasses import dataclass

VALID_MODES = {"general", "dev", "sales", "buyer", "legal"}


@dataclass(slots=True)
class SummarizeRequest:
    url: str | None = None
    title: str | None = None
    page_text: str | None = None
    mode: str = "general"

    @classmethod
    def from_dict(cls, data: dict | None) -> "SummarizeRequest":
        payload = data or {}
        mode = str(payload.get("mode") or "general").strip().lower()
        if mode not in VALID_MODES:
            mode = "general"
        return cls(
            url=_clean_optional(payload.get("url")),
            title=_clean_optional(payload.get("title")),
            page_text=_clean_optional(payload.get("page_text")),
            mode=mode,
        )


def _clean_optional(value: object) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None
