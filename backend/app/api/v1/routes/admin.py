import csv
import io
import logging
import os
import re
import subprocess
import sys
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, Response, status
from pydantic import ValidationError
from sqlalchemy import delete, func, inspect, select, text
from sqlalchemy.orm import Session

from app.api.deps import require_roles
from app.core.config import get_settings
from app.core.database import SessionLocal, engine, get_db
from app.core.datetime import MEXICO_CITY_TZ
from app.models.entities import (
    Competition,
    CompetitionTeam,
    CompetitionStructureFormat,
    CommerceSettings,
    HistoricalChampion,
    LiveMatchScore,
    Match,
    MatchResult,
    Matchday,
    MatchdayStatus,
    PickSelection,
    Profile,
    Odds,
    ProfileTrophyAward,
    PublishedMatchday,
    RoleCode,
    RulePage,
    ScoringRule,
    Season,
    SeasonTeam,
    SeasonMembership,
    SeasonVisibilityStatus,
    StandingsMatchday,
    SurvivorMembership,
    Team,
    TournamentFormat,
    TrophyAsset,
    VipCompetitionMatchday,
    VipMembershipStatus,
    WorldCupGroup,
    UserPick,
)
from app.providers.api_football_provider import ApiFootballProvider
from app.providers.mock_provider import MockSportsDataProvider
from app.providers.results_api_provider import ResultsApiProvider
from app.providers.the_odds_scores_provider import TheOddsScoresProvider
from app.repositories.match_repository import MatchRepository
from app.repositories.matchday_repository import MatchdayRepository
from app.repositories.profile_repository import ProfileRepository
from app.repositories.season_membership_repository import SeasonMembershipRepository
from app.repositories.season_repository import SeasonRepository
from app.repositories.team_repository import TeamRepository
from app.schemas.admin import (
    AdvancedStatsPullResponse,
    AdminLiveScoreRowOut,
    AdminLiveScoreUpdateRequest,
    AdminNflSpreadRowOut,
    AdminNflSpreadUpdateRequest,
    AdminPickOverrideRequest,
    AdminPickRowOut,
    AdminResultRowOut,
    AdminResultUpdateRequest,
    AdminSettingsOut,
    AdminSettingsUpdateRequest,
    AdminUserBulkCreateRequest,
    AdminUserBulkCreateResponse,
    AdminUserBulkCreateRowOut,
    AdminUserBillingUpdateRequest,
    AdminUserCreateRequest,
    AdminUserOut,
    AdminUserPasswordUpdateRequest,
    AdminUserSeasonMembershipOut,
    AdminUserSurvivorMembershipOut,
    CompetitionCreateRequest,
    CompetitionUpdateRequest,
    HistoricalChampionCreateRequest,
    HistoricalChampionOut,
    HistoricalChampionUpdateRequest,
    MatchCreateRequest,
    MatchdayCreateRequest,
    MatchdayUpdateRequest,
    MatchUpdateRequest,
    OddsPreviewRow,
    OddsPullResponse,
    OddsSnapshotOption,
    OddsUnmatchedMatchOut,
    OddsUnmatchedResponse,
    OddsUnmatchedTeamOut,
    RoleUpdateRequest,
    SeasonCreateRequest,
    SeasonStructureUpdateRequest,
    SeasonUpdateRequest,
    SyncResponse,
    TeamCreateRequest,
    TeamBulkImportRequest,
    TeamBulkImportResponse,
    TeamBulkImportRowOut,
    TeamPaletteRefreshResponse,
    TeamUpdateRequest,
    TrophyAssetCreateRequest,
    TrophyAssetOut,
    TrophyAssetUpdateRequest,
    UserAccessUpdateRequest,
    UserSeasonMembershipUpdateRequest,
    UserSurvivorMembershipUpdateRequest,
)
from app.schemas.competition import CompetitionOut
from app.schemas.match import MatchOut
from app.schemas.matchday import MatchdayOut
from app.schemas.profile import ProfileOut
from app.schemas.rules import RulePageKind, RulePageOut, RulePageUpdateRequest
from app.schemas.season import SeasonOut
from app.schemas.team import TeamOut
from app.schemas.survivor import AdminSurvivorPickOverrideRequest, AdminSurvivorPickRowOut
from app.schemas.vip import (
    AdminVipQuestionPoolBulkCorrectOptionRequest,
    AdminVipQuestionPoolCsvImportRequest,
    AdminVipCompetitionOut,
    AdminVipMembershipAddRequest,
    AdminVipMembershipDecisionRequest,
    AdminVipMembershipPaymentRequest,
    AdminVipQuestionPoolCorrectOptionRequest,
    AdminVipQuestionPoolQuestionUpsertRequest,
    AdminVipTeamWinnerConfigRequest,
    AdminVipTeamWinnerEntryPaymentRequest,
    AdminVipTeamWinnerTeamStatusRequest,
    AdminVipUpsertRequest,
)
from app.api.v1.routes.rules import build_rule_page_out, get_or_create_rule_page
from app.services.match_service import MatchService
from app.services.reminder_service import ReminderService
from app.services.pick_service import PickService
from app.services.result_service import ResultService
from app.services.reminder_service import ReminderService
from app.services.scoring_service import ScoringService
from app.services.season_eligibility_service import SeasonEligibilityService
from app.services.supabase_admin_service import SupabaseAdminError, SupabaseAdminService
from app.services.survivor_service import SurvivorService
from app.services.team_color_service import extract_team_palette
from app.services.username_service import assign_profile_username
from app.services.sync_matches import sync_matches
from app.services.sync_odds import sync_odds
from app.services.sync_results import sync_results
from app.services.vip_service import VipService

logger = logging.getLogger(__name__)

router = APIRouter()
profile_repo = ProfileRepository()
matchday_repo = MatchdayRepository()
match_repo = MatchRepository()
season_repo = SeasonRepository()
season_membership_repo = SeasonMembershipRepository()
team_repo = TeamRepository()
match_service = MatchService()
result_service = ResultService()
pick_service = PickService()
survivor_service = SurvivorService()
season_eligibility_service = SeasonEligibilityService()
vip_service = VipService()
reminder_service = ReminderService()
supabase_admin_service = SupabaseAdminService()
REPO_ROOT = Path(__file__).resolve().parents[5]
APPS_API_DIR = REPO_ROOT / "apps" / "api"
BACKEND_DIR = REPO_ROOT / "backend"
RAW_ODDS_TABLE = "lmx_odds_5d"


def get_script_python() -> str:
    local_python = BACKEND_DIR / ".venv" / "bin" / "python"
    if local_python.exists():
        return str(local_python)
    return sys.executable


DEFAULT_RESULT_CORRECT_POINTS = 3
DEFAULT_EXACT_SCORE_POINTS = 2


def recalculate_vips_for_matchday(db: Session, matchday_id: str) -> int:
    vip_ids = {
        vip_id
        for vip_id in db.scalars(
            select(VipCompetitionMatchday.vip_competition_id).where(
                VipCompetitionMatchday.matchday_id == matchday_id
            )
        )
    }
    for vip_id in vip_ids:
        VipService().recalculate_vip_standings(db, vip_id)
    return len(vip_ids)


def recalculate_all_vips(db: Session) -> int:
    vip_ids = set(db.scalars(select(VipCompetitionMatchday.vip_competition_id)))
    for vip_id in vip_ids:
        VipService().recalculate_vip_standings(db, vip_id)
    return len(vip_ids)


def run_scoring_recalculate_background() -> None:
    db = SessionLocal()
    try:
        ScoringService().recalculate(db)
        matchday_ids = set(
            db.scalars(
                select(Match.matchday_id)
                .join(MatchResult, MatchResult.match_id == Match.id)
                .where(MatchResult.is_official.is_(True))
            )
        )
        reminder_service = ReminderService()
        for matchday_id in matchday_ids:
            reminder_service.send_match_scoring_notifications(db, matchday_id=matchday_id)
    finally:
        db.close()


def run_vip_recalculate_background(vip_id: str) -> None:
    db = SessionLocal()
    try:
        VipService().recalculate_vip_standings(db, vip_id)
    finally:
        db.close()


def run_vip_recalculate_for_matchday_background(matchday_id: str) -> None:
    db = SessionLocal()
    try:
        recalculate_vips_for_matchday(db, matchday_id)
    finally:
        db.close()


def run_scoring_and_vip_recalculate_for_matchday_background(
    matchday_id: str,
    match_id: str | None = None,
) -> None:
    db = SessionLocal()
    try:
        ScoringService().recalculate_matchday(db, matchday_id)
        recalculate_vips_for_matchday(db, matchday_id)
        ReminderService().send_match_scoring_notifications(db, matchday_id=matchday_id, match_id=match_id)
    finally:
        db.close()


def recalculate_matchday_scoring_inline(
    db: Session,
    *,
    matchday_id: str,
    match_id: str | None = None,
) -> dict[str, int]:
    summary = ScoringService().recalculate_matchday(db, matchday_id)
    try:
        recalculate_vips_for_matchday(db, matchday_id)
    except Exception:
        logger.exception("VIP recalculation failed", extra={"matchday_id": matchday_id})
    try:
        ReminderService().send_match_scoring_notifications(db, matchday_id=matchday_id, match_id=match_id)
    except Exception:
        logger.exception(
            "Match scoring notifications failed",
            extra={"matchday_id": matchday_id, "match_id": match_id},
        )
    return summary


def run_matchday_publish_notifications_background(matchday_id: str) -> None:
    db = SessionLocal()
    try:
        ScoringService().recalculate(db)
        recalculate_vips_for_matchday(db, matchday_id)
        if reminder_service.push_service.is_configured():
            reminder_service.send_matchday_summary_notifications(db, matchday_id=matchday_id)
    finally:
        db.close()


def run_all_vip_recalculate_background() -> None:
    db = SessionLocal()
    try:
        recalculate_all_vips(db)
    finally:
        db.close()


def admin_vip_row(db: Session, vip_id: str, *, include_leaderboard: bool = False) -> AdminVipCompetitionOut:
    vip = next(
        iter(vip_service.list_admin_vips(db, include_leaderboard=include_leaderboard, vip_id=vip_id)),
        None,
    )
    if vip is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="VIP no encontrada")
    return vip


def ensure_matchday_can_be_saved(
    db: Session,
    *,
    season_id: str,
    number: int,
    starts_at: datetime,
    ends_at: datetime,
    existing_matchday_id: str | None = None,
) -> None:
    if ends_at <= starts_at:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="La fecha de cierre de la jornada debe ser posterior a la fecha de inicio.",
        )

    duplicate_stmt = select(Matchday).where(
        Matchday.season_id == season_id,
        Matchday.number == number,
    )
    if existing_matchday_id:
        duplicate_stmt = duplicate_stmt.where(Matchday.id != existing_matchday_id)

    duplicate_matchday = db.scalar(duplicate_stmt)
    if duplicate_matchday is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                f"Ya existe la jornada {number} en esta temporada: "
                f"{duplicate_matchday.name}."
            ),
        )


def list_historical_champions_rows(db: Session) -> list[HistoricalChampion]:
    return list(
        db.scalars(
            select(HistoricalChampion)
            .order_by(HistoricalChampion.created_at.desc(), HistoricalChampion.tournament_name.desc())
        )
    )


