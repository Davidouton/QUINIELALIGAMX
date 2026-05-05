from fastapi import APIRouter

from app.api.v1.routes.admin import router as admin_router
from app.api.v1.routes.health import router as health_router
from app.api.v1.routes.leaderboard import router as leaderboard_router
from app.api.v1.routes.matchdays import router as matchdays_router
from app.api.v1.routes.matches import router as matches_router
from app.api.v1.routes.me import router as me_router
from app.api.v1.routes.picks import router as picks_router
from app.api.v1.routes.results import router as results_router
from app.api.v1.routes.rules import router as rules_router
from app.api.v1.routes.seasons import router as seasons_router
from app.api.v1.routes.teams import router as teams_router
from app.api.v1.routes.vip import router as vip_router

api_router = APIRouter()
api_router.include_router(health_router, tags=["health"])
api_router.include_router(me_router, tags=["me"])
api_router.include_router(seasons_router, tags=["seasons"])
api_router.include_router(teams_router, tags=["teams"])
api_router.include_router(matchdays_router, tags=["matchdays"])
api_router.include_router(matches_router, tags=["matches"])
api_router.include_router(picks_router, tags=["picks"])
api_router.include_router(results_router, tags=["results"])
api_router.include_router(rules_router, tags=["rules"])
api_router.include_router(leaderboard_router, tags=["leaderboard"])
api_router.include_router(vip_router, tags=["vip"])
api_router.include_router(admin_router, prefix="/admin", tags=["admin"])
