from __future__ import annotations

import json
import logging
from pathlib import Path

from sqlalchemy.orm import Session

from app.db.models import AnalysisJob, HistoryItem, User
from app.services.fetcher import (
    extract_pdf_document_from_path,
    fetch_pdf_document_from_url,
)
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
    selected_text: str | None = None,
    page_number: int | None = None,
    page_from: int | None = None,
    page_to: int | None = None,
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
        selected_text=selected_text,
        page_number=page_number,
        page_from=page_from,
        page_to=page_to,
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
        extracted_document = None

        if job.upload_path:
            _update_progress(db, job, 20, "Lecture du PDF uploadé")
            extracted_document = extract_pdf_document_from_path(Path(job.upload_path))
            source_text = extracted_document.merged_text
            source_type = "pdf"
            if not job.title:
                job.title = extracted_document.title

        elif not source_text and source_url:
            is_local_file = source_url.lower().startswith("file:")
            is_remote_pdf = source_type == "pdf" or source_url.lower().endswith(".pdf")

            if is_local_file:
                _update_progress(db, job, 20, "PDF local non transféré")
                raise ValueError(
                    "Ce PDF est local à votre ordinateur (file://) et n'est pas accessible depuis le worker Docker. "
                    "Il faut d'abord envoyer le fichier au backend (file_token) avant l'analyse."
                )

            if is_remote_pdf:
                _update_progress(db, job, 20, "Récupération du PDF")
                extracted_document = fetch_pdf_document_from_url(
                    source_url,
                    timeout_s=30,
                    user_agent=USER_AGENT,
                )
                source_text = extracted_document.merged_text
                source_type = "pdf"
                if not job.title:
                    job.title = extracted_document.title
            else:
                _update_progress(db, job, 20, "Le frontend doit fournir le texte HTML")
                raise ValueError("Le texte HTML doit être fourni par l'extension pour les pages web.")

        if not source_text.strip() and not (job.selected_text or "").strip():
            raise ValueError("Aucun contenu exploitable à analyser.")

        _update_progress(db, job, 45, "Préparation de l'analyse")
        result, reading_time = summarize_document(
            format_name=job.format,
            raw_text=source_text,
            title=job.title,
            source_type=source_type,
            scope=job.scope,
            selected_text=job.selected_text,
            page_number=job.page_number,
            page_from=job.page_from,
            page_to=job.page_to,
            extracted_document=extracted_document,
        )

        _validate_summary_result(result)
        _update_progress(db, job, 90, "Finalisation du rendu")

        job.source_type = source_type
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


def _validate_summary_result(result: dict) -> None:
    intro = [item for item in (result.get("intro_lines") or []) if str(item).strip()]
    key_points = [item for item in (result.get("key_points") or []) if str(item).strip()]
    if not intro:
        raise ValueError("Résumé invalide : introduction vide.")
    if not key_points:
        raise ValueError("Résumé invalide : points clés vides.")
    if len(" ".join(key_points)) < 60:
        raise ValueError("Résumé invalide : points clés trop pauvres.")


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