def build_historical_champion_out(
    row: HistoricalChampion,
    trophy_name: str | None = None,
) -> HistoricalChampionOut:
    return HistoricalChampionOut(
        id=row.id,
        tournament_name=row.tournament_name,
        user_name=row.champion_name,
        awarded_profile_id=row.awarded_profile_id,
        place_label=row.place_label,
        trophy_asset_id=row.trophy_asset_id,
        trophy_name=trophy_name,
        image_url=row.image_url,
        total_points=row.total_points,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


def list_trophy_assets_rows(db: Session) -> list[TrophyAsset]:
    return list(
        db.scalars(
            select(TrophyAsset).order_by(
                TrophyAsset.category.asc(),
                TrophyAsset.name.asc(),
                TrophyAsset.created_at.desc(),
            )
        )
    )


def build_trophy_asset_out(row: TrophyAsset) -> TrophyAssetOut:
    return TrophyAssetOut(
        id=row.id,
        name=row.name,
        category=row.category,
        asset_code=row.asset_code,
        season_id=row.season_id,
        matchday_number=row.matchday_number,
        award_place_label=row.award_place_label,
        image_url=row.image_url,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


def sync_personal_award_from_historical_champion(
    db: Session,
    row: HistoricalChampion,
) -> None:
    existing_award = db.scalar(
        select(ProfileTrophyAward).where(
            ProfileTrophyAward.source_type == "historical_champion",
            ProfileTrophyAward.source_ref_id == row.id,
        )
    )
    if row.awarded_profile_id is None:
        if existing_award is not None:
            db.delete(existing_award)
        return

    if existing_award is None:
        existing_award = ProfileTrophyAward(
            profile_id=row.awarded_profile_id,
            trophy_asset_id=row.trophy_asset_id,
            tournament_name=row.tournament_name,
            place_label=row.place_label,
            total_points=row.total_points,
            source_type="historical_champion",
            source_ref_id=row.id,
            awarded_at=row.created_at,
        )
    else:
        existing_award.profile_id = row.awarded_profile_id
        existing_award.trophy_asset_id = row.trophy_asset_id
        existing_award.tournament_name = row.tournament_name
        existing_award.place_label = row.place_label
        existing_award.total_points = row.total_points
        existing_award.awarded_at = row.created_at

    db.add(existing_award)


def place_label_to_rank_position(place_label: str | None) -> int | None:
    mapping = {
        "1er Lugar": 1,
        "2do Lugar": 2,
        "3er Lugar": 3,
    }
    if place_label is None:
        return None
    return mapping.get(place_label)


def sync_weekly_awards_for_trophy_asset(
    db: Session,
    asset: TrophyAsset,
) -> int:
    db.execute(
        delete(ProfileTrophyAward).where(
            ProfileTrophyAward.source_type == "weekly_matchday",
            ProfileTrophyAward.trophy_asset_id == asset.id,
        )
    )

    rank_position = place_label_to_rank_position(asset.award_place_label)
    if asset.matchday_number is None or rank_position is None:
        return 0

    rows = db.execute(
        select(StandingsMatchday, Matchday, Season)
        .join(Matchday, Matchday.id == StandingsMatchday.matchday_id)
        .join(Season, Season.id == Matchday.season_id)
        .where(
            Matchday.number == asset.matchday_number,
            StandingsMatchday.rank_position == rank_position,
            Matchday.season_id == asset.season_id if asset.season_id is not None else text("1=1"),
        )
        .order_by(Matchday.number.asc(), StandingsMatchday.profile_id.asc())
    ).all()

    created = 0
    for standing, matchday, season in rows:
        db.add(
            ProfileTrophyAward(
                profile_id=standing.profile_id,
                trophy_asset_id=asset.id,
                season_id=matchday.season_id,
                matchday_id=matchday.id,
                tournament_name=season.name,
                place_label=asset.award_place_label or "Trofeo",
                total_points=standing.total_points,
                source_type="weekly_matchday",
                awarded_at=matchday.ends_at,
            )
        )
        created += 1
    return created


def get_or_create_main_rule_page(db: Session) -> RulePage:
    row = db.scalar(select(RulePage).where(RulePage.slug == "main"))
    if row is not None:
        return row

    row = RulePage(
        slug="main",
        title="Reglamento",
        content_markdown="",
        version_label="v 1.06",
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def extract_int(pattern: str, text: str) -> int | None:
    match = re.search(pattern, text)
    if match is None:
        return None
    return int(match.group(1))


def extract_text(pattern: str, text: str) -> str | None:
    match = re.search(pattern, text)
    if match is None:
        return None
    return match.group(1)


def extract_snapshot_date(text: str) -> str | None:
    match = re.search(r"snapshot (\d{4}-\d{2}-\d{2})", text)
    if match is not None:
        return match.group(1)
    return None


def get_raw_odds_snapshot_count(
    snapshot_date: str,
    table_name: str = RAW_ODDS_TABLE,
    sport_key: str | None = None,
) -> int | None:
    inspector = inspect(engine)
    if not inspector.has_table(table_name, schema="public"):
        return None

    has_sport_key = any(column["name"] == "sport_key" for column in inspector.get_columns(table_name, schema="public"))
    sport_filter = "AND sport_key = :sport_key" if sport_key and has_sport_key else ""
    params = {"snapshot_date": snapshot_date}
    if sport_key and has_sport_key:
        params["sport_key"] = sport_key

    with engine.begin() as connection:
        raw_rows_processed = connection.execute(
            text(
                f"""
                SELECT COUNT(*)
                FROM public.{table_name}
                WHERE snapshot_date = :snapshot_date
                {sport_filter}
                """
            ),
            params,
        ).scalar_one()

    return int(raw_rows_processed)


def get_latest_raw_odds_snapshot_date(table_name: str = RAW_ODDS_TABLE) -> str | None:
    inspector = inspect(engine)
    if not inspector.has_table(table_name, schema="public"):
        return None

    with engine.begin() as connection:
        snapshot_date = connection.execute(
            text(f"SELECT MAX(snapshot_date)::text FROM public.{table_name}")
        ).scalar_one_or_none()

    return str(snapshot_date) if snapshot_date is not None else None


def get_raw_odds_preview(
    snapshot_date: str,
    table_name: str = RAW_ODDS_TABLE,
    sport_key: str | None = None,
) -> list[OddsPreviewRow]:
    inspector = inspect(engine)
    if not inspector.has_table(table_name, schema="public"):
        return []

    has_sport_key = any(column["name"] == "sport_key" for column in inspector.get_columns(table_name, schema="public"))
    sport_filter = "AND sport_key = :sport_key" if sport_key and has_sport_key else ""
    params = {"snapshot_date": snapshot_date}
    if sport_key and has_sport_key:
        params["sport_key"] = sport_key

    with engine.begin() as connection:
        rows = connection.execute(
            text(
                f"""
                SELECT
                  match_date,
                  home_team,
                  away_team,
                  ml_home,
                  ml_draw,
                  ml_away
                FROM public.{table_name}
                WHERE snapshot_date = :snapshot_date
                {sport_filter}
                ORDER BY match_date ASC, home_team ASC, away_team ASC
                """
            ),
            params,
        ).mappings()

        return [
            OddsPreviewRow(
                match_date=row["match_date"].isoformat(),
                home_team=str(row["home_team"]),
                away_team=str(row["away_team"]),
                ml_home=str(row["ml_home"]) if row["ml_home"] is not None else None,
                ml_draw=str(row["ml_draw"]) if row["ml_draw"] is not None else None,
                ml_away=str(row["ml_away"]) if row["ml_away"] is not None else None,
            )
            for row in rows
        ]


def get_world_cup_unmatched_odds(table_name: str = RAW_ODDS_TABLE) -> OddsUnmatchedResponse:
    sport_key = "soccer_fifa_world_cup"
    inspector = inspect(engine)
    if not inspector.has_table(table_name, schema="public"):
        return OddsUnmatchedResponse(sport_key=sport_key)

    column_names = {column["name"] for column in inspector.get_columns(table_name, schema="public")}
    if "sport_key" not in column_names:
        return OddsUnmatchedResponse(sport_key=sport_key)

    with engine.begin() as connection:
        snapshot_date = connection.execute(
            text(
                f"""
                SELECT MAX(snapshot_date)::text
                FROM public.{table_name}
                WHERE sport_key = :sport_key
                """
            ),
            {"sport_key": sport_key},
        ).scalar_one_or_none()
        if snapshot_date is None:
            return OddsUnmatchedResponse(sport_key=sport_key)

        rows = connection.execute(
            text(
                f"""
                WITH raw AS (
                  SELECT *
                  FROM public.{table_name}
                  WHERE snapshot_date = :snapshot_date
                    AND sport_key = :sport_key
                ),
                team_codes AS (
                  SELECT UPPER(short_name) AS code
                  FROM teams
                )
                SELECT
                  raw.snapshot_date::text AS snapshot_date,
                  raw.match_date,
                  raw.home_team,
                  raw.home_code,
                  raw.away_team,
                  raw.away_code,
                  raw.source_match_key,
                  home.code IS NOT NULL AS home_exists,
                  away.code IS NOT NULL AS away_exists
                FROM raw
                LEFT JOIN team_codes home ON home.code = UPPER(raw.home_code)
                LEFT JOIN team_codes away ON away.code = UPPER(raw.away_code)
                WHERE home.code IS NULL OR away.code IS NULL
                ORDER BY raw.match_date ASC, raw.home_team ASC, raw.away_team ASC
                """
            ),
            {"snapshot_date": snapshot_date, "sport_key": sport_key},
        ).mappings()

    matches: list[OddsUnmatchedMatchOut] = []
    for row in rows:
        missing: list[OddsUnmatchedTeamOut] = []
        if not row["home_exists"]:
            missing.append(
                OddsUnmatchedTeamOut(
                    raw_team_name=str(row["home_team"]),
                    raw_team_code=str(row["home_code"]) if row["home_code"] is not None else None,
                    side="home",
                    team_exists=False,
                )
            )
        if not row["away_exists"]:
            missing.append(
                OddsUnmatchedTeamOut(
                    raw_team_name=str(row["away_team"]),
                    raw_team_code=str(row["away_code"]) if row["away_code"] is not None else None,
                    side="away",
                    team_exists=False,
                )
            )
        matches.append(
            OddsUnmatchedMatchOut(
                snapshot_date=str(row["snapshot_date"]),
                match_date=row["match_date"].isoformat(),
                home_team=str(row["home_team"]),
                home_code=str(row["home_code"]) if row["home_code"] is not None else None,
                away_team=str(row["away_team"]),
                away_code=str(row["away_code"]) if row["away_code"] is not None else None,
                source_match_key=str(row["source_match_key"]) if row["source_match_key"] is not None else None,
                missing=missing,
            )
        )

    return OddsUnmatchedResponse(
        sport_key=sport_key,
        snapshot_date=str(snapshot_date),
        unmatched_count=len(matches),
        matches=matches,
    )


def list_raw_odds_snapshots(table_name: str = RAW_ODDS_TABLE, limit: int = 30) -> list[OddsSnapshotOption]:
    inspector = inspect(engine)
    if not inspector.has_table(table_name, schema="public"):
        return []

    with engine.begin() as connection:
        rows = connection.execute(
            text(
                f"""
                SELECT snapshot_date::text AS snapshot_date, COUNT(*) AS raw_rows_processed
                FROM public.{table_name}
                GROUP BY snapshot_date
                ORDER BY snapshot_date DESC
                LIMIT :limit
                """
            ),
            {"limit": limit},
        ).mappings()

        return [
            OddsSnapshotOption(
                snapshot_date=str(row["snapshot_date"]),
                raw_rows_processed=int(row["raw_rows_processed"]),
            )
            for row in rows
        ]


@router.get("/odds/snapshots", response_model=list[OddsSnapshotOption])
def list_admin_odds_snapshots(
    _: Profile = Depends(require_roles(RoleCode.ADMIN, RoleCode.MASTER_ADMIN)),
) -> list[OddsSnapshotOption]:
    return list_raw_odds_snapshots()


@router.get("/odds/latest", response_model=OddsPullResponse)
def get_latest_admin_odds(
    snapshot_date: str | None = None,
    _: Profile = Depends(require_roles(RoleCode.ADMIN, RoleCode.MASTER_ADMIN)),
) -> OddsPullResponse:
    effective_snapshot_date = snapshot_date or get_latest_raw_odds_snapshot_date()
    if effective_snapshot_date is None:
        return OddsPullResponse(
            status="empty",
            snapshot_date=None,
            raw_rows_processed=0,
            matched=None,
            unmatched=None,
            preview_rows=[],
            pull_output="Todavia no hay snapshot raw guardado en public.lmx_odds_5d.",
            sync_output="",
        )

    return OddsPullResponse(
        status="success",
        snapshot_date=effective_snapshot_date,
        raw_rows_processed=get_raw_odds_snapshot_count(effective_snapshot_date) or 0,
        matched=None,
        unmatched=None,
        preview_rows=get_raw_odds_preview(effective_snapshot_date),
        pull_output="Snapshot cargado desde public.lmx_odds_5d.",
        sync_output="",
    )


@router.get("/odds/world-cup-unmatched", response_model=OddsUnmatchedResponse)
def get_admin_world_cup_unmatched_odds(
    _: Profile = Depends(require_roles(RoleCode.ADMIN, RoleCode.MASTER_ADMIN)),
) -> OddsUnmatchedResponse:
    return get_world_cup_unmatched_odds()


def load_env_values(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    if not path.exists():
        return values

    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key.strip()] = value.strip().strip("\"'")
    return values


def build_odds_script_env() -> dict[str, str]:
    env = os.environ.copy()
    apps_api_env = load_env_values(APPS_API_DIR / ".env")
    backend_env = load_env_values(BACKEND_DIR / ".env")
    pythonpath_entries = [str(BACKEND_DIR)]
    existing_pythonpath = env.get("PYTHONPATH")
    if existing_pythonpath:
        pythonpath_entries.append(existing_pythonpath)
    env["PYTHONPATH"] = os.pathsep.join(pythonpath_entries)

    odds_database_url = (
        apps_api_env.get("ODDS_DATABASE_URL")
        or apps_api_env.get("SUPABASE_DATABASE_URL")
        or apps_api_env.get("DATABASE_URL")
        or backend_env.get("SUPABASE_DATABASE_URL")
        or backend_env.get("DATABASE_URL")
        or env.get("ODDS_DATABASE_URL")
        or env.get("SUPABASE_DATABASE_URL")
        or env.get("DATABASE_URL")
    )

    if odds_database_url:
        env["ODDS_DATABASE_URL"] = odds_database_url
        env["DATABASE_URL"] = odds_database_url

    for key, value in apps_api_env.items():
        env.setdefault(key, value)
    for key, value in backend_env.items():
        env.setdefault(key, value)

    return env


def normalize_script_output(value: str | bytes | None) -> str:
    if value is None:
        return ""
    if isinstance(value, bytes):
        return value.decode(errors="replace")
    return value


def run_script(command: list[str], cwd: Path, env: dict[str, str] | None = None) -> subprocess.CompletedProcess[str]:
    timeout_seconds = max(get_settings().admin_script_timeout_seconds, 1)
    try:
        return subprocess.run(
            command,
            cwd=str(cwd),
            env=env,
            capture_output=True,
            text=True,
            check=False,
            timeout=timeout_seconds,
        )
    except subprocess.TimeoutExpired as exc:
        stdout = normalize_script_output(exc.stdout)
        stderr = normalize_script_output(exc.stderr)
        timeout_message = f"Script excedio {timeout_seconds}s y fue detenido para no colgar el backend."
        return subprocess.CompletedProcess(
            command,
            124,
            stdout=stdout,
            stderr="\n".join(part for part in [stderr.strip(), timeout_message] if part).strip(),
        )


def run_odds_pull_pipeline(script_env: dict[str, str], *, sport_key: str | None = None) -> OddsPullResponse:
    pull_result = run_script([get_script_python(), "scripts/pull_odds_raw.py"], BACKEND_DIR, env=script_env)
    pull_output = "\n".join(part for part in [pull_result.stdout.strip(), pull_result.stderr.strip()] if part).strip()

    if pull_result.returncode != 0:
        if "ODDS-API sin creditos" in pull_output:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="ODDS-API sin creditos.",
            )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"No se pudo bajar odds raw desde The Odds API.\n{pull_output or 'Sin salida del script.'}",
        )

    snapshot_date = extract_snapshot_date(pull_output)
    if snapshot_date is None:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"El extractor raw no devolvio una fecha de snapshot usable.\n{pull_output or 'Sin salida del script.'}",
        )

    raw_rows_processed = get_raw_odds_snapshot_count(snapshot_date, sport_key=sport_key)
    if raw_rows_processed is None:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="El extractor raw termino, pero la tabla public.lmx_odds_5d sigue sin existir.",
        )

    if raw_rows_processed == 0:
        return OddsPullResponse(
            status="success",
            snapshot_date=snapshot_date,
            raw_rows_processed=0,
            matched=0,
            unmatched=0,
            preview_rows=[],
            pull_output=pull_output,
            sync_output="No hubo filas raw dentro de la ventana configurada; se omitio la sincronizacion.",
        )

    sync_result = run_script(
        [
            get_script_python(),
            "scripts/sync_odds_from_raw.py",
            "--snapshot-date",
            snapshot_date,
            *(["--sport-key", sport_key] if sport_key else []),
        ],
        BACKEND_DIR,
        env=script_env,
    )
    sync_output = "\n".join(part for part in [sync_result.stdout.strip(), sync_result.stderr.strip()] if part).strip()

    if sync_result.returncode != 0:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=(
                "Los odds raw se bajaron, pero no se pudieron sincronizar.\n"
                f"{pull_output or 'Sin salida del pull.'}\n\n{sync_output or 'Sin salida del script de sync.'}"
            ),
        )

    return OddsPullResponse(
        status="success",
        snapshot_date=snapshot_date,
        raw_rows_processed=raw_rows_processed,
        matched=extract_int(r":\s*(\d+)\s+matched", sync_output),
        unmatched=extract_int(r",\s*(\d+)\s+unmatched", sync_output),
        preview_rows=get_raw_odds_preview(snapshot_date, sport_key=sport_key),
        pull_output=pull_output,
        sync_output=sync_output,
    )


def run_advanced_stats_pull_pipeline(
    script_env: dict[str, str],
    *,
    target_date: str,
    days: int,
) -> AdvancedStatsPullResponse:
    output_path = "app/data/quiniela_plus_advanced_stats.json"
    pull_result = run_script(
        [
            get_script_python(),
            "scripts/pull_quiniela_plus_advanced_stats.py",
            "--date",
            target_date,
            "--days",
            str(max(days, 1)),
            "--output",
            output_path,
        ],
        BACKEND_DIR,
        env=script_env,
    )
    pull_output = "\n".join(
        part for part in [pull_result.stdout.strip(), pull_result.stderr.strip()] if part
    ).strip()

    if pull_result.returncode != 0:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=(
                "No se pudo actualizar estadisticas avanzadas.\n"
                f"{pull_output or 'Sin salida del script.'}"
            ),
        )

    return AdvancedStatsPullResponse(
        status="success",
        count=extract_int(r"Saved\s+(\d+)\s+advanced stats fixtures", pull_output) or 0,
        snapshot_id=extract_text(r"Saved DB snapshot\s+([0-9a-fA-F-]+):", pull_output),
        matches_saved=extract_int(r":\s*(\d+)\s+stats matches", pull_output),
        recommendations_saved=extract_int(r",\s*(\d+)\s+recommendations", pull_output),
        output_path=output_path,
        pull_output=pull_output,
    )


def get_provider() -> MockSportsDataProvider:
    return MockSportsDataProvider()


def normalize_nfl_spread_line(raw_value: str | None) -> tuple[str | None, str | None]:
    if raw_value is None or not raw_value.strip():
        return None, None
    normalized = raw_value.strip().upper().replace("PK", "0")
    try:
        home_value = Decimal(normalized)
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Spread invalido") from exc
    if abs(home_value) > Decimal("100") or home_value % Decimal("0.5") != 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Usa una linea entre -100 y +100 en incrementos de 0.5",
        )

    def render(value: Decimal) -> str:
        if value == 0:
            return "0"
        rendered = format(value, "f").rstrip("0").rstrip(".")
        return f"+{rendered}" if value > 0 else rendered

    return render(home_value), render(-home_value)


def require_nfl_season(db: Session, season_id: str) -> Season:
    season = db.get(Season, season_id)
    competition = db.get(Competition, season.competition_id) if season and season.competition_id else None
    haystack = " ".join(
        value.lower()
        for value in [
            competition.sport_name if competition else "",
            competition.name if competition else "",
            competition.slug if competition else "",
        ]
        if value
    )
    if season is None or ("nfl" not in haystack and "football" not in haystack):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Selecciona una temporada NFL")
    return season


def get_results_provider():
    settings = get_settings()
    if settings.default_provider in {"api_football", "api_football_v3"}:
        if settings.api_football_key.strip():
            return ApiFootballProvider(settings)
        if settings.results_provider_base_url:
            return ResultsApiProvider(settings)
    if settings.default_provider in {"the_odds_api", "the_odds_scores"} and settings.the_odds_api_key.strip():
        return TheOddsScoresProvider(settings)
    if settings.default_provider in {"results_api", "thesportsdb_v1"} and settings.results_provider_base_url:
        return ResultsApiProvider(settings)
    return MockSportsDataProvider()


def normalize_slug(value: str) -> str:
    return value.strip().lower().replace(" ", "-")


def normalize_optional_text(value: str | None) -> str | None:
    if value is None:
        return None
    stripped = value.strip()
    return stripped or None


def build_competition_out(row: Competition) -> CompetitionOut:
    return CompetitionOut.model_validate(row, from_attributes=True)


