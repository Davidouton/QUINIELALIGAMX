from collections.abc import Generator

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.core.config import get_settings

settings = get_settings()

engine_kwargs: dict[str, object] = {
    "future": True,
    "pool_pre_ping": settings.database_pool_pre_ping,
    "pool_recycle": settings.database_pool_recycle_seconds,
}

if settings.normalized_database_url.startswith("postgresql"):
    connect_args: dict[str, object] = {
        "connect_timeout": settings.database_connect_timeout_seconds,
    }
    if settings.database_statement_timeout_ms > 0:
        connect_args["options"] = f"-c statement_timeout={settings.database_statement_timeout_ms}"
    engine_kwargs["connect_args"] = connect_args

engine = create_engine(settings.normalized_database_url, **engine_kwargs)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
