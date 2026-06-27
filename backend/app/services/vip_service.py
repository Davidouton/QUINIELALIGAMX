from datetime import UTC, datetime
from decimal import Decimal
import random

from fastapi import HTTPException, status
from sqlalchemy import delete, select
from sqlalchemy.orm import Session, aliased

from app.core.datetime import ensure_utc
from app.models.entities import (
    Competition,
    Match,
    MatchResult,
    Matchday,
    Profile,
    Season,
    TournamentFormat,
    Team,
    UserPick,
    VipCompetition,
    VipCompetitionKind,
    VipCompetitionMatchday,
    VipMembership,
    VipMembershipStatus,
    VipTeamWinnerEntry,
    VipTeamWinnerTeam,
)
from app.schemas.vip import (
    AdminVipCompetitionOut,
    AdminVipMembershipAddRequest,
    AdminVipMembershipDecisionRequest,
    AdminVipMembershipPaymentRequest,
    AdminVipTeamWinnerConfigRequest,
    AdminVipTeamWinnerEntryPaymentRequest,
    AdminVipTeamWinnerTeamStatusRequest,
    AdminVipUpsertRequest,
    VipCompetitionOut,
    VipLeaderboardEntryOut,
    VipMatchdayOut,
    VipMembershipOut,
    VipTeamWinnerEntryOut,
    VipTeamWinnerTeamOut,
)
from app.services.scoring_service import ScoringService