def build_team_out(
    row: Team,
    competition: Competition | None = None,
    competition_ids: list[str] | None = None,
    competition_names: list[str] | None = None,
) -> TeamOut:
    return TeamOut(
        id=row.id,
        competition_id=row.competition_id,
        competition_name=competition.name if competition is not None else None,
        competition_sport_name=competition.sport_name if competition is not None else None,
        competition_ids=competition_ids or ([row.competition_id] if row.competition_id else []),
        competition_names=competition_names or ([competition.name] if competition is not None else []),
        external_id=row.external_id,
        name=row.name,
        short_name=row.short_name,
        slug=row.slug,
        crest_url=row.crest_url,
        home_venue=row.home_venue,
        primary_color=row.primary_color,
        secondary_color=row.secondary_color,
        accent_color=row.accent_color,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


def sync_team_competitions(db: Session, team: Team, competition_ids: list[str]) -> list[Competition]:
    normalized_ids = list(dict.fromkeys(competition_id for competition_id in competition_ids if competition_id))
    competitions = list(
        db.scalars(select(Competition).where(Competition.id.in_(normalized_ids))).all()
    ) if normalized_ids else []
    if len(competitions) != len(normalized_ids):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Competition not found")
    competition_by_id = {competition.id: competition for competition in competitions}
    db.execute(delete(CompetitionTeam).where(CompetitionTeam.team_id == team.id))
    for competition_id in normalized_ids:
        db.add(CompetitionTeam(team_id=team.id, competition_id=competition_id))
    team.competition_id = normalized_ids[0] if normalized_ids else None
    return [competition_by_id[competition_id] for competition_id in normalized_ids]


def apply_automatic_team_palette(team: Team) -> bool:
    if not team.crest_url:
        return False
    try:
        primary, secondary, accent = extract_team_palette(team.crest_url)
    except Exception as exc:
        logger.warning("No se pudo extraer la paleta del escudo %s: %s", team.crest_url, exc)
        return False
    team.primary_color = primary
    team.secondary_color = secondary
    team.accent_color = accent
    return primary is not None


def build_season_out(row: Season, competition: Competition | None = None) -> SeasonOut:
    return SeasonOut(
        id=row.id,
        name=row.name,
        slug=row.slug,
        competition_id=row.competition_id,
        competition_name=competition.name if competition is not None else None,
        competition_sport_name=competition.sport_name if competition is not None else None,
        tournament_format=row.tournament_format,
        structure_format=row.structure_format,
        structure_config=row.structure_config or {},
        visibility_status=row.visibility_status,
        live_dashboard_enabled=row.live_dashboard_enabled,
        is_active=row.is_active,
        registration_closed=row.registration_closed,
        survivor_enabled=row.survivor_enabled,
        survivor_name=row.survivor_name,
        survivor_max_lives=row.survivor_max_lives,
        survivor_registration_closed=row.survivor_registration_closed,
        survivor_registration_lock_at=row.survivor_registration_lock_at,
        start_matchday_id=row.start_matchday_id,
        end_matchday_id=row.end_matchday_id,
        participants_lock_at=row.participants_lock_at,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


def build_trophy_asset_code(name: str, category: str) -> str:
    raw_value = f"{name.strip()}-{category.strip()}"
    normalized = normalize_slug(raw_value)
    normalized = re.sub(r"[^a-z0-9-]+", "-", normalized)
    normalized = re.sub(r"-{2,}", "-", normalized).strip("-")
    return normalized[:120] or "trofeo"


def resolve_trophy_asset_category(payload: TrophyAssetCreateRequest | TrophyAssetUpdateRequest) -> str:
    if payload.season_id and payload.matchday_number and payload.award_place_label:
        return "Badge Jornada"
    return (payload.category or "Trofeo").strip()


def apply_matchday_lock_offset_to_matches(db: Session, matchday: Matchday) -> None:
    matches = list(db.scalars(select(Match).where(Match.matchday_id == matchday.id)))
    for match in matches:
        match.picks_lock_at = match.kickoff_at - timedelta(minutes=matchday.default_lock_offset_minutes)
        db.add(match)
    matchday.picks_reopened_override = False
    db.add(matchday)


def reopen_matchday_picks(db: Session, matchday: Matchday) -> int:
    matches = list(db.scalars(select(Match).where(Match.matchday_id == matchday.id)))
    override_lock_at = datetime.now(UTC) + timedelta(days=365)
    for match in matches:
        match.picks_lock_at = override_lock_at
        db.add(match)
    matchday.picks_reopened_override = True
    db.add(matchday)
    return len(matches)


def set_active_season(db: Session, season_to_activate: Season) -> None:
    for season in season_repo.list_all(db):
        season.is_active = season.id == season_to_activate.id
        db.add(season)


def set_active_matchday(db: Session, matchday_to_activate: Matchday) -> None:
    for matchday in matchday_repo.list_matchdays(db):
        if matchday.season_id != matchday_to_activate.season_id:
            continue
        if matchday.id == matchday_to_activate.id:
            matchday.status = MatchdayStatus.ACTIVE
        elif matchday.status == MatchdayStatus.ACTIVE:
            matchday.status = MatchdayStatus.DRAFT
        db.add(matchday)


def get_or_create_commerce_settings(db: Session) -> CommerceSettings:
    row = db.scalar(select(CommerceSettings).order_by(CommerceSettings.created_at.asc()))
    if row is not None:
        return row

    row = CommerceSettings()
    db.add(row)
    db.flush()
    return row


def get_admin_settings_payload(
    db: Session,
    *,
    season_id: str | None = None,
    evaluated_picks: int | None = None,
    weekly_leaders: int | None = None,
) -> AdminSettingsOut:
    active_season = db.scalar(select(Season).where(Season.is_active.is_(True)).order_by(Season.created_at.desc()))
    target_season = season_repo.get_by_id(db, season_id) if season_id else active_season
    commerce_settings = get_or_create_commerce_settings(db)
    if target_season is not None:
        did_freeze = season_eligibility_service.freeze_season_if_due(db, target_season)
        if did_freeze:
            db.commit()
            db.refresh(target_season)
    stored_rules = {
        rule.rule_key: rule.points
        for rule in db.scalars(select(ScoringRule).where(ScoringRule.is_active.is_(True)))
    }
    participants_lock_at = None
    participants_locked = False
    eligible_participants = 0
    confirmed_participants = 0
    entry_fee_amount = Decimal("0")
    weekly_first_place_amount = Decimal("0")
    weekly_second_place_amount = Decimal("0")
    weekly_third_place_amount = Decimal("0")
    admin_commission_pct = Decimal("0")
    reserve_pct = Decimal("0")
    first_place_pct = Decimal("0")
    second_place_pct = Decimal("0")
    third_place_pct = Decimal("0")
    if target_season is not None:
        participants_lock_at = season_eligibility_service.get_effective_lock_at(db, target_season)
        participants_locked = season_eligibility_service.is_locked(db, target_season)
        memberships = season_membership_repo.list_for_season(db, target_season.id)
        eligible_participants = sum(1 for membership in memberships if membership.eligible_for_scoring)
        confirmed_participants = sum(1 for membership in memberships if membership.is_active)
        entry_fee_amount = target_season.entry_fee_amount
        weekly_first_place_amount = target_season.weekly_first_place_amount
        weekly_second_place_amount = target_season.weekly_second_place_amount
        weekly_third_place_amount = target_season.weekly_third_place_amount
        admin_commission_pct = target_season.admin_commission_pct
        reserve_pct = target_season.reserve_pct
        first_place_pct = target_season.first_place_pct
        second_place_pct = target_season.second_place_pct
        third_place_pct = target_season.third_place_pct

    tournament_matchdays_count = 0
    if target_season is not None:
        season_matchdays = list(
            db.scalars(
                select(Matchday)
                .where(Matchday.season_id == target_season.id)
                .order_by(Matchday.number.asc())
            )
        )
        start_number = next(
            (matchday.number for matchday in season_matchdays if matchday.id == target_season.start_matchday_id),
            None,
        )
        end_number = next(
            (matchday.number for matchday in season_matchdays if matchday.id == target_season.end_matchday_id),
            None,
        )
        filtered_matchdays = [
            matchday
            for matchday in season_matchdays
            if (start_number is None or matchday.number >= start_number)
            and (end_number is None or matchday.number <= end_number)
        ]
        tournament_matchdays_count = len(filtered_matchdays)

    gross_pool_amount = Decimal(confirmed_participants) * entry_fee_amount
    weekly_total_prize_amount = weekly_first_place_amount + weekly_second_place_amount + weekly_third_place_amount
    admin_commission_amount = gross_pool_amount * (admin_commission_pct / Decimal("100"))
    income_after_commission_amount = gross_pool_amount - admin_commission_amount
    total_weekly_prizes_amount = weekly_total_prize_amount * Decimal(tournament_matchdays_count)
    reserve_amount = gross_pool_amount * (reserve_pct / Decimal("100"))
    distributable_prize_pool_amount = income_after_commission_amount - total_weekly_prizes_amount - reserve_amount
    first_place_amount = distributable_prize_pool_amount * (first_place_pct / Decimal("100"))
    second_place_amount = distributable_prize_pool_amount * (second_place_pct / Decimal("100"))
    third_place_amount = distributable_prize_pool_amount * (third_place_pct / Decimal("100"))

    return AdminSettingsOut(
        active_season_id=active_season.id if active_season is not None else None,
        selected_season_id=target_season.id if target_season is not None else None,
        selected_season_name=target_season.name if target_season is not None else None,
        selected_tournament_format=target_season.tournament_format if target_season is not None else None,
        app_icon_url=commerce_settings.app_icon_url,
        show_live_tab=commerce_settings.show_live_tab,
        start_matchday_id=target_season.start_matchday_id if target_season is not None else None,
        end_matchday_id=target_season.end_matchday_id if target_season is not None else None,
        participants_lock_at=participants_lock_at,
        participants_locked=participants_locked,
        eligible_participants=eligible_participants,
        confirmed_participants=confirmed_participants,
        entry_fee_amount=float(entry_fee_amount),
        weekly_first_place_amount=float(weekly_first_place_amount),
        weekly_second_place_amount=float(weekly_second_place_amount),
        weekly_third_place_amount=float(weekly_third_place_amount),
        weekly_total_prize_amount=float(weekly_total_prize_amount),
        tournament_matchdays_count=tournament_matchdays_count,
        admin_commission_pct=float(admin_commission_pct),
        reserve_pct=float(reserve_pct),
        first_place_pct=float(first_place_pct),
        second_place_pct=float(second_place_pct),
        third_place_pct=float(third_place_pct),
        gross_pool_amount=float(gross_pool_amount),
        admin_commission_amount=float(admin_commission_amount),
        income_after_commission_amount=float(income_after_commission_amount),
        total_weekly_prizes_amount=float(total_weekly_prizes_amount),
        reserve_amount=float(reserve_amount),
        distributable_prize_pool_amount=float(distributable_prize_pool_amount),
        first_place_amount=float(first_place_amount),
        second_place_amount=float(second_place_amount),
        third_place_amount=float(third_place_amount),
        result_correct_points=stored_rules.get("result_correct", DEFAULT_RESULT_CORRECT_POINTS),
        exact_score_points=stored_rules.get("exact_score", DEFAULT_EXACT_SCORE_POINTS),
        advancing_team_points=stored_rules.get("advancing_team", 1),
        evaluated_picks=evaluated_picks,
        weekly_leaders=weekly_leaders,
    )


def upsert_scoring_rule(db: Session, rule_key: str, points: int) -> None:
    rule = db.scalar(select(ScoringRule).where(ScoringRule.rule_key == rule_key))
    if rule is None:
        rule = ScoringRule(rule_key=rule_key, points=points, is_active=True)
    else:
        rule.points = points
        rule.is_active = True
    db.add(rule)


def get_selected_season(db: Session, season_id: str | None = None) -> Season | None:
    if season_id:
        return season_repo.get_by_id(db, season_id)
    return db.scalar(select(Season).where(Season.is_active.is_(True)).order_by(Season.created_at.desc()))


def build_admin_user_season_membership_out(
    membership: SeasonMembership,
    *,
    season_name: str | None = None,
) -> AdminUserSeasonMembershipOut:
    return AdminUserSeasonMembershipOut(
        season_id=membership.season_id,
        season_name=season_name or membership.season_id,
        is_active=membership.is_active,
        is_paid=membership.is_paid,
        eligible_for_scoring=membership.eligible_for_scoring,
        eligible_locked_at=membership.eligible_locked_at,
        activated_at=membership.activated_at,
        notes=membership.notes,
    )


def build_admin_user_survivor_membership_out(
    membership: SurvivorMembership,
    *,
    season_name: str | None = None,
) -> AdminUserSurvivorMembershipOut:
    return AdminUserSurvivorMembershipOut(
        season_id=membership.season_id,
        season_name=season_name or membership.season_id,
        is_active=membership.is_active,
        joined_at=membership.joined_at,
    )


def is_survivor_available_for_season(season: Season) -> bool:
    return season.tournament_format == TournamentFormat.STANDARD or bool(season.survivor_enabled)


def build_admin_user_out_from_maps(
    profile: Profile,
    season: Season | None,
    *,
    favorite_team_by_id: dict[str, Team],
    aval_profile_by_id: dict[str, Profile],
    memberships_by_profile_id: dict[str, list[SeasonMembership]],
    survivor_memberships_by_profile_id: dict[str, list[SurvivorMembership]],
    season_name_by_id: dict[str, str],
) -> AdminUserOut:
    favorite_team = favorite_team_by_id.get(profile.favorite_team_id) if profile.favorite_team_id else None
    aval_profile = aval_profile_by_id.get(profile.aval_profile_id) if profile.aval_profile_id else None
    all_memberships = memberships_by_profile_id.get(profile.id, [])
    all_survivor_memberships = survivor_memberships_by_profile_id.get(profile.id, [])
    membership = next(
        (
            membership_row
            for membership_row in all_memberships
            if season is not None and membership_row.season_id == season.id
        ),
        None,
    )
    survivor_membership = next(
        (
            survivor_membership_row
            for survivor_membership_row in all_survivor_memberships
            if season is not None and survivor_membership_row.season_id == season.id
        ),
        None,
    )
    selected_season_membership = None
    if season is not None:
        selected_season_membership = AdminUserSeasonMembershipOut(
            season_id=season.id,
            season_name=season.name,
            is_active=bool(membership and membership.is_active),
            is_paid=bool(membership and membership.is_paid),
            eligible_for_scoring=bool(membership and membership.eligible_for_scoring),
            eligible_locked_at=membership.eligible_locked_at if membership is not None else None,
            activated_at=membership.activated_at if membership is not None else None,
            notes=membership.notes if membership is not None else None,
        )
    selected_survivor_membership = None
    if season is not None and is_survivor_available_for_season(season):
        selected_survivor_membership = AdminUserSurvivorMembershipOut(
            season_id=season.id,
            season_name=season.name,
            is_active=bool(survivor_membership and survivor_membership.is_active),
            joined_at=survivor_membership.joined_at if survivor_membership is not None else None,
        )
    season_memberships = [
        build_admin_user_season_membership_out(
            membership_row,
            season_name=season_name_by_id.get(membership_row.season_id),
        )
        for membership_row in all_memberships
    ]

    return AdminUserOut(
        id=profile.id,
        auth_user_id=profile.auth_user_id,
        email=profile.email,
        display_name=profile.display_name,
        username=profile.username,
        favorite_team_name=favorite_team.name if favorite_team is not None else None,
        contact_phone=profile.contact_phone,
        bank_name=profile.bank_name,
        deposit_account=profile.deposit_account,
        modality=profile.modality,
        aval_profile_id=profile.aval_profile_id,
        aval_display_name=aval_profile.display_name if aval_profile is not None else None,
        theme_preference=profile.theme_preference,
        role_code=profile.role_code,
        is_active=profile.is_active,
        created_at=profile.created_at,
        selected_season_membership=selected_season_membership,
        selected_survivor_membership=selected_survivor_membership,
        season_memberships=season_memberships,
    )


def build_admin_user_out(db: Session, profile: Profile, season: Season | None) -> AdminUserOut:
    return list_admin_user_out_rows(db, [profile], season)[0]


def list_admin_user_out_rows(
    db: Session,
    profiles: list[Profile],
    season: Season | None,
) -> list[AdminUserOut]:
    if not profiles:
        return []

    profile_ids = [profile.id for profile in profiles]
    favorite_team_ids = {profile.favorite_team_id for profile in profiles if profile.favorite_team_id}
    aval_profile_ids = {profile.aval_profile_id for profile in profiles if profile.aval_profile_id}

    favorite_team_by_id = (
        {
            row.id: row
            for row in db.scalars(select(Team).where(Team.id.in_(favorite_team_ids))).all()
        }
        if favorite_team_ids
        else {}
    )
    aval_profile_by_id = (
        {
            row.id: row
            for row in db.scalars(select(Profile).where(Profile.id.in_(aval_profile_ids))).all()
        }
        if aval_profile_ids
        else {}
    )

    memberships_by_profile_id: dict[str, list[SeasonMembership]] = defaultdict(list)
    survivor_memberships_by_profile_id: dict[str, list[SurvivorMembership]] = defaultdict(list)
    season_ids: set[str] = set()
    memberships = db.scalars(
        select(SeasonMembership)
        .where(SeasonMembership.profile_id.in_(profile_ids))
        .order_by(SeasonMembership.created_at.desc())
    ).all()
    for membership in memberships:
        memberships_by_profile_id[membership.profile_id].append(membership)
        season_ids.add(membership.season_id)

    survivor_memberships = db.scalars(
        select(SurvivorMembership)
        .where(SurvivorMembership.profile_id.in_(profile_ids))
        .order_by(SurvivorMembership.created_at.desc())
    ).all()
    for membership in survivor_memberships:
        survivor_memberships_by_profile_id[membership.profile_id].append(membership)
        season_ids.add(membership.season_id)

    season_name_by_id = (
        {
            row.id: row.name
            for row in db.scalars(select(Season).where(Season.id.in_(season_ids))).all()
        }
        if season_ids
        else {}
    )

    return [
        build_admin_user_out_from_maps(
            profile,
            season,
            favorite_team_by_id=favorite_team_by_id,
            aval_profile_by_id=aval_profile_by_id,
            memberships_by_profile_id=memberships_by_profile_id,
            survivor_memberships_by_profile_id=survivor_memberships_by_profile_id,
            season_name_by_id=season_name_by_id,
        )
        for profile in profiles
    ]


def _slugify_export_part(value: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")
    return slug or "temporada"


def _format_csv_bool(value: bool | None, true_label: str, false_label: str) -> str:
    return true_label if value else false_label


@router.get("/users", response_model=list[AdminUserOut])
def list_users(
    season_id: str | None = None,
    db: Session = Depends(get_db),
    _: Profile = Depends(require_roles(RoleCode.ADMIN, RoleCode.MASTER_ADMIN)),
) -> list[AdminUserOut]:
    season = get_selected_season(db, season_id)
    if season is not None:
        did_freeze = season_eligibility_service.freeze_season_if_due(db, season)
        if did_freeze:
            db.commit()
            db.refresh(season)
    return list_admin_user_out_rows(db, profile_repo.list_all(db), season)


@router.get("/users/export")
def export_users(
    season_id: str | None = None,
    db: Session = Depends(get_db),
    _: Profile = Depends(require_roles(RoleCode.ADMIN, RoleCode.MASTER_ADMIN)),
) -> Response:
    season = get_selected_season(db, season_id)
    if season is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Season not found")

    did_freeze = season_eligibility_service.freeze_season_if_due(db, season)
    if did_freeze:
        db.commit()
        db.refresh(season)

    users = list_admin_user_out_rows(db, profile_repo.list_all(db), season)
    csv_buffer = io.StringIO()
    writer = csv.writer(csv_buffer)
    writer.writerow(
        [
            "temporada",
            "usuario_id",
            "nombre",
            "username",
            "correo",
            "rol",
            "app",
            "alta_torneo",
            "pagado",
            "puntua",
            "modalidad",
            "aval",
            "equipo_favorito",
            "telefono",
            "banco",
            "cuenta_deposito",
            "activado_en",
            "bloqueo_puntaje_en",
            "notas",
        ]
    )
    for user in users:
        membership = user.selected_season_membership
        writer.writerow(
            [
                season.name,
                user.id,
                user.display_name,
                user.username or "",
                user.email or "",
                user.role_code,
                _format_csv_bool(user.is_active, "Activa", "Bloqueada"),
                _format_csv_bool(membership.is_active if membership is not None else False, "Alta", "Fuera"),
                _format_csv_bool(membership.is_paid if membership is not None else False, "Pagado", "Pendiente"),
                _format_csv_bool(
                    membership.eligible_for_scoring if membership is not None else False,
                    "Cuenta",
                    "No",
                ),
                user.modality or "pre_pago",
                user.aval_display_name or "",
                user.favorite_team_name or "",
                user.contact_phone or "",
                user.bank_name or "",
                user.deposit_account or "",
                membership.activated_at.isoformat() if membership and membership.activated_at else "",
                membership.eligible_locked_at.isoformat() if membership and membership.eligible_locked_at else "",
                membership.notes if membership and membership.notes else "",
            ]
        )

    filename = f"membresias-{_slugify_export_part(season.name)}.csv"
    return Response(
        content="\ufeff" + csv_buffer.getvalue(),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


def _get_csv_value(row: dict[str, str | None], *keys: str) -> str | None:
    normalized = {
        str(key).strip().lower(): value
        for key, value in row.items()
        if key is not None
    }
    for key in keys:
        value = normalized.get(key)
        if value is not None and value.strip():
            return value.strip()
    return None


def _parse_bool(value: str | None, default: bool = False) -> bool:
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "si", "sí", "yes", "y", "pagado"}


def _bulk_payload_from_row(
    row: dict[str, str | None],
    *,
    season_id: str,
    send_invites: bool,
) -> AdminUserCreateRequest:
    email = _get_csv_value(row, "email", "correo", "mail")
    display_name = _get_csv_value(row, "display_name", "nombre", "name", "usuario")
    username = _get_csv_value(row, "username", "nickname", "nick")
    password = _get_csv_value(row, "password", "clave", "contrasena", "contraseña")
    if not email:
        raise ValueError("Falta email")
    if not display_name:
        raise ValueError("Falta display_name/nombre")
    if not password and not send_invites:
        raise ValueError("Falta password; activa invitaciones si quieres enviar correo")

    return AdminUserCreateRequest(
        email=email or "",
        display_name=display_name or "",
        username=username,
        password=password,
        season_id=season_id,
        is_active=True,
        season_membership_active=_parse_bool(_get_csv_value(row, "is_active", "activo", "alta"), False),
        is_paid=_parse_bool(_get_csv_value(row, "is_paid", "pagado", "paid"), False),
        modality=_get_csv_value(row, "modality", "modalidad") or "pre_pago",
        aval_profile_id=_get_csv_value(row, "aval_profile_id", "aval_id"),
        notes=_get_csv_value(row, "notes", "notas", "nota"),
    )


def create_or_update_admin_user(
    payload: AdminUserCreateRequest,
    *,
    db: Session = Depends(get_db),
    current_profile: Profile = Depends(require_roles(RoleCode.ADMIN, RoleCode.MASTER_ADMIN)),
) -> AdminUserOut:
    email = payload.email.strip().lower()
    display_name = payload.display_name.strip()
    if not display_name:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Nombre requerido")

    season = season_repo.get_by_id(db, payload.season_id)
    if season is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Season not found")

    modality = normalize_optional_text(payload.modality) or "pre_pago"
    if modality not in {"pre_pago", "aval"}:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Modalidad invalida")

    aval_profile_id = normalize_optional_text(payload.aval_profile_id)
    if modality == "aval" and not aval_profile_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Selecciona un aval para esta modalidad",
        )
    if aval_profile_id and profile_repo.get_by_id(db, aval_profile_id) is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Aval no encontrado")

    existing_profile = db.scalar(select(Profile).where(func.lower(Profile.email) == email))
    if existing_profile is None:
        try:
            auth_user = (
                supabase_admin_service.create_user(
                    email=email,
                    display_name=display_name,
                    password=payload.password,
                )
                if payload.password
                else supabase_admin_service.invite_user(email=email, display_name=display_name)
            )
        except SupabaseAdminError as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

        profile = profile_repo.get_by_auth_user_id(db, auth_user.auth_user_id)
        if profile is None:
            profile = profile_repo.create_from_auth_user(db, auth_user)
    else:
        profile = existing_profile
        if payload.password:
            try:
                supabase_admin_service.update_user_password(
                    auth_user_id=profile.auth_user_id,
                    password=payload.password,
                )
            except SupabaseAdminError as exc:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    if aval_profile_id == profile.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No puedes seleccionarlo como su propio aval",
        )

    profile.email = email
    profile.display_name = display_name
    try:
        assign_profile_username(db, profile, payload.username)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    profile.modality = modality
    profile.aval_profile_id = aval_profile_id if modality == "aval" else None
    profile.is_active = payload.is_active
    db.add(profile)
    db.flush()

    did_freeze = season_eligibility_service.freeze_season_if_due(db, season)
    if did_freeze:
        db.flush()
        db.refresh(season)

    membership = season_membership_repo.get_for_profile_and_season(db, profile.id, season.id)
    if membership is None:
        membership = SeasonMembership(season_id=season.id, profile_id=profile.id)
    membership.is_active = payload.season_membership_active
    membership.is_paid = payload.is_paid
    membership.notes = normalize_optional_text(payload.notes)
    if payload.season_membership_active:
        membership.activated_at = datetime.now(UTC)
        membership.activated_by_profile_id = current_profile.id
    if not season_eligibility_service.is_locked(db, season):
        membership.eligible_for_scoring = membership.is_active
        membership.eligible_locked_at = None
    elif membership.eligible_locked_at is None:
        membership.eligible_for_scoring = False
        membership.eligible_locked_at = datetime.now(UTC)
    season_membership_repo.save(db, membership)

    db.commit()
    db.refresh(profile)
    return build_admin_user_out(db, profile, season)


@router.post("/users", response_model=AdminUserOut, status_code=status.HTTP_201_CREATED)
def create_user(
    payload: AdminUserCreateRequest,
    db: Session = Depends(get_db),
    current_profile: Profile = Depends(require_roles(RoleCode.ADMIN, RoleCode.MASTER_ADMIN)),
) -> AdminUserOut:
    return create_or_update_admin_user(payload, db=db, current_profile=current_profile)


@router.post("/users/bulk", response_model=AdminUserBulkCreateResponse)
def bulk_create_users(
    payload: AdminUserBulkCreateRequest,
    db: Session = Depends(get_db),
    current_profile: Profile = Depends(require_roles(RoleCode.ADMIN, RoleCode.MASTER_ADMIN)),
) -> AdminUserBulkCreateResponse:
    season = season_repo.get_by_id(db, payload.season_id)
    if season is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Season not found")

    reader = csv.DictReader(io.StringIO(payload.csv_text.strip()))
    if not reader.fieldnames:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="CSV sin encabezados")

    rows: list[AdminUserBulkCreateRowOut] = []
    created_or_updated = 0
    for index, raw_row in enumerate(reader, start=2):
        email = _get_csv_value(raw_row, "email", "correo", "mail")
        display_name = _get_csv_value(raw_row, "display_name", "nombre", "name", "usuario")
        try:
            user_payload = _bulk_payload_from_row(
                raw_row,
                season_id=payload.season_id,
                send_invites=payload.send_invites,
            )
            created = create_or_update_admin_user(
                user_payload,
                db=db,
                current_profile=current_profile,
            )
            created_or_updated += 1
            rows.append(
                AdminUserBulkCreateRowOut(
                    row_number=index,
                    email=created.email,
                    display_name=created.display_name,
                    status="ok",
                    detail="Creado o actualizado",
                )
            )
        except (HTTPException, ValueError, ValidationError) as exc:
            db.rollback()
            detail = exc.detail if isinstance(exc, HTTPException) else str(exc)
            rows.append(
                AdminUserBulkCreateRowOut(
                    row_number=index,
                    email=email,
                    display_name=display_name,
                    status="error",
                    detail=str(detail),
                )
            )

    return AdminUserBulkCreateResponse(
        created_or_updated=created_or_updated,
        failed=len(rows) - created_or_updated,
        rows=rows,
    )


