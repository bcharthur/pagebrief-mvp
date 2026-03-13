from __future__ import annotations

import io
import re
from dataclasses import dataclass
from pathlib import Path
from statistics import mean
from urllib.parse import unquote, urlparse
from urllib.request import url2pathname

import httpx
from pypdf import PdfReader


_WHITESPACE_RE = re.compile(r"\s+")
_LINE_ONLY_DIGITS_RE = re.compile(r"^\d{1,4}$")
_URL_ONLY_RE = re.compile(r"^(https?://|www\.)", flags=re.IGNORECASE)
_PAGE_MARKER_RE = re.compile(r"^(page|p\.)\s+\d+(\s*/\s*\d+)?$", flags=re.IGNORECASE)
_DOUBLE_CHAR_RE = re.compile(r"([A-Za-zÀ-ÿ])\1{1,}")
_REPEAT_WORD_RE = re.compile(r"\b([A-Za-zÀ-ÿ]{2,})\s+\1\b", flags=re.IGNORECASE)
_METADATA_HINT_RE = re.compile(
    r"biblioth[eè]que|collection|volume|version|ebooksgratuits|gallimard|pl[eé]iade|isbn|copyright|"
    r"all rights reserved|table des mati[eè]res|sommaire|imprim[eé]", flags=re.IGNORECASE
)


@dataclass
class ExtractedPage:
    page_number: int
    raw_text: str
    cleaned_text: str
    quality_score: float
    is_noise: bool


@dataclass
class ExtractedDocument:
    source_type: str
    title: str
    pages: list[ExtractedPage]
    merged_text: str
    usable_pages: list[ExtractedPage]
    quality_score: float
    noise_ratio: float


def clean_text(value: str | None) -> str:
    text = str(value or "").replace("\xa0", " ")
    text = _DOUBLE_CHAR_RE.sub(r"\1", text)
    text = _REPEAT_WORD_RE.sub(r"\1", text)
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
    return fetch_pdf_document_from_url(url, timeout_s, user_agent).merged_text


def fetch_pdf_document_from_url(url: str, timeout_s: int, user_agent: str) -> ExtractedDocument:
    parsed = urlparse(url)
    if parsed.scheme == "file":
        return extract_pdf_document_from_bytes(_read_file_url_bytes(url))

    if parsed.scheme not in {"http", "https"}:
        raise ValueError("L'URL doit commencer par http://, https:// ou file:///")

    with httpx.Client(timeout=timeout_s, follow_redirects=True, headers={"User-Agent": user_agent}) as client:
        response = client.get(url)
        response.raise_for_status()
        content_type = (response.headers.get("content-type") or "").lower()
        if "pdf" not in content_type and not is_probable_pdf_url(url):
            raise ValueError("L'URL fournie ne ressemble pas à un PDF public accessible.")
        return extract_pdf_document_from_bytes(response.content)


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
    return extract_pdf_document_from_path(path).merged_text


def extract_pdf_document_from_path(path: Path) -> ExtractedDocument:
    return extract_pdf_document_from_bytes(path.read_bytes())


def extract_pdf_text_from_bytes(data: bytes) -> str:
    return extract_pdf_document_from_bytes(data).merged_text


def extract_pdf_document_from_bytes(data: bytes) -> ExtractedDocument:
    try:
        reader = PdfReader(io.BytesIO(data))
    except Exception as exc:
        raise ValueError("Impossible de lire le PDF.") from exc

    pages: list[ExtractedPage] = []
    for index, page in enumerate(reader.pages, start=1):
        try:
            raw_text = page.extract_text() or ""
        except Exception:
            raw_text = ""
        cleaned = _clean_pdf_page(raw_text)
        quality = _page_quality_score(raw_text, cleaned)
        is_noise = _is_noise_page(raw_text, cleaned, quality)
        pages.append(
            ExtractedPage(
                page_number=index,
                raw_text=raw_text,
                cleaned_text=cleaned,
                quality_score=quality,
                is_noise=is_noise,
            )
        )

    usable_pages = [page for page in pages if page.cleaned_text and not page.is_noise]
    if not usable_pages:
        usable_pages = [page for page in pages if page.cleaned_text]

    merged = "\n\n".join(page.cleaned_text for page in usable_pages).strip()
    if not merged:
        raise ValueError("Le PDF ne contient aucun texte exploitable.")

    quality_score = mean([page.quality_score for page in usable_pages]) if usable_pages else 0.0
    noise_ratio = 1.0 - (len(usable_pages) / max(1, len(pages)))
    title = _guess_pdf_title(pages)

    return ExtractedDocument(
        source_type="pdf",
        title=title,
        pages=pages,
        merged_text=merged,
        usable_pages=usable_pages,
        quality_score=quality_score,
        noise_ratio=noise_ratio,
    )


def _clean_pdf_page(text: str) -> str:
    lines: list[str] = []
    seen: set[str] = set()
    for raw_line in (text or "").splitlines():
        line = raw_line.replace("\xa0", " ").strip()
        line = _DOUBLE_CHAR_RE.sub(r"\1", line)
        line = _REPEAT_WORD_RE.sub(r"\1", line)
        line = re.sub(r"\s+", " ", line).strip()
        if not line:
            continue
        if _LINE_ONLY_DIGITS_RE.match(line):
            continue
        if _PAGE_MARKER_RE.match(line):
            continue
        if _URL_ONLY_RE.match(line) and len(line) < 120:
            continue
        if set(line) <= {"-", "_", "=", ".", "•", "*"}:
            continue
        if len(line) <= 1:
            continue
        normalized = line.lower()
        if normalized in seen:
            continue
        seen.add(normalized)
        lines.append(line)
    return "\n".join(lines).strip()


def _page_quality_score(raw_text: str, cleaned_text: str) -> float:
    if not cleaned_text:
        return 0.0
    raw_len = max(1, len(raw_text.strip()))
    cleaned_len = len(cleaned_text)
    words = cleaned_text.split()
    unique_ratio = len(set(word.lower() for word in words)) / max(1, len(words))
    punctuation_ratio = sum(cleaned_text.count(ch) for ch in ".,;:?!") / max(1, cleaned_len)
    newline_count = cleaned_text.count("\n")
    cleanup_ratio = min(1.0, cleaned_len / raw_len)
    score = 0.0
    score += min(1.0, len(words) / 180) * 0.35
    score += unique_ratio * 0.25
    score += min(1.0, punctuation_ratio * 15) * 0.15
    score += cleanup_ratio * 0.15
    score += (0.1 if newline_count >= 2 else 0.0)
    if _METADATA_HINT_RE.search(cleaned_text[:600]):
        score -= 0.25
    return max(0.0, min(1.0, score))


def _is_noise_page(raw_text: str, cleaned_text: str, quality_score: float) -> bool:
    if not cleaned_text:
        return True
    words = cleaned_text.split()
    if len(words) < 35:
        return True
    if quality_score < 0.22:
        return True
    head = cleaned_text[:800]
    if _METADATA_HINT_RE.search(head) and len(words) < 120:
        return True
    uppercase_ratio = sum(1 for char in head if char.isupper()) / max(1, sum(1 for char in head if char.isalpha()))
    if uppercase_ratio > 0.38 and len(words) < 80:
        return True
    return False


def _guess_pdf_title(pages: list[ExtractedPage]) -> str:
    for page in pages[:3]:
        for line in page.cleaned_text.splitlines()[:8]:
            candidate = clean_text(line)
            if 6 <= len(candidate) <= 120 and not _METADATA_HINT_RE.search(candidate):
                return candidate
    return "Document PDF"
