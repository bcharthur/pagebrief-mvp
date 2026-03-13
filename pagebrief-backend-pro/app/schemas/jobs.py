from __future__ import annotations

from datetime import datetime
from typing import Any, Literal, Optional

from pydantic import BaseModel, Field, field_validator


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

    selected_text: Optional[str] = None
    page_number: Optional[int] = Field(default=None, ge=1)
    page_from: Optional[int] = Field(default=None, ge=1)
    page_to: Optional[int] = Field(default=None, ge=1)

    @field_validator("text_content", "selected_text", mode="before")
    @classmethod
    def normalize_text_fields(cls, value: str | None) -> str | None:
        if value is None:
            return None
        return str(value).strip()

    @field_validator("source_type", mode="before")
    @classmethod
    def normalize_source_type(cls, value: str) -> str:
        return (value or "html").strip().lower()

    @field_validator("page_to")
    @classmethod
    def validate_page_range(cls, value: int | None, info) -> int | None:
        page_from = info.data.get("page_from")
        if value is not None and page_from is not None and value < page_from:
            raise ValueError("page_to doit être supérieur ou égal à page_from")
        return value


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
