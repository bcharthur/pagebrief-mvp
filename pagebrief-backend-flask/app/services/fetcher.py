from __future__ import annotations

import io
import re
from urllib.parse import urlparse

import httpx
from pypdf import PdfReader


_WHITESPACE_RE = re.compile(r"\s+")


def clean_text(value: str | None) -> str:
    text = str(value or "").replace("\xa0", " ")
    text = _WHITESPACE_RE.sub(" ", text)
    return text.strip()


def trim_input(value: str, limit: int) -> str:
    cleaned = clean_text(value)
    if len(cleaned) <= limit:
        return cleaned
    return cleaned[:limit].rsplit(" ", 1)[0].strip()


def is_probable_pdf_url(url: str) -> bool:
    raw = (url or "").strip().lower()
    if raw.endswith(".pdf"):
        return True
    return ".pdf?" in raw or "format=pdf" in raw


def fetch_pdf_text_from_url(url: str, settings) -> str:
    parsed = urlparse(url)
    if parsed.scheme not in {"http", "https"}:
        raise ValueError("L'URL du PDF doit commencer par http:// ou https://")

    headers = {"User-Agent": settings.user_agent}
    with httpx.Client(timeout=settings.fetch_timeout_s, follow_redirects=True, headers=headers) as client:
        response = client.get(url)
        response.raise_for_status()
        content_type = (response.headers.get("content-type") or "").lower()
        if "pdf" not in content_type and not is_probable_pdf_url(url):
            raise ValueError("L'URL fournie ne ressemble pas à un PDF public accessible.")
        data = response.content

    return extract_pdf_text_from_bytes(data)


def extract_pdf_text_from_bytes(data: bytes) -> str:
    try:
        reader = PdfReader(io.BytesIO(data))
    except Exception as exc:
        raise ValueError("Impossible de lire le PDF.") from exc

    chunks: list[str] = []
    for page in reader.pages:
        try:
            text = page.extract_text() or ""
        except Exception:
            text = ""
        if text.strip():
            chunks.append(text.strip())

    merged = "\n".join(chunks).strip()
    if not merged:
        raise ValueError("Le PDF ne contient aucun texte exploitable.")
    return merged
