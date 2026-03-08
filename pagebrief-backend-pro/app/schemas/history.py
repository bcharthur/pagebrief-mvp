from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel


class HistoryItemResponse(BaseModel):
    id: str
    job_id: str | None = None
    title: str
    source_url: str
    summary_excerpt: str
    format: str
    source_type: str
    created_at: datetime
