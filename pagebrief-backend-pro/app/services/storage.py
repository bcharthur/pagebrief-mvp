from __future__ import annotations

from pathlib import Path
from uuid import uuid4

from fastapi import UploadFile

from app.core.config import get_settings


def ensure_storage_root() -> Path:
    root = Path(get_settings().storage_root)
    root.mkdir(parents=True, exist_ok=True)
    (root / "uploads").mkdir(parents=True, exist_ok=True)
    return root


def save_upload(file: UploadFile) -> tuple[str, Path, int]:
    root = ensure_storage_root()
    token = str(uuid4())
    suffix = Path(file.filename or "").suffix.lower() or ".bin"
    target = root / "uploads" / f"{token}{suffix}"
    content = file.file.read()
    target.write_bytes(content)
    return token, target, len(content)


def resolve_upload_token(file_token: str) -> Path:
    root = ensure_storage_root() / "uploads"
    matches = list(root.glob(f"{file_token}.*"))
    if not matches:
        raise FileNotFoundError("Fichier uploadé introuvable.")
    return matches[0]
