from decimal import Decimal

from fastapi import HTTPException, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy import and_, select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.security import AuthUser
from app.models.entities import (
    Competition,
    Match,
    MatchResult,
    Matchday,
    MatchdayStatus,
    PickSelection,
    Profile,
    ProfileTrophyAward,
    RoleCode,
    ScoringRule,
    Season,
    StandingsMatchday,
    TrophyAsset,
    UserPick,
)
from app.repositories.profile_repository import ProfileRepository
from app.repositories.season_membership_repository import SeasonMembershipRepository
from app.schemas.profile import (
    AdvancedStatsResponse,
    DashboardSummaryResponse,
    MeResponse,
    MeUpdateRequest,
    MySeasonMembershipOut,
    PersonalTrophyOut,
    PrizeSummaryResponse,
    RegisteredUserOption,
)
from app.services.season_eligibility_service import SeasonEligibilityService

settings = get_settings()


class ProfileService:
    def __init__(self) -> None:
        self.repo = ProfileRepository()
        self.membership_repo = SeasonMembershipRepository()
        self.eligibility_service = SeasonEligibilityService()

    def ensure_profile(self, db: Session, auth_user: AuthUser) -> Profile:
        can_bootstrap_admin = settings.app_env == "development" and not self.repo.has_admin_account(db)
        profile = self.repo.get_by_auth_user_id(db, auth_user.auth_user_id)
        if profile is not None:
            if can_bootstrap_admin and profile.role_code != RoleCode.MASTER_ADMIN:
                profile = self.repo.update_role(db, profile, RoleCode.MASTER_ADMIN)
                db.commit()
                db.refresh(profile)
            return profile

        try:
            profile = self.repo.create_from_auth_user(
                db,
                auth_user,
                role_code=RoleCode.MASTER_ADMIN if can_bootstrap_admin else RoleCode.USER,
            )
            db.commit()
            db.refresh(profile)
            return profile
        except IntegrityError as exc:
            db.rollback()
            existing_profile = self.repo.get_by_auth_user_id(db, auth_user.auth_user_id)
            if existing_profile is not None:
                return existing_profile

            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="No se pudo sincronizar tu perfil. Cierra sesion y vuelve a entrar.",
            ) from exc

    def update_settings(
        self,
        db: Session,
        profile: Profile,
        payload: MeUpdateRequest,
    ) -> Profile:
        updated = self.repo.update_settings(
            db,
            profile,
            display_name=payload.display_name.strip(),
            email=self._normalize_optional_text(payload.email),
            favorite_team_id=self._normalize_optional_text(payload.favorite_team_id),
            contact_phone=self._normalize_optional_text(payload.contact_phone),
            bank_name=self._normalize_optional_text(payload.bank_name),
            deposit_account=self._normalize_optional_text(payload.deposit_account),
            modality=payload.modality,
            aval_profile_id=self._normalize_optional_text(payload.aval_profile_id),
            theme_preference=payload.theme_preference,
            pick_reminder_email_enabled=payload.pick_reminder_email_enabled,
            pick_reminder_opening_enabled=payload.pick_reminder_opening_enabled,
            pick_reminder_hours_before=payload.pick_reminder_hours_before,
        )
        db.commit()
        db.refresh(updated)
        return updated

    def build_me_response(self, db: Session, profile: Profile, season_id: str | None = None) -> MeResponse:
        active_season = db.scalar(select(Season).where(Season.is_active.is_(True)).order_by(Season.created_at.desc()))
        if active_season is not None:
            did_freeze = self.eligibility_service.freeze_season_if_due(db, active_season)
            if did_freeze:
                db.commit()
                db.refresh(active_season)
        selected_season = db.get(Season, season_id) if season_id else active_season
        if selected_season is not None and (active_season is None or selected_season.id != active_season.id):
            did_freeze_selected = self.eligibility_service.freeze_season_if_due(db, selected_season)
            if did_freeze_selected:
                db.commit()
                db.refresh(selected_season)

        active_membership = (
            self.membership_repo.get_for_profile_and_season(db, profile.id, active_season.id)
            if active_season is not None
            else None
        )
        selected_membership = (
            self.membership_repo.get_for_profile_and_season(db, profile.id, selected_season.id)
            if selected_season is not None
            else None
        )
        membership_rows = self.membership_repo.list_for_profile(db, profile.id)
        membership_season_ids = [membership.season_id for membership in membership_rows]
        seasons_by_id = {
            season_row.id: season_row
            for season_row in db.scalars(select(Season).where(Season.id.in_(membership_season_ids))).all()
        } if membership_season_ids else {}
        membership_out_rows = [
            self._season_membership_out(db, membership_row, seasons_by_id.get(membership_row.season_id))
            for membership_row in membership_rows
            if seasons_by_id.get(membership_row.season_id) is not None
        ]
        selected_membership_out = (
            self._season_membership_out(db, selected_membership, selected_season)
            if selected_membership is not None and selected_season is not None
            else None
        )
        return MeResponse(
            id=profile.id,
            auth_user_id=profile.auth_user_id,
            email=profile.email,
            display_name=profile.display_name,
            role_code=profile.role_code,
            is_active=profile.is_active,
            created_at=profile.created_at,
            favorite_team_id=profile.favorite_team_id,
            contact_phone=profile.contact_phone,
            bank_name=profile.bank_name,
            deposit_account=profile.deposit_account,
            modality=profile.modality,
            aval_profile_id=profile.aval_profile_id,
            theme_preference=profile.theme_preference,
            pick_reminder_email_enabled=profile.pick_reminder_email_enabled,
            pick_reminder_opening_enabled=profile.pick_reminder_opening_enabled,
            pick_reminder_hours_before=profile.pick_reminder_hours_before,
            active_season_id=active_season.id if active_season is not None else None,
            active_season_name=active_season.name if active_season is not None else None,
            can_participate_active_season=bool(
                profile.is_active
                and active_season is not None
                and self.eligibility_service.can_participate(db, active_season, active_membership)
            ),
            is_paid_active_season=bool(active_membership and active_membership.is_paid),
            selected_season_id=selected_season.id if selected_season is not None else None,
            selected_season_name=selected_season.name if selected_season is not None else None,
            can_participate_selected_season=bool(
                profile.is_active
                and selected_season is not None
                and self.eligibility_service.can_participate(db, selected_season, selected_membership)
            ),
            is_paid_selected_season=bool(selected_membership and selected_membership.is_paid),
            selected_season_membership=selected_membership_out,
            season_memberships=membership_out_rows,
        )

    def list_registered_user_options(self, db: Session, current_profile: Profile) -> list[RegisteredUserOption]:
        return [
            RegisteredUserOption(id=profile.id, display_name=profile.display_name)
            for profile in self.repo.list_registered_options(db, exclude_profile_id=current_profile.id)
        ]

    def build_prize_summary(self, db: Session, season_id: str | None = None) -> PrizeSummaryResponse:
        season = self._resolve_season(db, season_id)
        if season is None:
            return PrizeSummaryResponse()

        did_freeze = self.eligibility_service.freeze_season_if_due(db, season)
        if did_freeze:
            db.commit()
            db.refresh(season)

        memberships = self.membership_repo.list_for_season(db, season.id)
        confirmed_participants = sum(1 for membership in memberships if membership.is_active)

        season_matchdays = list(
            db.scalars(
                select(Matchday)
                .where(Matchday.season_id == season.id)
                .order_by(Matchday.number.asc())
            )
        )
        start_number = next(
            (matchday.number for matchday in season_matchdays if matchday.id == season.start_matchday_id),
            None,
        )
        end_number = next(
            (matchday.number for matchday in season_matchdays if matchday.id == season.end_matchday_id),
            None,
        )
        tournament_matchdays = [
            matchday
            for matchday in season_matchdays
            if (start_number is None or matchday.number >= start_number)
            and (end_number is None or matchday.number <= end_number)
        ]

        gross_pool_amount = Decimal(confirmed_participants) * season.entry_fee_amount
        weekly_total_prize_amount = (
            season.weekly_first_place_amount
            + season.weekly_second_place_amount
            + season.weekly_third_place_amount
        )
        admin_commission_amount = gross_pool_amount * (season.admin_commission_pct / Decimal("100"))
        income_after_commission_amount = gross_pool_amount - admin_commission_amount
        total_weekly_prizes_amount = weekly_total_prize_amount * Decimal(len(tournament_matchdays))
        reserve_amount = gross_pool_amount * (season.reserve_pct / Decimal("100"))
        distributable_prize_pool_amount = income_after_commission_amount - total_weekly_prizes_amount - reserve_amount
        first_place_amount = distributable_prize_pool_amount * (season.first_place_pct / Decimal("100"))
        second_place_amount = distributable_prize_pool_amount * (season.second_place_pct / Decimal("100"))
        third_place_amount = distributable_prize_pool_amount * (season.third_place_pct / Decimal("100"))

        return PrizeSummaryResponse(
            season_id=season.id,
            season_name=season.name,
            confirmed_participants=confirmed_participants,
            entry_fee_amount=float(season.entry_fee_amount),
            gross_pool_amount=float(gross_pool_amount),
            admin_commission_pct=float(season.admin_commission_pct),
            admin_commission_amount=float(admin_commission_amount),
            reserve_pct=float(season.reserve_pct),
            reserve_amount=float(reserve_amount),
            income_after_commission_amount=float(income_after_commission_amount),
            net_income_amount=float(income_after_commission_amount - reserve_amount),
            weekly_first_place_amount=float(season.weekly_first_place_amount),
            weekly_second_place_amount=float(season.weekly_second_place_amount),
            weekly_third_place_amount=float(season.weekly_third_place_amount),
            weekly_total_prize_amount=float(weekly_total_prize_amount),
            tournament_matchdays_count=len(tournament_matchdays),
            total_weekly_prizes_amount=float(total_weekly_prizes_amount),
            distributable_prize_pool_amount=float(distributable_prize_pool_amount),
            first_place_pct=float(season.first_place_pct),
            first_place_amount=float(first_place_amount),
            second_place_pct=float(season.second_place_pct),
            second_place_amount=float(second_place_amount),
            third_place_pct=float(season.third_place_pct),
            third_place_amount=float(third_place_amount),
        )

    def build_dashboard_summary(
        self,
        db: Session,
        profile: Profile,
        season_id: str | None = None,
    ) -> DashboardSummaryResponse:
        season = self._resolve_season(db, season_id)
        if season is None:
            return DashboardSummaryResponse()

        matchdays = list(
            db.scalars(
                select(Matchday)
                .where(Matchday.season_id == season.id)
                .order_by(Matchday.number.asc())
            )
        )
        if not matchdays:
            return DashboardSummaryResponse(season_id=season.id, season_name=season.name)

        tournament_matchdays = self._get_tournament_matchdays(matchdays, season)
        if not tournament_matchdays:
            return DashboardSummaryResponse(season_id=season.id, season_name=season.name)

        tournament_ids = [matchday.id for matchday in tournament_matchdays]
        standings_rows = db.execute(
            select(StandingsMatchday).where(StandingsMatchday.matchday_id.in_(tournament_ids))
        ).scalars().all()

        standings_by_matchday = {row.matchday_id for row in standings_rows}
        completed_matchdays = [
            matchday
            for matchday in tournament_matchdays
            if matchday.status in {MatchdayStatus.CLOSED, MatchdayStatus.PUBLISHED}
            or matchday.id in standings_by_matchday
        ]
        completed_count = len(completed_matchdays)
        total_matchdays = len(tournament_matchdays)

        participant_ids = {
            membership.profile_id
            for membership in self.membership_repo.list_for_season(db, season.id)
            if self.eligibility_service.counts_for_scoring(db, season, membership)
        }
        participant_ids.update(row.profile_id for row in standings_rows)

        totals_by_profile: dict[str, dict[str, int]] = {
            participant_id: {"total_points": 0, "exact_scores": 0, "weekly_prizes": 0}
            for participant_id in participant_ids
        }

        for row in standings_rows:
            bucket = totals_by_profile.setdefault(
                row.profile_id,
                {"total_points": 0, "exact_scores": 0, "weekly_prizes": 0},
            )
            bucket["total_points"] += row.total_points
            bucket["exact_scores"] += row.exact_scores
            if row.rank_position <= 3:
                bucket["weekly_prizes"] += 1

        current = totals_by_profile.get(
            profile.id,
            {"total_points": 0, "exact_scores": 0, "weekly_prizes": 0},
        )
        average_points = (
            round(current["total_points"] / completed_count, 1)
            if completed_count > 0
            else 0.0
        )
        projected_total_points = (
            round((current["total_points"] / completed_count) * total_matchdays, 1)
            if completed_count > 0
            else 0.0
        )

        overall_rank = self._find_rank(
            profile.id,
            sorted(
                (
                    (candidate_id, values["total_points"], values["exact_scores"])
                    for candidate_id, values in totals_by_profile.items()
                ),
                key=lambda item: (-item[1], -item[2], item[0]),
            ),
        )
        projected_rank = self._find_rank(
            profile.id,
            sorted(
                (
                    (
                        candidate_id,
                        round((values["total_points"] / completed_count) * total_matchdays, 1) if completed_count > 0 else 0.0,
                        values["total_points"],
                        values["exact_scores"],
                    )
                    for candidate_id, values in totals_by_profile.items()
                ),
                key=lambda item: (-item[1], -item[2], -item[3], item[0]),
            ),
        )

        return DashboardSummaryResponse(
            season_id=season.id,
            season_name=season.name,
            total_points=current["total_points"],
            overall_rank=overall_rank,
            weekly_prizes_count=current["weekly_prizes"],
            average_points_per_matchday=average_points,
            projected_total_points=projected_total_points,
            projected_rank=projected_rank,
            tournament_matchdays=total_matchdays,
            completed_matchdays=completed_count,
            remaining_matchdays=max(total_matchdays - completed_count, 0),
        )

    def build_advanced_stats(
        self,
        db: Session,
        profile: Profile,
        season_id: str | None = None,
    ) -> AdvancedStatsResponse:
        season = self._resolve_season(db, season_id)
        if season is None:
            return AdvancedStatsResponse()

        matchdays = list(
            db.scalars(
                select(Matchday)
                .where(Matchday.season_id == season.id)
                .order_by(Matchday.number.asc())
            )
        )
        if not matchdays:
            return AdvancedStatsResponse(season_id=season.id, season_name=season.name)

        tournament_matchdays = self._get_tournament_matchdays(matchdays, season)
        if not tournament_matchdays:
            return AdvancedStatsResponse(season_id=season.id, season_name=season.name)

        tournament_ids = [matchday.id for matchday in tournament_matchdays]
        rules = self._load_rules(db)
        result_hit_points = rules["result_correct"]
        max_hit_points = rules["result_correct"] + rules["exact_score"]

        rows = db.execute(
            select(UserPick, MatchResult, Match)
            .join(Match, Match.id == UserPick.match_id)
            .join(
                MatchResult,
                and_(
                    MatchResult.match_id == Match.id,
                    MatchResult.is_official.is_(True),
                ),
            )
            .where(
                UserPick.profile_id == profile.id,
                Match.matchday_id.in_(tournament_ids),
            )
            .order_by(Match.kickoff_at.asc())
        ).all()

        selection_counts = {
            PickSelection.HOME: 0,
            PickSelection.DRAW: 0,
            PickSelection.AWAY: 0,
        }
        selection_hits = {
            PickSelection.HOME: 0,
            PickSelection.DRAW: 0,
            PickSelection.AWAY: 0,
        }
        selection_points = {
            PickSelection.HOME: 0,
            PickSelection.DRAW: 0,
            PickSelection.AWAY: 0,
        }
        exact_hits = 0
        result_hits = 0
        best_matchday_name: str | None = None
        best_matchday_points = 0

        matchday_rows = list(
            db.execute(
                select(StandingsMatchday, Matchday)
                .join(Matchday, Matchday.id == StandingsMatchday.matchday_id)
                .where(
                    StandingsMatchday.profile_id == profile.id,
                    StandingsMatchday.matchday_id.in_(tournament_ids),
                )
                .order_by(Matchday.number.asc())
            ).all()
        )

        if matchday_rows:
            best_standing, best_matchday = max(
                matchday_rows,
                key=lambda item: (item[0].total_points, -item[1].number),
            )
            best_matchday_name = best_matchday.name
            best_matchday_points = best_standing.total_points

        for pick, result, _match in rows:
            selection_counts[pick.selection] += 1

            winner = self._resolve_winner(result.home_score, result.away_score)
            got_result = pick.selection == winner
            got_exact = (
                pick.predicted_home_score == result.home_score
                and pick.predicted_away_score == result.away_score
            )

            total_points = 0
            if got_result:
                selection_hits[pick.selection] += 1
                total_points += rules["result_correct"]
                if got_exact:
                    exact_hits += 1
                    total_points += rules["exact_score"]
                else:
                    result_hits += 1

            selection_points[pick.selection] += total_points

        graded_picks = len(rows)
        successful_picks = exact_hits + result_hits

        return AdvancedStatsResponse(
            season_id=season.id,
            season_name=season.name,
            graded_picks=graded_picks,
            best_matchday_name=best_matchday_name,
            best_matchday_points=best_matchday_points,
            home_bets=selection_counts[PickSelection.HOME],
            draw_bets=selection_counts[PickSelection.DRAW],
            away_bets=selection_counts[PickSelection.AWAY],
            max_hit_points=max_hit_points,
            result_hit_points=result_hit_points,
            exact_hits=exact_hits,
            result_hits=result_hits,
            overall_effectiveness_pct=self._percentage(successful_picks, graded_picks),
            home_effectiveness_pct=self._percentage(
                selection_hits[PickSelection.HOME],
                selection_counts[PickSelection.HOME],
            ),
            draw_effectiveness_pct=self._percentage(
                selection_hits[PickSelection.DRAW],
                selection_counts[PickSelection.DRAW],
            ),
            away_effectiveness_pct=self._percentage(
                selection_hits[PickSelection.AWAY],
                selection_counts[PickSelection.AWAY],
            ),
            home_points=selection_points[PickSelection.HOME],
            draw_points=selection_points[PickSelection.DRAW],
            away_points=selection_points[PickSelection.AWAY],
        )

    def list_personal_trophies(
        self,
        db: Session,
        profile: Profile,
    ) -> list[PersonalTrophyOut]:
        self._sync_missing_weekly_awards_for_profile(db, profile)
        db.commit()
        trophy_map = {
            trophy.id: trophy
            for trophy in db.scalars(select(TrophyAsset)).all()
        }
        rows = list(
            db.scalars(
                select(ProfileTrophyAward)
                .where(ProfileTrophyAward.profile_id == profile.id)
                .order_by(ProfileTrophyAward.awarded_at.desc(), ProfileTrophyAward.tournament_name.desc())
            )
        )
        return [
            PersonalTrophyOut(
                id=row.id,
                tournament_name=row.tournament_name or "Historico",
                place_label=row.place_label,
                recognition_type="award" if row.source_type == "weekly_matchday" else "trophy",
                trophy_name=trophy_map[row.trophy_asset_id].name if row.trophy_asset_id in trophy_map else None,
                image_url=trophy_map[row.trophy_asset_id].image_url if row.trophy_asset_id in trophy_map else None,
                total_points=row.total_points,
            )
            for row in rows
        ]

    def _sync_missing_weekly_awards_for_profile(
        self,
        db: Session,
        profile: Profile,
    ) -> None:
        standings_rows = db.execute(
            select(StandingsMatchday, Matchday, Season)
            .join(Matchday, Matchday.id == StandingsMatchday.matchday_id)
            .join(Season, Season.id == Matchday.season_id)
            .where(StandingsMatchday.profile_id == profile.id)
            .order_by(Matchday.number.asc())
        ).all()
        if not standings_rows:
            return

        trophy_assets = list(
            db.scalars(
                select(TrophyAsset).where(
                    TrophyAsset.matchday_number.is_not(None),
                    TrophyAsset.award_place_label.is_not(None),
                )
            )
        )
        season_specific_trophy_asset_map: dict[tuple[str, int, str], TrophyAsset] = {}
        generic_trophy_asset_map: dict[tuple[int, str], TrophyAsset] = {}
        for trophy_asset in trophy_assets:
            if trophy_asset.season_id:
                season_specific_trophy_asset_map[
                    (
                        trophy_asset.season_id,
                        trophy_asset.matchday_number,
                        trophy_asset.award_place_label,
                    )
                ] = trophy_asset
            else:
                generic_trophy_asset_map[
                    (
                        trophy_asset.matchday_number,
                        trophy_asset.award_place_label,
                    )
                ] = trophy_asset

        existing_awards = list(
            db.scalars(
                select(ProfileTrophyAward).where(
                    ProfileTrophyAward.profile_id == profile.id,
                    ProfileTrophyAward.source_type == "weekly_matchday",
                )
            )
        )
        existing_keys = {
            (award.matchday_id, award.trophy_asset_id)
            for award in existing_awards
        }

        for standing, matchday, season in standings_rows:
            place_label = self._rank_to_place_label(standing.rank_position)
            if place_label is None:
                continue
            badge_asset = season_specific_trophy_asset_map.get((season.id, matchday.number, place_label))
            if badge_asset is None:
                badge_asset = generic_trophy_asset_map.get((matchday.number, place_label))
            if badge_asset is None:
                continue

            award_key = (matchday.id, badge_asset.id)
            if award_key in existing_keys:
                continue

            db.add(
                ProfileTrophyAward(
                    profile_id=profile.id,
                    trophy_asset_id=badge_asset.id,
                    season_id=season.id,
                    matchday_id=matchday.id,
                    tournament_name=season.name,
                    place_label=place_label,
                    total_points=standing.total_points,
                    source_type="weekly_matchday",
                    awarded_at=matchday.ends_at,
                )
            )
            existing_keys.add(award_key)

    def _season_membership_out(
        self,
        db: Session,
        membership,
        season: Season | None,
    ) -> MySeasonMembershipOut:
        if membership is None or season is None:
            raise ValueError("Membership and season are required")
        competition = db.get(Competition, season.competition_id) if season.competition_id else None
        return MySeasonMembershipOut(
            season_id=season.id,
            season_name=season.name,
            competition_id=season.competition_id,
            competition_name=competition.name if competition is not None else None,
            is_active=bool(membership.is_active),
            is_paid=bool(membership.is_paid),
            eligible_for_scoring=bool(membership.eligible_for_scoring),
            can_participate=bool(self.eligibility_service.can_participate(db, season, membership)),
            eligible_locked_at=membership.eligible_locked_at,
            activated_at=membership.activated_at,
            notes=membership.notes,
        )

    @staticmethod
    def _normalize_optional_text(value: str | None) -> str | None:
        if value is None:
            return None
        cleaned = value.strip()
        return cleaned or None

    @staticmethod
    def _resolve_season(db: Session, season_id: str | None) -> Season | None:
        if season_id:
            return db.get(Season, season_id)
        return db.scalar(select(Season).where(Season.is_active.is_(True)).order_by(Season.created_at.desc()))

    @staticmethod
    def _get_tournament_matchdays(matchdays: list[Matchday], season: Season) -> list[Matchday]:
        start_number = next(
            (matchday.number for matchday in matchdays if matchday.id == season.start_matchday_id),
            matchdays[0].number,
        )
        end_number = next(
            (matchday.number for matchday in matchdays if matchday.id == season.end_matchday_id),
            matchdays[-1].number,
        )
        if end_number < start_number:
            end_number = start_number
        return [matchday for matchday in matchdays if start_number <= matchday.number <= end_number]

    @staticmethod
    def _find_rank(profile_id: str, rows: list[tuple]) -> int | None:
        previous_score = None
        previous_rank = 0
        for position, row in enumerate(rows, start=1):
            current_score = row[1] if len(row) > 1 else None
            if previous_score is None or current_score != previous_score:
                previous_rank = position
                previous_score = current_score
            if row[0] == profile_id:
                return previous_rank
        return None

    @staticmethod
    def _resolve_winner(home_score: int, away_score: int) -> PickSelection:
        if home_score > away_score:
            return PickSelection.HOME
        if away_score > home_score:
            return PickSelection.AWAY
        return PickSelection.DRAW

    @staticmethod
    def _rank_to_place_label(rank_position: int | None) -> str | None:
        mapping = {
            1: "1er Lugar",
            2: "2do Lugar",
            3: "3er Lugar",
        }
        return mapping.get(rank_position)

    @staticmethod
    def _load_rules(db: Session) -> dict[str, int]:
        stored_rules = {
            rule.rule_key: rule.points
            for rule in db.scalars(select(ScoringRule).where(ScoringRule.is_active.is_(True)))
        }
        return {
            "result_correct": stored_rules.get("result_correct", 3),
            "exact_score": stored_rules.get("exact_score", 2),
        }

    @staticmethod
    def _percentage(hits: int, total: int) -> float:
        if total <= 0:
            return 0.0
        return round((hits / total) * 100, 1)
