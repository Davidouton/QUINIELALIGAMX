"""Private read endpoints. No payment, settlement, or write side effects."""
from collections import defaultdict

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.api.deps import get_current_auth_user
from app.core.database import get_db
from app.core.security import AuthUser
from app.services.ap26_virtual_credits import AP26_ID, build_preview

router = APIRouter()


def read_preview(db: Session) -> dict:
    bind = {"season_id": AP26_ID}
    season = db.execute(text("""
        select slug, admin_commission_pct, weekly_first_place_amount,
               weekly_second_place_amount, weekly_third_place_amount
        from public.seasons
        where id = :season_id and slug = 'ap26'
    """), bind).mappings().one_or_none()
    if season is None:
        raise HTTPException(404, "Temporada no disponible")

    members = {
        str(row.profile_id): row.display_name
        for row in db.execute(text("""
            select sm.profile_id, p.display_name
            from public.season_memberships sm
            join public.profiles p on p.id = sm.profile_id
            where sm.season_id = :season_id and sm.is_active and
                  sm.eligible_for_scoring and not sm.is_rejected
            order by p.display_name, sm.profile_id
        """), bind)
    }
    ranks = defaultdict(dict)
    for row in db.execute(text("""
        select m.number, s.profile_id, s.rank_position
        from public.matchdays m
        join public.standings_matchday s on s.matchday_id = m.id
        join public.season_memberships sm on sm.season_id = m.season_id and sm.profile_id = s.profile_id
        where m.season_id = :season_id and m.number between 1 and 17 and
              sm.is_active and sm.eligible_for_scoring and not sm.is_rejected
    """), bind):
        key = str(row.profile_id)
        if key in ranks[row.number]:
            raise HTTPException(409, "La jornada contiene posiciones repetidas.")
        ranks[row.number][key] = row.rank_position
    weeks = []
    for row in db.execute(text("""
        select m.number, cast(m.status as text) as status,
               count(x.id) as games,
               (pm.id is not null) as published,
               count(x.id) filter (
                    where exists (select 1 from public.match_results z where z.match_id = x.id and z.is_official)
               ) as official
        from public.matchdays m
        left join public.matches x on x.matchday_id = m.id
        left join public.published_matchdays pm on pm.matchday_id = m.id
        where m.season_id = :season_id and m.number between 1 and 17
        group by m.number, m.status, pm.id
        order by m.number
    """), bind):
        weeks.append({**row._mapping, "ranks": ranks[row.number]})
    overall = [(row.rank_position, str(row.profile_id), row.total_points) for row in db.execute(text("""
        select so.rank_position, so.profile_id, so.total_points
        from public.standings_overall so
        join public.season_memberships sm on sm.season_id = so.season_id and sm.profile_id = so.profile_id
        where so.season_id = :season_id and so.rank_position between 1 and 3 and
              sm.is_active and sm.eligible_for_scoring and not sm.is_rejected
    """), bind)]
    try:
        return build_preview(
            season["slug"], members, weeks, season["admin_commission_pct"],
            (season["weekly_first_place_amount"], season["weekly_second_place_amount"], season["weekly_third_place_amount"]),
            overall,
        )
    except ValueError as exc:
        raise HTTPException(409, "El cierre de créditos de Apertura 2026 necesita revisión.") from exc


def existing_profile(
    db: Session = Depends(get_db),
    auth_user: AuthUser = Depends(get_current_auth_user),
):
    # Unlike profile bootstrapping, this dependency has no writes even if the
    # authenticated account has not yet created its Quinielón profile.
    profile = db.execute(text("""
        select id, is_active, role_code from public.profiles
        where auth_user_id = :auth_user_id
    """), {"auth_user_id": auth_user.auth_user_id}).one_or_none()
    if profile is None or not profile.is_active:
        raise HTTPException(403, "Perfil no disponible")
    return profile


@router.get("/leaderboard/ap26-virtual-credits/me")
def ap26_my_credits(
    response: Response,
    db: Session = Depends(get_db),
    profile=Depends(existing_profile),
) -> dict:
    response.headers["Cache-Control"] = "private, no-store"
    preview = read_preview(db)
    balance = preview["balances"].get(str(profile.id))
    if balance is None:
        raise HTTPException(404, "No tienes saldo para esta temporada")
    return {"season": preview["summary"]["season"], "unit": preview["summary"]["unit"],
            "settled_weeks": preview["summary"]["settled_weeks"], **balance}


@router.get("/leaderboard/ap26-virtual-credits/admin")
def ap26_admin_credits(
    response: Response,
    db: Session = Depends(get_db),
    profile=Depends(existing_profile),
) -> dict:
    response.headers["Cache-Control"] = "private, no-store"
    if profile.role_code not in ("admin", "master_admin"):
        raise HTTPException(403, "Permisos insuficientes")
    preview = read_preview(db)
    return {"summary": preview["summary"], "balances": list(preview["balances"].values())}
