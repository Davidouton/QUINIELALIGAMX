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
    PickPoint,
    PickReminderEmailEvent,
    PickReminderKind,
    Profile,
    PushNotificationEvent,
    Season,
    SeasonMembership,
    SeasonVisibilityStatus,
    StandingsMatchday,
    StandingsOverall,
    Team,
    UserPick,
)
from app.services.onesignal_service import OneSignalPushService

settings = get_settings()


@dataclass
class DueReminder:
    dedupe_key: str
    profile_id: str
    external_user_id: str
    recipient_reference: str
    matchday_id: str
    matchday_name: str
    season_name: str
    reminder_kind: PickReminderKind
    title: str
    body: str
    target_url: str
    target_match_date: date | None = None
    hours_before: int | None = None


@dataclass
class ReminderDispatchResult:
    dedupe_key: str
    profile_id: str
    recipient_reference: str
    title: str
    status: str
    provider_message_id: str | None = None


class ReminderService:
    def __init__(self) -> None:
        self.push_service = OneSignalPushService()

    def collect_due_push_reminders(
        self,
        db: Session,
        *,
        now_utc: datetime | None = None,
        window_minutes: int = 70,
    ) -> list[DueReminder]:
        now = ensure_utc(now_utc or datetime.now(UTC))
        window = max(window_minutes, 1)
        reminders: list[DueReminder] = []

        active_rows = db.execute(
            select(Matchday, Season)
            .join(Season, Season.id == Matchday.season_id)
            .where(
                Matchday.status == MatchdayStatus.ACTIVE,
                Season.visibility_status == SeasonVisibilityStatus.LIVE,
            )
            .order_by(Matchday.starts_at.asc())
        ).all()

        for matchday, season in active_rows:
            scheduled_matches = list(
                db.scalars(
                    select(Match)
                    .where(
                        Match.matchday_id == matchday.id,
                        Match.status == MatchStatus.SCHEDULED,
                    )
                    .order_by(Match.kickoff_at.asc())
                )
            )
            if not scheduled_matches:
                continue

            open_matches = [match for match in scheduled_matches if ensure_utc(match.picks_lock_at) > now]
            participants = list(
                db.scalars(
                    select(Profile)
                    .join(SeasonMembership, SeasonMembership.profile_id == Profile.id)
                    .where(
                        SeasonMembership.season_id == season.id,
                        SeasonMembership.is_active.is_(True),
                        Profile.is_active.is_(True),
                        Profile.pick_reminder_email_enabled.is_(True),
                    )
                    .order_by(Profile.display_name.asc())
                )
            )
            if not participants:
                continue

            reminders.extend(
                self._collect_matchday_start_reminders(
                    db,
                    participants,
                    matchday,
                    season,
                    scheduled_matches,
                    now=now,
                    window_minutes=window,
                )
            )

            if open_matches:
                reminders.extend(
                    self._collect_pre_game_reminders(
                        db,
                        participants,
                        matchday,
                        season,
                        open_matches,
                        now=now,
                        window_minutes=window,
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
        results = self._dispatch_push_reminders(db, reminders, dry_run=dry_run)
        if not dry_run and reminders:
            db.commit()
        return results

    def send_matchday_summary_notifications(
        self,
        db: Session,
        *,
        matchday_id: str,
        dry_run: bool = False,
    ) -> list[ReminderDispatchResult]:
        reminders = self.collect_matchday_summary_reminders(db, matchday_id=matchday_id)
        results = self._dispatch_push_reminders(db, reminders, dry_run=dry_run)
        if not dry_run and reminders:
            db.commit()
        return results

    def send_match_scoring_notifications(
        self,
        db: Session,
        *,
        matchday_id: str | None = None,
        match_id: str | None = None,
        lookback_minutes: int = 10,
        max_attempts: int = 3,
        failed_only: bool = False,
    ) -> list[ReminderDispatchResult]:
        if not self.push_service.is_configured():
            return []

        dashboard_url = f"{settings.frontend_site_url.rstrip('/')}/dashboard/leaderboard"
        home_team_alias = aliased(Team)
        away_team_alias = aliased(Team)
        now = datetime.now(UTC)
        recent_result_cutoff = now - timedelta(minutes=max(lookback_minutes, 1))
        recent_match_cutoff = now - timedelta(hours=max(12, (lookback_minutes // 60) + 12))
        match_query = (
            select(Match, MatchResult, Matchday, home_team_alias, away_team_alias)
            .join(MatchResult, MatchResult.match_id == Match.id)
            .join(Matchday, Matchday.id == Match.matchday_id)
            .join(Season, Season.id == Matchday.season_id)
            .join(home_team_alias, home_team_alias.id == Match.home_team_id)
            .join(away_team_alias, away_team_alias.id == Match.away_team_id)
            .where(
                MatchResult.is_official.is_(True),
                MatchResult.last_synced_at >= recent_result_cutoff,
                Match.kickoff_at >= recent_match_cutoff,
                Season.visibility_status == SeasonVisibilityStatus.LIVE,
            )
        )
        if matchday_id is not None:
            match_query = match_query.where(Match.matchday_id == matchday_id)
        if match_id is not None:
            match_query = match_query.where(Match.id == match_id)

        match_rows = db.execute(match_query).all()
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
                .where(
                    PickPoint.match_id == match.id,
                    Profile.is_active.is_(True),
                    Profile.pick_reminder_email_enabled.is_(True),
                    Profile.match_result_notification_enabled.is_(True),
                )
            ).all()

            title = f"{home_team.short_name} {match_result.home_score}-{match_result.away_score} {away_team.short_name}"
            for point, profile, standing in scoring_rows:
                total_points = standing.total_points if standing is not None else point.total_points
                rank_label = f" y vas #{standing.rank_position}" if standing is not None else ""
                message = f"Sumaste {point.total_points} pts. Llevas {total_points} pts{rank_label} en el ranking."
                dedupe_key = f"score:{match.id}:{match_result.home_score}:{match_result.away_score}:{profile.id}"

                event = db.scalar(
                    select(PushNotificationEvent).where(PushNotificationEvent.dedupe_key == dedupe_key)
                )
                if event is not None and event.delivery_status == "sent":
                    continue
                if event is not None and event.attempt_count >= max(max_attempts, 1):
                    continue
                if event is None and failed_only:
                    continue
                if event is None:
                    event = PushNotificationEvent(
                        dedupe_key=dedupe_key,
                        notification_kind="match_result",
                        profile_id=profile.id,
                        matchday_id=matchday.id,
                        match_id=match.id,
                        delivery_status="pending",
                        attempt_count=0,
                    )

                event.attempt_count += 1
                event.last_attempt_at = now
                event.delivery_status = "pending"
                event.last_error = None

                try:
                    provider_message_id = self.push_service.send_to_external_id(
                        external_id=profile.auth_user_id,
                        title=title,
                        message=message,
                        url=dashboard_url,
                        dedupe_key=dedupe_key,
                    )
                except Exception as error:
                    event.delivery_status = "failed"
                    event.last_error = str(error)[:1000]
                    db.add(event)
                    results.append(
                        ReminderDispatchResult(
                            dedupe_key=dedupe_key,
                            profile_id=profile.id,
                            recipient_reference=profile.email or profile.auth_user_id,
                            title=title,
                            status="failed",
                        )
                    )
                    continue

                event.delivery_status = "sent"
                event.provider_message_id = provider_message_id
                event.sent_at = now
                db.add(event)
                results.append(
                    ReminderDispatchResult(
                        dedupe_key=dedupe_key,
                        profile_id=profile.id,
                        recipient_reference=profile.email or profile.auth_user_id,
                        title=title,
                        status="sent",
                        provider_message_id=provider_message_id,
                    )
                )

        if results:
            db.commit()
        return results

    def collect_matchday_summary_reminders(
        self,
        db: Session,
        *,
        matchday_id: str,
    ) -> list[DueReminder]:
        row = db.execute(
            select(Matchday, Season)
            .join(Season, Season.id == Matchday.season_id)
            .where(Matchday.id == matchday_id)
        ).first()
        if row is None:
            return []

        matchday, season = row
        if season.visibility_status != SeasonVisibilityStatus.LIVE:
            return []
        if matchday.status not in {MatchdayStatus.CLOSED, MatchdayStatus.PUBLISHED}:
            return []

        participants = list(
            db.scalars(
                select(Profile)
                .join(SeasonMembership, SeasonMembership.profile_id == Profile.id)
                .where(
                    SeasonMembership.season_id == season.id,
                    SeasonMembership.is_active.is_(True),
                    Profile.is_active.is_(True),
                    Profile.pick_reminder_email_enabled.is_(True),
                    Profile.matchday_summary_notification_enabled.is_(True),
                )
                .order_by(Profile.display_name.asc())
            )
        )
        if not participants:
            return []

        standings_rows = list(db.scalars(select(StandingsMatchday).where(StandingsMatchday.matchday_id == matchday.id)))
        standings_by_profile_id = {row.profile_id: row for row in standings_rows}
        podium_rows = sorted(
            standings_rows,
            key=lambda row: (row.rank_position, -row.total_points, row.profile_id),
        )[:3]
        podium_profiles_by_id = (
            {
                profile.id: profile
                for profile in db.scalars(select(Profile).where(Profile.id.in_([row.profile_id for row in podium_rows])))
            }
            if podium_rows
            else {}
        )

        candidates = [
            self._build_matchday_summary_reminder(
                profile=profile,
                matchday=matchday,
                season=season,
                standing=standings_by_profile_id.get(profile.id),
                podium_rows=podium_rows,
                podium_profiles_by_id=podium_profiles_by_id,
            )
            for profile in participants
        ]
        return self._filter_existing_reminders(db, candidates)

    def _collect_matchday_start_reminders(
        self,
        db: Session,
        participants: list[Profile],
        matchday: Matchday,
        season: Season,
        scheduled_matches: list[Match],
        *,
        now: datetime,
        window_minutes: int,
    ) -> list[DueReminder]:
        first_kickoff = min(match.kickoff_at for match in scheduled_matches)
        if not self._is_due_window(
            now=now,
            target_at=first_kickoff - timedelta(hours=1),
            window_minutes=window_minutes,
        ):
            return []

        eligible_profiles = [profile for profile in participants if profile.matchday_start_notification_enabled]
        if not eligible_profiles:
            return []

        match_ids = [match.id for match in scheduled_matches]
        profile_ids = [profile.id for profile in eligible_profiles]
        picks_by_profile = self._count_picks_by_profile(db, profile_ids=profile_ids, match_ids=match_ids)
        total_matches = len(match_ids)

        candidates = [
            self._build_matchday_start_reminder(
                profile=profile,
                matchday=matchday,
                season=season,
                scheduled_matches=scheduled_matches,
                missing_count=total_matches - picks_by_profile.get(profile.id, 0),
            )
            for profile in eligible_profiles
        ]
        return self._filter_existing_reminders(db, candidates)

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
    ) -> list[DueReminder]:
        reminders: list[DueReminder] = []
        matches_by_lock: dict[datetime, list[Match]] = defaultdict(list)
        for match in open_matches:
            matches_by_lock[ensure_utc(match.picks_lock_at)].append(match)

        for lock_at, lock_matches in matches_by_lock.items():
            local_match_date = lock_at.astimezone(MEXICO_CITY_TZ).date()
            for hours_before in (1, 3):
                if not self._is_due_window(
                    now=now,
                    target_at=lock_at - timedelta(hours=hours_before),
                    window_minutes=window_minutes,
                ):
                    continue

                eligible_profiles = [
                    profile for profile in participants if profile.pick_reminder_hours_before == hours_before
                ]
                if not eligible_profiles:
                    continue

                match_ids = [match.id for match in lock_matches]
                profile_ids = [profile.id for profile in eligible_profiles]
                picked_match_ids_by_profile: dict[str, set[str]] = defaultdict(set)
                for profile_id, match_id in db.execute(
                    select(UserPick.profile_id, UserPick.match_id).where(
                        UserPick.profile_id.in_(profile_ids),
                        UserPick.match_id.in_(match_ids),
                    )
                ):
                    picked_match_ids_by_profile[profile_id].add(match_id)

                team_ids = {
                    team_id
                    for match in lock_matches
                    for team_id in (match.home_team_id, match.away_team_id)
                    if team_id is not None
                }
                teams_by_id = (
                    {team.id: team for team in db.scalars(select(Team).where(Team.id.in_(team_ids)))}
                    if team_ids
                    else {}
                )

                candidates = [
                    self._build_pre_game_reminder(
                        profile=profile,
                        matchday=matchday,
                        season=season,
                        lock_at=lock_at,
                        local_match_date=local_match_date,
                        hours_before=hours_before,
                        missing_matches=[
                            match
                            for match in lock_matches
                            if match.id not in picked_match_ids_by_profile[profile.id]
                        ],
                        teams_by_id=teams_by_id,
                    )
                    for profile in eligible_profiles
                    if len(picked_match_ids_by_profile[profile.id]) < len(match_ids)
                ]
                reminders.extend(self._filter_existing_reminders(db, candidates))

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
            db.scalars(select(PickReminderEmailEvent.dedupe_key).where(PickReminderEmailEvent.dedupe_key.in_(keys)))
        )
        return [candidate for candidate in candidates if candidate.dedupe_key not in existing_keys]

    def _dispatch_push_reminders(
        self,
        db: Session,
        reminders: list[DueReminder],
        *,
        dry_run: bool,
    ) -> list[ReminderDispatchResult]:
        results: list[ReminderDispatchResult] = []
        for reminder in reminders:
            provider_message_id: str | None = None
            status = "dry_run"

            if not dry_run:
                try:
                    provider_message_id = self.push_service.send_to_external_id(
                        external_id=reminder.external_user_id,
                        title=reminder.title,
                        message=reminder.body,
                        url=reminder.target_url,
                        dedupe_key=reminder.dedupe_key,
                    )
                except Exception:
                    status = "failed"
                else:
                    self._record_notification_event(db, reminder, provider_message_id=provider_message_id)
                    status = "sent"

            results.append(
                ReminderDispatchResult(
                    dedupe_key=reminder.dedupe_key,
                    profile_id=reminder.profile_id,
                    recipient_reference=reminder.recipient_reference,
                    title=reminder.title,
                    status=status,
                    provider_message_id=provider_message_id,
                )
            )

        return results

    def _record_notification_event(
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
                recipient_email=reminder.recipient_reference,
                provider_name="onesignal",
                provider_message_id=provider_message_id,
            )
        )

    def _build_matchday_start_reminder(
        self,
        *,
        profile: Profile,
        matchday: Matchday,
        season: Season,
        scheduled_matches: list[Match],
        missing_count: int,
    ) -> DueReminder:
        dashboard_url = self._dashboard_url()
        title = f"{matchday.name} arranca en 1 hora"
        missing_message = (
            f"Aun te faltan {missing_count} picks por capturar."
            if missing_count > 0
            else "Ya tienes tus picks capturados para esta jornada."
        )
        body = (
            f"{matchday.name} de {season.name} inicia en aproximadamente una hora. "
            f"{missing_message} Partidos programados: {len(scheduled_matches)}."
        )
        return DueReminder(
            dedupe_key=f"matchday-start:{matchday.id}:{profile.id}",
            profile_id=profile.id,
            external_user_id=profile.auth_user_id,
            recipient_reference=profile.email or profile.auth_user_id,
            matchday_id=matchday.id,
            matchday_name=matchday.name,
            season_name=season.name,
            reminder_kind=PickReminderKind.MATCHDAY_START,
            title=title,
            body=body,
            target_url=dashboard_url,
        )

    def _build_pre_game_reminder(
        self,
        *,
        profile: Profile,
        matchday: Matchday,
        season: Season,
        lock_at: datetime,
        local_match_date: date,
        hours_before: int,
        missing_matches: list[Match],
        teams_by_id: dict[str, Team],
    ) -> DueReminder:
        dashboard_url = self._dashboard_url()
        formatted_date = local_match_date.strftime("%d/%m/%Y")
        title = "Tu pick está próximo a cerrar"
        missing_match_labels = [
            (
                f"{teams_by_id[match.home_team_id].short_name} vs "
                f"{teams_by_id[match.away_team_id].short_name}"
            )
            if match.home_team_id in teams_by_id and match.away_team_id in teams_by_id
            else "Partido pendiente"
            for match in missing_matches
        ]
        body = (
            f"Aún no tienes pick en: {', '.join(missing_match_labels)}. "
            f"El cierre está próximo en {matchday.name} ({formatted_date})."
        )
        return DueReminder(
            dedupe_key=f"pre-game:{matchday.id}:{lock_at.isoformat()}:{hours_before}:{profile.id}",
            profile_id=profile.id,
            external_user_id=profile.auth_user_id,
            recipient_reference=profile.email or profile.auth_user_id,
            matchday_id=matchday.id,
            matchday_name=matchday.name,
            season_name=season.name,
            reminder_kind=PickReminderKind.PRE_GAME,
            title=title,
            body=body,
            target_url=dashboard_url,
            target_match_date=local_match_date,
            hours_before=hours_before,
        )

    def _build_matchday_summary_reminder(
        self,
        *,
        profile: Profile,
        matchday: Matchday,
        season: Season,
        standing: StandingsMatchday | None,
        podium_rows: list[StandingsMatchday],
        podium_profiles_by_id: dict[str, Profile],
    ) -> DueReminder:
        dashboard_url = self._dashboard_url()
        if standing is None:
            user_summary = "Esta jornada cerro sin puntos registrados para tu perfil."
        else:
            user_summary = f"Terminaste con {standing.total_points} puntos y en la posicion #{standing.rank_position}."
        podium_text = "; ".join(
            (
                f"#{row.rank_position} "
                f"{podium_profiles_by_id.get(row.profile_id).display_name if podium_profiles_by_id.get(row.profile_id) else 'Usuario'} "
                f"- {row.total_points} pts"
            )
            for row in podium_rows
        )
        body = (
            f"{matchday.name} de {season.name} ya quedo cerrada. {user_summary} "
            f"Podio: {podium_text or 'Sin standings publicados todavia.'}"
        )
        return DueReminder(
            dedupe_key=f"matchday-summary:{matchday.id}:{profile.id}",
            profile_id=profile.id,
            external_user_id=profile.auth_user_id,
            recipient_reference=profile.email or profile.auth_user_id,
            matchday_id=matchday.id,
            matchday_name=matchday.name,
            season_name=season.name,
            reminder_kind=PickReminderKind.MATCHDAY_SUMMARY,
            title=f"{matchday.name} ya cerro",
            body=body,
            target_url=dashboard_url,
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
