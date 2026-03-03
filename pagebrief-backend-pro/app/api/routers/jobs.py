from __future__ import annotations

import asyncio
import json
from typing import AsyncGenerator

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, get_db
from app.core.config import get_settings
from app.db.models import AnalysisJob, User
from app.schemas.jobs import JobCreateRequest, JobCreateResponse, JobStatusResponse, UploadResponse
from app.services.job_service import create_job, serialize_job
from app.services.storage import save_upload
from app.services.usage import ensure_daily_quota, ensure_format_allowed


router = APIRouter(prefix="/v1", tags=["jobs"])


@router.post("/files/upload", response_model=UploadResponse)
def upload_pdf(
    file: UploadFile = File(...),
    user: User = Depends(get_current_user),
) -> UploadResponse:
    settings = get_settings()
    if not (file.filename or "").lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Seuls les PDF sont acceptés.")
    token, path, size_bytes = save_upload(file)
    max_bytes = settings.max_upload_mb * 1024 * 1024
    if size_bytes > max_bytes:
        path.unlink(missing_ok=True)
        raise HTTPException(status_code=413, detail="Fichier trop volumineux.")
    return UploadResponse(file_token=token, filename=file.filename or "document.pdf", size_bytes=size_bytes)


@router.post("/jobs", response_model=JobCreateResponse, status_code=status.HTTP_202_ACCEPTED)
def create_analysis_job(
    payload: JobCreateRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> JobCreateResponse:
    try:
        ensure_format_allowed(user, payload.format)
        ensure_daily_quota(db, user)
    except ValueError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc

    job = create_job(
        db,
        user=user,
        format_name=payload.format,
        scope=payload.scope,
        source_type=payload.source_type,
        title=payload.title,
        source_url=payload.source_url or "",
        text_content=payload.text_content,
        file_token=payload.file_token,
    )
    db.commit()
    return JobCreateResponse(
        job_id=job.id,
        status=job.status,
        progress=job.progress,
        progress_label=job.progress_label,
    )


@router.get("/jobs/{job_id}", response_model=JobStatusResponse)
def get_analysis_job(
    job_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> JobStatusResponse:
    job = db.get(AnalysisJob, job_id)
    if not job or job.user_id != user.id:
        raise HTTPException(status_code=404, detail="Job introuvable.")
    return JobStatusResponse(**serialize_job(job))


@router.get("/jobs/{job_id}/events")
async def stream_analysis_job(
    job_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> StreamingResponse:
    job = db.get(AnalysisJob, job_id)
    if not job or job.user_id != user.id:
        raise HTTPException(status_code=404, detail="Job introuvable.")

    async def event_stream() -> AsyncGenerator[str, None]:
        last_state = None
        idle_loops = 0
        while True:
            local_job = db.get(AnalysisJob, job_id)
            if not local_job or local_job.user_id != user.id:
                break
            payload = serialize_job(local_job)
            state = json.dumps(payload, default=str, ensure_ascii=False)
            if state != last_state:
                yield f"data: {state}\n\n"
                last_state = state
            if local_job.status in {"done", "failed"}:
                break
            idle_loops += 1
            if idle_loops > 600:
                break
            await asyncio.sleep(1)

    return StreamingResponse(event_stream(), media_type="text/event-stream")