@router.put("/users/{profile_id}/access", response_model=AdminUserOut)
def update_user_access(
    profile_id: str,
    payload: UserAccessUpdateRequest,
    db: Session = Depends(get_db),
    _: Profile = Depends(require_roles(RoleCode.ADMIN, RoleCode.MASTER_ADMIN)),
) -> AdminUserOut:
    profile = profile_repo.get_by_id(db, profile_id)
    if profile is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    profile.is_active = payload.is_active
    db.add(profile)
    db.commit()
    db.refresh(profile)
    season = get_selected_season(db)
    if season is not None:
        did_freeze = season_eligibility_service.freeze_season_if_due(db, season)
        if did_freeze:
            db.commit()
            db.refresh(season)
    return build_admin_user_out(db, profile, season)


@router.put("/users/{profile_id}/billing", response_model=AdminUserOut)
def update_user_billing(
    profile_id: str,
    payload: AdminUserBillingUpdateRequest,
    db: Session = Depends(get_db),
    _: Profile = Depends(require_roles(RoleCode.ADMIN, RoleCode.MASTER_ADMIN)),
) -> AdminUserOut:
    profile = profile_repo.get_by_id(db, profile_id)
    if profile is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    modality = normalize_optional_text(payload.modality) or "pre_pago"
    if modality not in {"pre_pago", "aval"}:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Modalidad invalida")

    aval_profile_id = normalize_optional_text(payload.aval_profile_id)
    if modality == "aval" and not aval_profile_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Selecciona un aval para esta modalidad")
    if aval_profile_id == profile.id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No puedes seleccionarlo como su propio aval")
    if aval_profile_id and profile_repo.get_by_id(db, aval_profile_id) is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Aval no encontrado")

    profile.modality = modality
    profile.aval_profile_id = aval_profile_id if modality == "aval" else None
    db.add(profile)
    db.commit()
    db.refresh(profile)
    season = get_selected_season(db)
    return build_admin_user_out(db, profile, season)


@router.put("/users/{profile_id}/password", response_model=AdminUserOut)
def update_user_password(
    profile_id: str,
    payload: AdminUserPasswordUpdateRequest,
    db: Session = Depends(get_db),
    _: Profile = Depends(require_roles(RoleCode.ADMIN, RoleCode.MASTER_ADMIN)),
) -> AdminUserOut:
    profile = profile_repo.get_by_id(db, profile_id)
    if profile is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    if not profile.auth_user_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="El usuario no esta vinculado a Supabase Auth",
        )

    try:
        supabase_admin_service.update_user_password(
            auth_user_id=profile.auth_user_id,
            password=payload.password,
        )
    except SupabaseAdminError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    season = get_selected_season(db)
    return build_admin_user_out(db, profile, season)


@router.delete("/users/{profile_id}")
def delete_user(
    profile_id: str,
    db: Session = Depends(get_db),
    current_profile: Profile = Depends(require_roles(RoleCode.ADMIN, RoleCode.MASTER_ADMIN)),
) -> dict[str, bool]:
    profile = profile_repo.get_by_id(db, profile_id)
    if profile is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    if profile.id == current_profile.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No te puedes borrar a ti mismo desde este panel",
        )

    if current_profile.role_code != RoleCode.MASTER_ADMIN and profile.role_code == RoleCode.MASTER_ADMIN:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Solo un super admin puede borrar esta cuenta",
        )

    if profile.role_code in {RoleCode.ADMIN, RoleCode.MASTER_ADMIN}:
        admin_count = db.scalar(
            select(func.count())
            .select_from(Profile)
            .where(Profile.role_code.in_([RoleCode.ADMIN, RoleCode.MASTER_ADMIN]))
        ) or 0
        if int(admin_count) <= 1:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="No puedes borrar al ultimo admin de la app",
            )

    if profile.auth_user_id:
        try:
            supabase_admin_service.delete_user(auth_user_id=profile.auth_user_id)
        except SupabaseAdminError as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    db.delete(profile)
    db.commit()
    return {"ok": True}


@router.put("/users/{profile_id}/season-membership", response_model=AdminUserOut)
def upsert_user_season_membership(
    profile_id: str,
    payload: UserSeasonMembershipUpdateRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_profile: Profile = Depends(require_roles(RoleCode.ADMIN, RoleCode.MASTER_ADMIN)),
) -> AdminUserOut:
    profile = profile_repo.get_by_id(db, profile_id)
    if profile is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    season = season_repo.get_by_id(db, payload.season_id)
    if season is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Season not found")

    did_freeze = season_eligibility_service.freeze_season_if_due(db, season)
    if did_freeze:
        db.commit()
        db.refresh(season)

    membership = season_membership_repo.get_for_profile_and_season(db, profile.id, season.id)
    if membership is None:
        membership = SeasonMembership(
            season_id=season.id,
            profile_id=profile.id,
        )
        if season_eligibility_service.is_locked(db, season):
            membership.eligible_for_scoring = False
            membership.eligible_locked_at = datetime.now(UTC)

    membership.is_active = payload.is_active
    membership.is_paid = payload.is_paid
    membership.notes = normalize_optional_text(payload.notes)
    if payload.is_active:
        membership.activated_at = datetime.now(UTC)
        membership.activated_by_profile_id = current_profile.id
    if not season_eligibility_service.is_locked(db, season):
        membership.eligible_for_scoring = membership.is_active
        membership.eligible_locked_at = None
    season_membership_repo.save(db, membership)
    db.commit()
    background_tasks.add_task(run_scoring_recalculate_background)
    return build_admin_user_out(db, profile, season)


@router.put("/users/{profile_id}/survivor-membership", response_model=AdminUserOut)
def upsert_user_survivor_membership(
    profile_id: str,
    payload: UserSurvivorMembershipUpdateRequest,
    db: Session = Depends(get_db),
    _: Profile = Depends(require_roles(RoleCode.ADMIN, RoleCode.MASTER_ADMIN)),
) -> AdminUserOut:
    profile = profile_repo.get_by_id(db, profile_id)
    if profile is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    season = season_repo.get_by_id(db, payload.season_id)
    if season is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Season not found")
    if not is_survivor_available_for_season(season):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Survivor no esta disponible para este torneo",
        )

    membership = db.scalar(
        select(SurvivorMembership).where(
            SurvivorMembership.season_id == season.id,
            SurvivorMembership.profile_id == profile.id,
        )
    )
    if membership is None:
        membership = SurvivorMembership(
            season_id=season.id,
            profile_id=profile.id,
        )

    membership.is_active = payload.is_active
    if payload.is_active and membership.joined_at is None:
        membership.joined_at = datetime.now(UTC)

    db.add(membership)
    db.commit()
    return build_admin_user_out(db, profile, season)


@router.get("/settings", response_model=AdminSettingsOut)
def get_admin_settings(
    season_id: str | None = None,
    db: Session = Depends(get_db),
    _: Profile = Depends(require_roles(RoleCode.ADMIN, RoleCode.MASTER_ADMIN)),
) -> AdminSettingsOut:
    return get_admin_settings_payload(db, season_id=season_id)


