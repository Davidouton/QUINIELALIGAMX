from dataclasses import dataclass
from functools import lru_cache

import httpx
from fastapi import HTTPException, status
from jose import JWTError, jwt

from app.core.config import get_settings

settings = get_settings()


@dataclass(frozen=True)
class AuthUser:
    auth_user_id: str
    email: str | None
    raw_claims: dict


@lru_cache
def get_supabase_jwks() -> dict:
    response = httpx.get(settings.supabase_jwks_url, timeout=5.0)
    response.raise_for_status()
    return response.json()


def decode_with_secret(token: str) -> dict:
    if not settings.supabase_jwt_secret:
        raise JWTError("SUPABASE_JWT_SECRET is not configured")
    return jwt.decode(
        token,
        settings.supabase_jwt_secret,
        algorithms=["HS256"],
        options={"verify_aud": False},
    )


def decode_with_jwks(token: str, algorithm: str) -> dict:
    jwks = get_supabase_jwks()
    return jwt.decode(
        token,
        jwks,
        algorithms=[algorithm],
        options={"verify_aud": False},
    )


def decode_supabase_token(token: str) -> AuthUser:
    try:
        header = jwt.get_unverified_header(token)
        algorithm = header.get("alg", "HS256")

        if algorithm == "HS256":
            payload = decode_with_secret(token)
        else:
            try:
                payload = decode_with_jwks(token, algorithm)
            except Exception:
                payload = decode_with_secret(token)
    except JWTError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
        ) from exc
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Could not verify Supabase token",
        ) from exc

    auth_user_id = payload.get("sub")
    if not auth_user_id:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token subject missing")

    return AuthUser(
        auth_user_id=auth_user_id,
        email=payload.get("email"),
        raw_claims=payload,
    )
