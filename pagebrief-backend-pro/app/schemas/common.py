from __future__ import annotations

from pydantic import BaseModel, ConfigDict


class MessageResponse(BaseModel):
    message: str


class HealthResponse(BaseModel):
    status: str = "ok"


class ORMModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)
