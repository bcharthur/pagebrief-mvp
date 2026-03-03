from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, get_db
from app.db.models import HistoryItem, User
from app.schemas.history import HistoryItemResponse


router = APIRouter(prefix="/v1/history", tags=["history"])


@router.get("", response_model=list[HistoryItemResponse])
def list_history(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[HistoryItemResponse]:
    items = db.scalars(
        select(HistoryItem)
        .where(HistoryItem.user_id == user.id)
        .order_by(HistoryItem.created_at.desc())
        .limit(100)
    ).all()
    return [
        HistoryItemResponse(
            id=item.id,
            job_id=item.job_id,
            title=item.title,
            source_url=item.source_url,
            summary_excerpt=item.summary_excerpt,
            format=item.format,
            source_type=item.source_type,
            created_at=item.created_at,
        )
        for item in items
    ]
