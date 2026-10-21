import json
from datetime import UTC, datetime, timedelta
from math import ceil

from sqlalchemy import case, distinct, func, select
from sqlalchemy.orm import Session

from app.core.datetime import MEXICO_CITY_TZ, ensure_utc, mexico_city_to_utc
from app.models.entities import AnalyticsEvent, Profile
from app.schemas.analytics import (
    AdminAnalyticsStatsOut,
    AnalyticsDailyStatOut,
    AnalyticsEventIn,
    AnalyticsEventStatOut,
    AnalyticsKpiOut,
    AnalyticsRecentEventOut,
    AnalyticsScreenStatOut,
    AnalyticsUserStatOut,
)


def _event_day(db: Session):
    """Group on the same local calendar used by the administration screen."""
    if db.get_bind().dialect.name == "sqlite":
        # SQLite has no IANA timezone support; use zoneinfo for historical DST too.
        connection = db.connection().connection.driver_connection
        connection.create_function(
            "analytics_local_day",
            1,
            lambda value: ensure_utc(datetime.fromisoformat(value))
            .astimezone(MEXICO_CITY_TZ)
            .date()
            .isoformat(),
            deterministic=True,
        )
        return func.analytics_local_day(AnalyticsEvent.created_at)
    return func.date(func.timezone("America/Mexico_City", AnalyticsEvent.created_at))


