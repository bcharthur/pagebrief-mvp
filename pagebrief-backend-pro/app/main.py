from __future__ import annotations

import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routers import auth, health, history, jobs, me
from app.core.config import get_settings
from app.core.logging import setup_logging
from app.db.base import Base
from app.db.session import engine


settings = get_settings()
setup_logging(settings.log_level)
logger = logging.getLogger("app")

app = FastAPI(
    title="PageBrief Backend Pro",
    version="2.0.0",
    docs_url="/docs",
    redoc_url="/redoc",
)

_origin_regex = ".*" if any("*" in origin for origin in settings.cors_allowed_origins) else None
_allow_origins = [origin for origin in settings.cors_allowed_origins if "*" not in origin] or (["*"] if _origin_regex == ".*" else [])

app.add_middleware(
    CORSMiddleware,
    allow_origins=_allow_origins,
    allow_origin_regex=_origin_regex,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router)
app.include_router(auth.router)
app.include_router(me.router)
app.include_router(jobs.router)
app.include_router(history.router)


@app.on_event("startup")
def startup() -> None:
    Base.metadata.create_all(bind=engine)
    logger.info(
        "PageBrief backend pro initialisé | env=%s host=%s port=%s db=%s redis=%s model=%s",
        settings.app_env,
        settings.app_host,
        settings.app_port,
        settings.database_url,
        settings.redis_url,
        settings.ollama_model,
    )
