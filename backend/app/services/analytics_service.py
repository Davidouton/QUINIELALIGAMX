import json
from datetime import UTC, datetime, timedelta

from sqlalchemy import case, distinct, func, select
from sqlalchemy.orm import Session

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
        days: int,
        profile_id: str | None = None,
    ) -> AdminAnalyticsStatsOut:
        self.ensure_schema(db)
        window_days = max(1, min(days, 90))
        window_start = datetime.now(UTC) - timedelta(days=window_days)

        base_filter = AnalyticsEvent.created_at >= window_start
        if profile_id:
            base_filter = base_filter & (AnalyticsEvent.profile_id == profile_id)
        count_if = lambda condition: func.sum(case((condition, 1), else_=0))

        selected_profile_display_name = None
        if profile_id:
            selected_profile = db.get(Profile, profile_id)
            selected_profile_display_name = selected_profile.display_name if selected_profile is not None else None

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
            .order_by(count_if(AnalyticsEvent.event_name == "screen_viewed").desc(), func.max(AnalyticsEvent.created_at).desc())
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
            .order_by(count_if(AnalyticsEvent.event_name == "screen_viewed").desc(), func.max(AnalyticsEvent.created_at).desc())
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

        day_rows = db.execute(
            select(
                func.date(AnalyticsEvent.created_at),
                count_if(AnalyticsEvent.event_name == "screen_viewed"),
                count_if(AnalyticsEvent.category == "action"),
                count_if(AnalyticsEvent.success.is_(False)),
                func.count(distinct(AnalyticsEvent.profile_id)),
            )
            .where(base_filter)
            .group_by(func.date(AnalyticsEvent.created_at))
            .order_by(func.date(AnalyticsEvent.created_at).asc())
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
            .order_by(AnalyticsEvent.created_at.desc())
            .limit(25)
        ).all()

        return AdminAnalyticsStatsOut(
            window_days=window_days,
            generated_at=datetime.now(UTC),
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
                    last_seen_at=row[6],
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
                    created_at=row[1],
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
