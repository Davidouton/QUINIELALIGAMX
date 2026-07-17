from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.orm import Session, aliased

from app.core.config import get_settings
from app.core.datetime import MEXICO_CITY_TZ, ensure_utc
from app.models.entities import (
    Match,
    MatchResult,
    MatchStatus,
    Matchday,
    MatchdayStatus,
    PickReminderEmailEvent,
    PickReminderKind,
    Profile,
    Season,
    SeasonMembership,
    UserPick,
    PickPoint,
    StandingsOverall,
    Team,
)
from app.services.email_service import ResendEmailService
from app.services.onesignal_service import OneSignalPushService

settings = get_settings()


@dataclass
class DueReminder:
    dedupe_key: str
    profile_id: str
    recipient_email: str
    matchday_id: str
    matchday_name: str
    season_name: str
    reminder_kind: PickReminderKind
    subject: str
    html: str
    target_match_date: date | None = None
    hours_before: int | None = None


@dataclass
class ReminderDispatchResult:
    dedupe_key: str
    profile_id: str
    recipient_email: str
    subject: str
    status: str
    provider_message_id: str | None = None


class ReminderService:
    def __init__(self) -> None:
        self.email_service = ResendEmailService()
        self.push_service = OneSignalPushService()

    def collect_due_email_reminders(
        self,
        db: Session,
        *,
        now_utc: datetime | None = None,
        window_minutes: int = 70,
    ) -> list[DueReminder]:
        return self._collect_due_reminders(db, now_utc=now_utc, window_minutes=window_minutes, channel="email")

    def collect_due_push_reminders(
        self,
        db: Session,
        *,
        now_utc: datetime | None = None,
        window_minutes: int = 70,
    ) -> list[DueReminder]:
        return self._collect_due_reminders(db, now_utc=now_utc, window_minutes=window_minutes, channel="push")

    def _collect_due_reminders(
        self,
        db: Session,
        *,
        now_utc: datetime | None,
        window_minutes: int,
        channel: str,
    ) -> list[DueReminder]:
        now = ensure_utc(now_utc or datetime.now(UTC))
        window = max(window_minutes, 1)
        reminders: list[DueReminder] = []

        active_rows = db.execute(
            select(Matchday, Season)
            .join(Season, Season.id == Matchday.season_id)
            .where(Matchday.status == MatchdayStatus.ACTIVE)
            .order_by(Matchday.starts_at.asc())
        ).all()

        for matchday, season in active_rows:
            open_matches = list(
                db.scalars(
                    select(Match)
                    .where(
                        Match.matchday_id == matchday.id,
                        Match.status == MatchStatus.SCHEDULED,
                        Match.picks_lock_at > now,
                    )
                    .order_by(Match.picks_lock_at.asc())
                )
            )
            if not open_matches:
                continue

            participant_query = (
                select(Profile)
                .join(SeasonMembership, SeasonMembership.profile_id == Profile.id)
                .where(SeasonMembership.season_id == season.id, SeasonMembership.is_active.is_(True), Profile.is_active.is_(True))
            )
            if channel == "email":
                participant_query = participant_query.where(
                    Profile.pick_reminder_email_enabled.is_(True), Profile.email.is_not(None)
                )
            participants = list(db.scalars(participant_query.order_by(Profile.display_name.asc())))
            if not participants:
                continue

            reminders.extend(self._collect_opening_reminders(db, participants, matchday, season, open_matches, channel=channel))
            reminders.extend(
                self._collect_pre_game_reminders(
                    db,
                    participants,
                    matchday,
                    season,
                    open_matches,
                    now=now,
                    window_minutes=window,
                    channel=channel,
                )
            )

        return reminders

    def send_due_push_reminders(
        self,
        db: Session,
        *,
        now_utc: datetime | None = None,
        window_minutes: int = 70,
        dry_run: bool = False,
    ) -> list[ReminderDispatchResult]:
        reminders = self.collect_due_push_reminders(db, now_utc=now_utc, window_minutes=window_minutes)
        results: list[ReminderDispatchResult] = []
        for reminder in reminders:
            provider_message_id = None
            dispatch_status = "dry_run"
            if not dry_run:
                profile = db.get(Profile, reminder.profile_id)
                if profile is None:
                    continue
                message = (
                    f"Te faltan picks en {reminder.matchday_name}. Entra antes de que cierre la jornada."
                    if reminder.reminder_kind == PickReminderKind.OPENING
                    else f"Todavía tienes picks pendientes en {reminder.matchday_name}."
                )
                provider_message_id = self.push_service.send_to_external_id(
                    external_id=profile.auth_user_id,
                    title=reminder.subject,
                    message=message,
                    url=self._dashboard_url(),
                    dedupe_key=reminder.dedupe_key,
                )
                dispatch_status = "sent"
            results.append(ReminderDispatchResult(
                dedupe_key=reminder.dedupe_key,
                profile_id=reminder.profile_id,
                recipient_email="",
                subject=reminder.subject,
                status=dispatch_status,
                provider_message_id=provider_message_id,
            ))
        return results

    def send_match_scoring_notifications(self, db: Session, *, matchday_id: str) -> list[ReminderDispatchResult]:
        if not self.push_service.is_configured():
            return []
        dashboard_url = f"{settings.frontend_site_url.rstrip('/')}/dashboard/leaderboard"
        home_team_alias = aliased(Team)
        away_team_alias = aliased(Team)
        match_rows = db.execute(
            select(Match, MatchResult, Matchday, home_team_alias, away_team_alias)
            .join(MatchResult, MatchResult.match_id == Match.id)
            .join(Matchday, Matchday.id == Match.matchday_id)
            .join(home_team_alias, home_team_alias.id == Match.home_team_id)
            .join(away_team_alias, away_team_alias.id == Match.away_team_id)
            .where(Match.matchday_id == matchday_id, MatchResult.is_official.is_(True))
        ).all()
        results: list[ReminderDispatchResult] = []
        for match, match_result, matchday, home_team, away_team in match_rows:
            scoring_rows = db.execute(
                select(PickPoint, Profile, StandingsOverall)
                .join(Profile, Profile.id == PickPoint.profile_id)
                .join(
                    StandingsOverall,
                    (StandingsOverall.profile_id == PickPoint.profile_id)
                    & (StandingsOverall.season_id == matchday.season_id),
                    isouter=True,
                )
                .where(PickPoint.match_id == match.id, Profile.is_active.is_(True))
            ).all()
            title = f"{home_team.short_name} {match_result.home_score}-{match_result.away_score} {away_team.short_name}"
            for point, profile, standing in scoring_rows:
                total_points = standing.total_points if standing is not None else point.total_points
                rank_label = f" y vas #{standing.rank_position}" if standing is not None else ""
                message = f"Sumaste {point.total_points} pts. Llevas {total_points} pts{rank_label} en el ranking."
                dedupe_key = (
                    f"score:{match.id}:{match_result.home_score}:{match_result.away_score}:{profile.id}"
                )
                provider_message_id = self.push_service.send_to_external_id(
                    external_id=profile.auth_user_id,
                    title=title,
                    message=message,
                    url=dashboard_url,
                    dedupe_key=dedupe_key,
                )
                results.append(ReminderDispatchResult(
                    dedupe_key=dedupe_key,
                    profile_id=profile.id,
                    recipient_email="",
                    subject=title,
                    status="sent",
                    provider_message_id=provider_message_id,
                ))
        return results

    def send_due_email_reminders(
        self,
        db: Session,
        *,
        now_utc: datetime | None = None,
        window_minutes: int = 70,
        dry_run: bool = False,
    ) -> list[ReminderDispatchResult]:
        reminders = self.collect_due_email_reminders(db, now_utc=now_utc, window_minutes=window_minutes)
        results: list[ReminderDispatchResult] = []

        for reminder in reminders:
            provider_message_id: str | None = None
            status = "dry_run"

            if not dry_run:
                provider_message_id = self.email_service.send_email(
                    to_email=reminder.recipient_email,
                    subject=reminder.subject,
                    html=reminder.html,
                )
                self._record_email_event(db, reminder, provider_message_id=provider_message_id)
                status = "sent"

            results.append(
                ReminderDispatchResult(
                    dedupe_key=reminder.dedupe_key,
                    profile_id=reminder.profile_id,
                    recipient_email=reminder.recipient_email,
                    subject=reminder.subject,
                    status=status,
                    provider_message_id=provider_message_id,
                )
            )

        if not dry_run and reminders:
            db.commit()

        return results

    def _collect_opening_reminders(
        self,
        db: Session,
        participants: list[Profile],
        matchday: Matchday,
        season: Season,
        open_matches: list[Match],
        *,
        channel: str,
    ) -> list[DueReminder]:
        eligible_profiles = [profile for profile in participants if profile.pick_reminder_opening_enabled]
        if not eligible_profiles:
            return []

        match_ids = [match.id for match in open_matches]
        profile_ids = [profile.id for profile in eligible_profiles]
        picks_by_profile = self._count_picks_by_profile(db, profile_ids=profile_ids, match_ids=match_ids)
        total_matches = len(match_ids)

        candidates = [
            self._build_opening_reminder(
                profile=profile,
                matchday=matchday,
                season=season,
                open_matches=open_matches,
                missing_count=total_matches - picks_by_profile.get(profile.id, 0),
            )
            for profile in eligible_profiles
            if total_matches - picks_by_profile.get(profile.id, 0) > 0
        ]
        return self._filter_existing_reminders(db, candidates) if channel == "email" else candidates

    def _collect_pre_game_reminders(
        self,
        db: Session,
        participants: list[Profile],
        matchday: Matchday,
        season: Season,
        open_matches: list[Match],
        *,
        now: datetime,
        window_minutes: int,
        channel: str,
    ) -> list[DueReminder]:
        reminders: list[DueReminder] = []
        matches_by_date: dict[date, list[Match]] = defaultdict(list)
        for match in open_matches:
            local_match_date = ensure_utc(match.picks_lock_at).astimezone(MEXICO_CITY_TZ).date()
            matches_by_date[local_match_date].append(match)

        for local_match_date, date_matches in matches_by_date.items():
            first_lock = min(match.picks_lock_at for match in date_matches)
            for hours_before in (1, 3):
                if not self._is_due_window(
                    now=now,
                    target_at=first_lock - timedelta(hours=hours_before),
                    window_minutes=window_minutes,
                ):
                    continue

                eligible_profiles = [
                    profile for profile in participants if profile.pick_reminder_hours_before == hours_before
                ]
                if not eligible_profiles:
                    continue

                match_ids = [match.id for match in date_matches]
                profile_ids = [profile.id for profile in eligible_profiles]
                picks_by_profile = self._count_picks_by_profile(db, profile_ids=profile_ids, match_ids=match_ids)
                total_matches = len(match_ids)

                candidates = [
                    self._build_pre_game_reminder(
                        profile=profile,
                        matchday=matchday,
                        season=season,
                        date_matches=date_matches,
                        local_match_date=local_match_date,
                        hours_before=hours_before,
                        missing_count=total_matches - picks_by_profile.get(profile.id, 0),
                    )
                    for profile in eligible_profiles
                    if total_matches - picks_by_profile.get(profile.id, 0) > 0
                ]
                reminders.extend(self._filter_existing_reminders(db, candidates) if channel == "email" else candidates)

        return reminders

    def _count_picks_by_profile(
        self,
        db: Session,
        *,
        profile_ids: list[str],
        match_ids: list[str],
    ) -> dict[str, int]:
        if not profile_ids or not match_ids:
            return {}

        rows = db.execute(
            select(UserPick.profile_id, func.count(UserPick.match_id))
            .where(
                UserPick.profile_id.in_(profile_ids),
                UserPick.match_id.in_(match_ids),
            )
            .group_by(UserPick.profile_id)
        ).all()
        return {profile_id: int(total) for profile_id, total in rows}

    def _filter_existing_reminders(
        self,
        db: Session,
        candidates: list[DueReminder],
    ) -> list[DueReminder]:
        if not candidates:
            return []

        keys = [candidate.dedupe_key for candidate in candidates]
        existing_keys = set(
            db.scalars(
                select(PickReminderEmailEvent.dedupe_key).where(PickReminderEmailEvent.dedupe_key.in_(keys))
            )
        )
        return [candidate for candidate in candidates if candidate.dedupe_key not in existing_keys]

    def _record_email_event(
        self,
        db: Session,
        reminder: DueReminder,
        *,
        provider_message_id: str | None,
    ) -> None:
        db.add(
            PickReminderEmailEvent(
                dedupe_key=reminder.dedupe_key,
                profile_id=reminder.profile_id,
                matchday_id=reminder.matchday_id,
                reminder_kind=reminder.reminder_kind,
                target_match_date=reminder.target_match_date,
                hours_before=reminder.hours_before,
                recipient_email=reminder.recipient_email,
                provider_name=self.email_service.provider_name,
                provider_message_id=provider_message_id,
            )
        )

    def _build_opening_reminder(
        self,
        *,
        profile: Profile,
        matchday: Matchday,
        season: Season,
        open_matches: list[Match],
        missing_count: int,
    ) -> DueReminder:
        dashboard_url = self._dashboard_url()
        subject = f"Tienes picks abiertos en {matchday.name}"
        html = (
            f"<p>Hola {profile.display_name},</p>"
            f"<p>{matchday.name} de {season.name} ya esta activa y aun te faltan "
            f"<strong>{missing_count}</strong> picks por capturar.</p>"
            f"<p>Entra aqui para completar tu jornada: "
            f"<a href=\"{dashboard_url}\">{dashboard_url}</a></p>"
            f"<p>Partidos abiertos: {len(open_matches)}.</p>"
        )
        return DueReminder(
            dedupe_key=f"opening:{matchday.id}:{profile.id}",
            profile_id=profile.id,
            recipient_email=profile.email or "",
            matchday_id=matchday.id,
            matchday_name=matchday.name,
            season_name=season.name,
            reminder_kind=PickReminderKind.OPENING,
            subject=subject,
            html=html,
        )

    def _build_pre_game_reminder(
        self,
        *,
        profile: Profile,
        matchday: Matchday,
        season: Season,
        date_matches: list[Match],
        local_match_date: date,
        hours_before: int,
        missing_count: int,
    ) -> DueReminder:
        dashboard_url = self._dashboard_url()
        formatted_date = local_match_date.strftime("%d/%m/%Y")
        subject = f"Hoy tienes picks abiertos en {matchday.name}"
        html = (
            f"<p>Hola {profile.display_name},</p>"
            f"<p>Quedan {hours_before} hora{'s' if hours_before != 1 else ''} para el primer juego de hoy "
            f"en {matchday.name} ({formatted_date}) y aun te faltan "
            f"<strong>{missing_count}</strong> picks.</p>"
            f"<p>Completa tus picks aqui: "
            f"<a href=\"{dashboard_url}\">{dashboard_url}</a></p>"
            f"<p>Partidos abiertos hoy: {len(date_matches)}.</p>"
        )
        return DueReminder(
            dedupe_key=f"pre-game:{matchday.id}:{local_match_date.isoformat()}:{hours_before}:{profile.id}",
            profile_id=profile.id,
            recipient_email=profile.email or "",
            matchday_id=matchday.id,
            matchday_name=matchday.name,
            season_name=season.name,
            reminder_kind=PickReminderKind.PRE_GAME,
            subject=subject,
            html=html,
            target_match_date=local_match_date,
            hours_before=hours_before,
        )

    def _dashboard_url(self) -> str:
        base_url = settings.frontend_site_url.rstrip("/")
        return f"{base_url}/dashboard/picks"

    def _is_due_window(
        self,
        *,
        now: datetime,
        target_at: datetime,
        window_minutes: int,
    ) -> bool:
        target = ensure_utc(target_at)
        return target <= now < target + timedelta(minutes=window_minutes)