class VipService:
    def get_join_lock(self, db: Session, vip_id: str) -> dict[str, object]:
        return self._join_lock_for_vip(db, vip_id)

    def list_public_vips(self, db: Session, profile: Profile) -> list[VipCompetitionOut]:
        vip_rows = list(
            db.scalars(
                select(VipCompetition)
                .where(VipCompetition.is_active.is_(True))
                .order_by(VipCompetition.created_at.desc(), VipCompetition.name.asc())
            )
        )
        if not vip_rows:
            return []

        self._repair_revealed_team_winner_assignments(db, [row.id for row in vip_rows])
        bundle = self._load_bundle(db, [row.id for row in vip_rows])
        result: list[VipCompetitionOut] = []
        for vip in vip_rows:
            memberships = bundle["memberships_by_vip"].get(vip.id, [])
            team_entries = bundle["team_winner_entries_by_vip"].get(vip.id, [])
            my_membership = next((membership for membership in memberships if membership.profile_id == profile.id), None)
            join_lock = bundle["join_locks_by_vip"].get(vip.id, {})
            result.append(
                VipCompetitionOut(
                    id=vip.id,
                    season_id=vip.season_id,
                    season_name=bundle["season_names"].get(vip.season_id, "Temporada"),
                    competition_kind=vip.competition_kind,
                    name=vip.name,
                    entry_fee_amount=float(vip.entry_fee_amount),
                    admin_commission_pct=float(vip.admin_commission_pct),
                    first_place_pct=float(vip.first_place_pct),
                    second_place_pct=float(vip.second_place_pct),
                    third_place_pct=float(vip.third_place_pct),
                    is_active=vip.is_active,
                    matchdays=bundle["matchdays_by_vip"].get(vip.id, []),
                    approved_members_count=sum(1 for membership in memberships if membership.status == VipMembershipStatus.APPROVED),
                    pending_requests_count=sum(1 for membership in memberships if membership.status == VipMembershipStatus.PENDING),
                    gross_pool_amount=float(self._gross_pool_amount(vip, memberships, team_entries)),
                    admin_commission_amount=float(self._admin_commission_amount(vip, memberships, team_entries)),
                    distributable_prize_pool_amount=float(self._distributable_prize_pool_amount(vip, memberships, team_entries)),
                    first_place_amount=float(self._first_place_amount(vip, memberships, team_entries)),
                    second_place_amount=float(self._second_place_amount(vip, memberships, team_entries)),
                    third_place_amount=float(self._third_place_amount(vip, memberships, team_entries)),
                    remaining_pool_amount=float(self._remaining_pool_amount(vip, memberships, team_entries)),
                    join_locked=bool(join_lock.get("locked", False)),
                    join_lock_at=join_lock.get("lock_at"),
                    join_lock_match_label=join_lock.get("match_label"),
                    my_membership=self._membership_out(my_membership, bundle["profile_names"]) if my_membership else None,
                    leaderboard=self._build_leaderboard(
                        vip.id,
                        bundle["matchdays_by_vip"].get(vip.id, []),
                        memberships,
                        bundle["profile_names"],
                        db,
                    ),
                    team_winner_teams=self._team_winner_team_outs(
                        bundle["team_winner_teams_by_vip"].get(vip.id, []),
                        bundle["team_names"],
                    ),
                    team_winner_entries=self._team_winner_entry_outs(
                        team_entries,
                        bundle["team_names"],
                        bundle["team_status_by_id"],
                    ),
                )
            )
        return result

    def request_join(self, db: Session, vip_id: str, profile: Profile) -> VipMembership:
        vip = db.get(VipCompetition, vip_id)
        if vip is None or not vip.is_active:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="VIP no encontrada")

        join_lock = self._join_lock_for_vip(db, vip_id)
        if join_lock["locked"]:
            lock_at_text = join_lock["lock_at"].strftime("%d/%m/%Y %H:%M") if join_lock["lock_at"] else "la fecha limite"
            match_label = join_lock["match_label"] or "el primer partido de la VIP"
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Las solicitudes VIP cerraron con {match_label} el {lock_at_text}",
            )

        membership = db.scalar(
            select(VipMembership).where(
                VipMembership.vip_competition_id == vip_id,
                VipMembership.profile_id == profile.id,
            )
        )
        now = datetime.now(UTC)
        if membership is None:
            membership = VipMembership(
                vip_competition_id=vip_id,
                profile_id=profile.id,
                status=VipMembershipStatus.PENDING,
                requested_at=now,
            )
        elif membership.status == VipMembershipStatus.APPROVED:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Ya perteneces a esta VIP")
        elif membership.status == VipMembershipStatus.PENDING:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Tu solicitud ya esta pendiente")
        else:
            membership.status = VipMembershipStatus.PENDING
            membership.requested_at = now
            membership.decided_at = None
            membership.decided_by_profile_id = None
            membership.admin_note = None

        db.add(membership)
        db.commit()
        db.refresh(membership)
        return membership

    def list_admin_vips(self, db: Session) -> list[AdminVipCompetitionOut]:
        vip_rows = list(
            db.scalars(
                select(VipCompetition)
                .order_by(VipCompetition.created_at.desc(), VipCompetition.name.asc())
            )
        )
        if not vip_rows:
            return []

        self._repair_revealed_team_winner_assignments(db, [row.id for row in vip_rows])
        bundle = self._load_bundle(db, [row.id for row in vip_rows], include_creator_names=True)
        return [
            AdminVipCompetitionOut(
                id=vip.id,
                season_id=vip.season_id,
                season_name=bundle["season_names"].get(vip.season_id, "Temporada"),
                competition_kind=vip.competition_kind,
                name=vip.name,
                entry_fee_amount=float(vip.entry_fee_amount),
                admin_commission_pct=float(vip.admin_commission_pct),
                first_place_pct=float(vip.first_place_pct),
                second_place_pct=float(vip.second_place_pct),
                third_place_pct=float(vip.third_place_pct),
                is_active=vip.is_active,
                created_by_profile_id=vip.created_by_profile_id,
                created_by_display_name=(
                    bundle["profile_names"].get(vip.created_by_profile_id)
                    if vip.created_by_profile_id
                    else None
                ),
                matchdays=bundle["matchdays_by_vip"].get(vip.id, []),
                memberships=[
                    self._membership_out(membership, bundle["profile_names"])
                    for membership in bundle["memberships_by_vip"].get(vip.id, [])
                ],
                approved_members_count=sum(
                    1
                    for membership in bundle["memberships_by_vip"].get(vip.id, [])
                    if membership.status == VipMembershipStatus.APPROVED
                ),
                pending_requests_count=sum(
                    1
                    for membership in bundle["memberships_by_vip"].get(vip.id, [])
                    if membership.status == VipMembershipStatus.PENDING
                ),
                gross_pool_amount=float(self._gross_pool_amount(vip, bundle["memberships_by_vip"].get(vip.id, []), bundle["team_winner_entries_by_vip"].get(vip.id, []))),
                admin_commission_amount=float(self._admin_commission_amount(vip, bundle["memberships_by_vip"].get(vip.id, []), bundle["team_winner_entries_by_vip"].get(vip.id, []))),
                distributable_prize_pool_amount=float(self._distributable_prize_pool_amount(vip, bundle["memberships_by_vip"].get(vip.id, []), bundle["team_winner_entries_by_vip"].get(vip.id, []))),
                first_place_amount=float(self._first_place_amount(vip, bundle["memberships_by_vip"].get(vip.id, []), bundle["team_winner_entries_by_vip"].get(vip.id, []))),
                second_place_amount=float(self._second_place_amount(vip, bundle["memberships_by_vip"].get(vip.id, []), bundle["team_winner_entries_by_vip"].get(vip.id, []))),
                third_place_amount=float(self._third_place_amount(vip, bundle["memberships_by_vip"].get(vip.id, []), bundle["team_winner_entries_by_vip"].get(vip.id, []))),
                remaining_pool_amount=float(self._remaining_pool_amount(vip, bundle["memberships_by_vip"].get(vip.id, []), bundle["team_winner_entries_by_vip"].get(vip.id, []))),
                join_locked=bool(bundle["join_locks_by_vip"].get(vip.id, {}).get("locked", False)),
                join_lock_at=bundle["join_locks_by_vip"].get(vip.id, {}).get("lock_at"),
                join_lock_match_label=bundle["join_locks_by_vip"].get(vip.id, {}).get("match_label"),
                leaderboard=self._build_leaderboard(
                    vip.id,
                    bundle["matchdays_by_vip"].get(vip.id, []),
                    bundle["memberships_by_vip"].get(vip.id, []),
                    bundle["profile_names"],
                    db,
                ),
                team_winner_teams=self._team_winner_team_outs(
                    bundle["team_winner_teams_by_vip"].get(vip.id, []),
                    bundle["team_names"],
                ),
                team_winner_entries=self._team_winner_entry_outs(
                    bundle["team_winner_entries_by_vip"].get(vip.id, []),
                    bundle["team_names"],
                    bundle["team_status_by_id"],
                ),
            )
            for vip in vip_rows
        ]

    def create_admin_vip(
        self,
        db: Session,
        payload: AdminVipUpsertRequest,
        current_profile: Profile,
    ) -> VipCompetition:
        season, matchdays = self._resolve_vip_season_and_matchdays(db, payload)
        vip = VipCompetition(
            season_id=season.id,
            competition_kind=payload.competition_kind,
            name=payload.name.strip(),
            entry_fee_amount=Decimal(str(payload.entry_fee_amount)),
            admin_commission_pct=Decimal(str(payload.admin_commission_pct)),
            first_place_pct=Decimal(str(payload.first_place_pct)),
            second_place_pct=Decimal(str(payload.second_place_pct)),
            third_place_pct=Decimal(str(payload.third_place_pct)),
            is_active=payload.is_active,
            created_by_profile_id=current_profile.id,
        )
        db.add(vip)
        db.flush()
        self._replace_matchdays(db, vip.id, matchdays)
        db.commit()
        db.refresh(vip)
        return vip

    def update_admin_vip(
        self,
        db: Session,
        vip_id: str,
        payload: AdminVipUpsertRequest,
    ) -> VipCompetition:
        vip = db.get(VipCompetition, vip_id)
        if vip is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="VIP no encontrada")

        season, matchdays = self._resolve_vip_season_and_matchdays(db, payload)
        vip.season_id = season.id
        vip.competition_kind = payload.competition_kind
        vip.name = payload.name.strip()
        vip.entry_fee_amount = Decimal(str(payload.entry_fee_amount))
        vip.admin_commission_pct = Decimal(str(payload.admin_commission_pct))
        vip.first_place_pct = Decimal(str(payload.first_place_pct))
        vip.second_place_pct = Decimal(str(payload.second_place_pct))
        vip.third_place_pct = Decimal(str(payload.third_place_pct))
        vip.is_active = payload.is_active
        db.add(vip)
        db.flush()
        self._replace_matchdays(db, vip.id, matchdays)
        db.commit()
        db.refresh(vip)
        return vip

    def delete_admin_vip(self, db: Session, vip_id: str) -> None:
        vip = db.get(VipCompetition, vip_id)
        if vip is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="VIP no encontrada")

        db.execute(delete(VipTeamWinnerEntry).where(VipTeamWinnerEntry.vip_competition_id == vip.id))
        db.execute(delete(VipTeamWinnerTeam).where(VipTeamWinnerTeam.vip_competition_id == vip.id))
        db.execute(delete(VipMembership).where(VipMembership.vip_competition_id == vip.id))
        db.execute(delete(VipCompetitionMatchday).where(VipCompetitionMatchday.vip_competition_id == vip.id))
        db.delete(vip)
        db.commit()

    def add_admin_membership(
        self,
        db: Session,
        vip_id: str,
        payload: AdminVipMembershipAddRequest,
        current_profile: Profile,
    ) -> VipMembership:
        vip = db.get(VipCompetition, vip_id)
        if vip is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="VIP no encontrada")

        profile = db.get(Profile, payload.profile_id)
        if profile is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Usuario no encontrado")

        now = datetime.now(UTC)
        membership = db.scalar(
            select(VipMembership).where(
                VipMembership.vip_competition_id == vip_id,
                VipMembership.profile_id == profile.id,
            )
        )
        if membership is None:
            membership = VipMembership(
                vip_competition_id=vip_id,
                profile_id=profile.id,
                status=VipMembershipStatus.APPROVED,
                requested_at=now,
            )
        elif membership.status == VipMembershipStatus.APPROVED:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="El usuario ya pertenece a esta VIP")
        else:
            membership.status = VipMembershipStatus.APPROVED

        membership.is_paid = payload.is_paid
        membership.decided_at = now
        membership.decided_by_profile_id = current_profile.id
        membership.admin_note = payload.admin_note.strip() if payload.admin_note else "Agregado por admin"
        db.add(membership)
        db.commit()
        db.refresh(membership)
        return membership

    def configure_team_winner(
        self,
        db: Session,
        vip_id: str,
        payload: AdminVipTeamWinnerConfigRequest,
    ) -> None:
        vip = self._get_team_winner_vip(db, vip_id)
        clean_team_ids = list(dict.fromkeys(payload.team_ids))
        clean_profile_ids = list(dict.fromkeys(payload.profile_ids))

        assigned_team_ids = set(
            db.scalars(
                select(VipTeamWinnerEntry.assigned_team_id).where(
                    VipTeamWinnerEntry.vip_competition_id == vip.id,
                    VipTeamWinnerEntry.assigned_team_id.is_not(None),
                )
            )
        )
        removed_assigned_teams = assigned_team_ids.difference(clean_team_ids)
        if removed_assigned_teams:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="No puedes quitar equipos que ya fueron asignados",
            )

        teams = list(db.scalars(select(Team).where(Team.id.in_(clean_team_ids))).all()) if clean_team_ids else []
        if len(teams) != len(clean_team_ids):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Hay equipos invalidos")
        if any(team.competition_id and team.competition_id != self._season_competition_id(db, vip.season_id) for team in teams):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Los equipos no pertenecen a la temporada")

        profiles = list(db.scalars(select(Profile).where(Profile.id.in_(clean_profile_ids))).all()) if clean_profile_ids else []
        if len(profiles) != len(clean_profile_ids):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Hay usuarios invalidos")
        if clean_profile_ids:
            approved_profile_ids = set(
                db.scalars(
                    select(VipMembership.profile_id).where(
                        VipMembership.vip_competition_id == vip.id,
                        VipMembership.status == VipMembershipStatus.APPROVED,
                        VipMembership.profile_id.in_(clean_profile_ids),
                    )
                )
            )
            if approved_profile_ids != set(clean_profile_ids):
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Solo puedes sortear miembros aprobados en esta VIP",
                )

        db.execute(
            delete(VipTeamWinnerTeam).where(
                VipTeamWinnerTeam.vip_competition_id == vip.id,
                VipTeamWinnerTeam.team_id.not_in(clean_team_ids) if clean_team_ids else True,
            )
        )
        existing_team_ids = set(
            db.scalars(select(VipTeamWinnerTeam.team_id).where(VipTeamWinnerTeam.vip_competition_id == vip.id))
        )
        for team_id in clean_team_ids:
            if team_id not in existing_team_ids:
                db.add(VipTeamWinnerTeam(vip_competition_id=vip.id, team_id=team_id))

        existing_entries = list(
            db.scalars(select(VipTeamWinnerEntry).where(VipTeamWinnerEntry.vip_competition_id == vip.id))
        )
        allowed_profile_ids = set(clean_profile_ids)
        for entry in existing_entries:
            if entry.assigned_team_id:
                continue
            if entry.is_house and not payload.include_house:
                db.delete(entry)
            elif not entry.is_house and entry.profile_id not in allowed_profile_ids:
                db.delete(entry)

        existing_profile_ids = {entry.profile_id for entry in existing_entries if entry.profile_id}
        profile_by_id = {profile.id: profile for profile in profiles}
        for profile_id in clean_profile_ids:
            if profile_id not in existing_profile_ids:
                profile = profile_by_id[profile_id]
                db.add(
                    VipTeamWinnerEntry(
                        vip_competition_id=vip.id,
                        profile_id=profile.id,
                        display_name=profile.display_name,
                    )
                )

        house_entry = next((entry for entry in existing_entries if entry.is_house), None)
        if payload.include_house:
            if house_entry is None:
                db.add(
                    VipTeamWinnerEntry(
                        vip_competition_id=vip.id,
                        display_name=payload.house_label.strip(),
                        is_house=True,
                    )
                )
            else:
                house_entry.display_name = payload.house_label.strip()
                db.add(house_entry)

        db.commit()

    def run_team_winner_draw(self, db: Session, vip_id: str) -> None:
        vip = self._get_team_winner_vip(db, vip_id)
        entries = list(
            db.scalars(
                select(VipTeamWinnerEntry)
                .where(VipTeamWinnerEntry.vip_competition_id == vip.id)
                .order_by(VipTeamWinnerEntry.created_at.asc(), VipTeamWinnerEntry.display_name.asc())
            )
        )
        teams = list(
            db.scalars(
                select(VipTeamWinnerTeam)
                .where(VipTeamWinnerTeam.vip_competition_id == vip.id)
                .order_by(VipTeamWinnerTeam.created_at.asc())
            )
        )
        if not entries:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Agrega participantes al sorteo")
        if len(teams) < len(entries):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Faltan equipos para sortear")
        if any(entry.assigned_team_id for entry in entries):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Este sorteo ya fue corrido")

        shuffled_teams = teams[:]
        random.SystemRandom().shuffle(shuffled_teams)
        shuffled_entries = entries[:]
        random.SystemRandom().shuffle(shuffled_entries)
        for index, entry in enumerate(shuffled_entries, start=1):
            entry.assigned_team_id = shuffled_teams[index - 1].team_id
            entry.reveal_order = index
            entry.revealed_at = None
            db.add(entry)
        db.commit()

    def reveal_next_team_winner_entry(self, db: Session, vip_id: str) -> None:
        vip = self._get_team_winner_vip(db, vip_id)
        entry = db.scalar(
            select(VipTeamWinnerEntry)
            .where(
                VipTeamWinnerEntry.vip_competition_id == vip.id,
                VipTeamWinnerEntry.assigned_team_id.is_not(None),
                VipTeamWinnerEntry.revealed_at.is_(None),
            )
            .order_by(VipTeamWinnerEntry.reveal_order.asc())
        )
        if entry is None:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No hay asignaciones por revelar")
        entry.revealed_at = datetime.now(UTC)
        db.add(entry)
        db.flush()
        db.refresh(entry)
        db.commit()
        db.expire_all()

    def _repair_revealed_team_winner_assignments(self, db: Session, vip_ids: list[str]) -> None:
        if not vip_ids:
            return

        entry_rows = list(
            db.scalars(
                select(VipTeamWinnerEntry)
                .where(VipTeamWinnerEntry.vip_competition_id.in_(vip_ids))
                .order_by(VipTeamWinnerEntry.reveal_order.asc().nulls_last(), VipTeamWinnerEntry.created_at.asc())
            )
        )
        missing_entries_by_vip: dict[str, list[VipTeamWinnerEntry]] = {}
        assigned_team_ids_by_vip: dict[str, set[str]] = {}
        for entry in entry_rows:
            if entry.assigned_team_id:
                assigned_team_ids_by_vip.setdefault(entry.vip_competition_id, set()).add(entry.assigned_team_id)
                continue
            if entry.revealed_at is not None:
                missing_entries_by_vip.setdefault(entry.vip_competition_id, []).append(entry)

        if not missing_entries_by_vip:
            return

        team_rows = list(
            db.scalars(
                select(VipTeamWinnerTeam)
                .where(VipTeamWinnerTeam.vip_competition_id.in_(missing_entries_by_vip.keys()))
                .order_by(VipTeamWinnerTeam.created_at.asc(), VipTeamWinnerTeam.id.asc())
            )
        )
        teams_by_vip: dict[str, list[VipTeamWinnerTeam]] = {}
        for team in team_rows:
            teams_by_vip.setdefault(team.vip_competition_id, []).append(team)

        changed = False
        for vip_id, missing_entries in missing_entries_by_vip.items():
            assigned_team_ids = assigned_team_ids_by_vip.get(vip_id, set())
            remaining_team_ids = [
                team.team_id
                for team in teams_by_vip.get(vip_id, [])
                if team.team_id not in assigned_team_ids
            ]
            for entry, team_id in zip(missing_entries, remaining_team_ids, strict=False):
                entry.assigned_team_id = team_id
                db.add(entry)
                assigned_team_ids.add(team_id)
                changed = True

        if changed:
            db.commit()
            db.expire_all()

    def update_team_winner_team_status(
        self,
        db: Session,
        vip_id: str,
        team_row_id: str,
        payload: AdminVipTeamWinnerTeamStatusRequest,
        current_profile: Profile,
    ) -> None:
        vip = self._get_team_winner_vip(db, vip_id)
        row = db.get(VipTeamWinnerTeam, team_row_id)
        if row is None or row.vip_competition_id != vip.id:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Equipo VIP no encontrado")
        row.is_eliminated = payload.is_eliminated
        row.is_champion = payload.is_champion
        row.eliminated_at = datetime.now(UTC) if payload.is_eliminated else None
        row.updated_by_profile_id = current_profile.id
        db.add(row)
        db.commit()

    def update_team_winner_entry_payment(
        self,
        db: Session,
        vip_id: str,
        entry_id: str,
        payload: AdminVipTeamWinnerEntryPaymentRequest,
    ) -> None:
        vip = self._get_team_winner_vip(db, vip_id)
        entry = db.get(VipTeamWinnerEntry, entry_id)
        if entry is None or entry.vip_competition_id != vip.id:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Participante VIP no encontrado")
        entry.is_paid = payload.is_paid
        db.add(entry)
        db.commit()

    def decide_membership(
        self,
        db: Session,
        vip_id: str,
        membership_id: str,
        decision: VipMembershipStatus,
        current_profile: Profile,
        payload: AdminVipMembershipDecisionRequest,
    ) -> VipMembership:
        membership = db.get(VipMembership, membership_id)
        if membership is None or membership.vip_competition_id != vip_id:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Solicitud no encontrada")
        if decision not in {VipMembershipStatus.APPROVED, VipMembershipStatus.REJECTED}:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Decision invalida")

        membership.status = decision
        membership.decided_at = datetime.now(UTC)
        membership.decided_by_profile_id = current_profile.id
        membership.admin_note = payload.admin_note.strip() if payload.admin_note else None
        db.add(membership)
        db.commit()
        db.refresh(membership)
        return membership

    def remove_membership(
        self,
        db: Session,
        vip_id: str,
        membership_id: str,
        current_profile: Profile,
        payload: AdminVipMembershipDecisionRequest,
    ) -> VipMembership:
        membership = db.get(VipMembership, membership_id)
        if membership is None or membership.vip_competition_id != vip_id:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Miembro VIP no encontrado")
        if membership.status != VipMembershipStatus.APPROVED:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Solo puedes sacar miembros aprobados")

        membership.status = VipMembershipStatus.REJECTED
        membership.is_paid = False
        membership.decided_at = datetime.now(UTC)
        membership.decided_by_profile_id = current_profile.id
        membership.admin_note = payload.admin_note.strip() if payload.admin_note else "Removido por admin"
        db.add(membership)
        db.commit()
        db.refresh(membership)
        return membership

    def update_membership_payment(
        self,
        db: Session,
        vip_id: str,
        membership_id: str,
        current_profile: Profile,
        payload: AdminVipMembershipPaymentRequest,
    ) -> VipMembership:
        membership = db.get(VipMembership, membership_id)
        if membership is None or membership.vip_competition_id != vip_id:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Miembro VIP no encontrado")
        if membership.status != VipMembershipStatus.APPROVED:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Solo puedes marcar pago de miembros aprobados")

        membership.is_paid = payload.is_paid
        membership.decided_at = datetime.now(UTC)
        membership.decided_by_profile_id = current_profile.id
        if payload.admin_note:
            membership.admin_note = payload.admin_note.strip()
        elif payload.is_paid:
            membership.admin_note = "Pago VIP confirmado por admin"
        else:
            membership.admin_note = "Pago VIP marcado pendiente por admin"
        db.add(membership)
        db.commit()
        db.refresh(membership)
        return membership

    def get_membership_out(self, db: Session, membership: VipMembership) -> VipMembershipOut:
        profile_names = self._profile_names(
            db,
            [
                membership.profile_id,
                membership.decided_by_profile_id,
            ],
        )
        return self._membership_out(membership, profile_names)

    def _load_bundle(
        self,
        db: Session,
        vip_ids: list[str],
        include_creator_names: bool = False,
    ) -> dict[str, object]:
        matchday_rows = db.execute(
            select(VipCompetitionMatchday, Matchday)
            .join(Matchday, Matchday.id == VipCompetitionMatchday.matchday_id)
            .where(VipCompetitionMatchday.vip_competition_id.in_(vip_ids))
            .order_by(Matchday.number.asc(), Matchday.name.asc())
        ).all()
        matchdays_by_vip: dict[str, list[VipMatchdayOut]] = {}
        matchday_ids_by_vip: dict[str, list[str]] = {}
        season_ids: set[str] = set()
        season_ids.update(
            row.season_id
            for row in db.scalars(select(VipCompetition).where(VipCompetition.id.in_(vip_ids))).all()
        )
        for link, matchday in matchday_rows:
            season_ids.add(matchday.season_id)
            matchday_ids_by_vip.setdefault(link.vip_competition_id, []).append(matchday.id)
            matchdays_by_vip.setdefault(link.vip_competition_id, []).append(
                VipMatchdayOut(
                    id=matchday.id,
                    season_id=matchday.season_id,
                    number=matchday.number,
                    name=matchday.name,
                )
            )

        decision_profile = aliased(Profile)
        membership_rows = db.execute(
            select(VipMembership, Profile.display_name, decision_profile.display_name)
            .join(Profile, Profile.id == VipMembership.profile_id)
            .outerjoin(decision_profile, decision_profile.id == VipMembership.decided_by_profile_id)
            .where(VipMembership.vip_competition_id.in_(vip_ids))
            .order_by(VipMembership.requested_at.desc(), Profile.display_name.asc())
        ).all()
        memberships_by_vip: dict[str, list[VipMembership]] = {}
        profile_names: dict[str, str] = {}
        for membership, display_name, decision_display_name in membership_rows:
            memberships_by_vip.setdefault(membership.vip_competition_id, []).append(membership)
            profile_names[membership.profile_id] = display_name
            if membership.decided_by_profile_id and decision_display_name:
                profile_names[membership.decided_by_profile_id] = decision_display_name

        team_winner_team_rows = list(
            db.scalars(
                select(VipTeamWinnerTeam)
                .where(VipTeamWinnerTeam.vip_competition_id.in_(vip_ids))
                .order_by(VipTeamWinnerTeam.created_at.asc())
            )
        )
        team_winner_teams_by_vip: dict[str, list[VipTeamWinnerTeam]] = {}
        team_ids: set[str] = set()
        for row in team_winner_team_rows:
            team_winner_teams_by_vip.setdefault(row.vip_competition_id, []).append(row)
            team_ids.add(row.team_id)

        team_winner_entry_rows = list(
            db.scalars(
                select(VipTeamWinnerEntry)
                .where(VipTeamWinnerEntry.vip_competition_id.in_(vip_ids))
                .order_by(VipTeamWinnerEntry.reveal_order.asc().nulls_last(), VipTeamWinnerEntry.created_at.asc())
            )
        )
        team_winner_entries_by_vip: dict[str, list[VipTeamWinnerEntry]] = {}
        for row in team_winner_entry_rows:
            team_winner_entries_by_vip.setdefault(row.vip_competition_id, []).append(row)
            if row.assigned_team_id:
                team_ids.add(row.assigned_team_id)

        team_names = {
            team.id: team
            for team in db.scalars(select(Team).where(Team.id.in_(team_ids))).all()
        } if team_ids else {}
        team_status_by_id = {row.team_id: row for row in team_winner_team_rows}

        if include_creator_names:
            vip_creator_ids = [
                vip.created_by_profile_id
                for vip in db.scalars(select(VipCompetition).where(VipCompetition.id.in_(vip_ids))).all()
                if vip.created_by_profile_id
            ]
            profile_names.update(self._profile_names(db, vip_creator_ids))

        season_names = {
            season.id: season.name
            for season in db.scalars(select(Season).where(Season.id.in_(season_ids))).all()
        }

        return {
            "matchdays_by_vip": matchdays_by_vip,
            "join_locks_by_vip": self._join_locks_for_vips(db, matchday_ids_by_vip),
            "memberships_by_vip": memberships_by_vip,
            "team_winner_teams_by_vip": team_winner_teams_by_vip,
            "team_winner_entries_by_vip": team_winner_entries_by_vip,
            "team_names": team_names,
            "team_status_by_id": team_status_by_id,
            "profile_names": profile_names,
            "season_names": season_names,
        }

    def _join_lock_for_vip(self, db: Session, vip_id: str) -> dict[str, object]:
        matchday_ids = [
            row.matchday_id
            for row in db.scalars(
                select(VipCompetitionMatchday).where(VipCompetitionMatchday.vip_competition_id == vip_id)
            ).all()
        ]
        return self._join_locks_for_vips(db, {vip_id: matchday_ids}).get(
            vip_id,
            {"locked": False, "lock_at": None, "match_label": None},
        )

    def _join_locks_for_vips(
        self,
        db: Session,
        matchday_ids_by_vip: dict[str, list[str]],
    ) -> dict[str, dict[str, object]]:
        all_matchday_ids = sorted({matchday_id for ids in matchday_ids_by_vip.values() for matchday_id in ids})
        if not all_matchday_ids:
            return {}

        home_team = aliased(Team)
        away_team = aliased(Team)
        rows = db.execute(
            select(
                Match,
                Matchday,
                home_team.name,
                away_team.name,
            )
            .join(Matchday, Matchday.id == Match.matchday_id)
            .outerjoin(home_team, home_team.id == Match.home_team_id)
            .outerjoin(away_team, away_team.id == Match.away_team_id)
            .where(Match.matchday_id.in_(all_matchday_ids))
            .order_by(Matchday.number.asc(), Match.kickoff_at.asc(), Match.id.asc())
        ).all()

        rows_by_matchday: dict[str, list[tuple[Match, Matchday, str | None, str | None]]] = {}
        for match, matchday, home_name, away_name in rows:
            rows_by_matchday.setdefault(matchday.id, []).append((match, matchday, home_name, away_name))

        now = datetime.now(UTC)
        result: dict[str, dict[str, object]] = {}
        for vip_id, matchday_ids in matchday_ids_by_vip.items():
            selected_row = next(
                (
                    rows_by_matchday[matchday_id][0]
                    for matchday_id in matchday_ids
                    if rows_by_matchday.get(matchday_id)
                ),
                None,
            )
            if selected_row is None:
                result[vip_id] = {"locked": False, "lock_at": None, "match_label": None}
                continue

            match, _, home_name, away_name = selected_row
            lock_at = ensure_utc(match.picks_lock_at)
            home_label = home_name or match.home_placeholder or "Local"
            away_label = away_name or match.away_placeholder or "Visitante"
            result[vip_id] = {
                "locked": now >= lock_at,
                "lock_at": lock_at,
                "match_label": f"{home_label} vs {away_label}",
            }
        return result

    def _build_leaderboard(
        self,
        vip_id: str,
        matchdays: list[VipMatchdayOut],
        memberships: list[VipMembership],
        profile_names: dict[str, str],
        db: Session,
    ) -> list[VipLeaderboardEntryOut]:
        approved_memberships = [membership for membership in memberships if membership.status == VipMembershipStatus.APPROVED]
        if not approved_memberships:
            return []

        approved_profile_ids = [membership.profile_id for membership in approved_memberships]
        profile_name_map = dict(profile_names)
        if any(profile_id not in profile_name_map for profile_id in approved_profile_ids):
            profile_name_map.update(self._profile_names(db, approved_profile_ids))

        if not matchdays:
            return []

        totals: dict[str, dict[str, int]] = {
            profile_id: {"total_points": 0, "correct_results": 0, "exact_scores": 0}
            for profile_id in approved_profile_ids
        }
        rows = self._vip_pick_score_rows(db, [matchday.id for matchday in matchdays], approved_profile_ids)
        for profile_id, values in rows:
            bucket = totals.setdefault(
                profile_id,
                {"total_points": 0, "correct_results": 0, "exact_scores": 0},
            )
            bucket["total_points"] += values["total_points"]
            bucket["correct_results"] += values["correct_results"]
            bucket["exact_scores"] += values["exact_scores"]

        sorted_rows = sorted(
            totals.items(),
            key=lambda item: (
                -item[1]["total_points"],
                -item[1]["exact_scores"],
                profile_name_map.get(item[0], item[0]).lower(),
            ),
        )
        ranked_rows = ScoringService._apply_competition_ranks(sorted_rows)
        return [
            VipLeaderboardEntryOut(
                profile_id=profile_id,
                display_name=profile_name_map.get(profile_id, "Jugador"),
                total_points=values["total_points"],
                correct_results=values["correct_results"],
                exact_scores=values["exact_scores"],
                rank_position=rank_position,
            )
            for profile_id, values, rank_position in ranked_rows
        ]

    def _vip_pick_score_rows(
        self,
        db: Session,
        matchday_ids: list[str],
        profile_ids: list[str],
    ) -> list[tuple[str, dict[str, int]]]:
        if not matchday_ids or not profile_ids:
            return []

        scoring = ScoringService()
        rules = scoring._load_rules(db)
        rows = db.execute(
            select(UserPick, MatchResult, Match, Matchday, Season, Competition)
            .join(Match, Match.id == UserPick.match_id)
            .join(MatchResult, MatchResult.match_id == Match.id)
            .join(Matchday, Matchday.id == Match.matchday_id)
            .join(Season, Season.id == Matchday.season_id)
            .outerjoin(Competition, Competition.id == Season.competition_id)
            .where(
                Match.matchday_id.in_(matchday_ids),
                UserPick.profile_id.in_(profile_ids),
                MatchResult.is_official.is_(True),
            )
        ).all()

        result: list[tuple[str, dict[str, int]]] = []
        for pick, match_result, match, _matchday, season, competition in rows:
            is_nfl_match = scoring._is_nfl_competition(competition)
            winner = scoring._resolve_winner(match_result.home_score, match_result.away_score)
            result_points = rules["result_correct"] if pick.selection == winner else 0
            exact_points = 0
            if not is_nfl_match:
                exact_points = (
                    rules["exact_score"]
                    if pick.predicted_home_score == match_result.home_score
                    and pick.predicted_away_score == match_result.away_score
                    else 0
                )
            advancing_points = (
                rules["advancing_team"]
                if season.tournament_format == TournamentFormat.WORLD_CUP
                and match.stage_type.value not in {"regular", "group"}
                and pick.advancing_team_id is not None
                and pick.advancing_team_id == match_result.advancing_team_id
                else 0
            )
            spread_points = 0
            if is_nfl_match:
                spread_points = scoring._calculate_spread_points(
                    match_result.home_score,
                    match_result.away_score,
                    pick.spread_selection,
                    pick.spread_line_value,
                    rules["spread_correct"],
                )
            result.append(
                (
                    pick.profile_id,
                    {
                        "total_points": result_points + exact_points + advancing_points + spread_points,
                        "correct_results": 1 if result_points else 0,
                        "exact_scores": 1 if exact_points else 0,
                    },
                )
            )
        return result

    def _resolve_matchdays(self, db: Session, matchday_ids: list[str]) -> tuple[Season, list[Matchday]]:
        clean_ids = list(dict.fromkeys(matchday_ids))
        matchdays = list(
            db.scalars(
                select(Matchday)
                .where(Matchday.id.in_(clean_ids))
                .order_by(Matchday.number.asc())
            )
        )
        if len(matchdays) != len(clean_ids):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Hay jornadas VIP invalidas")

        season_ids = {matchday.season_id for matchday in matchdays}
        if len(season_ids) != 1:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Todas las jornadas VIP deben ser de la misma temporada")

        season = db.get(Season, matchdays[0].season_id)
        if season is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Temporada no encontrada")

        return season, matchdays

    def _resolve_vip_season_and_matchdays(
        self,
        db: Session,
        payload: AdminVipUpsertRequest,
    ) -> tuple[Season, list[Matchday]]:
        if payload.competition_kind == VipCompetitionKind.MATCHDAY:
            return self._resolve_matchdays(db, payload.matchday_ids)

        season = db.get(Season, payload.season_id)
        if season is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Temporada no encontrada")
        return season, []

    def _get_team_winner_vip(self, db: Session, vip_id: str) -> VipCompetition:
        vip = db.get(VipCompetition, vip_id)
        if vip is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="VIP no encontrada")
        if vip.competition_kind != VipCompetitionKind.TEAM_WINNER:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Esta VIP no es de Equipo ganador")
        return vip

    def _season_competition_id(self, db: Session, season_id: str) -> str | None:
        season = db.get(Season, season_id)
        return season.competition_id if season else None

    def _replace_matchdays(self, db: Session, vip_id: str, matchdays: list[Matchday]) -> None:
        db.execute(delete(VipCompetitionMatchday).where(VipCompetitionMatchday.vip_competition_id == vip_id))
        for matchday in matchdays:
            db.add(
                VipCompetitionMatchday(
                    vip_competition_id=vip_id,
                    matchday_id=matchday.id,
                )
            )

    def _profile_names(self, db: Session, profile_ids: list[str | None]) -> dict[str, str]:
        clean_ids = sorted({profile_id for profile_id in profile_ids if profile_id})
        if not clean_ids:
            return {}
        return {
            profile.id: profile.display_name
            for profile in db.scalars(select(Profile).where(Profile.id.in_(clean_ids))).all()
        }

    def _membership_out(
        self,
        membership: VipMembership,
        profile_names: dict[str, str],
    ) -> VipMembershipOut:
        return VipMembershipOut(
            id=membership.id,
            profile_id=membership.profile_id,
            display_name=profile_names.get(membership.profile_id, "Jugador"),
            status=membership.status,
            is_paid=membership.is_paid,
            requested_at=membership.requested_at,
            decided_at=membership.decided_at,
            decided_by_profile_id=membership.decided_by_profile_id,
            decided_by_display_name=(
                profile_names.get(membership.decided_by_profile_id)
                if membership.decided_by_profile_id
                else None
            ),
            admin_note=membership.admin_note,
        )

    def _team_winner_team_outs(
        self,
        rows: list[VipTeamWinnerTeam],
        teams_by_id: dict[str, Team],
    ) -> list[VipTeamWinnerTeamOut]:
        result: list[VipTeamWinnerTeamOut] = []
        for row in rows:
            team = teams_by_id.get(row.team_id)
            result.append(
                VipTeamWinnerTeamOut(
                    id=row.id,
                    team_id=row.team_id,
                    team_name=team.name if team else "Equipo",
                    team_short_name=team.short_name if team else "EQ",
                    team_crest_url=team.crest_url if team else None,
                    is_eliminated=row.is_eliminated,
                    is_champion=row.is_champion,
                )
            )
        return result

    def _team_winner_entry_outs(
        self,
        rows: list[VipTeamWinnerEntry],
        teams_by_id: dict[str, Team],
        team_status_by_id: dict[str, VipTeamWinnerTeam],
    ) -> list[VipTeamWinnerEntryOut]:
        result: list[VipTeamWinnerEntryOut] = []
        for row in rows:
            team = teams_by_id.get(row.assigned_team_id) if row.assigned_team_id else None
            team_status = team_status_by_id.get(row.assigned_team_id) if row.assigned_team_id else None
            is_revealed = row.revealed_at is not None
            result.append(
                VipTeamWinnerEntryOut(
                    id=row.id,
                    profile_id=row.profile_id,
                    display_name=row.display_name,
                    is_house=row.is_house,
                    assigned_team_id=row.assigned_team_id if is_revealed else None,
                    assigned_team_name=team.name if team and is_revealed else None,
                    assigned_team_short_name=team.short_name if team and is_revealed else None,
                    assigned_team_crest_url=team.crest_url if team and is_revealed else None,
                    assigned_team_eliminated=bool(team_status.is_eliminated) if team_status and is_revealed else False,
                    assigned_team_champion=bool(team_status.is_champion) if team_status and is_revealed else False,
                    reveal_order=row.reveal_order,
                    revealed_at=row.revealed_at,
                    is_paid=row.is_paid,
                )
            )
        return result

    @staticmethod
    def _approved_members_count(memberships: list[VipMembership]) -> int:
        return sum(1 for membership in memberships if membership.status == VipMembershipStatus.APPROVED)

    def _pool_units(
        self,
        vip: VipCompetition,
        memberships: list[VipMembership],
        team_entries: list[VipTeamWinnerEntry] | None = None,
    ) -> int:
        return self._approved_members_count(memberships)

    def _gross_pool_amount(
        self,
        vip: VipCompetition,
        memberships: list[VipMembership],
        team_entries: list[VipTeamWinnerEntry] | None = None,
    ) -> Decimal:
        return Decimal(self._pool_units(vip, memberships, team_entries)) * vip.entry_fee_amount

    def _admin_commission_amount(
        self,
        vip: VipCompetition,
        memberships: list[VipMembership],
        team_entries: list[VipTeamWinnerEntry] | None = None,
    ) -> Decimal:
        return self._gross_pool_amount(vip, memberships, team_entries) * (vip.admin_commission_pct / Decimal("100"))

    def _distributable_prize_pool_amount(
        self,
        vip: VipCompetition,
        memberships: list[VipMembership],
        team_entries: list[VipTeamWinnerEntry] | None = None,
    ) -> Decimal:
        return self._gross_pool_amount(vip, memberships, team_entries) - self._admin_commission_amount(vip, memberships, team_entries)

    def _first_place_amount(
        self,
        vip: VipCompetition,
        memberships: list[VipMembership],
        team_entries: list[VipTeamWinnerEntry] | None = None,
    ) -> Decimal:
        return self._distributable_prize_pool_amount(vip, memberships, team_entries) * (vip.first_place_pct / Decimal("100"))

    def _second_place_amount(
        self,
        vip: VipCompetition,
        memberships: list[VipMembership],
        team_entries: list[VipTeamWinnerEntry] | None = None,
    ) -> Decimal:
        return self._distributable_prize_pool_amount(vip, memberships, team_entries) * (vip.second_place_pct / Decimal("100"))

    def _third_place_amount(
        self,
        vip: VipCompetition,
        memberships: list[VipMembership],
        team_entries: list[VipTeamWinnerEntry] | None = None,
    ) -> Decimal:
        return self._distributable_prize_pool_amount(vip, memberships, team_entries) * (vip.third_place_pct / Decimal("100"))

    def _remaining_pool_amount(
        self,
        vip: VipCompetition,
        memberships: list[VipMembership],
        team_entries: list[VipTeamWinnerEntry] | None = None,
    ) -> Decimal:
        return (
            self._distributable_prize_pool_amount(vip, memberships, team_entries)
            - self._first_place_amount(vip, memberships, team_entries)
            - self._second_place_amount(vip, memberships, team_entries)
            - self._third_place_amount(vip, memberships, team_entries)
        )
