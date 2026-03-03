from fastapi import APIRouter, Depends

from app.api.deps import get_current_user
from app.db.models import User
from app.schemas.auth import UserResponse


router = APIRouter(prefix="/v1/me", tags=["me"])


@router.get("", response_model=UserResponse)
def me(user: User = Depends(get_current_user)) -> UserResponse:
    return UserResponse(id=user.id, email=user.email, plan=user.plan)
