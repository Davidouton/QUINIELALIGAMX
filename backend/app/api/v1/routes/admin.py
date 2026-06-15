import csv
import io
import os
import re
import subprocess
import sys
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from pydantic import ValidationError
from sqlalchemy import delete, func, inspect, select, text
from sqlalchemy.orm import Session

from app.api.deps import require_roles
from app.core.config import get_settings
from app.core.database import SessionLocal, engine, get_db
from app.models.entities import (
    Competition,
    HistoricalChampion,
    Match,
    Matchday,
    MatchdayStatus,
    Profile,
    ProfileTrophyAward,
    PublishedMatchday,
    RoleCode,
    RulePage,
    ScoringRule,
    Season,
    SeasonMembership,
    StandingsMatchday,
    Team,
    TrophyAsset,
    VipMembershipStatus,
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
    SeasonUpdateRequest,
    SyncResponse,
    TeamCreateRequest,
    TeamUpdateRequest,
    TrophyAssetCreateRequest,
    TrophyAssetOut,
    TrophyAssetUpdateRequest,
    UserAccessUpdateRequest,
    UserSeasonMembershipUpdateRequest,
)
from app.schemas.competition import CompetitionOut
from app.schemas.match import MatchOut
from app.schemas.matchday import MatchdayOut
from app.schemas.profile import ProfileOut
from app.schemas.rules import RulePageOut, RulePageUpdateRequest
from app.schemas.season import SeasonOut
from app.schemas.team import TeamOut
from app.schemas.vip import (
    AdminVipCompetitionOut,
    AdminVipMembershipDecisionRequest,
    AdminVipMembershipPaymentRequest,
    AdminVipUpsertRequest,
)
from app.services.match_service import MatchService
from app.services.pick_service import PickService
from app.services.result_service import ResultService
from app.services.scoring_service import ScoringService
from app.services.season_eligibility_service import SeasonEligibilityService
from app.services.supabase_admin_service import SupabaseAdminError, SupabaseAdminService
from app.services.sync_matches import sync_matches
from app.services.sync_odds import sync_odds
from app.services.sync_results import sync_results
from app.services.vip_service import VipService

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
season_eligibility_service = SeasonEligibilityService()
vip_service = VipService()
supabase_admin_service = SupabaseAdminService()
REPO_ROOT = Path(__file__).resolve().parents[5]
APPS_API_DIR = REPO_ROOT / "apps" / "api"
BACKEND_DIR = REPO_ROOT / "backend"
RAW_ODDS_TABLE = "lmx_odds_5d"
DEFAULT_RESULT_CORRECT_POINTS = 3
DEFAULT_EXACT_SCORE_POINTS = 2


def run_scoring_recalculate_background() -> None:
    db = SessionLocal()
    try:
        ScoringService().recalculate(db)
    finally:
        db.close()


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
    )

    if odds_database_url:
        env["ODDS_DATABASE_URL"] = odds_database_url
        env["DATABASE_URL"] = odds_database_url

    for key, value in apps_api_env.items():
        env.setdefault(key, value)
    for key, value in backend_env.items():
        env.setdefault(key, value)

    return env


def run_script(command: list[str], cwd: Path, env: dict[str, str] | None = None) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        command,
        cwd=str(cwd),
        env=env,
        capture_output=True,
        text=True,
        check=False,
    )


def run_odds_pull_pipeline(script_env: dict[str, str], *, sport_key: str | None = None) -> OddsPullResponse:
    pull_result = run_script([sys.executable, "scripts/pull_odds_raw.py"], BACKEND_DIR, env=script_env)
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
            sys.executable,
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


def get_provider() -> MockSportsDataProvider:
    return MockSportsDataProvider()


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


