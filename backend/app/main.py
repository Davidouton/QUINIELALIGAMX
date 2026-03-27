from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from uuid import uuid4

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import inspect, text

from app.core.database import engine
from app.api.v1.router import api_router
from app.core.config import get_settings
from app.models import Base

settings = get_settings()


def run_startup_migrations() -> None:
    inspector = inspect(engine)
    table_names = inspector.get_table_names()

    with engine.begin() as connection:
        if "profiles" in table_names:
            profile_column_names = {column["name"] for column in inspector.get_columns("profiles")}
            missing_profile_columns = {
                "favorite_team_id": (
                    "ALTER TABLE profiles "
                    "ADD COLUMN favorite_team_id UUID REFERENCES teams(id) ON DELETE SET NULL"
                ),
                "contact_phone": "ALTER TABLE profiles ADD COLUMN contact_phone VARCHAR(32)",
                "bank_name": "ALTER TABLE profiles ADD COLUMN bank_name VARCHAR(120)",
                "deposit_account": "ALTER TABLE profiles ADD COLUMN deposit_account VARCHAR(160)",
                "modality": (
                    "ALTER TABLE profiles "
                    "ADD COLUMN modality VARCHAR(24) NOT NULL DEFAULT 'pre_pago'"
                ),
                "aval_profile_id": (
                    "ALTER TABLE profiles "
                    "ADD COLUMN aval_profile_id UUID REFERENCES profiles(id) ON DELETE SET NULL"
                ),
                "theme_preference": (
                    "ALTER TABLE profiles "
                    "ADD COLUMN theme_preference VARCHAR(32) NOT NULL DEFAULT 'standard'"
                ),
            }
            for column_name, statement in missing_profile_columns.items():
                if column_name not in profile_column_names:
                    connection.execute(text(statement))

        if "matchdays" in table_names:
            matchday_column_names = {column["name"] for column in inspector.get_columns("matchdays")}
            missing_matchday_columns = {
                "default_lock_offset_minutes": (
                    "ALTER TABLE matchdays "
                    "ADD COLUMN default_lock_offset_minutes INTEGER NOT NULL DEFAULT 10"
                ),
                "picks_reopened_override": (
                    "ALTER TABLE matchdays "
                    "ADD COLUMN picks_reopened_override BOOLEAN NOT NULL DEFAULT FALSE"
                ),
            }
            for column_name, statement in missing_matchday_columns.items():
                if column_name not in matchday_column_names:
                    connection.execute(text(statement))

        if "seasons" in table_names:
            season_column_names = {column["name"] for column in inspector.get_columns("seasons")}
            missing_season_columns = {
                "start_matchday_id": "ALTER TABLE seasons ADD COLUMN start_matchday_id UUID",
                "end_matchday_id": "ALTER TABLE seasons ADD COLUMN end_matchday_id UUID",
                "participants_lock_at": "ALTER TABLE seasons ADD COLUMN participants_lock_at TIMESTAMP WITH TIME ZONE",
                "entry_fee_amount": (
                    "ALTER TABLE seasons ADD COLUMN entry_fee_amount NUMERIC(10,2) NOT NULL DEFAULT 0"
                ),
                "weekly_first_place_amount": (
                    "ALTER TABLE seasons ADD COLUMN weekly_first_place_amount NUMERIC(10,2) NOT NULL DEFAULT 0"
                ),
                "weekly_second_place_amount": (
                    "ALTER TABLE seasons ADD COLUMN weekly_second_place_amount NUMERIC(10,2) NOT NULL DEFAULT 0"
                ),
                "weekly_third_place_amount": (
                    "ALTER TABLE seasons ADD COLUMN weekly_third_place_amount NUMERIC(10,2) NOT NULL DEFAULT 0"
                ),
                "admin_commission_pct": (
                    "ALTER TABLE seasons ADD COLUMN admin_commission_pct NUMERIC(5,2) NOT NULL DEFAULT 0"
                ),
                "reserve_pct": (
                    "ALTER TABLE seasons ADD COLUMN reserve_pct NUMERIC(5,2) NOT NULL DEFAULT 0"
                ),
                "first_place_pct": (
                    "ALTER TABLE seasons ADD COLUMN first_place_pct NUMERIC(5,2) NOT NULL DEFAULT 0"
                ),
                "second_place_pct": (
                    "ALTER TABLE seasons ADD COLUMN second_place_pct NUMERIC(5,2) NOT NULL DEFAULT 0"
                ),
                "third_place_pct": (
                    "ALTER TABLE seasons ADD COLUMN third_place_pct NUMERIC(5,2) NOT NULL DEFAULT 0"
                ),
            }
            for column_name, statement in missing_season_columns.items():
                if column_name not in season_column_names:
                    connection.execute(text(statement))

        if "odds" in table_names:
            odds_column_names = {column["name"] for column in inspector.get_columns("odds")}
            missing_odds_columns = {
                "spread_home_line": "ALTER TABLE odds ADD COLUMN spread_home_line VARCHAR(24)",
                "spread_home_odds": "ALTER TABLE odds ADD COLUMN spread_home_odds VARCHAR(24)",
                "spread_away_line": "ALTER TABLE odds ADD COLUMN spread_away_line VARCHAR(24)",
                "spread_away_odds": "ALTER TABLE odds ADD COLUMN spread_away_odds VARCHAR(24)",
                "total_line": "ALTER TABLE odds ADD COLUMN total_line VARCHAR(24)",
                "over_value": "ALTER TABLE odds ADD COLUMN over_value VARCHAR(24)",
                "under_value": "ALTER TABLE odds ADD COLUMN under_value VARCHAR(24)",
            }
            for column_name, statement in missing_odds_columns.items():
                if column_name not in odds_column_names:
                    connection.execute(text(statement))

        if "match_results" in table_names:
            match_result_column_names = {column["name"] for column in inspector.get_columns("match_results")}
            missing_match_result_columns = {
                "source_provider_name": "ALTER TABLE match_results ADD COLUMN source_provider_name VARCHAR(120)",
                "source_external_id": "ALTER TABLE match_results ADD COLUMN source_external_id VARCHAR(120)",
                "source_updated_at": "ALTER TABLE match_results ADD COLUMN source_updated_at TIMESTAMP WITH TIME ZONE",
                "last_synced_at": "ALTER TABLE match_results ADD COLUMN last_synced_at TIMESTAMP WITH TIME ZONE",
                "is_manual_override": (
                    "ALTER TABLE match_results ADD COLUMN is_manual_override BOOLEAN NOT NULL DEFAULT FALSE"
                ),
                "updated_by_profile_id": "ALTER TABLE match_results ADD COLUMN updated_by_profile_id UUID",
            }
            for column_name, statement in missing_match_result_columns.items():
                if column_name not in match_result_column_names:
                    connection.execute(text(statement))

        if "raw_match_results" not in table_names:
            connection.execute(
                text(
                    """
                    CREATE TABLE IF NOT EXISTS raw_match_results (
                      id UUID PRIMARY KEY,
                      sync_log_id UUID REFERENCES sync_logs(id) ON DELETE SET NULL,
                      provider_name VARCHAR(120) NOT NULL,
                      external_result_id VARCHAR(120),
                      external_match_id VARCHAR(120),
                      match_key VARCHAR(160),
                      mapped_match_id UUID REFERENCES matches(id) ON DELETE SET NULL,
                      home_score INTEGER,
                      away_score INTEGER,
                      result_status VARCHAR(80),
                      is_official BOOLEAN NOT NULL DEFAULT FALSE,
                      payload_json TEXT NOT NULL,
                      source_updated_at TIMESTAMP WITH TIME ZONE,
                      fetched_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                      applied_at TIMESTAMP WITH TIME ZONE
                    )
                    """
                )
            )
            connection.execute(
                text(
                    "CREATE INDEX IF NOT EXISTS idx_raw_match_results_provider "
                    "ON raw_match_results(provider_name, fetched_at DESC)"
                )
            )
            connection.execute(
                text(
                    "CREATE INDEX IF NOT EXISTS idx_raw_match_results_match "
                    "ON raw_match_results(mapped_match_id, fetched_at DESC)"
                )
            )

        if "teams" in table_names:
            team_column_names = {column["name"] for column in inspector.get_columns("teams")}
            missing_team_columns = {
                "home_venue": "ALTER TABLE teams ADD COLUMN home_venue VARCHAR(255)",
                "primary_color": "ALTER TABLE teams ADD COLUMN primary_color VARCHAR(16)",
                "secondary_color": "ALTER TABLE teams ADD COLUMN secondary_color VARCHAR(16)",
                "accent_color": "ALTER TABLE teams ADD COLUMN accent_color VARCHAR(16)",
            }
            for column_name, statement in missing_team_columns.items():
                if column_name not in team_column_names:
                    connection.execute(text(statement))

        if "season_memberships" not in table_names:
            connection.execute(
                text(
                    """
                    CREATE TABLE IF NOT EXISTS season_memberships (
                      id UUID PRIMARY KEY,
                      season_id UUID NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
                      profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
                      is_active BOOLEAN NOT NULL DEFAULT FALSE,
                      is_paid BOOLEAN NOT NULL DEFAULT FALSE,
                      eligible_for_scoring BOOLEAN NOT NULL DEFAULT FALSE,
                      activated_at TIMESTAMP WITH TIME ZONE,
                      eligible_locked_at TIMESTAMP WITH TIME ZONE,
                      activated_by_profile_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
                      notes TEXT,
                      created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                      updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                      CONSTRAINT uq_season_memberships UNIQUE (season_id, profile_id)
                    )
                    """
                )
            )
            connection.execute(
                text(
                    "CREATE INDEX IF NOT EXISTS idx_season_memberships_season_profile "
                    "ON season_memberships(season_id, profile_id)"
                )
            )
        else:
            membership_column_names = {column["name"] for column in inspector.get_columns("season_memberships")}
            missing_membership_columns = {
                "eligible_for_scoring": (
                    "ALTER TABLE season_memberships "
                    "ADD COLUMN eligible_for_scoring BOOLEAN NOT NULL DEFAULT FALSE"
                ),
                "eligible_locked_at": "ALTER TABLE season_memberships ADD COLUMN eligible_locked_at TIMESTAMP WITH TIME ZONE",
            }
            for column_name, statement in missing_membership_columns.items():
                if column_name not in membership_column_names:
                    connection.execute(text(statement))

        if "historical_champions" not in table_names:
            connection.execute(
                text(
                    """
                    CREATE TABLE IF NOT EXISTS historical_champions (
                      id UUID PRIMARY KEY,
                      tournament_name VARCHAR(160) NOT NULL,
                      champion_name VARCHAR(160) NOT NULL,
                      place_label VARCHAR(80) NOT NULL DEFAULT 'Campeon',
                      image_url TEXT,
                      total_points INTEGER NOT NULL DEFAULT 0,
                      created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                      updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
                    )
                    """
                )
            )
            connection.execute(
                text(
                    "CREATE INDEX IF NOT EXISTS idx_historical_champions_tournament "
                    "ON historical_champions(tournament_name)"
                )
            )
            connection.execute(
                text(
                    "CREATE INDEX IF NOT EXISTS idx_historical_champions_name "
                    "ON historical_champions(champion_name)"
                )
            )
            connection.execute(
                text(
                    "CREATE INDEX IF NOT EXISTS idx_historical_champions_place "
                    "ON historical_champions(place_label)"
                )
            )
        else:
            historical_champions_column_names = {
                column["name"] for column in inspector.get_columns("historical_champions")
            }
            if "place_label" not in historical_champions_column_names:
                connection.execute(
                    text(
                        "ALTER TABLE historical_champions "
                        "ADD COLUMN place_label VARCHAR(80) NOT NULL DEFAULT 'Campeon'"
                    )
                )
                connection.execute(
                    text(
                        "CREATE INDEX IF NOT EXISTS idx_historical_champions_place "
                        "ON historical_champions(place_label)"
                    )
                )
            if "image_url" not in historical_champions_column_names:
                connection.execute(
                    text("ALTER TABLE historical_champions ADD COLUMN image_url TEXT")
                )
            if "awarded_profile_id" not in historical_champions_column_names:
                connection.execute(
                    text("ALTER TABLE historical_champions ADD COLUMN awarded_profile_id UUID")
                )
            if "trophy_asset_id" not in historical_champions_column_names:
                connection.execute(
                    text("ALTER TABLE historical_champions ADD COLUMN trophy_asset_id UUID")
                )
        connection.execute(
            text(
                "CREATE INDEX IF NOT EXISTS idx_historical_champions_profile "
                "ON historical_champions(awarded_profile_id)"
            )
        )
        connection.execute(
            text(
                "CREATE INDEX IF NOT EXISTS idx_historical_champions_trophy_asset "
                "ON historical_champions(trophy_asset_id)"
            )
        )

        if "trophy_assets" not in table_names:
            connection.execute(
                text(
                    """
                    CREATE TABLE IF NOT EXISTS trophy_assets (
                      id UUID PRIMARY KEY,
                      name VARCHAR(160) NOT NULL,
                      category VARCHAR(80) NOT NULL DEFAULT 'Trofeo',
                      asset_code VARCHAR(120) UNIQUE,
                      season_id UUID,
                      matchday_number INTEGER,
                      award_place_label VARCHAR(80),
                      image_url TEXT,
                      created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                      updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
                    )
                    """
                )
            )
            connection.execute(
                text(
                    "CREATE INDEX IF NOT EXISTS idx_trophy_assets_name "
                    "ON trophy_assets(name)"
                )
            )
            connection.execute(
                text(
                    "CREATE INDEX IF NOT EXISTS idx_trophy_assets_category "
                    "ON trophy_assets(category)"
                )
            )
            connection.execute(
                text(
                    "CREATE INDEX IF NOT EXISTS idx_trophy_assets_season_matchday_place "
                    "ON trophy_assets(season_id, matchday_number, award_place_label)"
                )
            )
            connection.execute(
                text(
                    "CREATE UNIQUE INDEX IF NOT EXISTS idx_trophy_assets_code "
                    "ON trophy_assets(asset_code) WHERE asset_code IS NOT NULL"
                )
            )
        else:
            trophy_assets_column_names = {
                column["name"] for column in inspector.get_columns("trophy_assets")
            }
            missing_trophy_assets_columns = {
                "category": "ALTER TABLE trophy_assets ADD COLUMN category VARCHAR(80) NOT NULL DEFAULT 'Trofeo'",
                "asset_code": "ALTER TABLE trophy_assets ADD COLUMN asset_code VARCHAR(120)",
                "season_id": "ALTER TABLE trophy_assets ADD COLUMN season_id UUID",
                "matchday_number": "ALTER TABLE trophy_assets ADD COLUMN matchday_number INTEGER",
                "award_place_label": "ALTER TABLE trophy_assets ADD COLUMN award_place_label VARCHAR(80)",
                "image_url": "ALTER TABLE trophy_assets ADD COLUMN image_url TEXT",
            }
            for column_name, statement in missing_trophy_assets_columns.items():
                if column_name not in trophy_assets_column_names:
                    connection.execute(text(statement))

            connection.execute(
                text(
                    "CREATE INDEX IF NOT EXISTS idx_trophy_assets_name "
                    "ON trophy_assets(name)"
                )
            )
            connection.execute(
                text(
                    "CREATE INDEX IF NOT EXISTS idx_trophy_assets_category "
                    "ON trophy_assets(category)"
                )
            )
            connection.execute(
                text(
                    "CREATE INDEX IF NOT EXISTS idx_trophy_assets_season_matchday_place "
                    "ON trophy_assets(season_id, matchday_number, award_place_label)"
                )
            )
            connection.execute(
                text(
                    "CREATE UNIQUE INDEX IF NOT EXISTS idx_trophy_assets_code "
                    "ON trophy_assets(asset_code) WHERE asset_code IS NOT NULL"
                )
            )

        if "profile_trophy_awards" not in table_names:
            connection.execute(
                text(
                    """
                    CREATE TABLE IF NOT EXISTS profile_trophy_awards (
                      id UUID PRIMARY KEY,
                      profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
                      trophy_asset_id UUID REFERENCES trophy_assets(id) ON DELETE SET NULL,
                      season_id UUID REFERENCES seasons(id) ON DELETE SET NULL,
                      matchday_id UUID REFERENCES matchdays(id) ON DELETE SET NULL,
                      tournament_name VARCHAR(160),
                      place_label VARCHAR(80) NOT NULL DEFAULT 'Trofeo',
                      total_points INTEGER NOT NULL DEFAULT 0,
                      source_type VARCHAR(80) NOT NULL DEFAULT 'manual',
                      source_ref_id UUID,
                      awarded_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                      created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                      updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                      CONSTRAINT uq_profile_trophy_awards_source UNIQUE (source_type, source_ref_id)
                    )
                    """
                )
            )
            connection.execute(
                text(
                    "CREATE INDEX IF NOT EXISTS idx_profile_trophy_awards_profile "
                    "ON profile_trophy_awards(profile_id)"
                )
            )
            connection.execute(
                text(
                    "CREATE INDEX IF NOT EXISTS idx_profile_trophy_awards_trophy "
                    "ON profile_trophy_awards(trophy_asset_id)"
                )
            )
            connection.execute(
                text(
                    "CREATE INDEX IF NOT EXISTS idx_profile_trophy_awards_season "
                    "ON profile_trophy_awards(season_id)"
                )
            )
            connection.execute(
                text(
                    "CREATE INDEX IF NOT EXISTS idx_profile_trophy_awards_matchday "
                    "ON profile_trophy_awards(matchday_id)"
                )
            )
            connection.execute(
                text(
                    "CREATE INDEX IF NOT EXISTS idx_profile_trophy_awards_place "
                    "ON profile_trophy_awards(place_label)"
                )
            )
        else:
            profile_trophy_awards_column_names = {
                column["name"] for column in inspector.get_columns("profile_trophy_awards")
            }
            missing_profile_trophy_awards_columns = {
                "trophy_asset_id": "ALTER TABLE profile_trophy_awards ADD COLUMN trophy_asset_id UUID",
                "season_id": "ALTER TABLE profile_trophy_awards ADD COLUMN season_id UUID",
                "matchday_id": "ALTER TABLE profile_trophy_awards ADD COLUMN matchday_id UUID",
                "tournament_name": "ALTER TABLE profile_trophy_awards ADD COLUMN tournament_name VARCHAR(160)",
                "place_label": (
                    "ALTER TABLE profile_trophy_awards "
                    "ADD COLUMN place_label VARCHAR(80) NOT NULL DEFAULT 'Trofeo'"
                ),
                "total_points": (
                    "ALTER TABLE profile_trophy_awards "
                    "ADD COLUMN total_points INTEGER NOT NULL DEFAULT 0"
                ),
                "source_type": (
                    "ALTER TABLE profile_trophy_awards "
                    "ADD COLUMN source_type VARCHAR(80) NOT NULL DEFAULT 'manual'"
                ),
                "source_ref_id": "ALTER TABLE profile_trophy_awards ADD COLUMN source_ref_id UUID",
                "awarded_at": (
                    "ALTER TABLE profile_trophy_awards "
                    "ADD COLUMN awarded_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()"
                ),
                "created_at": (
                    "ALTER TABLE profile_trophy_awards "
                    "ADD COLUMN created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()"
                ),
                "updated_at": (
                    "ALTER TABLE profile_trophy_awards "
                    "ADD COLUMN updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()"
                ),
            }
            for column_name, statement in missing_profile_trophy_awards_columns.items():
                if column_name not in profile_trophy_awards_column_names:
                    connection.execute(text(statement))

            connection.execute(
                text(
                    "CREATE INDEX IF NOT EXISTS idx_profile_trophy_awards_profile "
                    "ON profile_trophy_awards(profile_id)"
                )
            )
            connection.execute(
                text(
                    "CREATE INDEX IF NOT EXISTS idx_profile_trophy_awards_trophy "
                    "ON profile_trophy_awards(trophy_asset_id)"
                )
            )
            connection.execute(
                text(
                    "CREATE INDEX IF NOT EXISTS idx_profile_trophy_awards_season "
                    "ON profile_trophy_awards(season_id)"
                )
            )
            connection.execute(
                text(
                    "CREATE INDEX IF NOT EXISTS idx_profile_trophy_awards_matchday "
                    "ON profile_trophy_awards(matchday_id)"
                )
            )
            connection.execute(
                text(
                    "CREATE INDEX IF NOT EXISTS idx_profile_trophy_awards_place "
                    "ON profile_trophy_awards(place_label)"
                )
            )

        if "historical_champions" in table_names:
            backfill_rows = connection.execute(
                text(
                    """
                    SELECT
                      hc.id,
                      hc.awarded_profile_id,
                      hc.trophy_asset_id,
                      hc.tournament_name,
                      hc.place_label,
                      hc.total_points,
                      hc.created_at
                    FROM historical_champions hc
                    LEFT JOIN profile_trophy_awards pta
                      ON pta.source_type = 'historical_champion'
                     AND pta.source_ref_id = hc.id
                    WHERE hc.awarded_profile_id IS NOT NULL
                      AND pta.id IS NULL
                    """
                )
            ).mappings()
            for row in backfill_rows:
                connection.execute(
                    text(
                        """
                        INSERT INTO profile_trophy_awards (
                          id,
                          profile_id,
                          trophy_asset_id,
                          tournament_name,
                          place_label,
                          total_points,
                          source_type,
                          source_ref_id,
                          awarded_at,
                          created_at,
                          updated_at
                        ) VALUES (
                          :id,
                          :profile_id,
                          :trophy_asset_id,
                          :tournament_name,
                          :place_label,
                          :total_points,
                          'historical_champion',
                          :source_ref_id,
                          :awarded_at,
                          now(),
                          now()
                        )
                        """
                    ),
                    {
                        "id": str(uuid4()),
                        "profile_id": row["awarded_profile_id"],
                        "trophy_asset_id": row["trophy_asset_id"],
                        "tournament_name": row["tournament_name"],
                        "place_label": row["place_label"],
                        "total_points": row["total_points"],
                        "source_ref_id": row["id"],
                        "awarded_at": row["created_at"],
                    },
                )

        if "rules_pages" not in table_names:
            connection.execute(
                text(
                    """
                    CREATE TABLE IF NOT EXISTS rules_pages (
                      id UUID PRIMARY KEY,
                      slug VARCHAR(80) NOT NULL UNIQUE,
                      title VARCHAR(160) NOT NULL DEFAULT 'Reglamento',
                      content_markdown TEXT NOT NULL DEFAULT '',
                      version_label VARCHAR(60),
                      updated_by_profile_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
                      created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                      updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
                    )
                    """
                )
            )
            connection.execute(
                text(
                    "CREATE INDEX IF NOT EXISTS idx_rules_pages_slug "
                    "ON rules_pages(slug)"
                )
            )
        else:
            rules_column_names = {column["name"] for column in inspector.get_columns("rules_pages")}
            missing_rules_columns = {
                "version_label": "ALTER TABLE rules_pages ADD COLUMN version_label VARCHAR(60)",
                "updated_by_profile_id": "ALTER TABLE rules_pages ADD COLUMN updated_by_profile_id UUID",
            }
            for column_name, statement in missing_rules_columns.items():
                if column_name not in rules_column_names:
                    connection.execute(text(statement))

        connection.execute(
            text(
                """
                INSERT INTO rules_pages (id, slug, title, content_markdown, version_label)
                SELECT :id, 'main', 'Reglamento', '', 'Beta 1.0'
                WHERE NOT EXISTS (
                  SELECT 1 FROM rules_pages WHERE slug = 'main'
                )
                """
            ),
            {"id": str(uuid4())},
        )


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    if settings.run_startup_db_bootstrap:
        Base.metadata.create_all(bind=engine)
    run_startup_migrations()
    yield


app = FastAPI(title=settings.project_name, version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(api_router, prefix=settings.api_v1_prefix)
