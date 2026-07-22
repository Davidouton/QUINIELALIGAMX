from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.username import unique_username, validate_username
from app.models.entities import Profile


def assign_profile_username(db: Session, profile: Profile, requested: str | None = None) -> str:
    if requested and requested.strip():
        normalized = validate_username(requested)
        owner_id = db.scalar(select(Profile.id).where(Profile.username_normalized == normalized))
        if owner_id is not None and owner_id != profile.id:
            raise ValueError("Ese usuario ya está ocupado.")
        if profile.username_normalized != normalized:
            profile.username_changed_at = datetime.now(UTC)
    elif profile.username_normalized:
        return profile.username_normalized
    else:
        used = set(db.scalars(select(Profile.username_normalized).where(Profile.username_normalized.is_not(None))))
        normalized = unique_username(profile.display_name, used)

    profile.username = normalized
    profile.username_normalized = normalized
    db.add(profile)
    return normalized
