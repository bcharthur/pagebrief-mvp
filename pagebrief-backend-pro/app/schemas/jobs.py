from __future__ import annotations

from datetime import datetime
from typing import Any, Literal, Optional

from pydantic import BaseModel


AllowedFormat = Literal["express", "analytique", "decision", "etude"]
AllowedScope = Literal["document", "selection", "page"]


class JobCreateRequest(BaseModel):
    format: AllowedFormat = "express"
    scope: AllowedScope = "document"
    title: str = ""
    source_url: Optional[str] = None
    source_type: str = "html"
    text_content: str = ""
    file_token: Optional[str] = None


class JobCreateResponse(BaseModel):
    job_id: str
    status: str
    progress: int
    progress_label: str


class JobStatusResponse(BaseModel):
    id: str
    status: str
    format: str
    scope: str
    source_type: str
    title: str
    source_url: str
    progress: int
    progress_label: str
    error_message: Optional[str] = None
    reading_time_min: Optional[int] = None
    confidence: Optional[str] = None
    result: Optional[dict[str, Any]] = None
    created_at: datetime
    updated_at: datetime


class UploadResponse(BaseModel):
    file_token: str
    filename: str
    size_bytes: int
