from calendar import monthrange
from datetime import UTC, datetime, timedelta
from decimal import Decimal

from fastapi import HTTPException, status
from sqlalchemy import func, select, text
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
    RoleCode,
    Season,
    SeasonMembership,
    Team,
    TournamentFormat,
    UserPick,
    VipCompetition,
    VipCompetitionKind,
    VipCompetitionMatchday,
    VipMembership,
    VipMembershipStatus,
)
from app.models.quiniela_plus_value import (
    QuinielaPlusStatsMatch,
    QuinielaPlusStatsSnapshot,
    QuinielaPlusValueRecommendation,
)
from app.repositories.odds_repository import OddsRepository
from app.services.season_eligibility_service import SeasonEligibilityService
from app.services.quiniela_plus_value_schema import ensure_quiniela_plus_value_tables
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
    QuinielaPlusValueTrackStatsOut,
)

KELLY_BANKROLL_UNITS = Decimal("20")
KELLY_FRACTION = Decimal("0.25")
KELLY_MAX_UNITS = Decimal("1.5")
KELLY_ROUNDING_UNIT = Decimal("0.25")
STRATEGY_RULES = {
    "ml_favorite": {
        "label": "ML favorito",
        "min_edge": Decimal("0.055"),
        "min_model_probability": Decimal("0.52"),
        "max_units": Decimal("1.0"),
    },
    "ml_pickem": {
        "label": "ML parejo",
        "min_edge": Decimal("0.065"),
        "min_model_probability": Decimal("0.44"),
        "max_units": Decimal("1.0"),
    },
    "ml_dog": {
        "label": "ML perro",
        "min_edge": Decimal("0.08"),
        "min_model_probability": Decimal("0.30"),
        "max_units": Decimal("0.75"),
    },
    "ml_longshot": {
        "label": "ML longshot",
        "min_edge": Decimal("0.12"),
        "min_model_probability": Decimal("0.22"),
        "max_units": Decimal("0.25"),
    },
    "draw": {
        "label": "Empate",
        "min_edge": Decimal("0.09"),
        "min_model_probability": Decimal("0.24"),
        "max_units": Decimal("0.5"),
    },
    "total": {
        "label": "Total",
        "min_edge": Decimal("0.07"),
        "min_model_probability": Decimal("0.54"),
        "max_units": Decimal("1.0"),
    },
}