@router.put("/settings", response_model=AdminSettingsOut)
def update_admin_settings(
    payload: AdminSettingsUpdateRequest,
    set_active: bool = True,
    db: Session = Depends(get_db),
    _: Profile = Depends(require_roles(RoleCode.ADMIN, RoleCode.MASTER_ADMIN)),
) -> AdminSettingsOut:
    season = season_repo.get_by_id(db, payload.active_season_id)
    if season is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Season not found")
    commerce_settings = get_or_create_commerce_settings(db)

    if payload.start_matchday_id:
        start_matchday = matchday_repo.get_by_id(db, payload.start_matchday_id)
        if start_matchday is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Matchday not found")
        if start_matchday.season_id != season.id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="La jornada inicial no pertenece al torneo activo",
            )
        season.start_matchday_id = start_matchday.id
        season.participants_lock_at = start_matchday.starts_at
    else:
        season.start_matchday_id = None
        season.participants_lock_at = None

    if payload.end_matchday_id:
        end_matchday = matchday_repo.get_by_id(db, payload.end_matchday_id)
        if end_matchday is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Matchday not found")
        if end_matchday.season_id != season.id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="La jornada final no pertenece al torneo activo",
            )
        if payload.start_matchday_id and end_matchday.number < start_matchday.number:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="La jornada final no puede ir antes de la jornada inicial",
            )
        season.end_matchday_id = end_matchday.id
    else:
        season.end_matchday_id = None

    payout_pct = payload.first_place_pct + payload.second_place_pct + payload.third_place_pct
    if payout_pct > 100:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="La suma de porcentajes de premios finales no puede exceder 100",
        )

    season.entry_fee_amount = Decimal(str(payload.entry_fee_amount))
    season.weekly_first_place_amount = Decimal(str(payload.weekly_first_place_amount))
    season.weekly_second_place_amount = Decimal(str(payload.weekly_second_place_amount))
    season.weekly_third_place_amount = Decimal(str(payload.weekly_third_place_amount))
    season.admin_commission_pct = Decimal(str(payload.admin_commission_pct))
    season.reserve_pct = Decimal(str(payload.reserve_pct))
    season.first_place_pct = Decimal(str(payload.first_place_pct))
    season.second_place_pct = Decimal(str(payload.second_place_pct))
    season.third_place_pct = Decimal(str(payload.third_place_pct))
    commerce_settings.app_icon_url = payload.app_icon_url
    commerce_settings.show_live_tab = payload.show_live_tab

    stored_rule_values = {
        rule.rule_key: rule.points
        for rule in db.scalars(
            select(ScoringRule).where(
                ScoringRule.rule_key.in_(["result_correct", "exact_score", "advancing_team"]),
                ScoringRule.is_active.is_(True),
            )
        )
    }
    scoring_rules_changed = any(
        [
            stored_rule_values.get("result_correct", DEFAULT_RESULT_CORRECT_POINTS) != payload.result_correct_points,
            stored_rule_values.get("exact_score", DEFAULT_EXACT_SCORE_POINTS) != payload.exact_score_points,
            stored_rule_values.get("advancing_team", 1) != payload.advancing_team_points,
        ]
    )

    if set_active:
        set_active_season(db, season)
    season_repo.save(db, season)
    db.add(commerce_settings)
    upsert_scoring_rule(db, "result_correct", payload.result_correct_points)
    upsert_scoring_rule(db, "exact_score", payload.exact_score_points)
    upsert_scoring_rule(db, "advancing_team", payload.advancing_team_points)
    if scoring_rules_changed:
        recalculate_summary = ScoringService().recalculate(db)
    else:
        recalculate_summary = ScoringService().recalculate_season(db, season.id)
    return get_admin_settings_payload(
        db,
        season_id=season.id,
        evaluated_picks=recalculate_summary["evaluated_picks"],
        weekly_leaders=recalculate_summary["weekly_leaders"],
    )


@router.post("/seasons", response_model=SeasonOut, status_code=201)
def create_season(
    payload: SeasonCreateRequest,
    db: Session = Depends(get_db),
    _: Profile = Depends(require_roles(RoleCode.ADMIN, RoleCode.MASTER_ADMIN)),
) -> SeasonOut:
    if payload.visibility_status == SeasonVisibilityStatus.TESTING and payload.is_active:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Un torneo de pruebas no puede ser la temporada default",
        )
    competition = db.get(Competition, payload.competition_id) if payload.competition_id else None
    if payload.competition_id and competition is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Competition not found")
    season = season_repo.create(
        db,
        Season(
            name=payload.name.strip(),
            slug=normalize_slug(payload.slug),
            competition_id=competition.id if competition is not None else None,
            tournament_format=payload.tournament_format,
            structure_format=(
                competition.structure_format
                if competition is not None
                else (
                    CompetitionStructureFormat.GROUPS_PLAYOFF
                    if payload.tournament_format == TournamentFormat.WORLD_CUP
                    else CompetitionStructureFormat.LEAGUE_TABLE
                )
            ),
            structure_config=dict(competition.structure_config or {}) if competition is not None else {},
            visibility_status=payload.visibility_status,
            live_dashboard_enabled=False,
            is_active=payload.is_active,
            registration_closed=payload.registration_closed,
            survivor_enabled=payload.survivor_enabled,
            survivor_name=normalize_optional_text(payload.survivor_name),
            survivor_max_lives=payload.survivor_max_lives,
            survivor_registration_closed=payload.survivor_registration_closed,
            survivor_registration_lock_at=payload.survivor_registration_lock_at,
        ),
    )
    db.flush()
    if season.structure_format == CompetitionStructureFormat.LEAGUES_CUP:
        db.add_all(
            [
                WorldCupGroup(
                    season_id=season.id,
                    group_label="LIGA MX",
                    display_name="Tabla LIGA MX",
                    sort_order=10,
                ),
                WorldCupGroup(
                    season_id=season.id,
                    group_label="MLS",
                    display_name="Tabla MLS",
                    sort_order=20,
                ),
            ]
        )
    if competition is not None:
        for team_id in db.scalars(
            select(CompetitionTeam.team_id).where(CompetitionTeam.competition_id == competition.id)
        ):
            db.add(SeasonTeam(season_id=season.id, team_id=team_id))
    if season.is_active:
        set_active_season(db, season)
    db.commit()
    db.refresh(season)
    return build_season_out(season, competition)


@router.put("/seasons/{season_id}", response_model=SeasonOut)
def update_season(
    season_id: str,
    payload: SeasonUpdateRequest,
    db: Session = Depends(get_db),
    _: Profile = Depends(require_roles(RoleCode.ADMIN, RoleCode.MASTER_ADMIN)),
) -> SeasonOut:
    if payload.visibility_status == SeasonVisibilityStatus.TESTING and payload.is_active:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Un torneo de pruebas no puede ser la temporada default",
        )
    season = season_repo.get_by_id(db, season_id)
    if season is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Season not found")

    competition = db.get(Competition, payload.competition_id) if payload.competition_id else None
    if payload.competition_id and competition is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Competition not found")

    is_archiving = payload.visibility_status == SeasonVisibilityStatus.ARCHIVED
    competition_changed = season.competition_id != (competition.id if competition is not None else None)
    season.name = payload.name.strip()
    season.slug = normalize_slug(payload.slug)
    season.competition_id = competition.id if competition is not None else None
    season.tournament_format = payload.tournament_format
    if competition_changed:
        season.structure_format = (
            competition.structure_format
            if competition is not None
            else CompetitionStructureFormat.LEAGUE_TABLE
        )
        season.structure_config = dict(competition.structure_config or {}) if competition is not None else {}
        db.execute(delete(SeasonTeam).where(SeasonTeam.season_id == season.id))
        if competition is not None:
            for team_id in db.scalars(
                select(CompetitionTeam.team_id).where(CompetitionTeam.competition_id == competition.id)
            ):
                db.add(SeasonTeam(season_id=season.id, team_id=team_id))
    season.visibility_status = payload.visibility_status
    season.live_dashboard_enabled = False
    season.is_active = False if is_archiving else payload.is_active
    season.registration_closed = True if is_archiving else payload.registration_closed
    season.survivor_enabled = payload.survivor_enabled
    season.survivor_name = normalize_optional_text(payload.survivor_name)
    season.survivor_max_lives = payload.survivor_max_lives
    season.survivor_registration_closed = True if is_archiving else payload.survivor_registration_closed
    season.survivor_registration_lock_at = payload.survivor_registration_lock_at
    season_repo.save(db, season)
    if season.is_active:
        set_active_season(db, season)
    db.commit()
    db.refresh(season)
    return build_season_out(season, competition)


@router.patch("/seasons/{season_id}/structure", response_model=SeasonOut)
def update_season_structure(
    season_id: str,
    payload: SeasonStructureUpdateRequest,
    db: Session = Depends(get_db),
    _: Profile = Depends(require_roles(RoleCode.ADMIN, RoleCode.MASTER_ADMIN)),
) -> SeasonOut:
    season = season_repo.get_by_id(db, season_id)
    if season is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Season not found")
    season.structure_format = payload.structure_format
    if payload.structure_format == CompetitionStructureFormat.LEAGUES_CUP:
        season.structure_config = {
            **dict(season.structure_config or {}),
            "leagues": ["MLS", "LIGA MX"],
            "phase_one_matches_per_team": 3,
            "regulation_win_points": 3,
            "shootout_win_points": 2,
            "shootout_loss_points": 1,
            "qualifiers_per_league": 4,
            "playoff_seed_count": 8,
            "playoff_rounds": ["Cuartos de final", "Semifinales", "Final", "Tercer lugar"],
            "reseed_after_each_round": False,
        }
    db.add(season)
    db.commit()
    db.refresh(season)
    competition = db.get(Competition, season.competition_id) if season.competition_id else None
    return build_season_out(season, competition)


@router.get("/competitions", response_model=list[CompetitionOut])
def list_competitions(
    db: Session = Depends(get_db),
    _: Profile = Depends(require_roles(RoleCode.ADMIN, RoleCode.MASTER_ADMIN)),
) -> list[CompetitionOut]:
    rows = list(
        db.scalars(
            select(Competition)
            .order_by(Competition.sort_order.asc(), Competition.sport_name.asc(), Competition.name.asc())
        )
    )
    return [build_competition_out(row) for row in rows]


@router.post("/competitions", response_model=CompetitionOut, status_code=201)
def create_competition(
    payload: CompetitionCreateRequest,
    db: Session = Depends(get_db),
    _: Profile = Depends(require_roles(RoleCode.ADMIN, RoleCode.MASTER_ADMIN)),
) -> CompetitionOut:
    row = Competition(
        sport_name=payload.sport_name.strip(),
        name=payload.name.strip() or f"Jornada {payload.number}",
        slug=normalize_slug(payload.slug),
        provider_league_id=normalize_optional_text(payload.provider_league_id),
        structure_format=payload.structure_format,
        structure_config=payload.structure_config,
        is_active=payload.is_active,
        sort_order=payload.sort_order,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return build_competition_out(row)


@router.put("/competitions/{competition_id}", response_model=CompetitionOut)
def update_competition(
    competition_id: str,
    payload: CompetitionUpdateRequest,
    db: Session = Depends(get_db),
    _: Profile = Depends(require_roles(RoleCode.ADMIN, RoleCode.MASTER_ADMIN)),
) -> CompetitionOut:
    row = db.get(Competition, competition_id)
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Competition not found")

    row.sport_name = payload.sport_name.strip()
    row.name = payload.name.strip()
    row.slug = normalize_slug(payload.slug)
    row.provider_league_id = normalize_optional_text(payload.provider_league_id)
    row.structure_format = payload.structure_format
    row.structure_config = payload.structure_config
    row.is_active = payload.is_active
    row.sort_order = payload.sort_order
    db.add(row)
    db.commit()
    db.refresh(row)
    return build_competition_out(row)


@router.post("/teams", response_model=TeamOut, status_code=201)
def create_team(
    payload: TeamCreateRequest,
    db: Session = Depends(get_db),
    _: Profile = Depends(require_roles(RoleCode.ADMIN, RoleCode.MASTER_ADMIN)),
) -> TeamOut:
    requested_competition_ids = payload.competition_ids or ([payload.competition_id] if payload.competition_id else [])
    team = team_repo.create(
        db,
        Team(
            competition_id=requested_competition_ids[0] if requested_competition_ids else None,
            name=payload.name.strip(),
            short_name=payload.short_name.strip().upper(),
            slug=normalize_slug(payload.slug),
            external_id=normalize_optional_text(payload.external_id),
            crest_url=normalize_optional_text(payload.crest_url),
            home_venue=normalize_optional_text(payload.home_venue),
            primary_color=normalize_optional_text(payload.primary_color),
            secondary_color=normalize_optional_text(payload.secondary_color),
            accent_color=normalize_optional_text(payload.accent_color),
        ),
    )
    db.flush()
    apply_automatic_team_palette(team)
    competitions = sync_team_competitions(db, team, requested_competition_ids)
    db.commit()
    db.refresh(team)
    return build_team_out(
        team,
        competitions[0] if competitions else None,
        [competition.id for competition in competitions],
        [competition.name for competition in competitions],
    )


@router.post("/teams/import-csv", response_model=TeamBulkImportResponse)
def import_teams_csv(
    payload: TeamBulkImportRequest,
    db: Session = Depends(get_db),
    _: Profile = Depends(require_roles(RoleCode.ADMIN, RoleCode.MASTER_ADMIN)),
) -> TeamBulkImportResponse:
    competition = db.get(Competition, payload.competition_id)
    if competition is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Competition not found")

    reader = csv.DictReader(io.StringIO(payload.csv_text.lstrip("\ufeff").strip()))
    normalized_headers = {
        (header or "").strip().lower()
        for header in (reader.fieldnames or [])
    }
    required_headers = {"name", "short_name", "slug"}
    if not required_headers.issubset(normalized_headers):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="El CSV requiere las columnas name, short_name y slug",
        )

    created = 0
    updated = 0
    failed = 0
    results: list[TeamBulkImportRowOut] = []
    for row_number, raw_row in enumerate(reader, start=2):
        row = {(key or "").strip().lower(): (value or "").strip() for key, value in raw_row.items()}
        name = row.get("name", "")
        short_name = row.get("short_name", "").upper()
        slug = normalize_slug(row.get("slug", ""))
        try:
            if not name or not short_name or not slug:
                raise ValueError("name, short_name y slug son obligatorios")
            if not 2 <= len(short_name) <= 16:
                raise ValueError("short_name debe tener entre 2 y 16 caracteres")

            with db.begin_nested():
                team = db.scalar(select(Team).where(Team.slug == slug))
                row_status = "updated" if team is not None else "created"
                if team is None:
                    team = Team(name=name, short_name=short_name, slug=slug)
                    db.add(team)
                    db.flush()

                team.name = name
                team.short_name = short_name
                team.external_id = normalize_optional_text(row.get("external_id"))
                team.crest_url = normalize_optional_text(row.get("crest_url"))
                team.home_venue = normalize_optional_text(row.get("home_venue"))
                apply_automatic_team_palette(team)
                if team.competition_id is None:
                    team.competition_id = competition.id
                membership = db.scalar(
                    select(CompetitionTeam).where(
                        CompetitionTeam.competition_id == competition.id,
                        CompetitionTeam.team_id == team.id,
                    )
                )
                if membership is None:
                    db.add(CompetitionTeam(competition_id=competition.id, team_id=team.id))
                db.add(team)
                db.flush()

            if row_status == "created":
                created += 1
            else:
                updated += 1
            results.append(
                TeamBulkImportRowOut(
                    row_number=row_number,
                    slug=slug,
                    name=name,
                    status=row_status,
                )
            )
        except Exception as exc:
            failed += 1
            results.append(
                TeamBulkImportRowOut(
                    row_number=row_number,
                    slug=slug or None,
                    name=name or None,
                    status="failed",
                    detail=str(exc),
                )
            )

    db.commit()
    return TeamBulkImportResponse(created=created, updated=updated, failed=failed, rows=results)


@router.post("/teams/refresh-colors", response_model=TeamPaletteRefreshResponse)
def refresh_team_colors(
    competition_id: str,
    db: Session = Depends(get_db),
    _: Profile = Depends(require_roles(RoleCode.ADMIN, RoleCode.MASTER_ADMIN)),
) -> TeamPaletteRefreshResponse:
    competition = db.get(Competition, competition_id)
    if competition is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Competition not found")
    linked_ids = set(
        db.scalars(
            select(CompetitionTeam.team_id).where(CompetitionTeam.competition_id == competition_id)
        )
    )
    linked_ids.update(
        db.scalars(select(Team.id).where(Team.competition_id == competition_id))
    )
    teams = list(db.scalars(select(Team).where(Team.id.in_(linked_ids)))) if linked_ids else []
    candidates = [team for team in teams if team.crest_url]
    palettes: dict[str, tuple[str | None, str | None, str | None]] = {}
    failed = len(teams) - len(candidates)

    with ThreadPoolExecutor(max_workers=min(6, max(1, len(candidates)))) as executor:
        futures = {
            executor.submit(extract_team_palette, team.crest_url): team.id
            for team in candidates
        }
        for future in as_completed(futures):
            team_id = futures[future]
            try:
                palettes[team_id] = future.result()
            except Exception as exc:
                failed += 1
                logger.warning("No se pudo recalcular la paleta de %s: %s", team_id, exc)

    updated = 0
    for team in teams:
        palette = palettes.get(team.id)
        if palette is None:
            continue
        team.primary_color, team.secondary_color, team.accent_color = palette
        db.add(team)
        if palette[0] is not None:
            updated += 1
        else:
            failed += 1
    db.commit()
    return TeamPaletteRefreshResponse(processed=len(teams), updated=updated, failed=failed)


