from __future__ import annotations

import json
import logging
from pathlib import Path

from sqlalchemy.orm import Session

from app.db.models import AnalysisJob, HistoryItem, User
from app.services.fetcher import extract_pdf_text_from_path, fetch_pdf_text_from_url
from app.services.storage import resolve_upload_token
from app.services.summarizer import summarize_document


logger = logging.getLogger("app.jobs")
USER_AGENT = "PageBrief/2.0"


def create_job(
    db: Session,
    *,
    user: User,
    format_name: str,
    scope: str,
    source_type: str,
    title: str,
    source_url: str,
    text_content: str,
    file_token: str | None,
) -> AnalysisJob:
    upload_path = None
    if file_token:
        upload_path = str(resolve_upload_token(file_token))

    job = AnalysisJob(
        user_id=user.id,
        format=format_name,
        scope=scope,
        source_type=source_type,
        title=title,
        source_url=source_url,
        text_content=text_content,
        upload_path=upload_path,
        progress=0,
        progress_label="En file d'attente",
        status="queued",
    )

    db.add(job)
    db.commit()
    db.refresh(job)

    from app.workers.tasks import process_job_task
    process_job_task.delay(str(job.id))

    return job


def process_job(db: Session, job_id: str) -> None:
    job = db.get(AnalysisJob, job_id)
    if not job:
        logger.warning("Job %s introuvable.", job_id)
        return

    try:
        _update_progress(db, job, 5, "Validation de la demande", "running")

        source_text = job.text_content or ""
        source_url = (job.source_url or "").strip()
        source_type = (job.source_type or "html").lower()

        # 1) Cas recommandé : PDF déjà uploadé côté backend
        if job.upload_path:
            _update_progress(db, job, 20, "Lecture du PDF uploadé")
            source_text = extract_pdf_text_from_path(Path(job.upload_path))
            source_type = "pdf"

        # 2) Si pas de texte fourni et qu'on a une URL
        elif not source_text and source_url:
            is_local_file = source_url.lower().startswith("file:")
            is_remote_pdf = (
                source_type == "pdf"
                or source_url.lower().endswith(".pdf")
            )

            # IMPORTANT :
            # un file:// pointe vers le PC de l'utilisateur, pas vers le conteneur Docker
            if is_local_file:
                _update_progress(db, job, 20, "PDF local non transféré")
                raise ValueError(
                    "Ce PDF est local à votre ordinateur (file://) et n'est pas accessible depuis le worker Docker. "
                    "Il faut d'abord envoyer le fichier au backend (file_token) avant l'analyse."
                )

            if is_remote_pdf:
                _update_progress(db, job, 20, "Récupération du PDF")
                source_text = fetch_pdf_text_from_url(
                    source_url,
                    timeout_s=30,
                    user_agent=USER_AGENT,
                )
                source_type = "pdf"
            else:
                _update_progress(db, job, 20, "Le frontend doit fournir le texte HTML.")
                raise ValueError(
                    "Le texte HTML doit être fourni par l'extension pour les pages web."
                )

        if not source_text.strip():
            raise ValueError("Aucun contenu exploitable à analyser.")

        _update_progress(db, job, 45, "Préparation de l'analyse")
        result, reading_time = summarize_document(job.format, source_text, job.title, source_type)

        _update_progress(db, job, 90, "Finalisation du rendu")

        job.result_payload = json.dumps(result, ensure_ascii=False)
        job.reading_time_min = reading_time
        job.confidence = result.get("confidence", "moyenne")
        job.status = "done"
        job.progress = 100
        job.progress_label = "Analyse terminée"
        job.error_message = None

        excerpt = " ".join((result.get("intro_lines") or [])[:2])[:240]
        history = HistoryItem(
            user_id=job.user_id,
            job_id=job.id,
            title=job.title or "Document analysé",
            source_url=job.source_url or "",
            summary_excerpt=excerpt,
            format=job.format,
            source_type=source_type,
        )

        db.add(job)
        db.add(history)
        db.commit()
        db.refresh(job)

        logger.info("Job %s terminé.", job.id)

    except Exception as exc:
        logger.exception("Job %s en erreur.", job.id)

        job.status = "failed"
        job.error_message = str(exc)
        job.progress = min(max(job.progress or 0, 0), 99)
        job.progress_label = "Analyse échouée"

        db.add(job)
        db.commit()


def _update_progress(
    db: Session,
    job: AnalysisJob,
    progress: int,
    label: str,
    status: str | None = None,
) -> None:
    job.progress = progress
    job.progress_label = label
    if status:
        job.status = status

    db.add(job)
    db.commit()
    db.refresh(job)


def serialize_job(job: AnalysisJob) -> dict:
    payload = None
    if job.result_payload:
        try:
            payload = json.loads(job.result_payload)
        except json.JSONDecodeError:
            payload = None

    return {
        "id": job.id,
        "status": job.status,
        "format": job.format,
        "scope": job.scope,
        "source_type": job.source_type,
        "title": job.title,
        "source_url": job.source_url,
        "progress": job.progress,
        "progress_label": job.progress_label,
        "error_message": job.error_message,
        "reading_time_min": job.reading_time_min,
        "confidence": job.confidence,
        "result": payload,
        "created_at": job.created_at,
        "updated_at": job.updated_at,
    }