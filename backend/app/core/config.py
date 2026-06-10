from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    project_name: str = "QuinielaMaestra API"
    app_env: str = "development"
    api_v1_prefix: str = "/api/v1"
    database_url: str = "sqlite:///./quinielamaestra.db"
    run_startup_db_bootstrap: bool = False
    run_startup_migrations: bool = True
    run_startup_migrations_in_production: bool = False
    allowed_origins: str = "http://localhost:3000"
    frontend_site_url: str = "http://localhost:3000"
    supabase_url: str = "https://your-project.supabase.co"
    supabase_anon_key: str = "replace-me"
    supabase_service_role_key: str = ""
    supabase_jwt_secret: str = ""
    resend_api_key: str = ""
    resend_from_email: str = ""
    resend_from_name: str = "QuinielaMaestra"
    resend_reply_to: str = ""
    default_provider: str = "mock"
    results_provider_name: str = "thesportsdb_v1"
    results_provider_base_url: str = "https://www.thesportsdb.com"
    results_provider_api_key: str = "123"
    results_provider_league_id: str = "4350"
    results_provider_season: str | None = None
    results_provider_timeout_seconds: float = 15.0
    api_football_base_url: str = "https://v3.football.api-sports.io"
    api_football_key: str = ""
    api_football_header_name: str = "x-apisports-key"
    api_football_host_header: str = ""
    api_football_league_id: str = "262"
    api_football_season: int | None = None
    api_football_timezone: str = "America/Mexico_City"
    api_football_results_statuses: str = "FT-AET-PEN"
    api_football_results_lookback_days: int = 7
    api_football_timeout_seconds: float = 20.0
    the_odds_api_key: str = ""
    the_odds_api_base_url: str = "https://api.the-odds-api.com/v4"
    the_odds_api_sport: str = "soccer_mexico_ligamx"
    the_odds_api_regions: str = "us"
    the_odds_api_markets: str = "h2h,spreads,totals"
    the_odds_api_odds_format: str = "american"
    the_odds_api_bookmaker: str = "draftkings"
    the_odds_api_results_days_from: int = 3
    the_odds_api_timeout_seconds: float = 20.0
    stripe_api_base_url: str = "https://api.stripe.com/v1"
    stripe_secret_key: str = ""
    stripe_webhook_secret: str = ""
    stripe_success_url: str = "http://localhost:3000/dashboard/payments/success"
    stripe_cancel_url: str = "http://localhost:3000/dashboard/payments/cancel"
    stripe_default_currency: str = "mxn"
    stripe_webhook_tolerance_seconds: int = 300

    model_config = SettingsConfigDict(env_file=".env", case_sensitive=False, extra="ignore")

    @property
    def allowed_origins_list(self) -> list[str]:
        return [origin.strip() for origin in self.allowed_origins.split(",") if origin.strip()]

    @property
    def normalized_database_url(self) -> str:
        if self.database_url.startswith("postgresql://"):
            return self.database_url.replace("postgresql://", "postgresql+psycopg://", 1)
        return self.database_url

    @property
    def supabase_jwks_url(self) -> str:
        return f"{self.supabase_url.rstrip('/')}/auth/v1/.well-known/jwks.json"


@lru_cache
def get_settings() -> Settings:
    return Settings()