@router.put("/teams/{team_id}", response_model=TeamOut)
def update_team(
    team_id: str,
    payload: TeamUpdateRequest,
    db: Session = Depends(get_db),
    _: Profile = Depends(require_roles(RoleCode.ADMIN, RoleCode.MASTER_ADMIN)),
) -> TeamOut:
    team = team_repo.get_by_id(db, team_id)
    if team is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Team not found")

    requested_competition_ids = payload.competition_ids or ([payload.competition_id] if payload.competition_id else [])
    team.name = payload.name.strip()
    team.short_name = payload.short_name.strip().upper()
    team.slug = normalize_slug(payload.slug)
    team.external_id = normalize_optional_text(payload.external_id)
    previous_crest_url = team.crest_url
    team.crest_url = normalize_optional_text(payload.crest_url)
    team.home_venue = normalize_optional_text(payload.home_venue)
    team.primary_color = normalize_optional_text(payload.primary_color)
    team.secondary_color = normalize_optional_text(payload.secondary_color)
    team.accent_color = normalize_optional_text(payload.accent_color)
    crest_changed = previous_crest_url != team.crest_url
    if crest_changed or not all([team.primary_color, team.secondary_color, team.accent_color]):
        apply_automatic_team_palette(team)
    team_repo.save(db, team)
    competitions = sync_team_competitions(db, team, requested_competition_ids)
    db.commit()
    db.refresh(team)
    return build_team_out(
        team,
        competitions[0] if competitions else None,
        [competition.id for competition in competitions],
        [competition.name for competition in competitions],
    )


@router.get("/historical-champions", response_model=list[HistoricalChampionOut])
def list_historical_champions(
    db: Session = Depends(get_db),
    _: Profile = Depends(require_roles(RoleCode.ADMIN, RoleCode.MASTER_ADMIN)),
) -> list[HistoricalChampionOut]:
    trophy_map = {
        trophy.id: trophy.name
        for trophy in db.scalars(select(TrophyAsset)).all()
    }
    return [
        build_historical_champion_out(row, trophy_map.get(row.trophy_asset_id))
        for row in list_historical_champions_rows(db)
    ]


@router.post("/historical-champions", response_model=HistoricalChampionOut, status_code=201)
def create_historical_champion(
    payload: HistoricalChampionCreateRequest,
    db: Session = Depends(get_db),
    _: Profile = Depends(require_roles(RoleCode.ADMIN, RoleCode.MASTER_ADMIN)),
) -> HistoricalChampionOut:
    trophy = db.get(TrophyAsset, payload.trophy_asset_id) if payload.trophy_asset_id else None
    if payload.trophy_asset_id and trophy is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Trophy asset not found")
    awarded_profile = db.get(Profile, payload.awarded_profile_id) if payload.awarded_profile_id else None
    if payload.awarded_profile_id and awarded_profile is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Profile not found")
    row = HistoricalChampion(
        tournament_name=payload.tournament_name.strip(),
        champion_name=awarded_profile.display_name if awarded_profile is not None else payload.user_name.strip(),
        awarded_profile_id=awarded_profile.id if awarded_profile is not None else None,
        place_label=payload.place_label.strip(),
        trophy_asset_id=trophy.id if trophy is not None else None,
        image_url=trophy.image_url if trophy is not None else normalize_optional_text(payload.image_url),
        total_points=payload.total_points,
    )
    db.add(row)
    db.flush()
    sync_personal_award_from_historical_champion(db, row)
    db.commit()
    db.refresh(row)
    return build_historical_champion_out(row, trophy.name if trophy is not None else None)


@router.put("/historical-champions/{champion_id}", response_model=HistoricalChampionOut)
def update_historical_champion(
    champion_id: str,
    payload: HistoricalChampionUpdateRequest,
    db: Session = Depends(get_db),
    _: Profile = Depends(require_roles(RoleCode.ADMIN, RoleCode.MASTER_ADMIN)),
) -> HistoricalChampionOut:
    row = db.get(HistoricalChampion, champion_id)
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Historical champion not found")

    trophy = db.get(TrophyAsset, payload.trophy_asset_id) if payload.trophy_asset_id else None
    if payload.trophy_asset_id and trophy is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Trophy asset not found")
    awarded_profile = db.get(Profile, payload.awarded_profile_id) if payload.awarded_profile_id else None
    if payload.awarded_profile_id and awarded_profile is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Profile not found")
    row.tournament_name = payload.tournament_name.strip()
    row.champion_name = awarded_profile.display_name if awarded_profile is not None else payload.user_name.strip()
    row.awarded_profile_id = awarded_profile.id if awarded_profile is not None else None
    row.place_label = payload.place_label.strip()
    row.trophy_asset_id = trophy.id if trophy is not None else None
    row.image_url = trophy.image_url if trophy is not None else normalize_optional_text(payload.image_url)
    row.total_points = payload.total_points
    db.add(row)
    sync_personal_award_from_historical_champion(db, row)
    db.commit()
    db.refresh(row)
    return build_historical_champion_out(row, trophy.name if trophy is not None else None)


@router.delete("/historical-champions/{champion_id}")
def delete_historical_champion(
    champion_id: str,
    db: Session = Depends(get_db),
    _: Profile = Depends(require_roles(RoleCode.ADMIN, RoleCode.MASTER_ADMIN)),
) -> dict[str, str]:
    row = db.get(HistoricalChampion, champion_id)
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Historical champion not found")

    existing_award = db.scalar(
        select(ProfileTrophyAward).where(
            ProfileTrophyAward.source_type == "historical_champion",
            ProfileTrophyAward.source_ref_id == row.id,
        )
    )
    if existing_award is not None:
        db.delete(existing_award)
    db.delete(row)
    db.commit()
    return {"status": "deleted", "champion_id": champion_id}


@router.get("/trophy-assets", response_model=list[TrophyAssetOut])
def list_trophy_assets(
    db: Session = Depends(get_db),
    _: Profile = Depends(require_roles(RoleCode.ADMIN, RoleCode.MASTER_ADMIN)),
) -> list[TrophyAssetOut]:
    return [build_trophy_asset_out(row) for row in list_trophy_assets_rows(db)]


@router.post("/trophy-assets", response_model=TrophyAssetOut, status_code=201)
def create_trophy_asset(
    payload: TrophyAssetCreateRequest,
    db: Session = Depends(get_db),
    _: Profile = Depends(require_roles(RoleCode.ADMIN, RoleCode.MASTER_ADMIN)),
) -> TrophyAssetOut:
    if payload.season_id and db.get(Season, payload.season_id) is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Season not found")

    resolved_category = resolve_trophy_asset_category(payload)
    normalized_asset_code = normalize_optional_text(payload.asset_code)
    if normalized_asset_code is not None:
        normalized_asset_code = normalize_slug(normalized_asset_code)
    else:
        normalized_asset_code = build_trophy_asset_code(payload.name, resolved_category)

    code_candidate = normalized_asset_code
    suffix = 2
    while db.scalar(select(TrophyAsset).where(TrophyAsset.asset_code == code_candidate)) is not None:
        code_candidate = f"{normalized_asset_code[:110]}-{suffix}"
        suffix += 1
    normalized_asset_code = code_candidate

    row = TrophyAsset(
        name=payload.name.strip(),
        category=resolved_category,
        asset_code=normalized_asset_code,
        season_id=payload.season_id,
        matchday_number=payload.matchday_number,
        award_place_label=normalize_optional_text(payload.award_place_label),
        image_url=normalize_optional_text(payload.image_url),
    )
    db.add(row)
    db.flush()
    sync_weekly_awards_for_trophy_asset(db, row)
    db.commit()
    db.refresh(row)
    return build_trophy_asset_out(row)


@router.put("/trophy-assets/{asset_id}", response_model=TrophyAssetOut)
def update_trophy_asset(
    asset_id: str,
    payload: TrophyAssetUpdateRequest,
    db: Session = Depends(get_db),
    _: Profile = Depends(require_roles(RoleCode.ADMIN, RoleCode.MASTER_ADMIN)),
) -> TrophyAssetOut:
    row = db.get(TrophyAsset, asset_id)
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Trophy asset not found")

    if payload.season_id and db.get(Season, payload.season_id) is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Season not found")

    resolved_category = resolve_trophy_asset_category(payload)
    normalized_asset_code = normalize_optional_text(payload.asset_code)
    if normalized_asset_code is not None:
        normalized_asset_code = normalize_slug(normalized_asset_code)
    else:
        normalized_asset_code = build_trophy_asset_code(payload.name, resolved_category)

    code_candidate = normalized_asset_code
    suffix = 2
    while db.scalar(
        select(TrophyAsset).where(
            TrophyAsset.asset_code == code_candidate,
            TrophyAsset.id != asset_id,
        )
    ) is not None:
        code_candidate = f"{normalized_asset_code[:110]}-{suffix}"
        suffix += 1
    normalized_asset_code = code_candidate

    row.name = payload.name.strip()
    row.category = resolved_category
    row.asset_code = normalized_asset_code
    row.season_id = payload.season_id
    row.matchday_number = payload.matchday_number
    row.award_place_label = normalize_optional_text(payload.award_place_label)
    row.image_url = normalize_optional_text(payload.image_url)
    db.add(row)
    db.flush()
    sync_weekly_awards_for_trophy_asset(db, row)
    db.commit()
    db.refresh(row)
    return build_trophy_asset_out(row)


@router.delete("/trophy-assets/{asset_id}")
def delete_trophy_asset(
    asset_id: str,
    db: Session = Depends(get_db),
    _: Profile = Depends(require_roles(RoleCode.ADMIN, RoleCode.MASTER_ADMIN)),
) -> dict[str, str]:
    row = db.get(TrophyAsset, asset_id)
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Trophy asset not found")

    db.execute(
        delete(ProfileTrophyAward).where(
            ProfileTrophyAward.source_type == "weekly_matchday",
            ProfileTrophyAward.trophy_asset_id == row.id,
        )
    )
    db.delete(row)
    db.commit()
    return {"status": "deleted", "asset_id": asset_id}


@router.get("/rules", response_model=RulePageOut)
def get_admin_rules_page(
    season_id: str | None = Query(default=None),
    page_kind: RulePageKind = Query(default="regular"),
    db: Session = Depends(get_db),
    _: Profile = Depends(require_roles(RoleCode.ADMIN, RoleCode.MASTER_ADMIN)),
) -> RulePageOut:
    row = get_or_create_rule_page(db, season_id, page_kind)
    return build_rule_page_out(db, row)


@router.put("/rules", response_model=RulePageOut)
def update_admin_rules_page(
    payload: RulePageUpdateRequest,
    season_id: str | None = Query(default=None),
    page_kind: RulePageKind = Query(default="regular"),
    db: Session = Depends(get_db),
    current_profile: Profile = Depends(require_roles(RoleCode.ADMIN, RoleCode.MASTER_ADMIN)),
) -> RulePageOut:
    row = get_or_create_rule_page(db, season_id, page_kind)
    row.title = payload.title.strip()
    row.content_markdown = payload.content_markdown.strip()
    row.version_label = payload.version_label.strip() if payload.version_label and payload.version_label.strip() else None
    row.updated_by_profile_id = current_profile.id
    db.add(row)
    db.commit()
    db.refresh(row)
    return build_rule_page_out(db, row)


@router.post("/matchdays", response_model=MatchdayOut, status_code=201)
def create_matchday(
    payload: MatchdayCreateRequest,
    db: Session = Depends(get_db),
    _: Profile = Depends(require_roles(RoleCode.ADMIN, RoleCode.MASTER_ADMIN)),
) -> MatchdayOut:
    season = season_repo.get_by_id(db, payload.season_id)
    if season is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Season not found")
    ensure_matchday_can_be_saved(
        db,
        season_id=payload.season_id,
        number=payload.number,
        starts_at=payload.starts_at,
        ends_at=payload.ends_at,
    )

    matchday = Matchday(
        season_id=payload.season_id,
        number=payload.number,
        name=payload.name.strip(),
        default_lock_offset_minutes=payload.default_lock_offset_minutes,
        picks_reopened_override=False,
        status=payload.status,
        starts_at=payload.starts_at,
        ends_at=payload.ends_at,
    )
    db.add(matchday)
    db.flush()
    apply_matchday_lock_offset_to_matches(db, matchday)
    if payload.status == MatchdayStatus.ACTIVE:
        set_active_matchday(db, matchday)
    db.commit()
    db.refresh(matchday)
    return MatchdayOut.model_validate(matchday, from_attributes=True)


@router.put("/matchdays/{matchday_id}", response_model=MatchdayOut)
def update_matchday(
    matchday_id: str,
    payload: MatchdayUpdateRequest,
    db: Session = Depends(get_db),
    _: Profile = Depends(require_roles(RoleCode.ADMIN, RoleCode.MASTER_ADMIN)),
) -> MatchdayOut:
    matchday = matchday_repo.get_by_id(db, matchday_id)
    if matchday is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Matchday not found")

    season = season_repo.get_by_id(db, payload.season_id)
    if season is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Season not found")
    ensure_matchday_can_be_saved(
        db,
        season_id=payload.season_id,
        number=payload.number,
        starts_at=payload.starts_at,
        ends_at=payload.ends_at,
        existing_matchday_id=matchday.id,
    )

    matchday.season_id = payload.season_id
    matchday.number = payload.number
    matchday.name = payload.name.strip() or f"Jornada {payload.number}"
    matchday.default_lock_offset_minutes = payload.default_lock_offset_minutes
    matchday.status = payload.status
    matchday.starts_at = payload.starts_at
    matchday.ends_at = payload.ends_at
    db.add(matchday)
    db.flush()
    apply_matchday_lock_offset_to_matches(db, matchday)
    if payload.status == MatchdayStatus.ACTIVE:
        set_active_matchday(db, matchday)
    db.commit()
    db.refresh(matchday)
    return MatchdayOut.model_validate(matchday, from_attributes=True)


@router.delete("/matchdays/{matchday_id}")
def delete_matchday(
    matchday_id: str,
    db: Session = Depends(get_db),
    _: Profile = Depends(require_roles(RoleCode.ADMIN, RoleCode.MASTER_ADMIN)),
) -> dict[str, str]:
    matchday = matchday_repo.get_by_id(db, matchday_id)
    if matchday is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Matchday not found")

    seasons_to_reset = list(
        db.scalars(
            select(Season).where(
                (Season.start_matchday_id == matchday.id) | (Season.end_matchday_id == matchday.id)
            )
        )
    )
    for season in seasons_to_reset:
        if season.start_matchday_id == matchday.id:
            season.start_matchday_id = None
            season.participants_lock_at = None
        if season.end_matchday_id == matchday.id:
            season.end_matchday_id = None
        db.add(season)

    db.delete(matchday)
    db.commit()
    return {"status": "deleted", "matchday_id": matchday_id}


@router.post("/matchdays/{matchday_id}/reopen-picks")
def reopen_picks_for_matchday(
    matchday_id: str,
    db: Session = Depends(get_db),
    _: Profile = Depends(require_roles(RoleCode.ADMIN, RoleCode.MASTER_ADMIN)),
) -> dict[str, str | int]:
    matchday = matchday_repo.get_by_id(db, matchday_id)
    if matchday is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Matchday not found")

    affected_matches = reopen_matchday_picks(db, matchday)
    db.commit()
    return {"status": "reopened", "matchday_id": matchday_id, "affected_matches": affected_matches}


@router.post("/matchdays/{matchday_id}/restore-picks-lock")
def restore_picks_lock_for_matchday(
    matchday_id: str,
    db: Session = Depends(get_db),
    _: Profile = Depends(require_roles(RoleCode.ADMIN, RoleCode.MASTER_ADMIN)),
) -> dict[str, str | int]:
    matchday = matchday_repo.get_by_id(db, matchday_id)
    if matchday is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Matchday not found")

    apply_matchday_lock_offset_to_matches(db, matchday)
    affected_matches = db.scalar(select(func.count(Match.id)).where(Match.matchday_id == matchday.id)) or 0
    db.commit()
    return {"status": "restored", "matchday_id": matchday_id, "affected_matches": affected_matches}


@router.post("/matches", response_model=MatchOut, status_code=201)
def create_match(
    payload: MatchCreateRequest,
    db: Session = Depends(get_db),
    _: Profile = Depends(require_roles(RoleCode.ADMIN, RoleCode.MASTER_ADMIN)),
) -> MatchOut:
    matchday = matchday_repo.get_by_id(db, payload.matchday_id)
    if matchday is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Matchday not found")

    if payload.home_team_id:
        home_team = team_repo.get_by_id(db, payload.home_team_id)
        if home_team is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Home team not found")
    if payload.away_team_id:
        away_team = team_repo.get_by_id(db, payload.away_team_id)
        if away_team is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Away team not found")

    match = Match(
        matchday_id=payload.matchday_id,
        home_team_id=payload.home_team_id,
        away_team_id=payload.away_team_id,
        stage_type=payload.stage_type,
        group_label=normalize_optional_text(payload.group_label),
        bracket_slot=normalize_optional_text(payload.bracket_slot),
        home_placeholder=normalize_optional_text(payload.home_placeholder),
        away_placeholder=normalize_optional_text(payload.away_placeholder),
        kickoff_at=payload.kickoff_at,
        picks_lock_at=payload.picks_lock_at,
        venue=payload.venue.strip() if payload.venue else None,
        status=payload.status,
        external_id=payload.external_id.strip() if payload.external_id else None,
    )
    db.add(match)
    db.commit()
    db.refresh(match)
    return match_service.get_match(db, match.id)  # type: ignore[return-value]


