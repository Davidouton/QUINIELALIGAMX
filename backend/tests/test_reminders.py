from datetime import UTC, datetime, timedelta

from sqlalchemy import select

from conftest import MATCHDAY_ID, MATCH_ONE_ID, PROFILE_USER_ID, SEASON_ID, SessionLocal
from app.models.entities import Match, MatchResult, Matchday, MatchdayStatus, PickPoint, PickReminderEmailEvent, PickReminderKind, PickSelection, Profile, PushNotificationEvent, Season, SeasonVisibilityStatus, StandingsMatchday, UserPick
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
            "pick_reminder_opening_enabled": False,
            "pick_reminder_hours_before": 1,
            "matchday_start_notification_enabled": True,
            "match_result_notification_enabled": True,
            "matchday_summary_notification_enabled": True,
        },
        headers={"Authorization": "Bearer test-token"},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["pick_reminder_email_enabled"] is True
    assert payload["pick_reminder_hours_before"] == 1
    assert payload["matchday_start_notification_enabled"] is True
    assert payload["match_result_notification_enabled"] is True
    assert payload["matchday_summary_notification_enabled"] is True


def test_collect_due_push_reminders_includes_pre_game():
    service = ReminderService()
    db = SessionLocal()
    try:
        profile = db.get(Profile, PROFILE_USER_ID)
        assert profile is not None
        profile.pick_reminder_email_enabled = True
        profile.pick_reminder_hours_before = 3
        db.add(profile)
        db.commit()

        first_match = db.scalar(
            select(Match).where(Match.matchday_id == MATCHDAY_ID).order_by(Match.picks_lock_at.asc())
        )
        assert first_match is not None
        now_utc = first_match.picks_lock_at - timedelta(hours=3) + timedelta(minutes=5)
        reminders = service.collect_due_push_reminders(db, now_utc=now_utc, window_minutes=70)
        reminder_kinds = {reminder.reminder_kind for reminder in reminders}

        assert reminder_kinds == {PickReminderKind.PRE_GAME}
        assert all(reminder.profile_id == PROFILE_USER_ID for reminder in reminders)
        assert reminders[0].title == "Tu pick está próximo a cerrar"
        assert "AME vs CHI" in reminders[0].body
        assert "TIG vs MTY" not in reminders[0].body
        assert "1 hora" not in reminders[0].body
        assert "3 horas" not in reminders[0].body

        second_match = db.scalar(
            select(Match).where(Match.matchday_id == MATCHDAY_ID).order_by(Match.picks_lock_at.desc())
        )
        assert second_match is not None
        later_reminders = service.collect_due_push_reminders(
            db,
            now_utc=second_match.picks_lock_at - timedelta(hours=3) + timedelta(minutes=5),
            window_minutes=70,
        )
        assert len(later_reminders) == 1
        assert "TIG vs MTY" in later_reminders[0].body
        assert "AME vs CHI" not in later_reminders[0].body
        assert later_reminders[0].dedupe_key != reminders[0].dedupe_key
    finally:
        db.close()


def test_collect_due_push_reminders_includes_matchday_start():
    service = ReminderService()
    db = SessionLocal()
    try:
        profile = db.get(Profile, PROFILE_USER_ID)
        assert profile is not None
        profile.pick_reminder_email_enabled = True
        profile.matchday_start_notification_enabled = True
        db.add(profile)
        db.commit()

        first_match = db.scalar(
            select(Match).where(Match.matchday_id == MATCHDAY_ID).order_by(Match.kickoff_at.asc())
        )
        assert first_match is not None
        now_utc = first_match.kickoff_at - timedelta(hours=1) + timedelta(minutes=5)
        reminders = service.collect_due_push_reminders(db, now_utc=now_utc, window_minutes=70)

        assert {reminder.reminder_kind for reminder in reminders} == {PickReminderKind.MATCHDAY_START}
    finally:
        db.close()


