from datetime import timedelta

from sqlalchemy import select

from conftest import MATCHDAY_ID, PROFILE_USER_ID, SessionLocal
from app.models.entities import Match, PickReminderEmailEvent, PickReminderKind, Profile
from app.services.reminder_service import ReminderService


def test_update_me_supports_pick_reminder_preferences(client):
    response = client.put(
        "/api/v1/me",
        json={
            "display_name": "Usuario Demo",
            "email": "user@example.com",
            "favorite_team_id": None,
            "contact_phone": "5555555555",
            "bank_name": "BBVA",
            "deposit_account": "Cuenta demo",
            "modality": "pre_pago",
            "aval_profile_id": None,
            "theme_preference": "standard",
            "pick_reminder_email_enabled": True,
            "pick_reminder_opening_enabled": True,
            "pick_reminder_hours_before": 3,
        },
        headers={"Authorization": "Bearer test-token"},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["pick_reminder_email_enabled"] is True
    assert payload["pick_reminder_opening_enabled"] is True
    assert payload["pick_reminder_hours_before"] == 3


def test_collect_due_email_reminders_includes_opening_and_pre_game():
    service = ReminderService()
    db = SessionLocal()
    try:
        profile = db.get(Profile, PROFILE_USER_ID)
        assert profile is not None
        profile.pick_reminder_email_enabled = True
        profile.pick_reminder_opening_enabled = True
        profile.pick_reminder_hours_before = 3
        db.add(profile)
        db.commit()

        first_match = db.scalar(
            select(Match).where(Match.matchday_id == MATCHDAY_ID).order_by(Match.picks_lock_at.asc())
        )
        assert first_match is not None
        now_utc = first_match.picks_lock_at - timedelta(hours=3) + timedelta(minutes=5)
        reminders = service.collect_due_email_reminders(db, now_utc=now_utc, window_minutes=70)
        reminder_kinds = {reminder.reminder_kind for reminder in reminders}

        assert reminder_kinds == {PickReminderKind.OPENING, PickReminderKind.PRE_GAME}
        assert all(reminder.profile_id == PROFILE_USER_ID for reminder in reminders)
    finally:
        db.close()


def test_collect_due_email_reminders_skips_already_sent_opening():
    service = ReminderService()
    db = SessionLocal()
    try:
        profile = db.get(Profile, PROFILE_USER_ID)
        assert profile is not None
        profile.pick_reminder_email_enabled = True
        profile.pick_reminder_opening_enabled = True
        db.add(profile)
        db.commit()

        db.add(
            PickReminderEmailEvent(
                dedupe_key=f"opening:{MATCHDAY_ID}:{PROFILE_USER_ID}",
                profile_id=PROFILE_USER_ID,
                matchday_id=MATCHDAY_ID,
                reminder_kind=PickReminderKind.OPENING,
                recipient_email=profile.email or "user@example.com",
            )
        )
        db.commit()

        reminders = service.collect_due_email_reminders(db)
        assert all(reminder.reminder_kind != PickReminderKind.OPENING for reminder in reminders)
    finally:
        db.close()