@router.put("/matches/{match_id}", response_model=MatchOut)
def update_match(
    match_id: str,
    payload: MatchUpdateRequest,
    db: Session = Depends(get_db),
    _: Profile = Depends(require_roles(RoleCode.ADMIN, RoleCode.MASTER_ADMIN)),
) -> MatchOut:
    match = match_repo.get_by_id(db, match_id)
    if match is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Match not found")

    matchday = matchday_repo.get_by_id(db, payload.matchday_id)
    if matchday is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Matchday not found")

    if payload.home_team_id:
        home_team = team_repo.get_by_id(db, payload.home_team_id)
        if home_team is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Home team not found")
    if payload.away_team_id:
        away_team = team_repo.get_by_id(db, payload.away_team_id)
        if away_team is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Away team not found")

    match.matchday_id = payload.matchday_id
    match.home_team_id = payload.home_team_id
    match.away_team_id = payload.away_team_id
    match.stage_type = payload.stage_type
    match.group_label = normalize_optional_text(payload.group_label)
    match.bracket_slot = normalize_optional_text(payload.bracket_slot)
    match.home_placeholder = normalize_optional_text(payload.home_placeholder)
    match.away_placeholder = normalize_optional_text(payload.away_placeholder)
    match.kickoff_at = payload.kickoff_at
    match.picks_lock_at = payload.picks_lock_at
    match.venue = payload.venue.strip() if payload.venue else None
    match.status = payload.status
    match.external_id = payload.external_id.strip() if payload.external_id else None
    db.add(match)
    db.commit()
    db.refresh(match)
    return match_service.get_match(db, match.id)  # type: ignore[return-value]


@router.delete("/matches/{match_id}")
def delete_match(
    match_id: str,
    db: Session = Depends(get_db),
    _: Profile = Depends(require_roles(RoleCode.ADMIN, RoleCode.MASTER_ADMIN)),
) -> dict[str, str]:
    match = match_repo.get_by_id(db, match_id)
    if match is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Match not found")

    match_repo.delete(db, match)
    db.commit()
    return {"status": "deleted", "match_id": match_id}


@router.patch("/users/{profile_id}/role", response_model=ProfileOut)
def update_user_role(
    profile_id: str,
    payload: RoleUpdateRequest,
    db: Session = Depends(get_db),
    current_profile: Profile = Depends(require_roles(RoleCode.ADMIN, RoleCode.MASTER_ADMIN)),
) -> ProfileOut:
    profile = profile_repo.get_by_id(db, profile_id)
    if profile is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    if current_profile.role_code != RoleCode.MASTER_ADMIN:
        if payload.role_code == RoleCode.MASTER_ADMIN:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Solo master admin puede asignar master admin")
        if profile.role_code == RoleCode.MASTER_ADMIN:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="No puedes modificar a un master admin")
    updated = profile_repo.update_role(db, profile, payload.role_code)
    db.commit()
    db.refresh(updated)
    return ProfileOut.model_validate(updated, from_attributes=True)


@router.post("/matches/sync", response_model=SyncResponse)
def sync_admin_matches(
    db: Session = Depends(get_db),
    _: Profile = Depends(require_roles(RoleCode.ADMIN, RoleCode.MASTER_ADMIN)),
) -> SyncResponse:
    return SyncResponse(**sync_matches(db, get_provider()))


@router.get("/results", response_model=list[AdminResultRowOut])
def list_admin_results(
    matchday_id: str | None = None,
    db: Session = Depends(get_db),
    _: Profile = Depends(require_roles(RoleCode.ADMIN, RoleCode.MASTER_ADMIN)),
) -> list[AdminResultRowOut]:
    return result_service.list_admin_results(db, matchday_id=matchday_id)


@router.get("/live-scores", response_model=list[AdminLiveScoreRowOut])
def list_admin_live_scores(
    matchday_id: str,
    db: Session = Depends(get_db),
    _: Profile = Depends(require_roles(RoleCode.ADMIN, RoleCode.MASTER_ADMIN)),
) -> list[AdminLiveScoreRowOut]:
    result_rows = result_service.list_admin_results(db, matchday_id=matchday_id)
    live_by_match_id = {
        row.match_id: row
        for row in db.scalars(
            select(LiveMatchScore)
            .join(Match, Match.id == LiveMatchScore.match_id)
            .where(Match.matchday_id == matchday_id)
        )
    }
    return [
        AdminLiveScoreRowOut(
            match_id=row.match_id,
            matchday_id=row.matchday_id,
            kickoff_at=row.kickoff_at,
            match_status=row.match_status,
            home_team_name=row.home_team_name,
            away_team_name=row.away_team_name,
            live_home_score=live_by_match_id[row.match_id].home_score if row.match_id in live_by_match_id else None,
            live_away_score=live_by_match_id[row.match_id].away_score if row.match_id in live_by_match_id else None,
            official_home_score=row.home_score,
            official_away_score=row.away_score,
            official_is_official=row.is_official,
            updated_at=live_by_match_id[row.match_id].updated_at if row.match_id in live_by_match_id else None,
        )
        for row in result_rows
    ]


@router.put("/live-scores/{match_id}", response_model=AdminLiveScoreRowOut)
def update_admin_live_score(
    match_id: str,
    payload: AdminLiveScoreUpdateRequest,
    db: Session = Depends(get_db),
    current_profile: Profile = Depends(require_roles(RoleCode.ADMIN, RoleCode.MASTER_ADMIN)),
) -> AdminLiveScoreRowOut:
    match = db.get(Match, match_id)
    if match is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Match not found")
    row = db.scalar(select(LiveMatchScore).where(LiveMatchScore.match_id == match_id))
    if row is None:
        row = LiveMatchScore(match_id=match_id, home_score=payload.home_score, away_score=payload.away_score)
    row.home_score = payload.home_score
    row.away_score = payload.away_score
    row.updated_by_profile_id = current_profile.id
    db.add(row)
    db.commit()
    db.refresh(row)
    return next(
        item
        for item in list_admin_live_scores(matchday_id=match.matchday_id, db=db, _=current_profile)
        if item.match_id == match_id
    )


@router.delete("/live-scores/{match_id}", status_code=204)
def clear_admin_live_score(
    match_id: str,
    db: Session = Depends(get_db),
    _: Profile = Depends(require_roles(RoleCode.ADMIN, RoleCode.MASTER_ADMIN)),
) -> Response:
    row = db.scalar(select(LiveMatchScore).where(LiveMatchScore.match_id == match_id))
    if row is not None:
        db.delete(row)
        db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/picks", response_model=list[AdminPickRowOut])
def list_admin_picks(
    matchday_id: str,
    profile_id: str | None = None,
    vip_id: str | None = None,
    db: Session = Depends(get_db),
    _: Profile = Depends(require_roles(RoleCode.ADMIN, RoleCode.MASTER_ADMIN)),
) -> list[AdminPickRowOut]:
    return pick_service.list_admin_picks(db, matchday_id=matchday_id, profile_id=profile_id, vip_id=vip_id)


@router.post("/picks/override", response_model=AdminPickRowOut)
def save_admin_pick_override(
    payload: AdminPickOverrideRequest,
    db: Session = Depends(get_db),
    current_profile: Profile = Depends(require_roles(RoleCode.ADMIN, RoleCode.MASTER_ADMIN)),
) -> AdminPickRowOut:
    return pick_service.save_admin_override(db, payload, updated_by=current_profile)


@router.get("/survivor/picks", response_model=list[AdminSurvivorPickRowOut])
def list_admin_survivor_picks(
    season_id: str,
    db: Session = Depends(get_db),
    _: Profile = Depends(require_roles(RoleCode.ADMIN, RoleCode.MASTER_ADMIN)),
) -> list[AdminSurvivorPickRowOut]:
    return survivor_service.list_admin_picks(db, season_id)


@router.post("/survivor/picks/override", response_model=AdminSurvivorPickRowOut)
def save_admin_survivor_pick_override(
    payload: AdminSurvivorPickOverrideRequest,
    db: Session = Depends(get_db),
    current_profile: Profile = Depends(require_roles(RoleCode.ADMIN, RoleCode.MASTER_ADMIN)),
) -> AdminSurvivorPickRowOut:
    return survivor_service.save_admin_override(db, payload, updated_by=current_profile)


@router.delete("/survivor/picks/{pick_id}/override", response_model=AdminSurvivorPickRowOut)
def clear_admin_survivor_pick_override(
    pick_id: str,
    db: Session = Depends(get_db),
    _: Profile = Depends(require_roles(RoleCode.ADMIN, RoleCode.MASTER_ADMIN)),
) -> AdminSurvivorPickRowOut:
    return survivor_service.clear_admin_override(db, pick_id)


@router.get("/vip", response_model=list[AdminVipCompetitionOut])
def list_admin_vips(
    include_leaderboard: bool = Query(False),
    db: Session = Depends(get_db),
    _: Profile = Depends(require_roles(RoleCode.ADMIN, RoleCode.MASTER_ADMIN)),
) -> list[AdminVipCompetitionOut]:
    return vip_service.list_admin_vips(db, include_leaderboard=include_leaderboard)


@router.get("/vip/{vip_id}", response_model=AdminVipCompetitionOut)
def get_admin_vip(
    vip_id: str,
    db: Session = Depends(get_db),
    _: Profile = Depends(require_roles(RoleCode.ADMIN, RoleCode.MASTER_ADMIN)),
) -> AdminVipCompetitionOut:
    return admin_vip_row(db, vip_id, include_leaderboard=True)


@router.post("/vip/{vip_id}/recalculate")
def recalculate_admin_vip(
    vip_id: str,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    _: Profile = Depends(require_roles(RoleCode.ADMIN, RoleCode.MASTER_ADMIN)),
) -> dict[str, str]:
    admin_vip_row(db, vip_id, include_leaderboard=False)
    background_tasks.add_task(run_vip_recalculate_background, vip_id)
    return {"status": "vip_recalculate_started", "vip_id": vip_id}


@router.post("/vip", response_model=AdminVipCompetitionOut, status_code=201)
def create_admin_vip(
    payload: AdminVipUpsertRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_profile: Profile = Depends(require_roles(RoleCode.ADMIN, RoleCode.MASTER_ADMIN)),
) -> AdminVipCompetitionOut:
    vip = vip_service.create_admin_vip(db, payload, current_profile)
    background_tasks.add_task(run_vip_recalculate_background, vip.id)
    return admin_vip_row(db, vip.id, include_leaderboard=False)


@router.put("/vip/{vip_id}", response_model=AdminVipCompetitionOut)
def update_admin_vip(
    vip_id: str,
    payload: AdminVipUpsertRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    _: Profile = Depends(require_roles(RoleCode.ADMIN, RoleCode.MASTER_ADMIN)),
) -> AdminVipCompetitionOut:
    vip = vip_service.update_admin_vip(db, vip_id, payload)
    background_tasks.add_task(run_vip_recalculate_background, vip.id)
    return admin_vip_row(db, vip.id, include_leaderboard=False)


@router.delete("/vip/{vip_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_admin_vip(
    vip_id: str,
    db: Session = Depends(get_db),
    _: Profile = Depends(require_roles(RoleCode.ADMIN, RoleCode.MASTER_ADMIN)),
) -> None:
    vip_service.delete_admin_vip(db, vip_id)


@router.post("/vip/{vip_id}/memberships", response_model=AdminVipCompetitionOut)
def add_admin_vip_membership(
    vip_id: str,
    payload: AdminVipMembershipAddRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_profile: Profile = Depends(require_roles(RoleCode.ADMIN, RoleCode.MASTER_ADMIN)),
) -> AdminVipCompetitionOut:
    vip_service.add_admin_membership(
        db,
        vip_id=vip_id,
        payload=payload,
        current_profile=current_profile,
    )
    background_tasks.add_task(run_vip_recalculate_background, vip_id)
    return admin_vip_row(db, vip_id, include_leaderboard=True)


@router.put("/vip/{vip_id}/team-winner/config", response_model=AdminVipCompetitionOut)
def configure_admin_vip_team_winner(
    vip_id: str,
    payload: AdminVipTeamWinnerConfigRequest,
    db: Session = Depends(get_db),
    _: Profile = Depends(require_roles(RoleCode.ADMIN, RoleCode.MASTER_ADMIN)),
) -> AdminVipCompetitionOut:
    vip_service.configure_team_winner(db, vip_id=vip_id, payload=payload)
    return admin_vip_row(db, vip_id, include_leaderboard=False)


@router.post("/vip/{vip_id}/questions", response_model=AdminVipCompetitionOut)
def create_admin_vip_question_pool_question(
    vip_id: str,
    payload: AdminVipQuestionPoolQuestionUpsertRequest,
    db: Session = Depends(get_db),
    _: Profile = Depends(require_roles(RoleCode.ADMIN, RoleCode.MASTER_ADMIN)),
) -> AdminVipCompetitionOut:
    vip_service.create_question_pool_question(db, vip_id=vip_id, payload=payload)
    vip_service.recalculate_vip_standings(db, vip_id)
    return admin_vip_row(db, vip_id, include_leaderboard=True)


@router.post("/vip/{vip_id}/questions/import-csv", response_model=AdminVipCompetitionOut)
def import_admin_vip_question_pool_csv(
    vip_id: str,
    payload: AdminVipQuestionPoolCsvImportRequest,
    db: Session = Depends(get_db),
    _: Profile = Depends(require_roles(RoleCode.ADMIN, RoleCode.MASTER_ADMIN)),
) -> AdminVipCompetitionOut:
    vip_service.import_question_pool_csv(db, vip_id=vip_id, csv_text=payload.csv_text)
    vip_service.recalculate_vip_standings(db, vip_id)
    return admin_vip_row(db, vip_id, include_leaderboard=True)


@router.put("/vip/{vip_id}/questions/correct-options", response_model=AdminVipCompetitionOut)
def set_admin_vip_question_pool_correct_options_bulk(
    vip_id: str,
    payload: AdminVipQuestionPoolBulkCorrectOptionRequest,
    db: Session = Depends(get_db),
    _: Profile = Depends(require_roles(RoleCode.ADMIN, RoleCode.MASTER_ADMIN)),
) -> AdminVipCompetitionOut:
    vip_service.set_question_pool_correct_options_bulk(db, vip_id=vip_id, payload=payload)
    vip_service.recalculate_vip_standings(db, vip_id)
    return admin_vip_row(db, vip_id, include_leaderboard=True)


@router.put("/vip/{vip_id}/questions/{question_id}", response_model=AdminVipCompetitionOut)
def update_admin_vip_question_pool_question(
    vip_id: str,
    question_id: str,
    payload: AdminVipQuestionPoolQuestionUpsertRequest,
    db: Session = Depends(get_db),
    _: Profile = Depends(require_roles(RoleCode.ADMIN, RoleCode.MASTER_ADMIN)),
) -> AdminVipCompetitionOut:
    vip_service.update_question_pool_question(db, vip_id=vip_id, question_id=question_id, payload=payload)
    vip_service.recalculate_vip_standings(db, vip_id)
    return admin_vip_row(db, vip_id, include_leaderboard=True)


@router.delete("/vip/{vip_id}/questions/{question_id}", response_model=AdminVipCompetitionOut)
def delete_admin_vip_question_pool_question(
    vip_id: str,
    question_id: str,
    db: Session = Depends(get_db),
    _: Profile = Depends(require_roles(RoleCode.ADMIN, RoleCode.MASTER_ADMIN)),
) -> AdminVipCompetitionOut:
    vip_service.delete_question_pool_question(db, vip_id=vip_id, question_id=question_id)
    vip_service.recalculate_vip_standings(db, vip_id)
    return admin_vip_row(db, vip_id, include_leaderboard=True)


@router.put("/vip/{vip_id}/questions/{question_id}/correct-option", response_model=AdminVipCompetitionOut)
def set_admin_vip_question_pool_correct_option(
    vip_id: str,
    question_id: str,
    payload: AdminVipQuestionPoolCorrectOptionRequest,
    db: Session = Depends(get_db),
    _: Profile = Depends(require_roles(RoleCode.ADMIN, RoleCode.MASTER_ADMIN)),
) -> AdminVipCompetitionOut:
    vip_service.set_question_pool_correct_option(db, vip_id=vip_id, question_id=question_id, payload=payload)
    vip_service.recalculate_vip_standings(db, vip_id)
    return admin_vip_row(db, vip_id, include_leaderboard=True)


