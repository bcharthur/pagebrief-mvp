from __future__ import annotations

import io
import re
from pathlib import Path
from urllib.parse import unquote, urlparse
from urllib.request import url2pathname

import httpx
from pypdf import PdfReader


_WHITESPACE_RE = re.compile(r"\s+")
_LINE_ONLY_DIGITS_RE = re.compile(r"^\d{1,4}$")
_URL_ONLY_RE = re.compile(r"^(https?://|www\.)", flags=re.IGNORECASE)
_PAGE_MARKER_RE = re.compile(r"^(page|p\.)\s+\d+(\s*/\s*\d+)?$", flags=re.IGNORECASE)


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


def fetch_text_from_http_url(url: str, timeout_s: int, user_agent: str) -> str:
    with httpx.Client(timeout=timeout_s, follow_redirects=True, headers={"User-Agent": user_agent}) as client:
        response = client.get(url)
        response.raise_for_status()
        content_type = (response.headers.get("content-type") or "").lower()
        if "pdf" in content_type or is_probable_pdf_url(url):
            return extract_pdf_text_from_bytes(response.content)
        return response.text


def fetch_pdf_text_from_url(url: str, timeout_s: int, user_agent: str) -> str:
    parsed = urlparse(url)
    if parsed.scheme == "file":
        return extract_pdf_text_from_bytes(_read_file_url_bytes(url))

    if parsed.scheme not in {"http", "https"}:
        raise ValueError("L'URL doit commencer par http://, https:// ou file:///")

    with httpx.Client(timeout=timeout_s, follow_redirects=True, headers={"User-Agent": user_agent}) as client:
        response = client.get(url)
        response.raise_for_status()
        content_type = (response.headers.get("content-type") or "").lower()
        if "pdf" not in content_type and not is_probable_pdf_url(url):
            raise ValueError("L'URL fournie ne ressemble pas à un PDF public accessible.")
        return extract_pdf_text_from_bytes(response.content)


def _read_file_url_bytes(url: str) -> bytes:
    parsed = urlparse(url)
    raw_path = url2pathname(unquote(parsed.path or ""))

    if parsed.netloc and parsed.netloc not in {"", "localhost"}:
        raw_path = f"//{parsed.netloc}{raw_path}"

    if re.match(r"^/[A-Za-z]:", raw_path):
        raw_path = raw_path[1:]

    path = Path(raw_path)
    if not path.exists() or not path.is_file():
        raise ValueError(f"Le fichier local est introuvable : {path}")
    if path.suffix.lower() != ".pdf":
        raise ValueError("Le fichier local doit être un PDF.")
    return path.read_bytes()


def extract_pdf_text_from_path(path: Path) -> str:
    return extract_pdf_text_from_bytes(path.read_bytes())


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
        cleaned = _clean_pdf_page(text)
        if cleaned:
            chunks.append(cleaned)

    merged = "\n".join(chunks).strip()
    if not merged:
        raise ValueError("Le PDF ne contient aucun texte exploitable.")
    return merged


def _clean_pdf_page(text: str) -> str:
    lines = []
    for raw_line in (text or "").splitlines():
        line = raw_line.replace("\xa0", " ").strip()
        if not line:
            continue
        if _LINE_ONLY_DIGITS_RE.match(line):
            continue
        if _PAGE_MARKER_RE.match(line):
            continue
        if _URL_ONLY_RE.match(line) and len(line) < 120:
            continue
        if set(line) <= {"-", "_", "=", ".", "•"}:
            continue
        if len(line) <= 1:
            continue
        lines.append(line)
    return "\n".join(lines).strip()