def build_team_out(row: Team, competition: Competition | None = None) -> TeamOut:
    return TeamOut(
        id=row.id,
        competition_id=row.competition_id,
        competition_name=competition.name if competition is not None else None,
        competition_sport_name=competition.sport_name if competition is not None else None,
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


def build_season_out(row: Season, competition: Competition | None = None) -> SeasonOut:
    return SeasonOut(
        id=row.id,
        name=row.name,
        slug=row.slug,
        competition_id=row.competition_id,
        competition_name=competition.name if competition is not None else None,
        competition_sport_name=competition.sport_name if competition is not None else None,
        tournament_format=row.tournament_format,
        is_active=row.is_active,
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
        if matchday.id == matchday_to_activate.id:
            matchday.status = MatchdayStatus.ACTIVE
        elif matchday.status == MatchdayStatus.ACTIVE:
            matchday.status = MatchdayStatus.DRAFT
        db.add(matchday)


def get_admin_settings_payload(
    db: Session,
    *,
    evaluated_picks: int | None = None,
    weekly_leaders: int | None = None,
) -> AdminSettingsOut:
    active_season = db.scalar(select(Season).where(Season.is_active.is_(True)).order_by(Season.created_at.desc()))
    if active_season is not None:
        did_freeze = season_eligibility_service.freeze_season_if_due(db, active_season)
        if did_freeze:
            db.commit()
            db.refresh(active_season)
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
    if active_season is not None:
        participants_lock_at = season_eligibility_service.get_effective_lock_at(db, active_season)
        participants_locked = season_eligibility_service.is_locked(db, active_season)
        memberships = season_membership_repo.list_for_season(db, active_season.id)
        eligible_participants = sum(1 for membership in memberships if membership.eligible_for_scoring)
        confirmed_participants = sum(1 for membership in memberships if membership.is_active)
        entry_fee_amount = active_season.entry_fee_amount
        weekly_first_place_amount = active_season.weekly_first_place_amount
        weekly_second_place_amount = active_season.weekly_second_place_amount
        weekly_third_place_amount = active_season.weekly_third_place_amount
        admin_commission_pct = active_season.admin_commission_pct
        reserve_pct = active_season.reserve_pct
        first_place_pct = active_season.first_place_pct
        second_place_pct = active_season.second_place_pct
        third_place_pct = active_season.third_place_pct

    tournament_matchdays_count = 0
    if active_season is not None:
        season_matchdays = list(
            db.scalars(
                select(Matchday)
                .where(Matchday.season_id == active_season.id)
                .order_by(Matchday.number.asc())
            )
        )
        start_number = next(
            (matchday.number for matchday in season_matchdays if matchday.id == active_season.start_matchday_id),
            None,
        )
        end_number = next(
            (matchday.number for matchday in season_matchdays if matchday.id == active_season.end_matchday_id),
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
        start_matchday_id=active_season.start_matchday_id if active_season is not None else None,
        end_matchday_id=active_season.end_matchday_id if active_season is not None else None,
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


def build_admin_user_out(db: Session, profile: Profile, season: Season | None) -> AdminUserOut:
    favorite_team = db.get(Team, profile.favorite_team_id) if profile.favorite_team_id else None
    aval_profile = db.get(Profile, profile.aval_profile_id) if profile.aval_profile_id else None
    membership = (
        season_membership_repo.get_for_profile_and_season(db, profile.id, season.id)
        if season is not None
        else None
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

    return AdminUserOut(
        id=profile.id,
        auth_user_id=profile.auth_user_id,
        email=profile.email,
        display_name=profile.display_name,
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
    )


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
    return [build_admin_user_out(db, profile, season) for profile in profile_repo.list_all(db)]


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
        password=password,
        season_id=season_id,
        is_active=_parse_bool(_get_csv_value(row, "is_active", "activo", "alta"), True),
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
    membership.is_active = payload.is_active
    membership.is_paid = payload.is_paid
    membership.notes = normalize_optional_text(payload.notes)
    if payload.is_active:
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


@router.get("/settings", response_model=AdminSettingsOut)
def get_admin_settings(
    db: Session = Depends(get_db),
    _: Profile = Depends(require_roles(RoleCode.ADMIN, RoleCode.MASTER_ADMIN)),
) -> AdminSettingsOut:
    return get_admin_settings_payload(db)


@router.put("/settings", response_model=AdminSettingsOut)
def update_admin_settings(
    payload: AdminSettingsUpdateRequest,
    db: Session = Depends(get_db),
    _: Profile = Depends(require_roles(RoleCode.ADMIN, RoleCode.MASTER_ADMIN)),
) -> AdminSettingsOut:
    season = season_repo.get_by_id(db, payload.active_season_id)
    if season is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Season not found")

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

    set_active_season(db, season)
    season_repo.save(db, season)
    upsert_scoring_rule(db, "result_correct", payload.result_correct_points)
    upsert_scoring_rule(db, "exact_score", payload.exact_score_points)
    upsert_scoring_rule(db, "advancing_team", payload.advancing_team_points)
    recalculate_summary = ScoringService().recalculate(db)
    return get_admin_settings_payload(
        db,
        evaluated_picks=recalculate_summary["evaluated_picks"],
        weekly_leaders=recalculate_summary["weekly_leaders"],
    )


@router.post("/seasons", response_model=SeasonOut, status_code=201)
def create_season(
    payload: SeasonCreateRequest,
    db: Session = Depends(get_db),
    _: Profile = Depends(require_roles(RoleCode.ADMIN, RoleCode.MASTER_ADMIN)),
) -> SeasonOut:
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
            is_active=payload.is_active,
        ),
    )
    if payload.is_active:
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
    season = season_repo.get_by_id(db, season_id)
    if season is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Season not found")

    competition = db.get(Competition, payload.competition_id) if payload.competition_id else None
    if payload.competition_id and competition is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Competition not found")

    season.name = payload.name.strip()
    season.slug = normalize_slug(payload.slug)
    season.competition_id = competition.id if competition is not None else None
    season.tournament_format = payload.tournament_format
    season.is_active = payload.is_active
    season_repo.save(db, season)
    if payload.is_active:
        set_active_season(db, season)
    db.commit()
    db.refresh(season)
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
        name=payload.name.strip(),
        slug=normalize_slug(payload.slug),
        provider_league_id=normalize_optional_text(payload.provider_league_id),
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
    competition = db.get(Competition, payload.competition_id) if payload.competition_id else None
    if payload.competition_id and competition is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Competition not found")
    team = team_repo.create(
        db,
        Team(
            competition_id=competition.id if competition is not None else None,
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
    db.commit()
    db.refresh(team)
    return build_team_out(team, competition)


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

    competition = db.get(Competition, payload.competition_id) if payload.competition_id else None
    if payload.competition_id and competition is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Competition not found")

    team.competition_id = competition.id if competition is not None else None
    team.name = payload.name.strip()
    team.short_name = payload.short_name.strip().upper()
    team.slug = normalize_slug(payload.slug)
    team.external_id = normalize_optional_text(payload.external_id)
    team.crest_url = normalize_optional_text(payload.crest_url)
    team.home_venue = normalize_optional_text(payload.home_venue)
    team.primary_color = normalize_optional_text(payload.primary_color)
    team.secondary_color = normalize_optional_text(payload.secondary_color)
    team.accent_color = normalize_optional_text(payload.accent_color)
    team_repo.save(db, team)
    db.commit()
    db.refresh(team)
    return build_team_out(team, competition)


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
    db: Session = Depends(get_db),
    _: Profile = Depends(require_roles(RoleCode.ADMIN, RoleCode.MASTER_ADMIN)),
) -> RulePageOut:
    row = get_or_create_main_rule_page(db)
    return RulePageOut.model_validate(row, from_attributes=True)


@router.put("/rules", response_model=RulePageOut)
def update_admin_rules_page(
    payload: RulePageUpdateRequest,
    db: Session = Depends(get_db),
    current_profile: Profile = Depends(require_roles(RoleCode.ADMIN, RoleCode.MASTER_ADMIN)),
) -> RulePageOut:
    row = get_or_create_main_rule_page(db)
    row.title = payload.title.strip()
    row.content_markdown = payload.content_markdown.strip()
    row.version_label = payload.version_label.strip() if payload.version_label and payload.version_label.strip() else None
    row.updated_by_profile_id = current_profile.id
    db.add(row)
    db.commit()
    db.refresh(row)
    return RulePageOut.model_validate(row, from_attributes=True)


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
    matchday.name = payload.name.strip()
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


@router.get("/picks", response_model=list[AdminPickRowOut])
def list_admin_picks(
    matchday_id: str,
    profile_id: str | None = None,
    db: Session = Depends(get_db),
    _: Profile = Depends(require_roles(RoleCode.ADMIN, RoleCode.MASTER_ADMIN)),
) -> list[AdminPickRowOut]:
    return pick_service.list_admin_picks(db, matchday_id=matchday_id, profile_id=profile_id)


@router.post("/picks/override", response_model=AdminPickRowOut)
def save_admin_pick_override(
    payload: AdminPickOverrideRequest,
    db: Session = Depends(get_db),
    current_profile: Profile = Depends(require_roles(RoleCode.ADMIN, RoleCode.MASTER_ADMIN)),
) -> AdminPickRowOut:
    return pick_service.save_admin_override(db, payload, updated_by=current_profile)


@router.get("/vip", response_model=list[AdminVipCompetitionOut])
def list_admin_vips(
    db: Session = Depends(get_db),
    _: Profile = Depends(require_roles(RoleCode.ADMIN, RoleCode.MASTER_ADMIN)),
) -> list[AdminVipCompetitionOut]:
    return vip_service.list_admin_vips(db)


@router.post("/vip", response_model=AdminVipCompetitionOut, status_code=201)
def create_admin_vip(
    payload: AdminVipUpsertRequest,
    db: Session = Depends(get_db),
    current_profile: Profile = Depends(require_roles(RoleCode.ADMIN, RoleCode.MASTER_ADMIN)),
) -> AdminVipCompetitionOut:
    vip = vip_service.create_admin_vip(db, payload, current_profile)
    return next(row for row in vip_service.list_admin_vips(db) if row.id == vip.id)


@router.put("/vip/{vip_id}", response_model=AdminVipCompetitionOut)
def update_admin_vip(
    vip_id: str,
    payload: AdminVipUpsertRequest,
    db: Session = Depends(get_db),
    _: Profile = Depends(require_roles(RoleCode.ADMIN, RoleCode.MASTER_ADMIN)),
) -> AdminVipCompetitionOut:
    vip = vip_service.update_admin_vip(db, vip_id, payload)
    return next(row for row in vip_service.list_admin_vips(db) if row.id == vip.id)


@router.post("/vip/{vip_id}/memberships/{membership_id}/approve", response_model=AdminVipCompetitionOut)
def approve_admin_vip_membership(
    vip_id: str,
    membership_id: str,
    payload: AdminVipMembershipDecisionRequest,
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
    return next(row for row in vip_service.list_admin_vips(db) if row.id == vip_id)


@router.post("/vip/{vip_id}/memberships/{membership_id}/reject", response_model=AdminVipCompetitionOut)
def reject_admin_vip_membership(
    vip_id: str,
    membership_id: str,
    payload: AdminVipMembershipDecisionRequest,
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
    return next(row for row in vip_service.list_admin_vips(db) if row.id == vip_id)


@router.post("/vip/{vip_id}/memberships/{membership_id}/remove", response_model=AdminVipCompetitionOut)
def remove_admin_vip_membership(
    vip_id: str,
    membership_id: str,
    payload: AdminVipMembershipDecisionRequest,
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
    return next(row for row in vip_service.list_admin_vips(db) if row.id == vip_id)


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
    return next(row for row in vip_service.list_admin_vips(db) if row.id == vip_id)


@router.put("/results/{match_id}", response_model=AdminResultRowOut)
def update_admin_result(
    match_id: str,
    payload: AdminResultUpdateRequest,
    db: Session = Depends(get_db),
    current_profile: Profile = Depends(require_roles(RoleCode.ADMIN, RoleCode.MASTER_ADMIN)),
) -> AdminResultRowOut:
    return result_service.save_admin_result(db, match_id, payload, updated_by=current_profile)


@router.post("/results/{match_id}/clear-override", response_model=AdminResultRowOut)
def clear_admin_result_override(
    match_id: str,
    db: Session = Depends(get_db),
    _: Profile = Depends(require_roles(RoleCode.ADMIN, RoleCode.MASTER_ADMIN)),
) -> AdminResultRowOut:
    return result_service.clear_manual_override(db, match_id)


@router.delete("/results/{match_id}", response_model=AdminResultRowOut)
def clear_admin_result(
    match_id: str,
    db: Session = Depends(get_db),
    _: Profile = Depends(require_roles(RoleCode.ADMIN, RoleCode.MASTER_ADMIN)),
) -> AdminResultRowOut:
    return result_service.clear_admin_result(db, match_id)


@router.post("/results/sync", response_model=SyncResponse)
def sync_admin_results(
    matchday_id: str | None = None,
    db: Session = Depends(get_db),
    _: Profile = Depends(require_roles(RoleCode.ADMIN, RoleCode.MASTER_ADMIN)),
) -> SyncResponse:
    return SyncResponse(**sync_results(db, get_results_provider(), matchday_id=matchday_id))


@router.post("/odds/sync", response_model=SyncResponse)
def sync_admin_odds(
    db: Session = Depends(get_db),
    _: Profile = Depends(require_roles(RoleCode.ADMIN, RoleCode.MASTER_ADMIN)),
) -> SyncResponse:
    return SyncResponse(**sync_odds(db, get_provider()))


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
    script_env["THE_ODDS_API_MARKETS"] = "h2h"
    script_env["THE_ODDS_API_BOOKMAKER"] = ""
    script_env["ODDS_WINDOW_START_OFFSET_DAYS"] = "0"
    script_env["ODDS_LOOKAHEAD_DAYS"] = "2"
    return run_odds_pull_pipeline(script_env, sport_key=sport_key)


@router.post("/results/recalculate")
def recalculate_results(
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    _: Profile = Depends(require_roles(RoleCode.ADMIN, RoleCode.MASTER_ADMIN)),
) -> dict[str, str]:
    background_tasks.add_task(run_scoring_recalculate_background)
    return {"status": "recalculate_started"}


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
    background_tasks.add_task(run_scoring_recalculate_background)
    return {
        "status": "published",
        "matchday_id": matchday_id,
        "recalculate_status": "recalculate_started",
    }