def test_archived_season_does_not_generate_due_reminders():
    service = ReminderService()
    db = SessionLocal()
    try:
        season = db.get(Season, SEASON_ID)
        profile = db.get(Profile, PROFILE_USER_ID)
        first_match = db.scalar(
            select(Match).where(Match.matchday_id == MATCHDAY_ID).order_by(Match.kickoff_at.asc())
        )
        assert season is not None
        assert profile is not None
        assert first_match is not None
        season.visibility_status = SeasonVisibilityStatus.ARCHIVED
        profile.pick_reminder_email_enabled = True
        profile.matchday_start_notification_enabled = True
        db.commit()

        reminders = service.collect_due_push_reminders(
            db,
            now_utc=first_match.kickoff_at - timedelta(hours=1) + timedelta(minutes=5),
            window_minutes=70,
        )

        assert reminders == []
    finally:
        db.close()


def test_collect_due_push_reminders_skips_already_sent_matchday_start():
    service = ReminderService()
    db = SessionLocal()
    try:
        profile = db.get(Profile, PROFILE_USER_ID)
        assert profile is not None
        profile.pick_reminder_email_enabled = True
        profile.matchday_start_notification_enabled = True
        db.add(profile)
        db.commit()

        db.add(
            PickReminderEmailEvent(
                dedupe_key=f"matchday-start:{MATCHDAY_ID}:{PROFILE_USER_ID}",
                profile_id=PROFILE_USER_ID,
                matchday_id=MATCHDAY_ID,
                reminder_kind=PickReminderKind.MATCHDAY_START,
                recipient_email=profile.email or "user@example.com",
            )
        )
        db.commit()

        first_match = db.scalar(
            select(Match).where(Match.matchday_id == MATCHDAY_ID).order_by(Match.kickoff_at.asc())
        )
        assert first_match is not None
        now_utc = first_match.kickoff_at - timedelta(hours=1) + timedelta(minutes=5)
        reminders = service.collect_due_push_reminders(db, now_utc=now_utc, window_minutes=70)
        assert all(reminder.reminder_kind != PickReminderKind.MATCHDAY_START for reminder in reminders)
    finally:
        db.close()


def test_send_matchday_summary_notifications_records_event(monkeypatch):
    service = ReminderService()
    db = SessionLocal()
    try:
        profile = db.get(Profile, PROFILE_USER_ID)
        matchday = db.get(Matchday, MATCHDAY_ID)
        assert profile is not None
        assert matchday is not None
        profile.pick_reminder_email_enabled = True
        profile.matchday_summary_notification_enabled = True
        matchday.status = MatchdayStatus.PUBLISHED
        db.add(profile)
        db.add(matchday)
        db.add(
            StandingsMatchday(
                matchday_id=MATCHDAY_ID,
                profile_id=PROFILE_USER_ID,
                total_points=14,
                correct_results=4,
                exact_scores=1,
                rank_position=1,
            )
        )
        db.commit()

        monkeypatch.setattr(service.push_service, "send_to_external_id", lambda **_: "msg_123")
        results = service.send_matchday_summary_notifications(db, matchday_id=MATCHDAY_ID)

        assert len(results) == 1
        assert results[0].status == "sent"
        saved = db.scalars(
            select(PickReminderEmailEvent).where(PickReminderEmailEvent.matchday_id == MATCHDAY_ID)
        ).all()
        assert len(saved) == 1
        assert saved[0].reminder_kind == PickReminderKind.MATCHDAY_SUMMARY
    finally:
        db.close()


def test_archived_season_does_not_generate_matchday_summary():
    service = ReminderService()
    db = SessionLocal()
    try:
        season = db.get(Season, SEASON_ID)
        matchday = db.get(Matchday, MATCHDAY_ID)
        assert season is not None
        assert matchday is not None
        season.visibility_status = SeasonVisibilityStatus.ARCHIVED
        matchday.status = MatchdayStatus.PUBLISHED
        db.commit()

        assert service.collect_matchday_summary_reminders(db, matchday_id=MATCHDAY_ID) == []
    finally:
        db.close()


