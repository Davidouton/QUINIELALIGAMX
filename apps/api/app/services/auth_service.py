from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.security import create_access_token, verify_password
from app.models.user import User
from app.schemas.auth import LoginResponse, TokenData


class InvalidCredentialsError(ValueError):
    pass


def login_user(db: Session, email: str, password: str) -> LoginResponse:
    user = db.scalar(select(User).where(User.email == email))
    if not user or not verify_password(password, user.password_hash):
        raise InvalidCredentialsError("Invalid email or password")

    token = create_access_token(str(user.id))
    return LoginResponse(user_id=user.id, email=user.email, token=TokenData(access_token=token))
