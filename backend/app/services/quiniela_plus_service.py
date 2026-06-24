import json
from calendar import monthrange
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from pathlib import Path

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.core.datetime import MEXICO_CITY_TZ, ensure_utc
from app.models.entities import (
    CommerceSettings,
    Match,
    MatchResult,
    Matchday,
    Odds,
    Payment,
    PickSelection,
    Profile,
    QuinielaPlusBillingPeriod,
    QuinielaPlusLeague,
    QuinielaPlusMembership,
    QuinielaPlusMembershipLeague,
    QuinielaPlusMembershipStatus,
    QuinielaPlusPlan,
    Season,
    Team,
    TournamentFormat,
    UserPick,
)
from app.models.quiniela_plus_value import (
    QuinielaPlusStatsMatch,
    QuinielaPlusStatsSnapshot,
    QuinielaPlusValueRecommendation,
)
from app.repositories.odds_repository import OddsRepository
from app.schemas.quiniela_plus import (
    QuinielaPlusAdminConsoleResponse,
    QuinielaPlusAdminSettingsOut,
    QuinielaPlusAdminSettingsUpdateRequest,
    QuinielaPlusAdvancedStatsMatchOut,
    QuinielaPlusAdvancedStatsOut,
    QuinielaPlusCatalogResponse,
    QuinielaPlusLeagueOut,
    QuinielaPlusLeagueUpsertRequest,
    QuinielaPlusMembershipLeagueOut,
    QuinielaPlusMembershipOut,
    QuinielaPlusOddsSneakPeekMatchOut,
    QuinielaPlusOddsSneakPeekOut,
    QuinielaPlusPlanOut,
    QuinielaPlusPlanUpsertRequest,
    QuinielaPlusScoreDistributionOut,
    QuinielaPlusUserDistributionMatchOut,
    QuinielaPlusUserDistributionOut,
    QuinielaPlusUserSelectionDistributionOut,
    QuinielaPlusValueLabOut,
    QuinielaPlusValueRecommendationOut,
)

ADVANCED_STATS_PATH = (
    Path(__file__).resolve().parents[1] / "data" / "quiniela_plus_advanced_stats.json"
)