def _prepare_match_result_notification(db):
    profile = db.get(Profile, PROFILE_USER_ID)
    match = db.get(Match, MATCH_ONE_ID)
    assert profile is not None
    assert match is not None
    profile.pick_reminder_email_enabled = True
    profile.match_result_notification_enabled = True
    pick = UserPick(
        profile_id=profile.id,
        match_id=match.id,
        selection=PickSelection.HOME,
        predicted_home_score=2,
        predicted_away_score=1,
    )
    db.add_all(
        [
            profile,
            pick,
            MatchResult(
                match_id=match.id,
                home_score=2,
                away_score=1,
                is_official=True,
                last_synced_at=datetime.now(UTC),
            ),
        ]
    )
    db.flush()
    db.add(
        PickPoint(
            pick_id=pick.id,
            profile_id=profile.id,
            match_id=match.id,
            matchday_id=MATCHDAY_ID,
            result_points=3,
            exact_score_points=2,
            total_points=5,
        )
    )
    db.commit()


def test_match_result_notification_is_audited_and_deduplicated(monkeypatch):
    service = ReminderService()
    db = SessionLocal()
    try:
        _prepare_match_result_notification(db)
        monkeypatch.setattr(service.push_service, "is_configured", lambda: True)
        sent_calls = []

        def fake_send(**kwargs):
            sent_calls.append(kwargs)
            return "result_msg_123"

        monkeypatch.setattr(service.push_service, "send_to_external_id", fake_send)
        first_results = service.send_match_scoring_notifications(db, matchday_id=MATCHDAY_ID, match_id=MATCH_ONE_ID)
        second_results = service.send_match_scoring_notifications(db, matchday_id=MATCHDAY_ID, match_id=MATCH_ONE_ID)

        assert len(first_results) == 1
        assert first_results[0].status == "sent"
        assert second_results == []
        assert len(sent_calls) == 1
        event = db.scalar(select(PushNotificationEvent))
        assert event is not None
        assert event.delivery_status == "sent"
        assert event.attempt_count == 1
        assert event.provider_message_id == "result_msg_123"
        assert event.match_id == MATCH_ONE_ID
    finally:
        db.close()


def test_archived_season_does_not_send_match_result_notification(monkeypatch):
    service = ReminderService()
    db = SessionLocal()
    try:
        _prepare_match_result_notification(db)
        season = db.get(Season, SEASON_ID)
        assert season is not None
        season.visibility_status = SeasonVisibilityStatus.ARCHIVED
        db.commit()
        monkeypatch.setattr(service.push_service, "is_configured", lambda: True)

        assert service.send_match_scoring_notifications(
            db,
            matchday_id=MATCHDAY_ID,
            match_id=MATCH_ONE_ID,
        ) == []
        assert db.scalar(select(PushNotificationEvent)) is None
    finally:
        db.close()


def test_failed_match_result_notification_can_retry(monkeypatch):
    service = ReminderService()
    db = SessionLocal()
    try:
        _prepare_match_result_notification(db)
        monkeypatch.setattr(service.push_service, "is_configured", lambda: True)

        def fail_send(**_kwargs):
            raise RuntimeError("OneSignal temporal")

        monkeypatch.setattr(service.push_service, "send_to_external_id", fail_send)
        failed_results = service.send_match_scoring_notifications(db, matchday_id=MATCHDAY_ID, match_id=MATCH_ONE_ID)
        assert failed_results[0].status == "failed"
        db.expire_all()
        failed_event = db.scalar(select(PushNotificationEvent))
        assert failed_event is not None
        assert failed_event.delivery_status == "failed"
        assert failed_event.attempt_count == 1
        assert failed_event.last_error == "OneSignal temporal"

        monkeypatch.setattr(service.push_service, "send_to_external_id", lambda **_: "retry_msg_456")
        retry_results = service.send_match_scoring_notifications(
            db,
            lookback_minutes=24 * 60,
            max_attempts=3,
            failed_only=True,
        )
        assert retry_results[0].status == "sent"
        db.expire_all()
        retried_event = db.scalar(select(PushNotificationEvent))
        assert retried_event is not None
        assert retried_event.delivery_status == "sent"
        assert retried_event.attempt_count == 2
        assert retried_event.last_error is None
        assert retried_event.provider_message_id == "retry_msg_456"
    finally:
        db.close()
