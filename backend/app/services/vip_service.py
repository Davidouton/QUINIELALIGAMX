from datetime import UTC, datetime
from decimal import Decimal

from fastapi import HTTPException, status
from sqlalchemy import delete, select
from sqlalchemy.orm import Session, aliased

from app.models.entities import (
    Matchday,
    Profile,
    Season,
    StandingsMatchday,
    VipCompetition,
    VipCompetitionMatchday,
    VipMembership,
    VipMembershipStatus,
)
from app.schemas.vip import (
    AdminVipCompetitionOut,
    AdminVipMembershipDecisionRequest,
    AdminVipUpsertRequest,
    VipCompetitionOut,
    VipLeaderboardEntryOut,
    VipMatchdayOut,
    VipMembershipOut,
)
from app.services.scoring_service import ScoringService


class VipService:
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

        bundle = self._load_bundle(db, [row.id for row in vip_rows])
        result: list[VipCompetitionOut] = []
        for vip in vip_rows:
            memberships = bundle["memberships_by_vip"].get(vip.id, [])
            my_membership = next((membership for membership in memberships if membership.profile_id == profile.id), None)
            result.append(
                VipCompetitionOut(
                    id=vip.id,
                    season_id=vip.season_id,
                    season_name=bundle["season_names"].get(vip.season_id, "Temporada"),
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
                    gross_pool_amount=float(self._gross_pool_amount(vip, memberships)),
                    admin_commission_amount=float(self._admin_commission_amount(vip, memberships)),
                    distributable_prize_pool_amount=float(self._distributable_prize_pool_amount(vip, memberships)),
                    first_place_amount=float(self._first_place_amount(vip, memberships)),
                    second_place_amount=float(self._second_place_amount(vip, memberships)),
                    third_place_amount=float(self._third_place_amount(vip, memberships)),
                    remaining_pool_amount=float(self._remaining_pool_amount(vip, memberships)),
                    my_membership=self._membership_out(my_membership, bundle["profile_names"]) if my_membership else None,
                    leaderboard=self._build_leaderboard(
                        vip.id,
                        bundle["matchdays_by_vip"].get(vip.id, []),
                        memberships,
                        bundle["profile_names"],
                        db,
                    ),
                )
            )
        return result

    def request_join(self, db: Session, vip_id: str, profile: Profile) -> VipMembership:
        vip = db.get(VipCompetition, vip_id)
        if vip is None or not vip.is_active:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="VIP no encontrada")

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

        bundle = self._load_bundle(db, [row.id for row in vip_rows], include_creator_names=True)
        return [
            AdminVipCompetitionOut(
                id=vip.id,
                season_id=vip.season_id,
                season_name=bundle["season_names"].get(vip.season_id, "Temporada"),
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
                gross_pool_amount=float(self._gross_pool_amount(vip, bundle["memberships_by_vip"].get(vip.id, []))),
                admin_commission_amount=float(self._admin_commission_amount(vip, bundle["memberships_by_vip"].get(vip.id, []))),
                distributable_prize_pool_amount=float(self._distributable_prize_pool_amount(vip, bundle["memberships_by_vip"].get(vip.id, []))),
                first_place_amount=float(self._first_place_amount(vip, bundle["memberships_by_vip"].get(vip.id, []))),
                second_place_amount=float(self._second_place_amount(vip, bundle["memberships_by_vip"].get(vip.id, []))),
                third_place_amount=float(self._third_place_amount(vip, bundle["memberships_by_vip"].get(vip.id, []))),
                remaining_pool_amount=float(self._remaining_pool_amount(vip, bundle["memberships_by_vip"].get(vip.id, []))),
                leaderboard=self._build_leaderboard(
                    vip.id,
                    bundle["matchdays_by_vip"].get(vip.id, []),
                    bundle["memberships_by_vip"].get(vip.id, []),
                    bundle["profile_names"],
                    db,
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
        season, matchdays = self._resolve_matchdays(db, payload.matchday_ids)
        vip = VipCompetition(
            season_id=season.id,
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

        season, matchdays = self._resolve_matchdays(db, payload.matchday_ids)
        vip.season_id = season.id
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
        membership.decided_at = datetime.now(UTC)
        membership.decided_by_profile_id = current_profile.id
        membership.admin_note = payload.admin_note.strip() if payload.admin_note else "Removido por admin"
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
        season_ids: set[str] = set()
        for link, matchday in matchday_rows:
            season_ids.add(matchday.season_id)
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
            "memberships_by_vip": memberships_by_vip,
            "profile_names": profile_names,
            "season_names": season_names,
        }

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

        rows = list(
            db.scalars(
                select(StandingsMatchday).where(
                    StandingsMatchday.matchday_id.in_([matchday.id for matchday in matchdays]),
                    StandingsMatchday.profile_id.in_(approved_profile_ids),
                )
            )
        )

        totals: dict[str, dict[str, int]] = {
            profile_id: {"total_points": 0, "correct_results": 0, "exact_scores": 0}
            for profile_id in approved_profile_ids
        }
        for row in rows:
            bucket = totals.setdefault(
                row.profile_id,
                {"total_points": 0, "correct_results": 0, "exact_scores": 0},
            )
            bucket["total_points"] += row.total_points
            bucket["correct_results"] += row.correct_results
            bucket["exact_scores"] += row.exact_scores

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

    @staticmethod
    def _approved_members_count(memberships: list[VipMembership]) -> int:
        return sum(1 for membership in memberships if membership.status == VipMembershipStatus.APPROVED)

    def _gross_pool_amount(self, vip: VipCompetition, memberships: list[VipMembership]) -> Decimal:
        return Decimal(self._approved_members_count(memberships)) * vip.entry_fee_amount

    def _admin_commission_amount(self, vip: VipCompetition, memberships: list[VipMembership]) -> Decimal:
        return self._gross_pool_amount(vip, memberships) * (vip.admin_commission_pct / Decimal("100"))

    def _distributable_prize_pool_amount(self, vip: VipCompetition, memberships: list[VipMembership]) -> Decimal:
        return self._gross_pool_amount(vip, memberships) - self._admin_commission_amount(vip, memberships)

    def _first_place_amount(self, vip: VipCompetition, memberships: list[VipMembership]) -> Decimal:
        return self._distributable_prize_pool_amount(vip, memberships) * (vip.first_place_pct / Decimal("100"))

    def _second_place_amount(self, vip: VipCompetition, memberships: list[VipMembership]) -> Decimal:
        return self._distributable_prize_pool_amount(vip, memberships) * (vip.second_place_pct / Decimal("100"))

    def _third_place_amount(self, vip: VipCompetition, memberships: list[VipMembership]) -> Decimal:
        return self._distributable_prize_pool_amount(vip, memberships) * (vip.third_place_pct / Decimal("100"))

    def _remaining_pool_amount(self, vip: VipCompetition, memberships: list[VipMembership]) -> Decimal:
        return (
            self._distributable_prize_pool_amount(vip, memberships)
            - self._first_place_amount(vip, memberships)
            - self._second_place_amount(vip, memberships)
            - self._third_place_amount(vip, memberships)
        )
