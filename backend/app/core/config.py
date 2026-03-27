from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    project_name: str = "QuinielaMaestra API"
    app_env: str = "development"
    api_v1_prefix: str = "/api/v1"
    database_url: str = "sqlite:///./quinielamaestra.db"
    run_startup_db_bootstrap: bool = False
    allowed_origins: str = "http://localhost:3000"
    supabase_url: str = "https://your-project.supabase.co"
    supabase_anon_key: str = "replace-me"
    supabase_jwt_secret: str = ""
    default_provider: str = "mock"
    results_provider_name: str = "thesportsdb_v1"
    results_provider_base_url: str = "https://www.thesportsdb.com"
    results_provider_api_key: str = "123"
    results_provider_league_id: str = "4350"
    results_provider_season: str | None = None
    results_provider_timeout_seconds: float = 15.0

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