class AnalyticsService:
    def ensure_schema(self, db: Session) -> None:
        AnalyticsEvent.__table__.create(bind=db.get_bind(), checkfirst=True)

    def record_event(
        self,
        db: Session,
        *,
        profile_id: str | None,
        payload: AnalyticsEventIn,
    ) -> None:
        self.ensure_schema(db)
        event = AnalyticsEvent(
            profile_id=profile_id,
            category=payload.category,
            event_name=payload.event_name,
            route_path=payload.route_path,
            screen_name=payload.screen_name,
            season_id=payload.season_id,
            matchday_id=payload.matchday_id,
            competition_id=payload.competition_id,
            success=payload.success,
            duration_ms=payload.duration_ms,
            metadata_json=json.dumps(payload.metadata, ensure_ascii=True, separators=(",", ":"))
            if payload.metadata
            else None,
        )
        db.add(event)
        db.commit()

    def build_admin_stats(
        self,
        db: Session,
        *,
        days: int = 7,
        profile_id: str | None = None,
        start_at: datetime | None = None,
        end_at: datetime | None = None,
        page: int = 1,
        page_size: int = 50,
    ) -> AdminAnalyticsStatsOut:
        if (start_at is None) != (end_at is None):
            raise ValueError("Indica tanto el inicio como el fin del rango.")
        if page < 1 or not 1 <= page_size <= 200:
            raise ValueError("La página debe ser positiva y su tamaño debe estar entre 1 y 200.")
        generated_at = datetime.now(UTC)
        if start_at is not None and end_at is not None:
            window_start = mexico_city_to_utc(start_at)
            window_end = mexico_city_to_utc(end_at)
            if window_start >= window_end:
                raise ValueError("El inicio del rango debe ser anterior al fin.")
        else:
            window_end = generated_at
            window_start = window_end - timedelta(days=max(1, min(days, 90)))
        window_days = max(1, ceil((window_end - window_start).total_seconds() / 86400))
        self.ensure_schema(db)

        base_filter = (AnalyticsEvent.created_at >= window_start) & (
            AnalyticsEvent.created_at < window_end
        )
        if profile_id:
            base_filter = base_filter & (AnalyticsEvent.profile_id == profile_id)

        def count_if(condition):
            return func.sum(case((condition, 1), else_=0))

        selected_profile_display_name = None
        if profile_id:
            selected_profile = db.get(Profile, profile_id)
            selected_profile_display_name = (
                selected_profile.display_name if selected_profile is not None else None
            )

        kpi_row = db.execute(
            select(
                func.count(AnalyticsEvent.id),
                func.count(distinct(AnalyticsEvent.profile_id)),
                count_if(AnalyticsEvent.event_name == "screen_viewed"),
                count_if(AnalyticsEvent.category == "action"),
                count_if(AnalyticsEvent.success.is_(False)),
                func.avg(
                    case(
                        (
                            (AnalyticsEvent.event_name == "screen_loaded")
                            & AnalyticsEvent.duration_ms.is_not(None)
                            & AnalyticsEvent.success.is_not(False),
                            AnalyticsEvent.duration_ms,
                        ),
                        else_=None,
                    )
                ),
            ).where(base_filter)
        ).one()
        events_total = int(kpi_row[0] or 0)
        events_total_pages = (events_total + page_size - 1) // page_size
        events_page = min(page, max(1, events_total_pages))

        user_rows = db.execute(
            select(
                AnalyticsEvent.profile_id,
                Profile.display_name,
                count_if(AnalyticsEvent.event_name == "screen_viewed"),
                count_if(AnalyticsEvent.category == "action"),
                count_if(AnalyticsEvent.success.is_(False)),
                func.avg(
                    case(
                        (
                            (AnalyticsEvent.event_name == "screen_loaded")
                            & AnalyticsEvent.duration_ms.is_not(None)
                            & AnalyticsEvent.success.is_not(False),
                            AnalyticsEvent.duration_ms,
                        ),
                        else_=None,
                    )
                ),
                func.max(AnalyticsEvent.created_at),
            )
            .select_from(AnalyticsEvent)
            .join(Profile, Profile.id == AnalyticsEvent.profile_id)
            .where(base_filter)
            .group_by(AnalyticsEvent.profile_id, Profile.display_name)
            .order_by(
                count_if(AnalyticsEvent.event_name == "screen_viewed").desc(),
                func.max(AnalyticsEvent.created_at).desc(),
            )
            .limit(20)
        ).all()

        screen_rows = db.execute(
            select(
                func.coalesce(AnalyticsEvent.screen_name, "Sin nombre"),
                func.max(AnalyticsEvent.route_path),
                count_if(AnalyticsEvent.event_name == "screen_viewed"),
                func.count(distinct(AnalyticsEvent.profile_id)),
                func.avg(
                    case(
                        (
                            (AnalyticsEvent.event_name == "screen_loaded")
                            & AnalyticsEvent.duration_ms.is_not(None)
                            & AnalyticsEvent.success.is_not(False),
                            AnalyticsEvent.duration_ms,
                        ),
                        else_=None,
                    )
                ),
                count_if((AnalyticsEvent.category == "screen") & AnalyticsEvent.success.is_(False)),
            )
            .where(base_filter)
            .where(AnalyticsEvent.screen_name.is_not(None))
            .group_by(AnalyticsEvent.screen_name)
            .order_by(
                count_if(AnalyticsEvent.event_name == "screen_viewed").desc(),
                func.max(AnalyticsEvent.created_at).desc(),
            )
            .limit(12)
        ).all()

        event_rows = db.execute(
            select(
                AnalyticsEvent.category,
                AnalyticsEvent.event_name,
                func.count(AnalyticsEvent.id),
                func.count(distinct(AnalyticsEvent.profile_id)),
            )
            .where(base_filter)
            .group_by(AnalyticsEvent.category, AnalyticsEvent.event_name)
            .order_by(func.count(AnalyticsEvent.id).desc(), AnalyticsEvent.event_name.asc())
            .limit(12)
        ).all()

        event_day = _event_day(db)
        day_rows = db.execute(
            select(
                event_day,
                count_if(AnalyticsEvent.event_name == "screen_viewed"),
                count_if(AnalyticsEvent.category == "action"),
                count_if(AnalyticsEvent.success.is_(False)),
                func.count(distinct(AnalyticsEvent.profile_id)),
            )
            .where(base_filter)
            .group_by(event_day)
            .order_by(event_day.asc())
        ).all()

        recent_rows = db.execute(
            select(
                AnalyticsEvent.id,
                AnalyticsEvent.created_at,
                AnalyticsEvent.profile_id,
                Profile.display_name,
                AnalyticsEvent.category,
                AnalyticsEvent.event_name,
                AnalyticsEvent.route_path,
                AnalyticsEvent.screen_name,
                AnalyticsEvent.success,
                AnalyticsEvent.duration_ms,
            )
            .select_from(AnalyticsEvent)
            .outerjoin(Profile, Profile.id == AnalyticsEvent.profile_id)
            .where(base_filter)
            .order_by(AnalyticsEvent.created_at.desc(), AnalyticsEvent.id.desc())
            .offset((events_page - 1) * page_size)
            .limit(page_size)
        ).all()

        return AdminAnalyticsStatsOut(
            window_days=window_days,
            window_start=window_start,
            window_end=window_end,
            generated_at=generated_at,
            events_page=events_page,
            events_page_size=page_size,
            events_total=events_total,
            events_total_pages=events_total_pages,
            selected_profile_id=profile_id,
            selected_profile_display_name=selected_profile_display_name,
            kpis=AnalyticsKpiOut(
                total_events=int(kpi_row[0] or 0),
                unique_users=int(kpi_row[1] or 0),
                screen_views=int(kpi_row[2] or 0),
                action_events=int(kpi_row[3] or 0),
                failure_events=int(kpi_row[4] or 0),
                avg_screen_load_ms=float(kpi_row[5]) if kpi_row[5] is not None else None,
            ),
            users=[
                AnalyticsUserStatOut(
                    profile_id=row[0],
                    display_name=row[1],
                    screen_views=int(row[2] or 0),
                    action_events=int(row[3] or 0),
                    failure_events=int(row[4] or 0),
                    avg_load_ms=float(row[5]) if row[5] is not None else None,
                    last_seen_at=ensure_utc(row[6]) if row[6] is not None else None,
                )
                for row in user_rows
            ],
            screens=[
                AnalyticsScreenStatOut(
                    screen_name=str(row[0]),
                    route_path=row[1],
                    views=int(row[2] or 0),
                    unique_users=int(row[3] or 0),
                    avg_load_ms=float(row[4]) if row[4] is not None else None,
                    failures=int(row[5] or 0),
                )
                for row in screen_rows
            ],
            top_events=[
                AnalyticsEventStatOut(
                    category=str(row[0]),
                    event_name=str(row[1]),
                    count=int(row[2] or 0),
                    unique_users=int(row[3] or 0),
                )
                for row in event_rows
            ],
            daily=[
                AnalyticsDailyStatOut(
                    day=str(row[0]),
                    screen_views=int(row[1] or 0),
                    action_events=int(row[2] or 0),
                    failure_events=int(row[3] or 0),
                    unique_users=int(row[4] or 0),
                )
                for row in day_rows
            ],
            recent_events=[
                AnalyticsRecentEventOut(
                    id=row[0],
                    created_at=ensure_utc(row[1]),
                    profile_id=row[2],
                    display_name=row[3],
                    category=row[4],
                    event_name=row[5],
                    route_path=row[6],
                    screen_name=row[7],
                    success=row[8],
                    duration_ms=row[9],
                )
                for row in recent_rows
            ],
        )
