from __future__ import annotations

from app.db.session import db_session
from app.services.job_service import process_job
from app.workers.celery_app import celery_app


@celery_app.task(name="pagebrief.process_job")
def process_job_task(job_id: str) -> None:
    with db_session() as db:
        process_job(db, job_id)