class QuinielaPlusService:
    def __init__(self) -> None:
        self.odds_repo = OddsRepository()
        self.season_eligibility_service = SeasonEligibilityService()

    def _ensure_value_tables(self, db: Session) -> None:
        ensure_quiniela_plus_value_tables(db)
        db.commit()

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

    def get_user_distribution(
        self,
        db: Session,
        current_profile: Profile,
        context_type: str | None = None,
        context_id: str | None = None,
        limit: int | None = None,
    ) -> QuinielaPlusUserDistributionOut:
        now = datetime.now(UTC)
        is_admin = current_profile.role_code in {RoleCode.ADMIN, RoleCode.MASTER_ADMIN}
        title = "Distribucion de usuarios"
        participant_profile_ids: list[str] | None = None
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

        if context_type == "season" and context_id:
            season = db.get(Season, context_id)
            if season is None:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Temporada no encontrada")

            memberships = list(
                db.scalars(select(SeasonMembership).where(SeasonMembership.season_id == season.id))
            )
            has_access = any(
                membership.profile_id == current_profile.id
                and self.season_eligibility_service.can_participate(db, season, membership)
                for membership in memberships
            )
            if not has_access and not is_admin:
                raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="No tienes acceso a este contexto")

            participant_profile_ids = [
                membership.profile_id
                for membership in memberships
                if self.season_eligibility_service.can_participate(db, season, membership)
            ]
            title = f"Distribucion de usuarios · {season.name}"
            match_query = match_query.where(Matchday.season_id == season.id)
        elif context_type == "vip" and context_id:
            vip = db.get(VipCompetition, context_id)
            if vip is None:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="VIP no encontrada")

            membership = db.scalar(
                select(VipMembership).where(
                    VipMembership.vip_competition_id == vip.id,
                    VipMembership.profile_id == current_profile.id,
                    VipMembership.status == VipMembershipStatus.APPROVED,
                )
            )
            if membership is None and not is_admin:
                raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="No tienes acceso a este contexto")

            title = f"Distribucion de usuarios · {vip.name}"
            if vip.competition_kind != VipCompetitionKind.MATCHDAY:
                return QuinielaPlusUserDistributionOut(title=title, matches=[])

            participant_profile_ids = list(
                db.scalars(
                    select(VipMembership.profile_id).where(
                        VipMembership.vip_competition_id == vip.id,
                        VipMembership.status == VipMembershipStatus.APPROVED,
                    )
                )
            )
            vip_matchday_ids = list(
                db.scalars(
                    select(VipCompetitionMatchday.matchday_id).where(
                        VipCompetitionMatchday.vip_competition_id == vip.id,
                    )
                )
            )
            if not vip_matchday_ids:
                return QuinielaPlusUserDistributionOut(title=title, matches=[])
            match_query = match_query.where(Match.matchday_id.in_(vip_matchday_ids))

        if limit is not None:
            match_query = match_query.limit(limit)
        match_rows = db.execute(match_query).all()

        match_ids = [match.id for match, _ in match_rows]
        if not match_ids:
            return QuinielaPlusUserDistributionOut(title=title)

        selection_counts: dict[str, dict[PickSelection, int]] = {
            match_id: {
                PickSelection.HOME: 0,
                PickSelection.DRAW: 0,
                PickSelection.AWAY: 0,
            }
            for match_id in match_ids
        }
        score_counts: dict[str, list[tuple[int, int, int]]] = {match_id: [] for match_id in match_ids}

        selection_query = (
            select(UserPick.match_id, UserPick.selection, func.count(UserPick.id))
            .where(UserPick.match_id.in_(match_ids))
            .group_by(UserPick.match_id, UserPick.selection)
        )
        if participant_profile_ids is not None:
            if not participant_profile_ids:
                return QuinielaPlusUserDistributionOut(title=title)
            selection_query = selection_query.where(UserPick.profile_id.in_(participant_profile_ids))
        selection_rows = db.execute(selection_query).all()
        for match_id, selection, count in selection_rows:
            if match_id in selection_counts:
                selection_counts[match_id][selection] = int(count)

        score_query = (
            select(
                UserPick.match_id,
                UserPick.predicted_home_score,
                UserPick.predicted_away_score,
                func.count(UserPick.id).label("pick_count"),
            )
            .where(UserPick.match_id.in_(match_ids))
            .group_by(UserPick.match_id, UserPick.predicted_home_score, UserPick.predicted_away_score)
            .order_by(UserPick.match_id.asc(), func.count(UserPick.id).desc(), UserPick.predicted_home_score.asc(), UserPick.predicted_away_score.asc())
        )
        if participant_profile_ids is not None:
            score_query = score_query.where(UserPick.profile_id.in_(participant_profile_ids))
        score_rows = db.execute(score_query).all()
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

        return QuinielaPlusUserDistributionOut(title=title, matches=rows)

    def get_advanced_stats(self, db: Session | None = None) -> QuinielaPlusAdvancedStatsOut:
        if db is not None:
            try:
                self._ensure_value_tables(db)
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
        return QuinielaPlusAdvancedStatsOut()

    def get_value_lab(self, db: Session, limit: int = 100) -> QuinielaPlusValueLabOut:
        try:
            self._ensure_value_tables(db)
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

            recommendations: list[QuinielaPlusValueRecommendationOut] = []
            for recommendation, stats_match, result in rows:
                strategy = self._build_stake_strategy(recommendation)
                recommendations.append(
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
                    **strategy,
                    **self._build_value_outcome(recommendation, result, strategy["suggested_units"]),
                    confidence_label=recommendation.confidence_label,
                    recommendation=recommendation.recommendation,
                    reason=self._display_value_reason(recommendation.reason),
                    created_at=recommendation.created_at,
                    )
                )
            self._select_strategy_entries(recommendations)
            retro_cards = self._build_retro_history_cards(db, snapshot.id, 50)
            all_recommendations = [*recommendations, *retro_cards]
            self._apply_backtested_strategy_guards(db, all_recommendations)
            self._apply_historical_guards(all_recommendations)
            return QuinielaPlusValueLabOut(
                generated_at=snapshot.generated_at or snapshot.created_at,
                track_stats=[
                    self._build_track_stats(
                        "Live",
                        [item for item in all_recommendations if item.recommendation != "retro_market"],
                    ),
                    self._build_track_stats("Retro", retro_cards),
                    self._build_track_stats("Total", all_recommendations),
                    self._build_track_stats(
                        "ML",
                        [
                            item
                            for item in all_recommendations
                            if item.market_key == "h2h" and item.selection_key != "draw"
                        ],
                    ),
                    self._build_track_stats(
                        "Empate",
                        [
                            item
                            for item in all_recommendations
                            if item.market_key == "h2h" and item.selection_key == "draw"
                        ],
                    ),
                    self._build_track_stats(
                        "Over",
                        [
                            item
                            for item in all_recommendations
                            if item.market_key == "total" and item.selection_key == "over"
                        ],
                    ),
                    self._build_track_stats(
                        "Under",
                        [
                            item
                            for item in all_recommendations
                            if item.market_key == "total" and item.selection_key == "under"
                        ],
                    ),
                    self._build_track_stats(
                        "BTTS",
                        [item for item in all_recommendations if item.market_key == "btts_model"],
                    ),
                    self._build_track_stats(
                        "Favoritos",
                        [
                            item
                            for item in all_recommendations
                            if item.market_odds is not None and item.market_odds <= -120
                        ],
                    ),
                    self._build_track_stats(
                        "+100 a +300",
                        [
                            item
                            for item in all_recommendations
                            if item.market_odds is not None and 100 <= item.market_odds <= 300
                        ],
                    ),
                    self._build_track_stats(
                        "+301+",
                        [
                            item
                            for item in all_recommendations
                            if item.market_odds is not None and item.market_odds > 300
                        ],
                    ),
                ],
                recommendations=all_recommendations,
            )
        except SQLAlchemyError:
            db.rollback()
            return QuinielaPlusValueLabOut()

    def _build_track_stats(
        self,
        label: str,
        recommendations: list[QuinielaPlusValueRecommendationOut],
    ) -> QuinielaPlusValueTrackStatsOut:
        open_count = sum(
            1
            for item in recommendations
            if item.outcome_status == "pending" and item.suggested_units > 0
        )
        settled = [
            item
            for item in recommendations
            if item.outcome_status in {"settled", "push"}
            and item.profit_units is not None
            and item.suggested_units > 0
        ]
        wins = sum(1 for item in settled if item.is_hit is True)
        losses = sum(1 for item in settled if item.is_hit is False and item.outcome_status != "push")
        pushes = sum(1 for item in settled if item.outcome_status == "push")
        staked_units = float(sum(item.suggested_units for item in settled))
        profit_units = float(sum(item.profit_units or 0 for item in settled))
        decisions = wins + losses
        return QuinielaPlusValueTrackStatsOut(
            label=label,
            total=len(recommendations),
            open=open_count,
            wins=wins,
            losses=losses,
            pushes=pushes,
            tracked_bets=len(settled),
            staked_units=staked_units,
            profit_units=profit_units,
            hit_rate=(wins / decisions) if decisions > 0 else None,
            roi=(profit_units / staked_units) if staked_units > 0 else None,
        )

    def _select_strategy_entries(
        self,
        recommendations: list[QuinielaPlusValueRecommendationOut],
    ) -> None:
        grouped: dict[tuple[str, str], list[QuinielaPlusValueRecommendationOut]] = {}
        for item in recommendations:
            if item.recommendation == "retro_market" or item.market_key == "btts_model":
                continue
            if item.suggested_units <= 0 or item.edge_probability is None:
                continue
            grouped.setdefault((item.fixture_id, item.market_key), []).append(item)

        for candidates in grouped.values():
            if len(candidates) <= 1:
                continue
            selected = max(candidates, key=lambda item: item.edge_probability or 0)
            for item in candidates:
                if item.id == selected.id:
                    continue
                item.suggested_units = 0
                item.stake_bankroll_pct = 0
                item.strategy_label = "alternate"
                item.stake_reason = "No entrar: hay mejor edge en este partido y mercado."
                item.entry_grade = "avoid"
                item.profit_units = None

    def _apply_historical_guards(
        self,
        recommendations: list[QuinielaPlusValueRecommendationOut],
    ) -> None:
        grouped: dict[str, list[QuinielaPlusValueRecommendationOut]] = {}
        for item in recommendations:
            group_key = self._strategy_history_group(item)
            if group_key is None:
                continue
            grouped.setdefault(group_key, []).append(item)

        blocked_groups: dict[str, tuple[int, float]] = {}
        for group_key, items in grouped.items():
            settled = [
                item
                for item in items
                if item.outcome_status in {"settled", "push"}
                and item.profit_units is not None
                and item.suggested_units > 0
            ]
            staked_units = sum(item.suggested_units for item in settled)
            if len(settled) < 5 or staked_units <= 0:
                continue
            profit_units = sum(item.profit_units or 0 for item in settled)
            roi = profit_units / staked_units
            if roi < -0.05:
                blocked_groups[group_key] = (len(settled), roi)

        for item in recommendations:
            if item.outcome_status != "pending" or item.suggested_units <= 0:
                continue
            group_key = self._strategy_history_group(item)
            if group_key not in blocked_groups:
                continue
            tracked_bets, roi = blocked_groups[group_key]
            item.suggested_units = 0
            item.stake_bankroll_pct = 0
            item.strategy_label = "watch"
            item.entry_grade = "watch"
            item.stake_reason = (
                f"Watch por historico: {tracked_bets} bets del segmento con ROI {roi * 100:.1f}%. "
                "No entrar hasta que mejore la muestra."
            )

    def _apply_backtested_strategy_guards(
        self,
        db: Session,
        recommendations: list[QuinielaPlusValueRecommendationOut],
    ) -> None:
        profiles = self._load_backtested_strategy_profiles(db)
        for item in recommendations:
            if item.outcome_status != "pending" or item.suggested_units <= 0:
                continue
            profile_key = self._backtest_profile_key(item)
            profile = profiles.get(profile_key or "")
            if profile is None:
                item.suggested_units = 0
                item.stake_bankroll_pct = 0
                item.strategy_label = "watch"
                item.entry_grade = "watch"
                item.stake_reason = "Watch: este segmento no tiene backtest suficiente para meter dinero."
                continue

            total = int(profile["total"])
            roi = float(profile["roi"])
            profit_units = float(profile["profit_units"])
            if total < 5:
                item.suggested_units = 0
                item.stake_bankroll_pct = 0
                item.strategy_label = "watch"
                item.entry_grade = "watch"
                item.stake_reason = (
                    f"Watch: segmento con muestra chica ({total} bets, {profit_units:+.2f}u). "
                    "Esperar mas datos antes de stake real."
                )
                continue
            if roi <= 0:
                item.suggested_units = 0
                item.stake_bankroll_pct = 0
                item.strategy_label = "watch"
                item.entry_grade = "watch"
                item.stake_reason = (
                    f"Watch: backtest negativo/neutro en {total} bets "
                    f"({profit_units:+.2f}u, ROI {roi * 100:+.1f}%)."
                )
                continue
            if roi < 0.05:
                item.suggested_units = min(item.suggested_units, 0.25)
                item.stake_bankroll_pct = self._stake_bankroll_pct(item.suggested_units)
                item.strategy_label = "kelly_watch"
                item.stake_reason = (
                    f"Entrada chica: backtest apenas positivo en {total} bets "
                    f"({profit_units:+.2f}u, ROI {roi * 100:+.1f}%). "
                    f"{item.stake_reason or ''}"
                ).strip()
                continue
            item.stake_reason = (
                f"Backtest aprueba segmento: {total} bets, {profit_units:+.2f}u, "
                f"ROI {roi * 100:+.1f}%. {item.stake_reason or ''}"
            ).strip()

    def _load_backtested_strategy_profiles(self, db: Session) -> dict[str, dict[str, float | int]]:
        rows = db.execute(
            text(
                """
                select distinct on (m.id)
                  m.id as match_id,
                  mr.home_score,
                  mr.away_score,
                  o.home_value,
                  o.draw_value,
                  o.away_value
                from public.odds o
                join public.matches m on m.id = o.match_id
                join public.matchdays md on md.id = m.matchday_id
                join public.seasons s on s.id = md.season_id
                join public.match_results mr on mr.match_id = m.id and mr.is_official
                where s.tournament_format = 'world_cup'
                  and o.home_value is not null
                  and o.draw_value is not null
                  and o.away_value is not null
                order by m.id, o.synced_at desc
                """
            )
        ).mappings()
        profiles: dict[str, dict[str, float | int]] = {}
        for row in rows:
            if int(row["home_score"]) > int(row["away_score"]):
                actual = "home"
            elif int(row["away_score"]) > int(row["home_score"]):
                actual = "away"
            else:
                actual = "draw"
            odds_by_selection = {
                "home": row["home_value"],
                "draw": row["draw_value"],
                "away": row["away_value"],
            }
            for selection, odds in odds_by_selection.items():
                key = self._backtest_profile_key_from_parts("h2h", selection, odds)
                if key is None:
                    continue
                profit_units = self._flat_profit_units(odds, selection == actual)
                profile = profiles.setdefault(
                    key,
                    {"total": 0, "wins": 0, "profit_units": 0.0, "roi": 0.0},
                )
                profile["total"] = int(profile["total"]) + 1
                profile["wins"] = int(profile["wins"]) + int(selection == actual)
                profile["profit_units"] = float(profile["profit_units"]) + profit_units
        for profile in profiles.values():
            total = int(profile["total"])
            profile["roi"] = (float(profile["profit_units"]) / total) if total > 0 else 0.0
        return profiles

    def _backtest_profile_key(self, item: QuinielaPlusValueRecommendationOut) -> str | None:
        return self._backtest_profile_key_from_parts(item.market_key, item.selection_key, item.market_odds)

    def _backtest_profile_key_from_parts(
        self,
        market_key: str,
        selection_key: str,
        market_odds: Decimal | float | None,
    ) -> str | None:
        if market_key != "h2h" or market_odds is None:
            return None
        odds_decimal = Decimal(str(market_odds))
        if selection_key == "draw":
            return f"h2h_draw:{self._odds_bucket(odds_decimal)}"
        return f"h2h_ml:{self._odds_bucket(odds_decimal)}"

    @staticmethod
    def _flat_profit_units(market_odds: Decimal | float | None, is_hit: bool) -> float:
        if not is_hit:
            return -1.0
        if market_odds is None:
            return 0.0
        odds = Decimal(str(market_odds))
        if odds > 0:
            return float(odds / Decimal("100"))
        if odds < 0:
            return float(Decimal("100") / abs(odds))
        return 0.0

    def _strategy_history_group(self, item: QuinielaPlusValueRecommendationOut) -> str | None:
        if item.market_key == "h2h":
            if item.selection_key == "draw":
                return "h2h_draw"
            if item.market_odds is None:
                return "h2h_unknown"
            if item.market_odds <= -120:
                return "h2h_favorite"
            if item.market_odds < 100:
                return "h2h_pickem"
            if item.market_odds <= 300:
                return "h2h_dog"
            return "h2h_longshot"
        if item.market_key == "total":
            return f"total_{item.selection_key}"
        if item.market_key == "btts_model":
            return "btts_model"
        return None

    def _build_retro_history_cards(
        self,
        db: Session,
        latest_snapshot_id: str,
        limit: int,
    ) -> list[QuinielaPlusValueRecommendationOut]:
        if limit <= 0:
            return []

        rows = db.execute(
            text(
                """
                select distinct on (m.id)
                  o.id as odds_id,
                  m.id as match_id,
                  m.kickoff_at,
                  ht.name as home_name,
                  at.name as away_name,
                  mr.home_score,
                  mr.away_score,
                  o.home_value,
                  o.draw_value,
                  o.away_value,
                  o.synced_at
                from public.odds o
                join public.matches m on m.id = o.match_id
                join public.matchdays md on md.id = m.matchday_id
                join public.seasons s on s.id = md.season_id
                join public.teams ht on ht.id = m.home_team_id
                join public.teams at on at.id = m.away_team_id
                join public.match_results mr on mr.match_id = m.id and mr.is_official
                where s.tournament_format = 'world_cup'
                  and o.home_value is not null
                  and o.draw_value is not null
                  and o.away_value is not null
                  and not exists (
                    select 1
                    from public.quiniela_plus_value_recommendations qpr
                    where qpr.snapshot_id = :latest_snapshot_id
                      and qpr.match_id = m.id
                  )
                order by m.id, o.synced_at desc
                limit :limit
                """
            ),
            {"latest_snapshot_id": latest_snapshot_id, "limit": limit},
        ).mappings()

        cards: list[QuinielaPlusValueRecommendationOut] = []
        for row in rows:
            market_probs = self._no_vig_h2h_probabilities(
                row["home_value"],
                row["draw_value"],
                row["away_value"],
            )
            if market_probs is None:
                continue
            selection_key = max(market_probs, key=market_probs.get)
            odds_by_selection = {
                "home": row["home_value"],
                "draw": row["draw_value"],
                "away": row["away_value"],
            }
            is_hit = self._h2h_hit(selection_key, int(row["home_score"]), int(row["away_score"]))
            suggested_units = self._retro_stake_units(market_probs[selection_key])
            cards.append(
                QuinielaPlusValueRecommendationOut(
                    id=f"retro-{row['odds_id']}",
                    fixture_id=str(row["match_id"]),
                    kickoff_at=row["kickoff_at"],
                    home=str(row["home_name"]),
                    away=str(row["away_name"]),
                    market_key="h2h",
                    selection_key=selection_key,
                    line_value=None,
                    model_probability=market_probs[selection_key],
                    market_probability=market_probs[selection_key],
                    market_odds=float(odds_by_selection[selection_key]),
                    fair_odds_decimal=None,
                    edge_probability=None,
                    suggested_units=suggested_units,
                    stake_bankroll_pct=self._stake_bankroll_pct(suggested_units),
                    strategy_label="retro_track" if suggested_units > 0 else "no_bet",
                    stake_reason="Retro track con stake variable por probabilidad no-vig del mercado.",
                    odds_bucket=self._odds_bucket(odds_by_selection[selection_key]),
                    market_segment="Retro ML mercado",
                    entry_grade="track" if suggested_units > 0 else "avoid",
                    outcome_status="settled",
                    is_hit=is_hit,
                    result_label=f"{int(row['home_score'])}-{int(row['away_score'])}",
                    profit_units=self._profit_units(odds_by_selection[selection_key], is_hit, suggested_units),
                    confidence_label="retro",
                    recommendation="retro_market",
                    reason="Tarjeta retro AI Quinielón construida con odds guardadas antes del partido.",
                    created_at=row["synced_at"],
                )
            )
        return cards

    @staticmethod
    def _display_value_reason(reason: str | None) -> str | None:
        if reason is None:
            return None
        return reason.replace("Football-MD", "AI Quinielón").replace("AI Quinielon", "AI Quinielón")

    def _build_value_outcome(
        self,
        recommendation: QuinielaPlusValueRecommendation,
        result: MatchResult | None,
        suggested_units: float,
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
            profit_units = self._profit_units(recommendation.market_odds, is_hit, suggested_units)

        return {
            "outcome_status": status,
            "is_hit": is_hit,
            "result_label": f"{home_score}-{away_score}",
            "profit_units": profit_units,
        }

    @staticmethod
    def _h2h_hit(selection_key: str, home_score: int, away_score: int) -> bool:
        if home_score > away_score:
            return selection_key == "home"
        if away_score > home_score:
            return selection_key == "away"
        return selection_key == "draw"

    def _no_vig_h2h_probabilities(
        self,
        home_value: Decimal | None,
        draw_value: Decimal | None,
        away_value: Decimal | None,
    ) -> dict[str, float] | None:
        raw_home = self._american_to_probability(home_value)
        raw_draw = self._american_to_probability(draw_value)
        raw_away = self._american_to_probability(away_value)
        if raw_home is None or raw_draw is None or raw_away is None:
            return None
        total = raw_home + raw_draw + raw_away
        if total <= 0:
            return None
        return {
            "home": float(raw_home / total),
            "draw": float(raw_draw / total),
            "away": float(raw_away / total),
        }

    @staticmethod
    def _american_to_probability(value: Decimal | None) -> Decimal | None:
        if value is None:
            return None
        if value >= Decimal("100"):
            return Decimal("100") / (value + Decimal("100"))
        if value <= Decimal("-100"):
            absolute = abs(value)
            return absolute / (absolute + Decimal("100"))
        if value > Decimal("1"):
            return Decimal("1") / value
        return None

    def _build_stake_strategy(
        self,
        recommendation: QuinielaPlusValueRecommendation,
    ) -> dict[str, object]:
        if recommendation.market_odds is None:
            return {
                "suggested_units": 0.0,
                "stake_bankroll_pct": 0.0,
                "strategy_label": "model_only",
                "stake_reason": "Sin odds reales; sólo seguimiento de modelo.",
                "odds_bucket": None,
                "market_segment": "Modelo sin mercado",
                "entry_grade": "watch",
            }
        if (
            recommendation.model_probability is None
            or recommendation.edge_probability is None
        ):
            return {
                "suggested_units": 0.0,
                "stake_bankroll_pct": 0.0,
                "strategy_label": "no_bet",
                "stake_reason": "Sin edge calculable.",
                "odds_bucket": self._odds_bucket(recommendation.market_odds),
                "market_segment": self._market_segment(recommendation),
                "entry_grade": "avoid",
            }

        decimal_odds = self._decimal_odds_from_american(recommendation.market_odds)
        if decimal_odds is None or decimal_odds <= 1:
            return {
                "suggested_units": 0.0,
                "stake_bankroll_pct": 0.0,
                "strategy_label": "no_bet",
                "stake_reason": "Odds no compatibles con Kelly.",
                "odds_bucket": self._odds_bucket(recommendation.market_odds),
                "market_segment": self._market_segment(recommendation),
                "entry_grade": "avoid",
            }

        model_probability = Decimal(str(recommendation.model_probability))
        edge = Decimal(str(recommendation.edge_probability))
        gate = self._strategy_gate(recommendation, model_probability, edge)
        if gate["entry_grade"] != "bet":
            return {
                "suggested_units": 0.0,
                "stake_bankroll_pct": 0.0,
                "strategy_label": "watch" if gate["entry_grade"] == "watch" else "no_bet",
                "stake_reason": str(gate["stake_reason"]),
                "odds_bucket": gate["odds_bucket"],
                "market_segment": gate["market_segment"],
                "entry_grade": gate["entry_grade"],
            }

        payout_ratio = decimal_odds - Decimal("1")
        loss_probability = Decimal("1") - model_probability
        full_kelly = ((payout_ratio * model_probability) - loss_probability) / payout_ratio
        if full_kelly <= 0:
            return {
                "suggested_units": 0.0,
                "stake_bankroll_pct": 0.0,
                "strategy_label": "no_bet",
                "stake_reason": "Kelly negativo; no entrar.",
                "odds_bucket": gate["odds_bucket"],
                "market_segment": gate["market_segment"],
                "entry_grade": "avoid",
            }

        raw_units = full_kelly * KELLY_FRACTION * KELLY_BANKROLL_UNITS
        capped_units = min(raw_units, KELLY_MAX_UNITS, gate["max_units"])
        suggested_units = self._floor_to_unit(capped_units, KELLY_ROUNDING_UNIT)
        if suggested_units <= 0:
            return {
                "suggested_units": 0.0,
                "stake_bankroll_pct": 0.0,
                "strategy_label": "no_bet",
                "stake_reason": "Kelly positivo pero menor a 0.25u; no entrar.",
                "odds_bucket": gate["odds_bucket"],
                "market_segment": gate["market_segment"],
                "entry_grade": "watch",
            }

        if suggested_units <= Decimal("0.25"):
            label = "kelly_watch"
        elif suggested_units <= Decimal("0.75"):
            label = "kelly_standard"
        elif suggested_units < KELLY_MAX_UNITS:
            label = "kelly_strong"
        else:
            label = "kelly_max"

        return {
            "suggested_units": float(suggested_units),
            "stake_bankroll_pct": self._stake_bankroll_pct(float(suggested_units)),
            "strategy_label": label,
            "stake_reason": f"{gate['stake_reason']} Kelly 25%; stake {format(suggested_units, 'f')}u.",
            "odds_bucket": gate["odds_bucket"],
            "market_segment": gate["market_segment"],
            "entry_grade": "bet",
        }

    def _strategy_gate(
        self,
        recommendation: QuinielaPlusValueRecommendation,
        model_probability: Decimal,
        edge: Decimal,
    ) -> dict[str, object]:
        odds_bucket = self._odds_bucket(recommendation.market_odds)
        market_segment = self._market_segment(recommendation)
        if recommendation.market_key == "btts_model":
            return {
                "entry_grade": "watch",
                "stake_reason": "BTTS no entra hasta tener odds reales; sólo tracking.",
                "odds_bucket": odds_bucket,
                "market_segment": market_segment,
                "max_units": Decimal("0"),
            }
        if recommendation.market_odds is not None and recommendation.market_odds <= Decimal("-300"):
            return {
                "entry_grade": "watch",
                "stake_reason": "Favorito demasiado caro; se observa aunque Kelly de positivo.",
                "odds_bucket": odds_bucket,
                "market_segment": market_segment,
                "max_units": Decimal("0"),
            }

        rule_key = self._strategy_rule_key(recommendation)
        rule = STRATEGY_RULES.get(rule_key)
        if rule is None:
            return {
                "entry_grade": "watch",
                "stake_reason": "Mercado sin regla suficiente; tracking sin stake.",
                "odds_bucket": odds_bucket,
                "market_segment": market_segment,
                "max_units": Decimal("0"),
            }

        min_edge = rule["min_edge"]
        min_model_probability = rule["min_model_probability"]
        missing = []
        if edge < min_edge:
            missing.append(f"edge {float(edge * 100):.1f}% < {float(min_edge * 100):.1f}%")
        if model_probability < min_model_probability:
            missing.append(
                f"modelo {float(model_probability * 100):.1f}% < {float(min_model_probability * 100):.1f}%"
            )
        if missing:
            return {
                "entry_grade": "watch",
                "stake_reason": f"Watch {rule['label']}: " + ", ".join(missing) + ".",
                "odds_bucket": odds_bucket,
                "market_segment": market_segment,
                "max_units": Decimal("0"),
            }

        return {
            "entry_grade": "bet",
            "stake_reason": f"Pasa filtro {rule['label']} ({odds_bucket}): edge y probabilidad sobre umbral.",
            "odds_bucket": odds_bucket,
            "market_segment": market_segment,
            "max_units": rule["max_units"],
        }

    def _strategy_rule_key(self, recommendation: QuinielaPlusValueRecommendation) -> str | None:
        if recommendation.market_key == "total":
            return "total"
        if recommendation.market_key != "h2h":
            return None
        if recommendation.selection_key == "draw":
            return "draw"
        odds = recommendation.market_odds
        if odds is None:
            return None
        if odds <= Decimal("-120"):
            return "ml_favorite"
        if odds < Decimal("100"):
            return "ml_pickem"
        if odds <= Decimal("300"):
            return "ml_dog"
        return "ml_longshot"

    def _market_segment(self, recommendation: QuinielaPlusValueRecommendation) -> str:
        if recommendation.market_key == "h2h":
            if recommendation.selection_key == "draw":
                return "Empate"
            return "ML"
        if recommendation.market_key == "total":
            return "Over/Under"
        if recommendation.market_key == "btts_model":
            return "BTTS modelo"
        return recommendation.market_key

    @staticmethod
    def _odds_bucket(value: Decimal | None) -> str | None:
        if value is None:
            return None
        if value <= Decimal("-300"):
            return "-300 o mas caro"
        if value <= Decimal("-200"):
            return "-299 a -200"
        if value <= Decimal("-120"):
            return "-199 a -120"
        if value < Decimal("100"):
            return "-119 a +99"
        if value <= Decimal("200"):
            return "+100 a +200"
        if value <= Decimal("300"):
            return "+201 a +300"
        return "+301 o mas"

    @staticmethod
    def _stake_bankroll_pct(stake_units: float) -> float:
        if stake_units <= 0:
            return 0.0
        return float(Decimal(str(stake_units)) / KELLY_BANKROLL_UNITS)

    @staticmethod
    def _decimal_odds_from_american(value: Decimal | None) -> Decimal | None:
        if value is None:
            return None
        if value >= Decimal("100"):
            return Decimal("1") + (value / Decimal("100"))
        if value <= Decimal("-100"):
            return Decimal("1") + (Decimal("100") / abs(value))
        if value > Decimal("1"):
            return value
        return None

    @staticmethod
    def _floor_to_unit(value: Decimal, unit: Decimal) -> Decimal:
        return Decimal(int(value / unit)) * unit

    @staticmethod
    def _retro_stake_units(market_probability: float) -> float:
        if market_probability >= 0.75:
            return 1.0
        if market_probability >= 0.65:
            return 0.5
        if market_probability >= 0.55:
            return 0.25
        return 0.0

    @staticmethod
    def _profit_units(
        market_odds: Decimal | None,
        is_hit: bool | None,
        stake_units: float,
    ) -> float | None:
        if stake_units <= 0:
            return None
        if is_hit is None:
            return None
        if not is_hit:
            return -stake_units
        if market_odds is None:
            return None
        if market_odds > 0:
            return float(market_odds / Decimal("100")) * stake_units
        if market_odds < 0:
            return float(Decimal("100") / abs(market_odds)) * stake_units
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
