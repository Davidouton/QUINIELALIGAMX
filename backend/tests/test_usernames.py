import pytest

from app.core.database import SessionLocal
from app.core.username import normalize_username, unique_username, validate_username
from app.models.entities import Profile, RoleCode
from app.services.username_service import assign_profile_username


def test_username_normalization_ignores_accents_case_and_spaces() -> None:
    assert normalize_username(" José Pérez ") == "joseperez"
    assert normalize_username("DAVID..OUTON") == "david.outon"


def test_generated_usernames_are_deterministic_and_unique() -> None:
    used: set[str] = set()
    assert unique_username("José Pérez", used) == "joseperez"
    assert unique_username("Jose Perez", used) == "joseperez2"


def test_duplicate_normalized_username_is_rejected() -> None:
    db = SessionLocal()
    try:
        first = db.query(Profile).first()
        assert first is not None
        assign_profile_username(db, first, "José.Pérez")
        second = Profile(
            auth_user_id="33333333-3333-3333-3333-333333333333",
            email="second@example.com",
            display_name="Otro Nombre",
            role_code=RoleCode.USER,
            is_active=True,
        )
        db.add(second)
        db.flush()
        with pytest.raises(ValueError, match="ocupado"):
            assign_profile_username(db, second, "jose.perez")
    finally:
        db.rollback()
        db.close()


def test_reserved_username_is_rejected() -> None:
    with pytest.raises(ValueError, match="reservado"):
        validate_username("Admin")
