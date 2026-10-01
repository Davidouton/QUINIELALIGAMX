import psycopg
from fastapi import APIRouter, Depends, HTTPException, Query

from app.api.deps import require_roles
from app.models.entities import Profile, RoleCode
from app.nfl_predictor.store import connection

router = APIRouter()


@router.get("/nfl-predictor")
def get_nfl_predictor(
    season: int | None = Query(None, ge=2018, le=2100),
    week: int | None = Query(None, ge=1, le=22),
    profile: Profile = Depends(require_roles(RoleCode.MASTER_ADMIN)),
):
    if not profile.is_active:
        raise HTTPException(403, "Tu cuenta no está activa.")
    try:
        with connection() as store:
            return store.dashboard(season, week)
    except psycopg.errors.UndefinedTable:
        raise HTTPException(
            503, "NFL Predictor está pendiente de inicializar en la base de datos."
        ) from None
    except (psycopg.Error, ValueError):
        raise HTTPException(503, "NFL Predictor no está disponible temporalmente.") from None


@router.get("/nfl-predictor/report")
def get_kelly_report(
    market: str = Query("ML", pattern="^(ML|ATS|TOTAL|CONTRA_ATS|CONTRA_TOTAL)$"),
    season: int | None = Query(None, ge=2018, le=2100),
    week: int | None = Query(None, ge=1, le=22),
    mode: str = Query("original", pattern="^(original|corrected|engine)$"),
    profile: Profile = Depends(require_roles(RoleCode.MASTER_ADMIN)),
):
    if not profile.is_active:
        raise HTTPException(403, "Tu cuenta no está activa.")
    from app.nfl_predictor.report import read_report

    try:
        with connection() as store:
            return read_report(store, market, season, week, mode)
    except psycopg.errors.UndefinedTable:
        raise HTTPException(503, "El histórico Kelly está pendiente de importar.") from None
    except (psycopg.Error, ValueError):
        raise HTTPException(503, "No se pudo consultar el histórico Kelly.") from None
