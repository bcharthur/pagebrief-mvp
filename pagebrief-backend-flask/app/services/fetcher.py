from __future__ import annotations

import io
import re
from pathlib import Path
from urllib.parse import urlparse, unquote
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


def fetch_pdf_text_from_url(url: str, settings) -> str:
    parsed = urlparse(url)

    if parsed.scheme == "file":
        data = _read_pdf_bytes_from_file_url(url)
        return extract_pdf_text_from_bytes(data)

    if parsed.scheme not in {"http", "https"}:
        raise ValueError("L'URL du PDF doit commencer par http:// , https:// ou file:///")

    headers = {"User-Agent": settings.user_agent}
    with httpx.Client(timeout=settings.fetch_timeout_s, follow_redirects=True, headers=headers) as client:
        response = client.get(url)
        response.raise_for_status()
        content_type = (response.headers.get("content-type") or "").lower()
        if "pdf" not in content_type and not is_probable_pdf_url(url):
            raise ValueError("L'URL fournie ne ressemble pas à un PDF public accessible.")
        data = response.content

    return extract_pdf_text_from_bytes(data)


def _read_pdf_bytes_from_file_url(url: str) -> bytes:
    parsed = urlparse(url)
    if parsed.scheme != "file":
        raise ValueError("URL de fichier invalide.")

    # Convertit proprement file:///... en chemin local Windows/Linux
    raw_path = url2pathname(unquote(parsed.path or ""))

    # Cas UNC éventuel : file://server/share/file.pdf
    if parsed.netloc and parsed.netloc not in {"", "localhost"}:
        raw_path = f"//{parsed.netloc}{raw_path}"

    # Sur Windows, file:///C:/... donne souvent /C:/... -> on enlève le slash de trop
    if re.match(r"^/[A-Za-z]:", raw_path):
        raw_path = raw_path[1:]

    path = Path(raw_path)

    if not path.exists():
        raise ValueError(f"Le fichier local est introuvable : {path}")
    if not path.is_file():
        raise ValueError(f"Le chemin local n'est pas un fichier : {path}")
    if path.suffix.lower() != ".pdf":
        raise ValueError("Le fichier local doit être un PDF.")

    try:
        return path.read_bytes()
    except Exception as exc:
        raise ValueError(f"Impossible de lire le fichier local : {path}") from exc


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