class QuinielaPlusService:
    def __init__(self) -> None:
        self.odds_repo = OddsRepository()

    def list_catalog(self, db: Session, profile: Profile) -> QuinielaPlusCatalogResponse:
        self._refresh_expired_memberships(db, profile.id)
        settings = self._get_or_create_settings(db)
        leagues = list(
            db.scalars(
                select(QuinielaPlusLeague)
                .where(QuinielaPlusLeague.is_active.is_(True))
                .order_by(QuinielaPlusLeague.sort_order.asc(), QuinielaPlusLeague.league_name.asc())
            )
        )
        plans = list(
            db.scalars(
                select(QuinielaPlusPlan)
                .where(QuinielaPlusPlan.is_active.is_(True))
                .order_by(QuinielaPlusPlan.sort_order.asc(), QuinielaPlusPlan.price_amount.asc())
            )
        )
        memberships = self._list_memberships(db, profile.id, only_active=True)
        return QuinielaPlusCatalogResponse(
            checkout_enabled=settings.quiniela_plus_checkout_enabled,
            checkout_message=settings.quiniela_plus_checkout_message,
            leagues=[self._to_league_out(row) for row in leagues],
            plans=[self._to_plan_out(row) for row in plans],
            active_memberships=memberships,
        )

    def get_odds_sneak_peek(self, db: Session, limit: int = 40) -> QuinielaPlusOddsSneakPeekOut:
        today_start = datetime.now(MEXICO_CITY_TZ).replace(hour=0, minute=0, second=0, microsecond=0)
        window_start = today_start.astimezone(UTC)
        candidate_rows = db.execute(
            select(Match, Matchday)
            .join(Matchday, Matchday.id == Match.matchday_id)
            .join(Season, Season.id == Matchday.season_id)
            .where(
                Season.tournament_format == TournamentFormat.WORLD_CUP,
                Match.kickoff_at >= window_start,
                Match.home_team_id.is_not(None),
                Match.away_team_id.is_not(None),
            )
            .order_by(Match.kickoff_at.asc(), Match.created_at.asc())
            .limit(30)
        ).all()
        latest_odds_by_match_id = self.odds_repo.list_latest_by_match_ids(
            db,
            [match.id for match, _ in candidate_rows],
        )

        rows: list[QuinielaPlusOddsSneakPeekMatchOut] = []
        for match, matchday in candidate_rows:
            odds = latest_odds_by_match_id.get(match.id)
            home_probability, draw_probability, away_probability = self._build_devigged_probabilities(odds)
            if (
                odds is None
                or not odds.provider_name
                or home_probability is None
                or draw_probability is None
                or away_probability is None
            ):
                continue
            home_team = db.get(Team, match.home_team_id)
            away_team = db.get(Team, match.away_team_id)
            rows.append(
                QuinielaPlusOddsSneakPeekMatchOut(
                    match_id=match.id,
                    matchday_id=match.matchday_id,
                    matchday_number=matchday.number,
                    matchday_name=matchday.name,
                    home_team_name=home_team.name if home_team is not None else match.home_placeholder or "Local",
                    home_team_short_name=home_team.short_name if home_team is not None else "LOC",
                    home_team_crest_url=home_team.crest_url if home_team is not None else None,
                    away_team_name=away_team.name if away_team is not None else match.away_placeholder or "Visitante",
                    away_team_short_name=away_team.short_name if away_team is not None else "VIS",
                    away_team_crest_url=away_team.crest_url if away_team is not None else None,
                    kickoff_at=match.kickoff_at,
                    odds_provider_name=odds.provider_name,
                    home_win_probability=home_probability,
                    draw_probability=draw_probability,
                    away_win_probability=away_probability,
                )
            )
            if len(rows) >= limit:
                break

        return QuinielaPlusOddsSneakPeekOut(matches=rows)

    def get_user_distribution(self, db: Session, limit: int | None = None) -> QuinielaPlusUserDistributionOut:
        now = datetime.now(UTC)
        match_query = (
            select(Match, Matchday)
            .join(Matchday, Matchday.id == Match.matchday_id)
            .join(Season, Season.id == Matchday.season_id)
            .where(
                Season.tournament_format == TournamentFormat.WORLD_CUP,
                Match.home_team_id.is_not(None),
                Match.away_team_id.is_not(None),
            )
            .order_by(Match.kickoff_at.asc(), Match.created_at.asc())
        )
        if limit is not None:
            match_query = match_query.limit(limit)
        match_rows = db.execute(match_query).all()

        match_ids = [match.id for match, _ in match_rows]
        if not match_ids:
            return QuinielaPlusUserDistributionOut()

        selection_counts: dict[str, dict[PickSelection, int]] = {
            match_id: {
                PickSelection.HOME: 0,
                PickSelection.DRAW: 0,
                PickSelection.AWAY: 0,
            }
            for match_id in match_ids
        }
        score_counts: dict[str, list[tuple[int, int, int]]] = {match_id: [] for match_id in match_ids}

        selection_rows = db.execute(
            select(UserPick.match_id, UserPick.selection, func.count(UserPick.id))
            .where(UserPick.match_id.in_(match_ids))
            .group_by(UserPick.match_id, UserPick.selection)
        ).all()
        for match_id, selection, count in selection_rows:
            if match_id in selection_counts:
                selection_counts[match_id][selection] = int(count)

        score_rows = db.execute(
            select(
                UserPick.match_id,
                UserPick.predicted_home_score,
                UserPick.predicted_away_score,
                func.count(UserPick.id).label("pick_count"),
            )
            .where(UserPick.match_id.in_(match_ids))
            .group_by(UserPick.match_id, UserPick.predicted_home_score, UserPick.predicted_away_score)
            .order_by(UserPick.match_id.asc(), func.count(UserPick.id).desc(), UserPick.predicted_home_score.asc(), UserPick.predicted_away_score.asc())
        ).all()
        for match_id, home_score, away_score, count in score_rows:
            if match_id in score_counts:
                score_counts[match_id].append((int(home_score), int(away_score), int(count)))

        rows: list[QuinielaPlusUserDistributionMatchOut] = []
        for match, matchday in match_rows:
            home_team = db.get(Team, match.home_team_id)
            away_team = db.get(Team, match.away_team_id)
            counts = selection_counts[match.id]
            total_picks = counts[PickSelection.HOME] + counts[PickSelection.DRAW] + counts[PickSelection.AWAY]
            if total_picks <= 0:
                continue

            rows.append(
                QuinielaPlusUserDistributionMatchOut(
                    match_id=match.id,
                    matchday_id=match.matchday_id,
                    matchday_number=matchday.number,
                    matchday_name=matchday.name,
                    home_team_name=home_team.name if home_team is not None else match.home_placeholder or "Local",
                    home_team_short_name=home_team.short_name if home_team is not None else "LOC",
                    home_team_crest_url=home_team.crest_url if home_team is not None else None,
                    away_team_name=away_team.name if away_team is not None else match.away_placeholder or "Visitante",
                    away_team_short_name=away_team.short_name if away_team is not None else "VIS",
                    away_team_crest_url=away_team.crest_url if away_team is not None else None,
                    kickoff_at=ensure_utc(match.kickoff_at),
                    is_locked=ensure_utc(match.picks_lock_at) <= now,
                    total_picks=total_picks,
                    selection_distribution=QuinielaPlusUserSelectionDistributionOut(
                        home_count=counts[PickSelection.HOME],
                        draw_count=counts[PickSelection.DRAW],
                        away_count=counts[PickSelection.AWAY],
                        home_percentage=counts[PickSelection.HOME] / total_picks,
                        draw_percentage=counts[PickSelection.DRAW] / total_picks,
                        away_percentage=counts[PickSelection.AWAY] / total_picks,
                    ),
                    score_distribution=[
                        QuinielaPlusScoreDistributionOut(
                            score_label=f"{home_score}-{away_score}",
                            home_score=home_score,
                            away_score=away_score,
                            count=count,
                            percentage=count / total_picks,
                        )
                        for home_score, away_score, count in score_counts[match.id][:6]
                    ],
                )
            )

        return QuinielaPlusUserDistributionOut(matches=rows)

    def get_advanced_stats(self, db: Session | None = None) -> QuinielaPlusAdvancedStatsOut:
        if db is not None:
            try:
                snapshot = db.scalar(
                    select(QuinielaPlusStatsSnapshot).order_by(
                        QuinielaPlusStatsSnapshot.created_at.desc()
                    )
                )
                if snapshot is not None:
                    rows = list(
                        db.scalars(
                            select(QuinielaPlusStatsMatch)
                            .where(QuinielaPlusStatsMatch.snapshot_id == snapshot.id)
                            .order_by(QuinielaPlusStatsMatch.kickoff_at.asc())
                        )
                    )
                    matches: list[QuinielaPlusAdvancedStatsMatchOut] = []
                    for row in rows:
                        normalized = dict(row.payload_json or {})
                        normalized["fixture_id"] = str(normalized.get("fixture_id") or row.fixture_id or "")
                        if not normalized["fixture_id"]:
                            continue
                        matches.append(QuinielaPlusAdvancedStatsMatchOut.model_validate(normalized))
                    return QuinielaPlusAdvancedStatsOut(
                        generated_at=snapshot.generated_at or snapshot.created_at,
                        matches=matches,
                    )
            except SQLAlchemyError:
                db.rollback()

        if not ADVANCED_STATS_PATH.exists():
            return QuinielaPlusAdvancedStatsOut()

        with ADVANCED_STATS_PATH.open(encoding="utf-8") as file:
            payload = json.load(file)

        matches: list[QuinielaPlusAdvancedStatsMatchOut] = []
        for row in payload.get("fixtures", []):
            if not isinstance(row, dict):
                continue
            normalized = dict(row)
            normalized["fixture_id"] = str(normalized.get("fixture_id") or "")
            if not normalized["fixture_id"]:
                continue
            matches.append(QuinielaPlusAdvancedStatsMatchOut.model_validate(normalized))

        matches.sort(key=lambda match: match.kickoff_at)
        return QuinielaPlusAdvancedStatsOut(
            generated_at=payload.get("generated_at"),
            matches=matches,
        )

    def get_value_lab(self, db: Session, limit: int = 100) -> QuinielaPlusValueLabOut:
        try:
            snapshot = db.scalar(
                select(QuinielaPlusStatsSnapshot).order_by(
                    QuinielaPlusStatsSnapshot.created_at.desc()
                )
            )
            if snapshot is None:
                return QuinielaPlusValueLabOut()

            rows = db.execute(
                select(QuinielaPlusValueRecommendation, QuinielaPlusStatsMatch, MatchResult)
                .join(
                    QuinielaPlusStatsMatch,
                    QuinielaPlusStatsMatch.id == QuinielaPlusValueRecommendation.stats_match_id,
                )
                .outerjoin(MatchResult, MatchResult.match_id == QuinielaPlusValueRecommendation.match_id)
                .where(QuinielaPlusValueRecommendation.snapshot_id == snapshot.id)
                .order_by(
                    QuinielaPlusValueRecommendation.edge_probability.desc().nullslast(),
                    QuinielaPlusValueRecommendation.created_at.desc(),
                )
                .limit(max(1, min(limit, 100)))
            ).all()

            recommendations = [
                QuinielaPlusValueRecommendationOut(
                    id=recommendation.id,
                    fixture_id=recommendation.fixture_id,
                    kickoff_at=stats_match.kickoff_at,
                    home=stats_match.home_name,
                    away=stats_match.away_name,
                    market_key=recommendation.market_key,
                    selection_key=recommendation.selection_key,
                    line_value=float(recommendation.line_value) if recommendation.line_value is not None else None,
                    model_probability=(
                        float(recommendation.model_probability)
                        if recommendation.model_probability is not None
                        else None
                    ),
                    market_probability=(
                        float(recommendation.market_probability)
                        if recommendation.market_probability is not None
                        else None
                    ),
                    market_odds=float(recommendation.market_odds) if recommendation.market_odds is not None else None,
                    fair_odds_decimal=(
                        float(recommendation.fair_odds_decimal)
                        if recommendation.fair_odds_decimal is not None
                        else None
                    ),
                    edge_probability=(
                        float(recommendation.edge_probability)
                        if recommendation.edge_probability is not None
                        else None
                    ),
                    **self._build_value_outcome(recommendation, result),
                    confidence_label=recommendation.confidence_label,
                    recommendation=recommendation.recommendation,
                    reason=self._display_value_reason(recommendation.reason),
                    created_at=recommendation.created_at,
                )
                for recommendation, stats_match, result in rows
            ]
            return QuinielaPlusValueLabOut(
                generated_at=snapshot.generated_at or snapshot.created_at,
                recommendations=recommendations,
            )
        except SQLAlchemyError:
            db.rollback()
            return QuinielaPlusValueLabOut()

    @staticmethod
    def _display_value_reason(reason: str | None) -> str | None:
        if reason is None:
            return None
        return reason.replace("Football-MD", "AI Quinielón").replace("AI Quinielon", "AI Quinielón")

    def _build_value_outcome(
        self,
        recommendation: QuinielaPlusValueRecommendation,
        result: MatchResult | None,
    ) -> dict[str, object]:
        if result is None or not result.is_official:
            return {
                "outcome_status": "pending",
                "is_hit": None,
                "result_label": None,
                "profit_units": None,
            }

        home_score = int(result.home_score)
        away_score = int(result.away_score)
        is_hit: bool | None = None
        is_push = False

        if recommendation.market_key == "h2h":
            if home_score > away_score:
                actual = "home"
            elif away_score > home_score:
                actual = "away"
            else:
                actual = "draw"
            is_hit = recommendation.selection_key == actual
        elif recommendation.market_key == "total" and recommendation.line_value is not None:
            total_goals = Decimal(home_score + away_score)
            if total_goals == recommendation.line_value:
                is_push = True
            elif recommendation.selection_key == "over":
                is_hit = total_goals > recommendation.line_value
            elif recommendation.selection_key == "under":
                is_hit = total_goals < recommendation.line_value
        elif recommendation.market_key == "btts_model":
            actual = "yes" if home_score > 0 and away_score > 0 else "no"
            is_hit = recommendation.selection_key == actual

        if is_push:
            status = "push"
            profit_units = 0.0
        else:
            status = "settled"
            profit_units = self._profit_units(recommendation.market_odds, is_hit)

        return {
            "outcome_status": status,
            "is_hit": is_hit,
            "result_label": f"{home_score}-{away_score}",
            "profit_units": profit_units,
        }

    @staticmethod
    def _profit_units(market_odds: Decimal | None, is_hit: bool | None) -> float | None:
        if is_hit is None:
            return None
        if not is_hit:
            return -1.0
        if market_odds is None:
            return None
        if market_odds > 0:
            return float(market_odds / Decimal("100"))
        if market_odds < 0:
            return float(Decimal("100") / abs(market_odds))
        return None

    def get_admin_console(self, db: Session) -> QuinielaPlusAdminConsoleResponse:
        settings = self._get_or_create_settings(db)
        leagues = list(
            db.scalars(
                select(QuinielaPlusLeague).order_by(
                    QuinielaPlusLeague.sort_order.asc(),
                    QuinielaPlusLeague.league_name.asc(),
                )
            )
        )
        plans = list(
            db.scalars(
                select(QuinielaPlusPlan).order_by(
                    QuinielaPlusPlan.sort_order.asc(),
                    QuinielaPlusPlan.billing_period.asc(),
                    QuinielaPlusPlan.price_amount.asc(),
                )
            )
        )
        return QuinielaPlusAdminConsoleResponse(
            settings=self._to_settings_out(settings),
            leagues=[self._to_league_out(row) for row in leagues],
            plans=[self._to_plan_out(row) for row in plans],
        )

    def update_settings(
        self,
        db: Session,
        payload: QuinielaPlusAdminSettingsUpdateRequest,
    ) -> QuinielaPlusAdminSettingsOut:
        row = self._get_or_create_settings(db)
        row.quiniela_plus_checkout_enabled = payload.checkout_enabled
        row.quiniela_plus_checkout_message = self._normalize_optional_text(payload.checkout_message)
        db.add(row)
        db.commit()
        db.refresh(row)
        return self._to_settings_out(row)

    def create_league(self, db: Session, payload: QuinielaPlusLeagueUpsertRequest) -> QuinielaPlusLeagueOut:
        normalized_slug = self._normalize_slug(payload.slug)
        existing = db.scalar(select(QuinielaPlusLeague).where(QuinielaPlusLeague.slug == normalized_slug))
        if existing is not None:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Ya existe una liga con ese slug")
        row = QuinielaPlusLeague(
            sport_name=payload.sport_name.strip(),
            league_name=payload.league_name.strip(),
            slug=normalized_slug,
            is_active=payload.is_active,
            sort_order=payload.sort_order,
        )
        db.add(row)
        db.commit()
        db.refresh(row)
        return self._to_league_out(row)

    def update_league(
        self,
        db: Session,
        league_id: str,
        payload: QuinielaPlusLeagueUpsertRequest,
    ) -> QuinielaPlusLeagueOut:
        row = db.get(QuinielaPlusLeague, league_id)
        if row is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Liga de Quiniela + no encontrada")
        normalized_slug = self._normalize_slug(payload.slug)
        existing = db.scalar(
            select(QuinielaPlusLeague).where(
                QuinielaPlusLeague.slug == normalized_slug,
                QuinielaPlusLeague.id != league_id,
            )
        )
        if existing is not None:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Ya existe otra liga con ese slug")
        row.sport_name = payload.sport_name.strip()
        row.league_name = payload.league_name.strip()
        row.slug = normalized_slug
        row.is_active = payload.is_active
        row.sort_order = payload.sort_order
        db.add(row)
        db.commit()
        db.refresh(row)
        return self._to_league_out(row)

    def create_plan(
        self,
        db: Session,
        payload: QuinielaPlusPlanUpsertRequest,
        current_profile: Profile,
    ) -> QuinielaPlusPlanOut:
        self._ensure_plan_combo_available(db, payload)
        row = QuinielaPlusPlan(
            name=payload.name.strip(),
            billing_period=QuinielaPlusBillingPeriod(payload.billing_period),
            included_leagues_count=None if payload.includes_all_leagues else payload.included_leagues_count,
            includes_all_leagues=payload.includes_all_leagues,
            price_amount=Decimal(str(payload.price_amount)),
            currency=payload.currency.strip().lower(),
            is_active=payload.is_active,
            sort_order=payload.sort_order,
            created_by_profile_id=current_profile.id,
        )
        db.add(row)
        db.commit()
        db.refresh(row)
        return self._to_plan_out(row)

    def update_plan(
        self,
        db: Session,
        plan_id: str,
        payload: QuinielaPlusPlanUpsertRequest,
    ) -> QuinielaPlusPlanOut:
        row = db.get(QuinielaPlusPlan, plan_id)
        if row is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Plan de Quiniela + no encontrado")
        self._ensure_plan_combo_available(db, payload, exclude_plan_id=plan_id)
        row.name = payload.name.strip()
        row.billing_period = QuinielaPlusBillingPeriod(payload.billing_period)
        row.included_leagues_count = None if payload.includes_all_leagues else payload.included_leagues_count
        row.includes_all_leagues = payload.includes_all_leagues
        row.price_amount = Decimal(str(payload.price_amount))
        row.currency = payload.currency.strip().lower()
        row.is_active = payload.is_active
        row.sort_order = payload.sort_order
        db.add(row)
        db.commit()
        db.refresh(row)
        return self._to_plan_out(row)

    def list_memberships(self, db: Session, profile: Profile) -> list[QuinielaPlusMembershipOut]:
        self._refresh_expired_memberships(db, profile.id)
        return self._list_memberships(db, profile.id, only_active=False)

    def validate_checkout(
        self,
        db: Session,
        profile: Profile,
        plan_id: str,
        selected_league_ids: list[str],
        *,
        require_checkout_enabled: bool = True,
    ) -> tuple[QuinielaPlusPlan, list[QuinielaPlusLeague], QuinielaPlusAdminSettingsOut]:
        self._refresh_expired_memberships(db, profile.id)
        settings = self._to_settings_out(self._get_or_create_settings(db))
        if require_checkout_enabled and not settings.checkout_enabled:
            detail = settings.checkout_message or "Quiniela + todavia no esta habilitada para cobro"
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=detail)

        plan = db.get(QuinielaPlusPlan, plan_id)
        if plan is None or not plan.is_active:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Plan de Quiniela + no disponible")

        active_memberships = self._list_membership_rows(db, profile.id, only_active=True)
        if active_memberships:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Ya tienes una membresia activa de Quiniela +",
            )

        leagues = self._resolve_checkout_leagues(db, plan, selected_league_ids)
        return plan, leagues, settings

    def apply_paid_membership(
        self,
        db: Session,
        *,
        payment: Payment,
        selected_league_ids: list[str],
    ) -> QuinielaPlusMembership:
        existing = db.scalar(
            select(QuinielaPlusMembership).where(QuinielaPlusMembership.source_payment_id == payment.id)
        )
        if existing is not None:
            return existing

        plan = db.get(QuinielaPlusPlan, payment.scope_id)
        if plan is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Plan de Quiniela + no encontrado")

        leagues = self._resolve_checkout_leagues(db, plan, selected_league_ids)
        starts_at = payment.paid_at or datetime.now(UTC)
        membership = QuinielaPlusMembership(
            profile_id=payment.profile_id,
            plan_id=plan.id,
            source_payment_id=payment.id,
            status=QuinielaPlusMembershipStatus.ACTIVE,
            starts_at=starts_at,
            ends_at=self._calculate_end_at(starts_at, plan.billing_period),
        )
        db.add(membership)
        db.flush()

        for league in leagues:
            db.add(
                QuinielaPlusMembershipLeague(
                    membership_id=membership.id,
                    league_id=league.id,
                )
            )
        db.add(membership)
        return membership

    def _resolve_checkout_leagues(
        self,
        db: Session,
        plan: QuinielaPlusPlan,
        selected_league_ids: list[str],
    ) -> list[QuinielaPlusLeague]:
        active_leagues = list(
            db.scalars(
                select(QuinielaPlusLeague)
                .where(QuinielaPlusLeague.is_active.is_(True))
                .order_by(QuinielaPlusLeague.sort_order.asc(), QuinielaPlusLeague.league_name.asc())
            )
        )
        if not active_leagues:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Primero activa al menos una liga en Quiniela +",
            )

        if plan.includes_all_leagues:
            return active_leagues

        normalized_ids = list(dict.fromkeys(selected_league_ids))
        required_count = plan.included_leagues_count or 0
        if len(normalized_ids) != required_count:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Debes seleccionar exactamente {required_count} ligas para este plan",
            )

        active_by_id = {league.id: league for league in active_leagues}
        missing_ids = [league_id for league_id in normalized_ids if league_id not in active_by_id]
        if missing_ids:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="La seleccion incluye ligas no disponibles en Quiniela +",
            )
        return [active_by_id[league_id] for league_id in normalized_ids]

    def _refresh_expired_memberships(self, db: Session, profile_id: str | None = None) -> None:
        now = datetime.now(UTC)
        query = select(QuinielaPlusMembership).where(
            QuinielaPlusMembership.status == QuinielaPlusMembershipStatus.ACTIVE,
            QuinielaPlusMembership.ends_at < now,
        )
        if profile_id is not None:
            query = query.where(QuinielaPlusMembership.profile_id == profile_id)
        rows = list(db.scalars(query))
        if not rows:
            return
        for row in rows:
            row.status = QuinielaPlusMembershipStatus.EXPIRED
            db.add(row)
        db.commit()

    def _list_memberships(
        self,
        db: Session,
        profile_id: str,
        *,
        only_active: bool,
    ) -> list[QuinielaPlusMembershipOut]:
        memberships = self._list_membership_rows(db, profile_id, only_active=only_active)
        if not memberships:
            return []

        plan_ids = {membership.plan_id for membership in memberships}
        plans = {
            row.id: row
            for row in db.scalars(select(QuinielaPlusPlan).where(QuinielaPlusPlan.id.in_(plan_ids)))
        }
        links = list(
            db.scalars(
                select(QuinielaPlusMembershipLeague).where(
                    QuinielaPlusMembershipLeague.membership_id.in_([row.id for row in memberships])
                )
            )
        )
        league_ids = {link.league_id for link in links}
        leagues_by_id = {
            row.id: row
            for row in db.scalars(select(QuinielaPlusLeague).where(QuinielaPlusLeague.id.in_(league_ids)))
        }
        leagues_by_membership: dict[str, list[QuinielaPlusMembershipLeagueOut]] = {}
        for link in links:
            league = leagues_by_id.get(link.league_id)
            if league is None:
                continue
            leagues_by_membership.setdefault(link.membership_id, []).append(
                QuinielaPlusMembershipLeagueOut(
                    id=league.id,
                    sport_name=league.sport_name,
                    league_name=league.league_name,
                    slug=league.slug,
                )
            )

        result: list[QuinielaPlusMembershipOut] = []
        for membership in memberships:
            plan = plans.get(membership.plan_id)
            if plan is None:
                continue
            membership_leagues = leagues_by_membership.get(membership.id, [])
            membership_leagues.sort(key=lambda league: (league.sport_name.lower(), league.league_name.lower()))
            result.append(
                QuinielaPlusMembershipOut(
                    id=membership.id,
                    status=membership.status.value,
                    starts_at=membership.starts_at,
                    ends_at=membership.ends_at,
                    created_at=membership.created_at,
                    plan=self._to_plan_out(plan),
                    leagues=membership_leagues,
                )
            )
        return result

    def _list_membership_rows(
        self,
        db: Session,
        profile_id: str,
        *,
        only_active: bool,
    ) -> list[QuinielaPlusMembership]:
        query = (
            select(QuinielaPlusMembership)
            .where(QuinielaPlusMembership.profile_id == profile_id)
            .order_by(QuinielaPlusMembership.ends_at.desc(), QuinielaPlusMembership.created_at.desc())
        )
        if only_active:
            query = query.where(QuinielaPlusMembership.status == QuinielaPlusMembershipStatus.ACTIVE)
        return list(db.scalars(query))

    def _build_devigged_probabilities(
        self,
        odds: Odds | None,
    ) -> tuple[float | None, float | None, float | None]:
        if (
            odds is None
            or odds.home_value is None
            or odds.draw_value is None
            or odds.away_value is None
        ):
            return None, None, None

        raw_home = self._odds_to_implied_probability(odds.home_value)
        raw_draw = self._odds_to_implied_probability(odds.draw_value)
        raw_away = self._odds_to_implied_probability(odds.away_value)
        if raw_home is None or raw_draw is None or raw_away is None:
            return None, None, None

        total = raw_home + raw_draw + raw_away
        if total <= 0:
            return None, None, None

        return float(raw_home / total), float(raw_draw / total), float(raw_away / total)

    def _odds_to_implied_probability(self, value: Decimal | None) -> Decimal | None:
        if value is None:
            return None
        if value >= Decimal("100"):
            return Decimal("100") / (value + Decimal("100"))
        if value <= Decimal("-100"):
            absolute_value = abs(value)
            return absolute_value / (absolute_value + Decimal("100"))
        if value > Decimal("1"):
            return Decimal("1") / value
        return None

    def _ensure_plan_combo_available(
        self,
        db: Session,
        payload: QuinielaPlusPlanUpsertRequest,
        *,
        exclude_plan_id: str | None = None,
    ) -> None:
        rows = list(
            db.scalars(
                select(QuinielaPlusPlan).where(
                    QuinielaPlusPlan.billing_period == QuinielaPlusBillingPeriod(payload.billing_period)
                )
            )
        )
        for row in rows:
            if exclude_plan_id and row.id == exclude_plan_id:
                continue
            same_bundle = (
                row.includes_all_leagues == payload.includes_all_leagues
                and row.included_leagues_count == (
                    None if payload.includes_all_leagues else payload.included_leagues_count
                )
            )
            if same_bundle:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="Ya existe un plan con ese periodo y bundle",
                )

    def _get_or_create_settings(self, db: Session) -> CommerceSettings:
        row = db.scalar(select(CommerceSettings).order_by(CommerceSettings.created_at.asc()))
        if row is not None:
            return row
        row = CommerceSettings(
            quiniela_plus_checkout_enabled=False,
            quiniela_plus_checkout_message=(
                "Quiniela + ya esta montada, pero el checkout sigue deshabilitado mientras se cierra el tema fiscal."
            ),
        )
        db.add(row)
        db.commit()
        db.refresh(row)
        return row

    def _calculate_end_at(
        self,
        starts_at: datetime,
        billing_period: QuinielaPlusBillingPeriod,
    ) -> datetime:
        if billing_period == QuinielaPlusBillingPeriod.WEEKLY:
            return starts_at + timedelta(days=7)
        months_to_add = {
            QuinielaPlusBillingPeriod.MONTHLY: 1,
            QuinielaPlusBillingPeriod.QUARTERLY: 3,
            QuinielaPlusBillingPeriod.SEMIANNUAL: 6,
            QuinielaPlusBillingPeriod.ANNUAL: 12,
        }[billing_period]
        return self._add_months(starts_at, months_to_add)

    def _add_months(self, value: datetime, months_to_add: int) -> datetime:
        month_index = value.month - 1 + months_to_add
        year = value.year + month_index // 12
        month = month_index % 12 + 1
        day = min(value.day, monthrange(year, month)[1])
        return value.replace(year=year, month=month, day=day)

    def _normalize_optional_text(self, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip()
        return normalized or None

    def _normalize_slug(self, value: str) -> str:
        normalized = value.strip().lower().replace(" ", "-")
        if not normalized:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="El slug no puede quedar vacio")
        return normalized

    def _to_settings_out(self, row: CommerceSettings) -> QuinielaPlusAdminSettingsOut:
        return QuinielaPlusAdminSettingsOut(
            checkout_enabled=row.quiniela_plus_checkout_enabled,
            checkout_message=row.quiniela_plus_checkout_message,
        )

    def _to_league_out(self, row: QuinielaPlusLeague) -> QuinielaPlusLeagueOut:
        return QuinielaPlusLeagueOut(
            id=row.id,
            sport_name=row.sport_name,
            league_name=row.league_name,
            slug=row.slug,
            is_active=row.is_active,
            sort_order=row.sort_order,
            created_at=row.created_at,
            updated_at=row.updated_at,
        )

    def _to_plan_out(self, row: QuinielaPlusPlan) -> QuinielaPlusPlanOut:
        return QuinielaPlusPlanOut(
            id=row.id,
            name=row.name,
            billing_period=row.billing_period.value,
            included_leagues_count=row.included_leagues_count,
            includes_all_leagues=row.includes_all_leagues,
            price_amount=float(row.price_amount),
            currency=row.currency,
            is_active=row.is_active,
            sort_order=row.sort_order,
            created_by_profile_id=row.created_by_profile_id,
            created_at=row.created_at,
            updated_at=row.updated_at,
        )
