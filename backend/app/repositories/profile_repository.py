from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.security import AuthUser
from app.models.entities import Profile, RoleCode


class ProfileRepository:
    def get_by_auth_user_id(self, db: Session, auth_user_id: str) -> Profile | None:
        return db.scalar(select(Profile).where(Profile.auth_user_id == auth_user_id))

    def get_by_id(self, db: Session, profile_id: str) -> Profile | None:
        return db.scalar(select(Profile).where(Profile.id == profile_id))

    def list_all(self, db: Session) -> list[Profile]:
        return list(db.scalars(select(Profile).order_by(Profile.created_at.desc())))

    def list_registered_options(self, db: Session, exclude_profile_id: str | None = None) -> list[Profile]:
        stmt = select(Profile).order_by(Profile.display_name.asc())
        if exclude_profile_id:
            stmt = stmt.where(Profile.id != exclude_profile_id)
        return list(db.scalars(stmt))

    def has_admin_account(self, db: Session) -> bool:
        total = db.scalar(
            select(func.count())
            .select_from(Profile)
            .where(Profile.role_code.in_([RoleCode.ADMIN, RoleCode.MASTER_ADMIN]))
        )
        return bool(total)

    def create_from_auth_user(self, db: Session, auth_user: AuthUser, role_code: RoleCode = RoleCode.USER) -> Profile:
        profile = Profile(
            auth_user_id=auth_user.auth_user_id,
            email=auth_user.email,
            display_name=(auth_user.raw_claims.get("user_metadata") or {}).get("display_name")
            or auth_user.email
            or "Usuario",
            role_code=role_code,
            is_active=True,
        )
        db.add(profile)
        db.flush()
        return profile

    def update_role(self, db: Session, profile: Profile, role_code: RoleCode) -> Profile:
        profile.role_code = role_code
        db.add(profile)
        db.flush()
        return profile

    def update_settings(
        self,
        db: Session,
        profile: Profile,
        *,
        display_name: str,
        email: str | None,
        favorite_team_id: str | None,
        contact_phone: str | None,
        bank_name: str | None,
        deposit_account: str | None,
        modality: str,
        aval_profile_id: str | None,
        theme_preference: str,
        pick_reminder_email_enabled: bool,
        pick_reminder_opening_enabled: bool,
        pick_reminder_hours_before: int | None,
    ) -> Profile:
        profile.display_name = display_name
        profile.email = email
        profile.favorite_team_id = favorite_team_id
        profile.contact_phone = contact_phone
        profile.bank_name = bank_name
        profile.deposit_account = deposit_account
        profile.modality = modality
        profile.aval_profile_id = aval_profile_id
        profile.theme_preference = theme_preference
        profile.pick_reminder_email_enabled = pick_reminder_email_enabled
        profile.pick_reminder_opening_enabled = pick_reminder_opening_enabled
        profile.pick_reminder_hours_before = pick_reminder_hours_before
        db.add(profile)
        db.flush()
        return profile