@router.post("/vip/{vip_id}/team-winner/draw", response_model=AdminVipCompetitionOut)
def run_admin_vip_team_winner_draw(
    vip_id: str,
    db: Session = Depends(get_db),
    _: Profile = Depends(require_roles(RoleCode.ADMIN, RoleCode.MASTER_ADMIN)),
) -> AdminVipCompetitionOut:
    vip_service.run_team_winner_draw(db, vip_id=vip_id)
    return admin_vip_row(db, vip_id, include_leaderboard=False)


@router.post("/vip/{vip_id}/team-winner/reset-draw", response_model=AdminVipCompetitionOut)
def reset_admin_vip_team_winner_draw(
    vip_id: str,
    db: Session = Depends(get_db),
    _: Profile = Depends(require_roles(RoleCode.ADMIN, RoleCode.MASTER_ADMIN)),
) -> AdminVipCompetitionOut:
    vip_service.reset_team_winner_draw(db, vip_id=vip_id)
    return admin_vip_row(db, vip_id, include_leaderboard=False)


@router.post("/vip/{vip_id}/team-winner/reveal-next", response_model=AdminVipCompetitionOut)
def reveal_next_admin_vip_team_winner(
    vip_id: str,
    db: Session = Depends(get_db),
    _: Profile = Depends(require_roles(RoleCode.ADMIN, RoleCode.MASTER_ADMIN)),
) -> AdminVipCompetitionOut:
    vip_service.reveal_next_team_winner_entry(db, vip_id=vip_id)
    return admin_vip_row(db, vip_id, include_leaderboard=False)


@router.put("/vip/{vip_id}/team-winner/teams/{team_row_id}/status", response_model=AdminVipCompetitionOut)
def update_admin_vip_team_winner_team_status(
    vip_id: str,
    team_row_id: str,
    payload: AdminVipTeamWinnerTeamStatusRequest,
    db: Session = Depends(get_db),
    current_profile: Profile = Depends(require_roles(RoleCode.ADMIN, RoleCode.MASTER_ADMIN)),
) -> AdminVipCompetitionOut:
    vip_service.update_team_winner_team_status(
        db,
        vip_id=vip_id,
        team_row_id=team_row_id,
        payload=payload,
        current_profile=current_profile,
    )
    return admin_vip_row(db, vip_id, include_leaderboard=False)


@router.put("/vip/{vip_id}/team-winner/entries/{entry_id}/payment", response_model=AdminVipCompetitionOut)
def update_admin_vip_team_winner_entry_payment(
    vip_id: str,
    entry_id: str,
    payload: AdminVipTeamWinnerEntryPaymentRequest,
    db: Session = Depends(get_db),
    _: Profile = Depends(require_roles(RoleCode.ADMIN, RoleCode.MASTER_ADMIN)),
) -> AdminVipCompetitionOut:
    vip_service.update_team_winner_entry_payment(
        db,
        vip_id=vip_id,
        entry_id=entry_id,
        payload=payload,
    )
    return admin_vip_row(db, vip_id, include_leaderboard=False)


@router.post("/vip/{vip_id}/memberships/{membership_id}/approve", response_model=AdminVipCompetitionOut)
def approve_admin_vip_membership(
    vip_id: str,
    membership_id: str,
    payload: AdminVipMembershipDecisionRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_profile: Profile = Depends(require_roles(RoleCode.ADMIN, RoleCode.MASTER_ADMIN)),
) -> AdminVipCompetitionOut:
    vip_service.decide_membership(
        db,
        vip_id=vip_id,
        membership_id=membership_id,
        decision=VipMembershipStatus.APPROVED,
        current_profile=current_profile,
        payload=payload,
    )
    background_tasks.add_task(run_vip_recalculate_background, vip_id)
    return admin_vip_row(db, vip_id, include_leaderboard=True)


@router.post("/vip/{vip_id}/memberships/{membership_id}/reject", response_model=AdminVipCompetitionOut)
def reject_admin_vip_membership(
    vip_id: str,
    membership_id: str,
    payload: AdminVipMembershipDecisionRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_profile: Profile = Depends(require_roles(RoleCode.ADMIN, RoleCode.MASTER_ADMIN)),
) -> AdminVipCompetitionOut:
    vip_service.decide_membership(
        db,
        vip_id=vip_id,
        membership_id=membership_id,
        decision=VipMembershipStatus.REJECTED,
        current_profile=current_profile,
        payload=payload,
    )
    background_tasks.add_task(run_vip_recalculate_background, vip_id)
    return admin_vip_row(db, vip_id, include_leaderboard=True)


@router.post("/vip/{vip_id}/memberships/{membership_id}/remove", response_model=AdminVipCompetitionOut)
def remove_admin_vip_membership(
    vip_id: str,
    membership_id: str,
    payload: AdminVipMembershipDecisionRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_profile: Profile = Depends(require_roles(RoleCode.ADMIN, RoleCode.MASTER_ADMIN)),
) -> AdminVipCompetitionOut:
    vip_service.remove_membership(
        db,
        vip_id=vip_id,
        membership_id=membership_id,
        current_profile=current_profile,
        payload=payload,
    )
    background_tasks.add_task(run_vip_recalculate_background, vip_id)
    return admin_vip_row(db, vip_id, include_leaderboard=True)


@router.post("/vip/{vip_id}/memberships/{membership_id}/payment", response_model=AdminVipCompetitionOut)
@router.put("/vip/{vip_id}/memberships/{membership_id}/payment", response_model=AdminVipCompetitionOut)
def update_admin_vip_membership_payment(
    vip_id: str,
    membership_id: str,
    payload: AdminVipMembershipPaymentRequest,
    db: Session = Depends(get_db),
    current_profile: Profile = Depends(require_roles(RoleCode.ADMIN, RoleCode.MASTER_ADMIN)),
) -> AdminVipCompetitionOut:
    vip_service.update_membership_payment(
        db,
        vip_id=vip_id,
        membership_id=membership_id,
        current_profile=current_profile,
        payload=payload,
    )
    return admin_vip_row(db, vip_id, include_leaderboard=True)


@router.put("/results/{match_id}", response_model=AdminResultRowOut)
def update_admin_result(
    match_id: str,
    payload: AdminResultUpdateRequest,
    db: Session = Depends(get_db),
    current_profile: Profile = Depends(require_roles(RoleCode.ADMIN, RoleCode.MASTER_ADMIN)),
) -> AdminResultRowOut:
    result = result_service.save_admin_result(db, match_id, payload, updated_by=current_profile)
    if payload.is_official:
        db.execute(delete(LiveMatchScore).where(LiveMatchScore.match_id == match_id))
        db.commit()
    recalculate_matchday_scoring_inline(db, matchday_id=result.matchday_id, match_id=match_id)
    return result


@router.post("/results/{match_id}/clear-override", response_model=AdminResultRowOut)
def clear_admin_result_override(
    match_id: str,
    db: Session = Depends(get_db),
    _: Profile = Depends(require_roles(RoleCode.ADMIN, RoleCode.MASTER_ADMIN)),
) -> AdminResultRowOut:
    result = result_service.clear_manual_override(db, match_id)
    recalculate_matchday_scoring_inline(db, matchday_id=result.matchday_id, match_id=match_id)
    return result


@router.delete("/results/{match_id}", response_model=AdminResultRowOut)
def clear_admin_result(
    match_id: str,
    db: Session = Depends(get_db),
    _: Profile = Depends(require_roles(RoleCode.ADMIN, RoleCode.MASTER_ADMIN)),
) -> AdminResultRowOut:
    result = result_service.clear_admin_result(db, match_id)
    recalculate_matchday_scoring_inline(db, matchday_id=result.matchday_id, match_id=match_id)
    return result


@router.post("/results/sync", response_model=SyncResponse)
def sync_admin_results(
    background_tasks: BackgroundTasks,
    matchday_id: str | None = None,
    db: Session = Depends(get_db),
    _: Profile = Depends(require_roles(RoleCode.ADMIN, RoleCode.MASTER_ADMIN)),
) -> SyncResponse:
    response = SyncResponse(**sync_results(db, get_results_provider(), matchday_id=matchday_id))
    if matchday_id is not None:
        recalculate_matchday_scoring_inline(db, matchday_id=matchday_id)
    else:
        background_tasks.add_task(run_scoring_recalculate_background)
        background_tasks.add_task(run_all_vip_recalculate_background)
    return response


@router.post("/odds/sync", response_model=SyncResponse)
def sync_admin_odds(
    db: Session = Depends(get_db),
    _: Profile = Depends(require_roles(RoleCode.ADMIN, RoleCode.MASTER_ADMIN)),
) -> SyncResponse:
    return SyncResponse(**sync_odds(db, get_provider()))


@router.get("/nfl-spreads", response_model=list[AdminNflSpreadRowOut])
def list_admin_nfl_spreads(
    season_id: str,
    matchday_id: str | None = None,
    db: Session = Depends(get_db),
    _: Profile = Depends(require_roles(RoleCode.ADMIN, RoleCode.MASTER_ADMIN)),
) -> list[AdminNflSpreadRowOut]:
    require_nfl_season(db, season_id)
    matchdays = list(
        db.scalars(
            select(Matchday)
            .where(Matchday.season_id == season_id)
            .order_by(Matchday.number.asc())
        )
    )
    matchday_by_id = {row.id: row for row in matchdays}
    matchday_ids = [row.id for row in matchdays]
    if matchday_id:
        if matchday_id not in matchday_by_id:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="La jornada no pertenece a la temporada")
        matchday_ids = [matchday_id]
    if not matchday_ids:
        return []

    matches = list(
        db.scalars(
            select(Match)
            .where(Match.matchday_id.in_(matchday_ids))
            .order_by(Match.kickoff_at.asc())
        )
    )
    match_ids = [row.id for row in matches]
    latest_odds: dict[str, Odds] = {}
    if match_ids:
        for row in db.scalars(
            select(Odds).where(Odds.match_id.in_(match_ids)).order_by(Odds.match_id.asc(), Odds.synced_at.desc(), Odds.id.desc())
        ):
            latest_odds.setdefault(row.match_id, row)
    pick_counts = dict(
        db.execute(
            select(UserPick.match_id, func.count(UserPick.id))
            .where(UserPick.match_id.in_(match_ids))
            .group_by(UserPick.match_id)
        ).all()
    ) if match_ids else {}
    team_ids = {team_id for match in matches for team_id in [match.home_team_id, match.away_team_id] if team_id}
    teams = {team.id: team for team in db.scalars(select(Team).where(Team.id.in_(team_ids)))} if team_ids else {}

    return [
        AdminNflSpreadRowOut(
            match_id=match.id,
            matchday_id=match.matchday_id,
            matchday_number=matchday_by_id[match.matchday_id].number,
            matchday_name=matchday_by_id[match.matchday_id].name,
            kickoff_at=match.kickoff_at,
            picks_lock_at=match.picks_lock_at,
            home_team_name=teams[match.home_team_id].name if match.home_team_id in teams else match.home_placeholder or "Local",
            away_team_name=teams[match.away_team_id].name if match.away_team_id in teams else match.away_placeholder or "Visitante",
            spread_home_line=latest_odds[match.id].spread_home_line if match.id in latest_odds else None,
            spread_away_line=latest_odds[match.id].spread_away_line if match.id in latest_odds else None,
            provider_name=latest_odds[match.id].provider_name if match.id in latest_odds else None,
            published_at=latest_odds[match.id].synced_at if match.id in latest_odds else None,
            pick_count=int(pick_counts.get(match.id, 0)),
            is_frozen=bool(pick_counts.get(match.id, 0)),
        )
        for match in matches
    ]


@router.put("/nfl-spreads/{match_id}", response_model=AdminNflSpreadRowOut)
def update_admin_nfl_spread(
    match_id: str,
    payload: AdminNflSpreadUpdateRequest,
    db: Session = Depends(get_db),
    _: Profile = Depends(require_roles(RoleCode.ADMIN, RoleCode.MASTER_ADMIN)),
) -> AdminNflSpreadRowOut:
    match = db.get(Match, match_id)
    matchday = db.get(Matchday, match.matchday_id) if match else None
    if match is None or matchday is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Partido no encontrado")
    require_nfl_season(db, matchday.season_id)
    pick_count = int(db.scalar(select(func.count(UserPick.id)).where(UserPick.match_id == match.id)) or 0)
    if pick_count and not payload.force:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"La linea esta congelada porque ya existen {pick_count} picks. Usa correccion administrativa.",
        )
    home_line, away_line = normalize_nfl_spread_line(payload.home_line)
    if pick_count and home_line is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No puedes retirar la linea cuando ya existen picks; publica una correccion.",
        )
    odds = Odds(
        match_id=match.id,
        provider_name="admin_nfl",
        spread_home_line=home_line,
        spread_away_line=away_line,
    )
    db.add(odds)
    if pick_count and payload.force and home_line is not None:
        picks = list(db.scalars(select(UserPick).where(UserPick.match_id == match.id)))
        for pick in picks:
            pick.spread_line_value = home_line if pick.spread_selection == PickSelection.HOME else away_line
            db.add(pick)
        db.flush()
        ScoringService().recalculate_season(db, matchday.season_id)
        recalculate_vips_for_matchday(db, matchday.id)
    db.commit()
    db.refresh(odds)
    home_team = db.get(Team, match.home_team_id) if match.home_team_id else None
    away_team = db.get(Team, match.away_team_id) if match.away_team_id else None
    return AdminNflSpreadRowOut(
        match_id=match.id,
        matchday_id=matchday.id,
        matchday_number=matchday.number,
        matchday_name=matchday.name,
        kickoff_at=match.kickoff_at,
        picks_lock_at=match.picks_lock_at,
        home_team_name=home_team.name if home_team else match.home_placeholder or "Local",
        away_team_name=away_team.name if away_team else match.away_placeholder or "Visitante",
        spread_home_line=home_line,
        spread_away_line=away_line,
        provider_name=odds.provider_name,
        published_at=odds.synced_at,
        pick_count=pick_count,
        is_frozen=pick_count > 0,
    )


@router.post("/odds/pull", response_model=OddsPullResponse)
def pull_admin_odds(
    _: Profile = Depends(require_roles(RoleCode.ADMIN, RoleCode.MASTER_ADMIN)),
) -> OddsPullResponse:
    script_env = build_odds_script_env()
    return run_odds_pull_pipeline(script_env)


@router.post("/odds/pull-world-cup", response_model=OddsPullResponse)
def pull_admin_world_cup_odds(
    _: Profile = Depends(require_roles(RoleCode.ADMIN, RoleCode.MASTER_ADMIN)),
) -> OddsPullResponse:
    script_env = build_odds_script_env()
    sport_key = "soccer_fifa_world_cup"
    script_env["THE_ODDS_API_SPORT"] = sport_key
    script_env["THE_ODDS_API_REGIONS"] = "us,uk,eu,au"
    script_env["THE_ODDS_API_MARKETS"] = "h2h,totals"
    script_env["THE_ODDS_API_BOOKMAKER"] = ""
    script_env["ODDS_WINDOW_START_OFFSET_DAYS"] = "0"
    script_env["ODDS_LOOKAHEAD_DAYS"] = "5"
    return run_odds_pull_pipeline(script_env, sport_key=sport_key)


@router.post("/quiniela-plus/advanced-stats/pull", response_model=AdvancedStatsPullResponse)
def pull_admin_quiniela_plus_advanced_stats(
    target_date: str | None = None,
    days: int = 2,
    _: Profile = Depends(require_roles(RoleCode.ADMIN, RoleCode.MASTER_ADMIN)),
) -> AdvancedStatsPullResponse:
    script_env = build_odds_script_env()
    effective_date = target_date or datetime.now(MEXICO_CITY_TZ).date().isoformat()
    return run_advanced_stats_pull_pipeline(
        script_env,
        target_date=effective_date,
        days=days,
    )


@router.post("/results/recalculate")
def recalculate_results(
    background_tasks: BackgroundTasks,
    _: Profile = Depends(require_roles(RoleCode.ADMIN, RoleCode.MASTER_ADMIN)),
) -> dict[str, str]:
    background_tasks.add_task(run_scoring_recalculate_background)
    background_tasks.add_task(run_all_vip_recalculate_background)
    return {
        "status": "recalculate_started",
        "message": "Scoring general y VIP en recalculo.",
    }


@router.post("/matchdays/{matchday_id}/publish")
def publish_matchday(
    matchday_id: str,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_profile: Profile = Depends(require_roles(RoleCode.ADMIN, RoleCode.MASTER_ADMIN)),
) -> dict[str, str]:
    matchday = matchday_repo.get_by_id(db, matchday_id)
    if matchday is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Matchday not found")

    existing = db.scalar(
        select(PublishedMatchday).where(PublishedMatchday.matchday_id == matchday.id)
    )
    if existing is None:
        db.add(
            PublishedMatchday(
                matchday_id=matchday.id,
                published_by_profile_id=current_profile.id,
                notes="Published from admin endpoint",
            )
        )
    matchday.status = MatchdayStatus.PUBLISHED
    db.add(matchday)
    db.commit()
    background_tasks.add_task(run_matchday_publish_notifications_background, matchday_id)
    return {
        "status": "published",
        "matchday_id": matchday_id,
        "recalculate_status": "started",
        "vip_recalculate_status": "started",
    }
