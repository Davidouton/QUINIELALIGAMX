from collections.abc import Callable

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import AuthUser, decode_supabase_token
from app.models.entities import Profile, RoleCode
from app.services.profile_service import ProfileService

bearer_scheme = HTTPBearer(auto_error=True)
profile_service = ProfileService()


def get_current_auth_user(
    credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme),
) -> AuthUser:
    return decode_supabase_token(credentials.credentials)


def get_current_profile(
    db: Session = Depends(get_db),
    auth_user: AuthUser = Depends(get_current_auth_user),
) -> Profile:
    return profile_service.ensure_profile(db, auth_user)


def require_roles(*allowed_roles: RoleCode) -> Callable[[Profile], Profile]:
    def dependency(current_profile: Profile = Depends(get_current_profile)) -> Profile:
        if current_profile.role_code not in allowed_roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Insufficient permissions",
            )
        return current_profile

    return dependency

