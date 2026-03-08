from __future__ import annotations

from datetime import datetime, time, timezone

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.db.models import AnalysisJob, User


def _today_utc_bounds() -> tuple[datetime, datetime]:
    now = datetime.now(timezone.utc)
    start = datetime.combine(now.date(), time.min, tzinfo=timezone.utc)
    end = datetime.combine(now.date(), time.max, tzinfo=timezone.utc)
    return start, end


def ensure_format_allowed(user: User, requested_format: str) -> None:
    settings = get_settings()
    allowed = settings.free_allowed_formats if user.plan == "free" else settings.premium_allowed_formats
    if requested_format not in allowed:
        raise ValueError(f"Le format '{requested_format}' n'est pas disponible sur le plan {user.plan}.")


def ensure_daily_quota(db: Session, user: User) -> None:
    if user.plan != "free":
        return
    settings = get_settings()
    start, end = _today_utc_bounds()
    stmt = select(func.count(AnalysisJob.id)).where(
        AnalysisJob.user_id == user.id,
        AnalysisJob.created_at >= start,
        AnalysisJob.created_at <= end,
    )
    count = db.scalar(stmt) or 0
    if count >= settings.free_daily_analyses:
        raise ValueError("Quota quotidien atteint pour le plan gratuit.")
