from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from decimal import Decimal, ROUND_HALF_UP

from fastapi import HTTPException, status
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.models.entities import (
    Matchday,
    PaymentScopeType,
    Profile,
    RoleCode,
    Season,
    SeasonMembership,
    SettlementAssignment,
    SettlementConfig,
    SettlementStatus,
    VipCompetition,
    VipMembership,
)
from app.schemas.payments import (
    MySettlementsResponse,
    SettlementAssignmentOut,
    SettlementConfigOut,
    SettlementConfigUpdateRequest,
    SettlementGenerateRequest,
    SettlementGeneratedScopeOut,
    SettlementManualAssignmentRequest,
    SettlementParticipantOut,
    SettlementProofSubmitRequest,
    SettlementRejectRequest,
    SettlementScopeSummaryOut,
)
from app.services.onesignal_service import OneSignalPushService
from app.services.leaderboard_service import LeaderboardService
from app.services.scoring_service import ScoringService
from app.services.vip_service import VipService

settings = get_settings()
DEFAULT_MAX_PAYMENT_AMOUNT = Decimal("5000.00")
DEFAULT_CONFIRMATION_WINDOW_HOURS = 24
PAYMENT_REMINDER_INTERVAL_HOURS = 12
MONEY_QUANTIZER = Decimal("0.01")


@dataclass
class ParticipantSnapshot:
    profile_id: str
    display_name: str
    rank_position: int | None
    total_points: int
    prize_amount: Decimal
    weekly_prize_amount: Decimal
    final_prize_amount: Decimal
    admin_commission_amount: Decimal
    pending_entry_amount: Decimal
    net_amount: Decimal
    contact_phone: str | None
    bank_name: str | None
    deposit_account: str | None
    modality: str | None
    aval_display_name: str | None


@dataclass
class SettlementNotificationDispatchResult:
    dedupe_key: str
    profile_id: str
    title: str
    status: str
    provider_message_id: str | None = None


class SettlementService:
    def __init__(self) -> None:
        self.leaderboard_service = LeaderboardService()
        self.vip_service = VipService()
        self.push_service = OneSignalPushService()

    def get_scope_summary(
        self,
        db: Session,
        scope_type: str,
        scope_id: str,
    ) -> SettlementScopeSummaryOut:
        self._auto_confirm_due_assignments(db)
        scope_type_enum = self._supported_scope_type(scope_type)
        if scope_type_enum in {PaymentScopeType.SEASON, PaymentScopeType.VIP}:
            self._sync_vip_lifecycle_status(db, scope_id)
        scope_label, participants = self._build_participants(db, scope_type_enum, scope_id)
        assignments = self._list_scope_assignments(db, scope_type_enum, scope_id)
        selected_payer_profile_ids = sorted({row.payer_profile_id for row in assignments})
        config_row = self._get_or_create_config(db, scope_type_enum, scope_id, create=False)
        return self._build_scope_summary_out(
            db,
            scope_type_enum,
            scope_id,
            scope_label,
            participants,
            assignments,
            selected_payer_profile_ids=selected_payer_profile_ids,
            config_row=config_row,
        )

    def list_generated_scopes(self, db: Session) -> list[SettlementGeneratedScopeOut]:
        self._auto_confirm_due_assignments(db)
        rows = list(
            db.scalars(
                select(SettlementAssignment)
                .where(SettlementAssignment.scope_type.in_([PaymentScopeType.SEASON, PaymentScopeType.VIP]))
                .order_by(SettlementAssignment.updated_at.desc())
            )
        )
        if not rows:
            return []
        labels = self._scope_labels_for_rows(db, rows)
        grouped: dict[tuple[PaymentScopeType, str], list[SettlementAssignment]] = {}
        for row in rows:
            grouped.setdefault((row.scope_type, row.scope_id), []).append(row)

        output = [
            SettlementGeneratedScopeOut(
                scope_type=scope_type.value,
                scope_id=scope_id,
                scope_label=labels.get((scope_type.value, scope_id), "Competencia"),
                assignments_count=len(assignments),
                pending_count=sum(row.status == SettlementStatus.PENDING_PROOF for row in assignments),
                proof_submitted_count=sum(row.status == SettlementStatus.PROOF_SUBMITTED for row in assignments),
                confirmed_count=sum(row.status == SettlementStatus.CONFIRMED for row in assignments),
                rejected_count=sum(row.status == SettlementStatus.REJECTED for row in assignments),
                total_assigned_amount=float(sum((row.amount for row in assignments), Decimal("0.00"))),
                updated_at=max(row.updated_at for row in assignments),
            )
            for (scope_type, scope_id), assignments in grouped.items()
        ]
        output.sort(key=lambda row: row.updated_at, reverse=True)
        return output

    def update_config(
        self,
        db: Session,
        payload: SettlementConfigUpdateRequest,
        current_profile: Profile,
    ) -> SettlementConfigOut:
        scope_type_enum = self._supported_scope_type(payload.scope_type)
        self._ensure_scope_exists(db, scope_type_enum, payload.scope_id)
        row = self._get_or_create_config(db, scope_type_enum, payload.scope_id, create=True, current_profile=current_profile)
        row.max_payment_amount = self._to_money(payload.max_payment_amount)
        row.confirmation_window_hours = payload.confirmation_window_hours
        if scope_type_enum == PaymentScopeType.VIP:
            seen_profile_ids: set[str] = set()
            allocations: list[dict[str, str | float]] = []
            for allocation in payload.commission_allocations:
                recipient = db.get(Profile, allocation.profile_id)
                if (
                    recipient is None
                    or recipient.role_code not in {RoleCode.ADMIN, RoleCode.MASTER_ADMIN}
                    or allocation.profile_id in seen_profile_ids
                ):
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail="Cada comisión debe tener un administrador válido y no repetido.",
                    )
                seen_profile_ids.add(allocation.profile_id)
                allocations.append({"profile_id": allocation.profile_id, "amount": float(self._to_money(allocation.amount))})
            expected_commission = self._expected_commission_amount(db, scope_type_enum, payload.scope_id)
            allocated_commission = self._to_money(sum((Decimal(str(item["amount"])) for item in allocations), Decimal("0")))
            if allocated_commission != expected_commission:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=(
                        f"Los montos de comisión deben sumar {self._format_money(expected_commission)}; "
                        f"actualmente suman {self._format_money(allocated_commission)}."
                    ),
                )
            row.commission_allocations = allocations
            row.commission_recipient_profile_id = allocations[0]["profile_id"] if len(allocations) == 1 else None
        db.add(row)
        db.commit()
        db.refresh(row)
        return self._config_out(row)

    def generate_assignments(
        self,
        db: Session,
        payload: SettlementGenerateRequest,
        current_profile: Profile,
    ) -> SettlementScopeSummaryOut:
        self._auto_confirm_due_assignments(db)
        scope_type_enum = self._supported_scope_type(payload.scope_type)
        selected_payer_profile_ids = list(dict.fromkeys(payload.payer_profile_ids))
        scope_label, participants = self._build_participants(db, scope_type_enum, payload.scope_id)
        if scope_type_enum == PaymentScopeType.SEASON:
            season = self._ensure_scope_exists(db, scope_type_enum, payload.scope_id)
            assert isinstance(season, Season)
            config_row = self._get_or_create_config(db, scope_type_enum, payload.scope_id, create=False)
            expected_commission = self._expected_commission_amount(db, scope_type_enum, payload.scope_id)
            allocated_commission = self._to_money(sum(
                (Decimal(str(item.get("amount", 0))) for item in ((config_row.commission_allocations if config_row else []) or [])),
                Decimal("0"),
            ))
            if allocated_commission != expected_commission:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=(
                        f"Distribuye la comisión administrativa completa antes de generar: "
                        f"{self._format_money(allocated_commission)} de {self._format_money(expected_commission)}."
                    ),
                )
        participant_by_id = {participant.profile_id: participant for participant in participants}
        invalid_payers = [
            profile_id
            for profile_id in selected_payer_profile_ids
            if profile_id not in participant_by_id or participant_by_id[profile_id].net_amount >= Decimal("0")
        ]
        if invalid_payers:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Solo puedes seleccionar jugadores con saldo pendiente por pagar.",
            )

        existing_assignments = self._list_scope_assignments(db, scope_type_enum, payload.scope_id)
        if any(
            row.status in {SettlementStatus.PROOF_SUBMITTED, SettlementStatus.CONFIRMED}
            for row in existing_assignments
        ):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Ya hay pagos enviados o confirmados en este split. No se puede regenerar.",
            )

        config_row = self._get_or_create_config(
            db,
            scope_type_enum,
            payload.scope_id,
            create=True,
            current_profile=current_profile,
        )
        max_payment_amount = config_row.max_payment_amount or DEFAULT_MAX_PAYMENT_AMOUNT
        if max_payment_amount <= 0:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Configura un monto maximo por pago mayor a cero antes de generar el split.",
            )

        db.execute(
            delete(SettlementAssignment).where(
                SettlementAssignment.scope_type == scope_type_enum,
                SettlementAssignment.scope_id == payload.scope_id,
            )
        )

        selected_payers = [participant_by_id[profile_id] for profile_id in selected_payer_profile_ids]
        receivers = [participant for participant in participants if participant.net_amount > 0]
        assignments_to_create: list[SettlementAssignment] = []

        payer_remaining = {
            participant.profile_id: self._to_money(abs(participant.net_amount))
            for participant in selected_payers
        }
        payee_remaining = {
            participant.profile_id: self._to_money(participant.net_amount)
            for participant in receivers
        }

        for receiver in receivers:
            remaining_receiver_amount = payee_remaining[receiver.profile_id]
            if remaining_receiver_amount <= 0:
                continue
            for payer in selected_payers:
                remaining_payer_amount = payer_remaining[payer.profile_id]
                if remaining_payer_amount <= 0 or remaining_receiver_amount <= 0:
                    continue
                chunk_total = min(remaining_payer_amount, remaining_receiver_amount)
                while chunk_total > 0:
                    chunk_amount = min(chunk_total, max_payment_amount)
                    assignments_to_create.append(
                        SettlementAssignment(
                            scope_type=scope_type_enum,
                            scope_id=payload.scope_id,
                            payer_profile_id=payer.profile_id,
                            payee_profile_id=receiver.profile_id,
                            amount=self._to_money(chunk_amount),
                            currency="mxn",
                            status=SettlementStatus.PENDING_PROOF,
                            created_by_profile_id=current_profile.id,
                        )
                    )
                    remaining_payer_amount = self._to_money(remaining_payer_amount - chunk_amount)
                    remaining_receiver_amount = self._to_money(remaining_receiver_amount - chunk_amount)
                    chunk_total = self._to_money(chunk_total - chunk_amount)
                payer_remaining[payer.profile_id] = remaining_payer_amount
                payee_remaining[receiver.profile_id] = remaining_receiver_amount

        for row in assignments_to_create:
            db.add(row)
        db.commit()

        assignments = self._list_scope_assignments(db, scope_type_enum, payload.scope_id)
        try:
            self.send_generation_notifications(db, assignments, scope_label=scope_label)
        except Exception:
            db.rollback()
        return self._build_scope_summary_out(
            db,
            scope_type_enum,
            payload.scope_id,
            scope_label,
            participants,
            assignments,
            selected_payer_profile_ids=selected_payer_profile_ids,
            config_row=config_row,
        )

    def clear_assignments(
        self,
        db: Session,
        scope_type: str,
        scope_id: str,
    ) -> SettlementScopeSummaryOut:
        scope_type_enum = self._supported_scope_type(scope_type)
        scope_label, participants = self._build_participants(db, scope_type_enum, scope_id)
        assignments = self._list_scope_assignments(db, scope_type_enum, scope_id)
        if any(row.status in {SettlementStatus.PROOF_SUBMITTED, SettlementStatus.CONFIRMED} for row in assignments):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="No se pueden borrar asignaciones con ficha enviada o ya confirmadas.",
            )
        db.execute(
            delete(SettlementAssignment).where(
                SettlementAssignment.scope_type == scope_type_enum,
                SettlementAssignment.scope_id == scope_id,
            )
        )
        db.commit()
        config_row = self._get_or_create_config(db, scope_type_enum, scope_id, create=False)
        return self._build_scope_summary_out(
            db,
            scope_type_enum,
            scope_id,
            scope_label,
            participants,
            [],
            selected_payer_profile_ids=[],
            config_row=config_row,
        )

    def create_manual_assignment(
        self,
        db: Session,
        payload: SettlementManualAssignmentRequest,
        current_profile: Profile,
    ) -> SettlementScopeSummaryOut:
        scope_type_enum = self._supported_scope_type(payload.scope_type)
        scope_label, participants = self._build_participants(db, scope_type_enum, payload.scope_id)
        if payload.payer_profile_id == payload.payee_profile_id:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Quien paga y quien recibe deben ser distintos.")
        participant_ids = {row.profile_id for row in participants}
        if payload.payer_profile_id not in participant_ids or payload.payee_profile_id not in participant_ids:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Selecciona participantes o administradores que pertenezcan a este settlement.",
            )
        row = SettlementAssignment(
            scope_type=scope_type_enum,
            scope_id=payload.scope_id,
            payer_profile_id=payload.payer_profile_id,
            payee_profile_id=payload.payee_profile_id,
            amount=self._to_money(payload.amount),
            currency="mxn",
            status=SettlementStatus.PENDING_PROOF,
            created_by_profile_id=current_profile.id,
        )
        db.add(row)
        db.commit()
        assignments = self._list_scope_assignments(db, scope_type_enum, payload.scope_id)
        selected_payer_profile_ids = sorted({assignment.payer_profile_id for assignment in assignments})
        config_row = self._get_or_create_config(db, scope_type_enum, payload.scope_id, create=False)
        return self._build_scope_summary_out(
            db,
            scope_type_enum,
            payload.scope_id,
            scope_label,
            participants,
            assignments,
            selected_payer_profile_ids=selected_payer_profile_ids,
            config_row=config_row,
        )

    def list_my_settlements(self, db: Session, profile: Profile) -> MySettlementsResponse:
        self._auto_confirm_due_assignments(db)
        outgoing = list(
            db.scalars(
                select(SettlementAssignment)
                .where(SettlementAssignment.payer_profile_id == profile.id)
                .order_by(SettlementAssignment.created_at.desc(), SettlementAssignment.updated_at.desc())
            )
        )
        incoming = list(
            db.scalars(
                select(SettlementAssignment)
                .where(SettlementAssignment.payee_profile_id == profile.id)
                .order_by(SettlementAssignment.created_at.desc(), SettlementAssignment.updated_at.desc())
            )
        )
        return MySettlementsResponse(
            outgoing=self._assignment_outs(db, outgoing),
            incoming=self._assignment_outs(db, incoming),
        )

    def send_generation_notifications(
        self,
        db: Session,
        assignments: list[SettlementAssignment],
        *,
        scope_label: str | None = None,
    ) -> list[SettlementNotificationDispatchResult]:
        return self._send_assignment_notifications(
            db,
            assignments,
            notification_kind="generated",
            scope_label=scope_label,
        )

    def send_due_payment_push_reminders(
        self,
        db: Session,
        *,
        now_utc: datetime | None = None,
    ) -> list[SettlementNotificationDispatchResult]:
        self._auto_confirm_due_assignments(db)
        if not self.push_service.is_configured():
            return []

        now = self._ensure_utc(now_utc or datetime.now(UTC))
        cutoff = now - timedelta(hours=PAYMENT_REMINDER_INTERVAL_HOURS)
        rows = list(
            db.scalars(
                select(SettlementAssignment).where(
                    SettlementAssignment.status.in_([SettlementStatus.PENDING_PROOF, SettlementStatus.REJECTED]),
                    (
                        SettlementAssignment.last_payer_notification_sent_at.is_(None)
                        | (SettlementAssignment.last_payer_notification_sent_at <= cutoff)
                    ),
                )
            )
        )
        if not rows:
            return []
        return self._send_assignment_notifications(
            db,
            rows,
            notification_kind="reminder",
            now=now,
        )

    def submit_proof(
        self,
        db: Session,
        settlement_id: str,
        profile: Profile,
        payload: SettlementProofSubmitRequest,
    ) -> SettlementAssignmentOut:
        self._auto_confirm_due_assignments(db)
        row = self._load_assignment_or_404(db, settlement_id)
        if row.payer_profile_id != profile.id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Solo quien paga puede subir la ficha.")
        if row.status == SettlementStatus.CONFIRMED:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Este pago ya fue confirmado.")

        config_row = self._get_or_create_config(db, row.scope_type, row.scope_id, create=False)
        confirmation_window_hours = (
            config_row.confirmation_window_hours
            if config_row is not None
            else DEFAULT_CONFIRMATION_WINDOW_HOURS
        )
        now = datetime.now(UTC)
        row.status = SettlementStatus.PROOF_SUBMITTED
        row.proof_image_url = payload.proof_image_url
        row.proof_note = payload.proof_note
        row.proof_uploaded_at = now
        row.auto_confirm_at = now + timedelta(hours=confirmation_window_hours)
        row.confirmed_automatically = False
        row.confirmed_by_profile_id = None
        row.confirmed_at = None
        row.rejected_by_profile_id = None
        row.rejected_at = None
        row.rejection_reason = None
        db.add(row)
        db.commit()
        db.refresh(row)
        if row.scope_type == PaymentScopeType.VIP:
            self._sync_vip_lifecycle_status(db, row.scope_id)
        return self._assignment_outs(db, [row])[0]

    def confirm_assignment(
        self,
        db: Session,
        settlement_id: str,
        profile: Profile,
    ) -> SettlementAssignmentOut:
        self._auto_confirm_due_assignments(db)
        row = self._load_assignment_or_404(db, settlement_id)
        if row.payee_profile_id != profile.id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Solo quien recibe el pago puede confirmarlo.",
            )
        if row.status != SettlementStatus.PROOF_SUBMITTED:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Todavia no hay una ficha pendiente por confirmar en este pago.",
            )
        self._mark_confirmed(row, confirmed_by_profile_id=profile.id, automatic=False)
        db.add(row)
        db.commit()
        db.refresh(row)
        if row.scope_type == PaymentScopeType.VIP:
            self._sync_vip_lifecycle_status(db, row.scope_id)
        return self._assignment_outs(db, [row])[0]

    def reject_assignment(
        self,
        db: Session,
        settlement_id: str,
        profile: Profile,
        payload: SettlementRejectRequest,
    ) -> SettlementAssignmentOut:
        self._auto_confirm_due_assignments(db)
        row = self._load_assignment_or_404(db, settlement_id)
        if row.payee_profile_id != profile.id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Solo quien recibe el pago puede rechazarlo.",
            )
        if row.status != SettlementStatus.PROOF_SUBMITTED:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="No hay una ficha pendiente por rechazar en este pago.",
            )
        row.status = SettlementStatus.REJECTED
        row.rejected_by_profile_id = profile.id
        row.rejected_at = datetime.now(UTC)
        row.rejection_reason = payload.rejection_reason
        row.auto_confirm_at = None
        row.confirmed_automatically = False
        row.confirmed_by_profile_id = None
        row.confirmed_at = None
        db.add(row)
        db.commit()
        db.refresh(row)
        return self._assignment_outs(db, [row])[0]

    def _build_scope_summary_out(
        self,
        db: Session,
        scope_type: PaymentScopeType,
        scope_id: str,
        scope_label: str,
        participants: list[ParticipantSnapshot],
        assignments: list[SettlementAssignment],
        *,
        selected_payer_profile_ids: list[str],
        config_row: SettlementConfig | None,
    ) -> SettlementScopeSummaryOut:
        selected_set = set(selected_payer_profile_ids)
        participant_outs = [
            SettlementParticipantOut(
                profile_id=participant.profile_id,
                display_name=participant.display_name,
                rank_position=participant.rank_position,
                total_points=participant.total_points,
                prize_amount=float(participant.prize_amount),
                weekly_prize_amount=float(participant.weekly_prize_amount),
                final_prize_amount=float(participant.final_prize_amount),
                admin_commission_amount=float(participant.admin_commission_amount),
                pending_entry_amount=float(participant.pending_entry_amount),
                net_amount=float(participant.net_amount),
                is_payer_candidate=participant.net_amount < 0,
                is_selected_payer=participant.profile_id in selected_set,
                contact_phone=participant.contact_phone,
                bank_name=participant.bank_name,
                deposit_account=participant.deposit_account,
                modality=participant.modality,
                aval_display_name=participant.aval_display_name,
            )
            for participant in participants
        ]
        total_receivable_amount = sum(
            (participant.net_amount for participant in participants if participant.net_amount > 0),
            start=Decimal("0.00"),
        )
        total_selected_payable_amount = sum(
            (abs(participant.net_amount) for participant in participants if participant.profile_id in selected_set and participant.net_amount < 0),
            start=Decimal("0.00"),
        )
        total_assigned_amount = sum((row.amount for row in assignments), start=Decimal("0.00"))
        uncovered_receiver_amount = self._to_money(total_receivable_amount - total_assigned_amount)
        if uncovered_receiver_amount < 0:
            uncovered_receiver_amount = Decimal("0.00")
        unallocated_payer_amount = self._to_money(total_selected_payable_amount - total_assigned_amount)
        if unallocated_payer_amount < 0:
            unallocated_payer_amount = Decimal("0.00")

        return SettlementScopeSummaryOut(
            scope_type=scope_type.value,
            scope_id=scope_id,
            scope_label=scope_label,
            config=self._config_out(config_row, scope_type=scope_type, scope_id=scope_id),
            participants=participant_outs,
            assignments=self._assignment_outs(db, assignments, scope_label_map={(scope_type.value, scope_id): scope_label}),
            selected_payer_profile_ids=selected_payer_profile_ids,
            total_receivable_amount=float(total_receivable_amount),
            total_selected_payable_amount=float(total_selected_payable_amount),
            total_assigned_amount=float(total_assigned_amount),
            expected_admin_commission_amount=float(self._expected_commission_amount(db, scope_type, scope_id)),
            uncovered_receiver_amount=float(uncovered_receiver_amount),
            unallocated_payer_amount=float(unallocated_payer_amount),
        )

    def _build_participants(
        self,
        db: Session,
        scope_type: PaymentScopeType,
        scope_id: str,
    ) -> tuple[str, list[ParticipantSnapshot]]:
        if scope_type == PaymentScopeType.SEASON:
            season = self._ensure_scope_exists(db, scope_type, scope_id)
            assert isinstance(season, Season)
            return season.name, self._build_season_participants(db, season)

        vip = self._ensure_scope_exists(db, scope_type, scope_id)
        assert isinstance(vip, VipCompetition)
        return vip.name, self._build_vip_participants(db, vip)

    def _build_season_participants(self, db: Session, season: Season) -> list[ParticipantSnapshot]:
        leaderboard = self.leaderboard_service.list_overall(db, season.id)
        if not leaderboard:
            return []

        profile_ids = [entry.profile_id for entry in leaderboard]
        profile_map, aval_name_map = self._profile_maps(db, profile_ids)
        memberships = {
            row.profile_id: row
            for row in db.scalars(
                select(SeasonMembership).where(
                    SeasonMembership.season_id == season.id,
                    SeasonMembership.profile_id.in_(profile_ids),
                )
            )
        }
        settings = self._season_prize_settings(db, season)
        prize_shares = ScoringService.calculate_prize_shares(
            [(entry.profile_id, entry.rank_position) for entry in leaderboard],
            settings["first_place_amount"],
            settings["second_place_amount"],
            settings["third_place_amount"],
        )
        weekly_prize_by_profile: dict[str, Decimal] = {}
        for matchday in self.leaderboard_service.list_weekly_prizes(db, season.id):
            for winner in matchday.winners:
                weekly_prize_by_profile[winner.profile_id] = self._to_money(
                    weekly_prize_by_profile.get(winner.profile_id, Decimal("0.00"))
                    + Decimal(str(winner.prize_amount))
                )

        participants: list[ParticipantSnapshot] = []
        for entry in leaderboard:
            profile = profile_map.get(entry.profile_id)
            membership = memberships.get(entry.profile_id)
            pending_entry_amount = Decimal("0.00") if membership and membership.is_paid else settings["entry_fee_amount"]
            final_prize_amount = self._to_money(prize_shares.get(entry.profile_id, Decimal("0.00")))
            weekly_prize_amount = weekly_prize_by_profile.get(entry.profile_id, Decimal("0.00"))
            prize_amount = self._to_money(final_prize_amount + weekly_prize_amount)
            participants.append(
                ParticipantSnapshot(
                    profile_id=entry.profile_id,
                    display_name=entry.display_name,
                    rank_position=entry.rank_position,
                    total_points=entry.total_points,
                    prize_amount=prize_amount,
                    weekly_prize_amount=weekly_prize_amount,
                    final_prize_amount=final_prize_amount,
                    admin_commission_amount=Decimal("0.00"),
                    pending_entry_amount=self._to_money(pending_entry_amount),
                    net_amount=self._to_money(prize_amount - pending_entry_amount),
                    contact_phone=profile.contact_phone if profile is not None else None,
                    bank_name=profile.bank_name if profile is not None else None,
                    deposit_account=profile.deposit_account if profile is not None else None,
                    modality=profile.modality if profile is not None else None,
                    aval_display_name=aval_name_map.get(profile.aval_profile_id) if profile is not None and profile.aval_profile_id else None,
                )
            )
        config_row = self._get_or_create_config(db, PaymentScopeType.SEASON, season.id, create=False)
        allocations = config_row.commission_allocations if config_row is not None else []
        if not allocations:
            allocations = season.commission_allocations or []
        if not allocations and season.commission_recipient_profile_id:
            allocations = [{"profile_id": season.commission_recipient_profile_id, "amount": float(settings["admin_commission_amount"])}]
        self._apply_commission_allocations(db, participants, allocations)
        return participants

    def _build_vip_participants(self, db: Session, vip: VipCompetition) -> list[ParticipantSnapshot]:
        vip_row = next(
            iter(self.vip_service.list_admin_vips(db, include_leaderboard=True, vip_id=vip.id)),
            None,
        )
        if vip_row is None or not vip_row.leaderboard:
            return []

        profile_ids = [entry.profile_id for entry in vip_row.leaderboard]
        profile_map, aval_name_map = self._profile_maps(db, profile_ids)
        memberships = {membership.profile_id: membership for membership in vip_row.memberships}
        prize_shares = ScoringService.calculate_prize_shares(
            [(entry.profile_id, entry.rank_position) for entry in vip_row.leaderboard],
            vip_row.first_place_amount,
            vip_row.second_place_amount,
            vip_row.third_place_amount,
        )

        participants: list[ParticipantSnapshot] = []
        for entry in vip_row.leaderboard:
            profile = profile_map.get(entry.profile_id)
            membership = memberships.get(entry.profile_id)
            pending_entry_amount = Decimal("0.00") if membership and membership.is_paid else self._to_money(vip.entry_fee_amount)
            prize_amount = self._to_money(prize_shares.get(entry.profile_id, Decimal("0.00")))
            participants.append(
                ParticipantSnapshot(
                    profile_id=entry.profile_id,
                    display_name=entry.display_name,
                    rank_position=entry.rank_position,
                    total_points=entry.total_points,
                    prize_amount=prize_amount,
                    weekly_prize_amount=Decimal("0.00"),
                    final_prize_amount=prize_amount,
                    admin_commission_amount=Decimal("0.00"),
                    pending_entry_amount=self._to_money(pending_entry_amount),
                    net_amount=self._to_money(prize_amount - pending_entry_amount),
                    contact_phone=profile.contact_phone if profile is not None else None,
                    bank_name=profile.bank_name if profile is not None else None,
                    deposit_account=profile.deposit_account if profile is not None else None,
                    modality=profile.modality if profile is not None else None,
                    aval_display_name=aval_name_map.get(profile.aval_profile_id) if profile is not None and profile.aval_profile_id else None,
                )
            )

        config_row = self._get_or_create_config(db, PaymentScopeType.VIP, vip.id, create=False)
        allocations = config_row.commission_allocations if config_row is not None else []
        if not allocations and config_row is not None and config_row.commission_recipient_profile_id:
            allocations = [{"profile_id": config_row.commission_recipient_profile_id, "amount": float(vip_row.admin_commission_amount)}]
        self._apply_commission_allocations(db, participants, allocations)
        return participants

    def _apply_commission_allocations(
        self,
        db: Session,
        participants: list[ParticipantSnapshot],
        allocations: list[dict],
    ) -> None:
        for allocation in allocations:
            profile_id = str(allocation.get("profile_id") or "")
            amount = self._to_money(allocation.get("amount") or 0)
            if not profile_id or amount <= 0:
                continue
            existing = next((row for row in participants if row.profile_id == profile_id), None)
            if existing is not None:
                existing.prize_amount = self._to_money(existing.prize_amount + amount)
                existing.admin_commission_amount = self._to_money(existing.admin_commission_amount + amount)
                existing.net_amount = self._to_money(existing.net_amount + amount)
                continue
            profile = db.get(Profile, profile_id)
            if profile is None:
                continue
            participants.append(
                ParticipantSnapshot(
                    profile_id=profile.id,
                    display_name=f"{profile.display_name} · Comision admin",
                    rank_position=None,
                    total_points=0,
                    prize_amount=amount,
                    weekly_prize_amount=Decimal("0.00"),
                    final_prize_amount=Decimal("0.00"),
                    admin_commission_amount=amount,
                    pending_entry_amount=Decimal("0.00"),
                    net_amount=amount,
                    contact_phone=profile.contact_phone,
                    bank_name=profile.bank_name,
                    deposit_account=profile.deposit_account,
                    modality=profile.modality,
                    aval_display_name=None,
                )
            )

    def _season_prize_settings(self, db: Session, season: Season) -> dict[str, Decimal]:
        matchdays = list(
            db.scalars(
                select(Matchday)
                .where(Matchday.season_id == season.id)
                .order_by(Matchday.number.asc())
            )
        )
        start_number = next((row.number for row in matchdays if row.id == season.start_matchday_id), None)
        end_number = next((row.number for row in matchdays if row.id == season.end_matchday_id), None)
        tournament_matchdays = [
            row
            for row in matchdays
            if (start_number is None or row.number >= start_number)
            and (end_number is None or row.number <= end_number)
        ]
        confirmed_participants = sum(
            1
            for row in db.scalars(select(SeasonMembership).where(SeasonMembership.season_id == season.id))
            if row.is_active
        )
        entry_fee_amount = self._to_money(season.entry_fee_amount)
        weekly_total_prize_amount = self._to_money(
            season.weekly_first_place_amount + season.weekly_second_place_amount + season.weekly_third_place_amount
        )
        gross_pool_amount = self._to_money(Decimal(confirmed_participants) * entry_fee_amount)
        admin_commission_amount = self._to_money(gross_pool_amount * (Decimal(season.admin_commission_pct) / Decimal("100")))
        income_after_commission_amount = self._to_money(gross_pool_amount - admin_commission_amount)
        total_weekly_prizes_amount = self._to_money(weekly_total_prize_amount * Decimal(len(tournament_matchdays)))
        reserve_amount = self._to_money(gross_pool_amount * (Decimal(season.reserve_pct) / Decimal("100")))
        distributable_prize_pool_amount = self._to_money(
            income_after_commission_amount - total_weekly_prizes_amount - reserve_amount
        )
        return {
            "entry_fee_amount": entry_fee_amount,
            "admin_commission_amount": admin_commission_amount,
            "first_place_amount": self._to_money(
                distributable_prize_pool_amount * (Decimal(season.first_place_pct) / Decimal("100"))
            ),
            "second_place_amount": self._to_money(
                distributable_prize_pool_amount * (Decimal(season.second_place_pct) / Decimal("100"))
            ),
            "third_place_amount": self._to_money(
                distributable_prize_pool_amount * (Decimal(season.third_place_pct) / Decimal("100"))
            ),
        }

    def _expected_commission_amount(
        self,
        db: Session,
        scope_type: PaymentScopeType,
        scope_id: str,
    ) -> Decimal:
        scope = self._ensure_scope_exists(db, scope_type, scope_id)
        if scope_type == PaymentScopeType.SEASON:
            assert isinstance(scope, Season)
            return self._season_prize_settings(db, scope)["admin_commission_amount"]
        assert isinstance(scope, VipCompetition)
        vip_row = next(iter(self.vip_service.list_admin_vips(db, include_leaderboard=False, vip_id=scope.id)), None)
        return self._to_money(vip_row.admin_commission_amount if vip_row is not None else 0)

    def _assignment_outs(
        self,
        db: Session,
        rows: list[SettlementAssignment],
        *,
        scope_label_map: dict[tuple[str, str], str] | None = None,
    ) -> list[SettlementAssignmentOut]:
        if not rows:
            return []

        profile_ids = {
            row.payer_profile_id
            for row in rows
        } | {
            row.payee_profile_id
            for row in rows
        } | {
            row.confirmed_by_profile_id
            for row in rows
            if row.confirmed_by_profile_id
        } | {
            row.rejected_by_profile_id
            for row in rows
            if row.rejected_by_profile_id
        }
        profiles = {
            row.id: row
            for row in db.scalars(select(Profile).where(Profile.id.in_(profile_ids)))
        }
        if scope_label_map is None:
            scope_label_map = self._scope_labels_for_rows(db, rows)

        outputs: list[SettlementAssignmentOut] = []
        for row in rows:
            payer = profiles.get(row.payer_profile_id)
            payee = profiles.get(row.payee_profile_id)
            confirmed_by = profiles.get(row.confirmed_by_profile_id) if row.confirmed_by_profile_id else None
            rejected_by = profiles.get(row.rejected_by_profile_id) if row.rejected_by_profile_id else None
            outputs.append(
                SettlementAssignmentOut(
                    id=row.id,
                    scope_type=row.scope_type.value,
                    scope_id=row.scope_id,
                    scope_label=scope_label_map.get((row.scope_type.value, row.scope_id)),
                    payer_profile_id=row.payer_profile_id,
                    payer_display_name=payer.display_name if payer is not None else "Jugador",
                    payer_contact_phone=payer.contact_phone if payer is not None else None,
                    payee_profile_id=row.payee_profile_id,
                    payee_display_name=payee.display_name if payee is not None else "Jugador",
                    payee_contact_phone=payee.contact_phone if payee is not None else None,
                    payee_bank_name=payee.bank_name if payee is not None else None,
                    payee_deposit_account=payee.deposit_account if payee is not None else None,
                    amount=float(row.amount),
                    currency=row.currency,
                    status=row.status.value,
                    proof_image_url=row.proof_image_url,
                    proof_note=row.proof_note,
                    proof_uploaded_at=row.proof_uploaded_at,
                    auto_confirm_at=row.auto_confirm_at,
                    confirmed_automatically=row.confirmed_automatically,
                    confirmed_by_profile_id=row.confirmed_by_profile_id,
                    confirmed_by_display_name=confirmed_by.display_name if confirmed_by is not None else None,
                    confirmed_at=row.confirmed_at,
                    rejected_by_profile_id=row.rejected_by_profile_id,
                    rejected_by_display_name=rejected_by.display_name if rejected_by is not None else None,
                    rejected_at=row.rejected_at,
                    rejection_reason=row.rejection_reason,
                    created_by_profile_id=row.created_by_profile_id,
                    created_at=row.created_at,
                    updated_at=row.updated_at,
                )
            )
        return outputs

    def _scope_labels_for_rows(
        self,
        db: Session,
        rows: list[SettlementAssignment],
    ) -> dict[tuple[str, str], str]:
        season_ids = {row.scope_id for row in rows if row.scope_type == PaymentScopeType.SEASON}
        vip_ids = {row.scope_id for row in rows if row.scope_type == PaymentScopeType.VIP}
        season_map = {
            row.id: row.name
            for row in db.scalars(select(Season).where(Season.id.in_(season_ids)))
        }
        vip_map = {
            row.id: row.name
            for row in db.scalars(select(VipCompetition).where(VipCompetition.id.in_(vip_ids)))
        }
        labels: dict[tuple[str, str], str] = {}
        labels.update({(PaymentScopeType.SEASON.value, scope_id): label for scope_id, label in season_map.items()})
        labels.update({(PaymentScopeType.VIP.value, scope_id): label for scope_id, label in vip_map.items()})
        return labels

    def _list_scope_assignments(
        self,
        db: Session,
        scope_type: PaymentScopeType,
        scope_id: str,
    ) -> list[SettlementAssignment]:
        return list(
            db.scalars(
                select(SettlementAssignment)
                .where(
                    SettlementAssignment.scope_type == scope_type,
                    SettlementAssignment.scope_id == scope_id,
                )
                .order_by(SettlementAssignment.created_at.asc(), SettlementAssignment.id.asc())
            )
        )

    def _profile_maps(
        self,
        db: Session,
        profile_ids: list[str],
    ) -> tuple[dict[str, Profile], dict[str, str]]:
        if not profile_ids:
            return {}, {}
        profiles = {
            row.id: row
            for row in db.scalars(select(Profile).where(Profile.id.in_(profile_ids)))
        }
        aval_ids = {row.aval_profile_id for row in profiles.values() if row.aval_profile_id}
        aval_name_map = {
            row.id: row.display_name
            for row in db.scalars(select(Profile).where(Profile.id.in_(aval_ids)))
        } if aval_ids else {}
        return profiles, aval_name_map

    def _load_assignment_or_404(self, db: Session, settlement_id: str) -> SettlementAssignment:
        row = db.get(SettlementAssignment, settlement_id)
        if row is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Pago entre jugadores no encontrado.")
        return row

    def _get_or_create_config(
        self,
        db: Session,
        scope_type: PaymentScopeType,
        scope_id: str,
        *,
        create: bool,
        current_profile: Profile | None = None,
    ) -> SettlementConfig | None:
        row = db.scalar(
            select(SettlementConfig).where(
                SettlementConfig.scope_type == scope_type,
                SettlementConfig.scope_id == scope_id,
            )
        )
        if row is not None or not create:
            return row

        row = SettlementConfig(
            scope_type=scope_type,
            scope_id=scope_id,
            max_payment_amount=DEFAULT_MAX_PAYMENT_AMOUNT,
            confirmation_window_hours=DEFAULT_CONFIRMATION_WINDOW_HOURS,
            created_by_profile_id=current_profile.id if current_profile is not None else None,
        )
        db.add(row)
        db.flush()
        return row

    def _send_assignment_notifications(
        self,
        db: Session,
        assignments: list[SettlementAssignment],
        *,
        notification_kind: str,
        scope_label: str | None = None,
        now: datetime | None = None,
    ) -> list[SettlementNotificationDispatchResult]:
        if not assignments or not self.push_service.is_configured():
            return []

        current_time = self._ensure_utc(now or datetime.now(UTC))
        scope_label_map = (
            {(assignments[0].scope_type.value, assignments[0].scope_id): scope_label}
            if scope_label is not None and assignments
            else self._scope_labels_for_rows(db, assignments)
        )
        profile_ids = {
            assignment.payer_profile_id
            for assignment in assignments
        } | {
            assignment.payee_profile_id
            for assignment in assignments
        }
        profiles = {
            row.id: row
            for row in db.scalars(select(Profile).where(Profile.id.in_(profile_ids)))
        }
        results: list[SettlementNotificationDispatchResult] = []

        payer_groups: dict[tuple[str, str, str], list[SettlementAssignment]] = {}
        payee_groups: dict[tuple[str, str, str], list[SettlementAssignment]] = {}
        for assignment in assignments:
            payer_groups.setdefault(
                (assignment.scope_type.value, assignment.scope_id, assignment.payer_profile_id),
                [],
            ).append(assignment)
            if notification_kind == "generated":
                payee_groups.setdefault(
                    (assignment.scope_type.value, assignment.scope_id, assignment.payee_profile_id),
                    [],
                ).append(assignment)

        for (scope_type, scope_id, payer_profile_id), grouped_assignments in payer_groups.items():
            payer = profiles.get(payer_profile_id)
            if payer is None or not payer.is_active or not payer.pick_reminder_email_enabled or not payer.auth_user_id:
                continue
            pending_total = sum((assignment.amount for assignment in grouped_assignments), start=Decimal("0.00"))
            rejected_count = sum(1 for assignment in grouped_assignments if assignment.status == SettlementStatus.REJECTED)
            current_scope_label = scope_label_map.get((scope_type, scope_id), "tu competencia")
            title = "Tienes pagos pendientes"
            if notification_kind == "generated":
                body = (
                    f"Ya quedó listo tu split de {current_scope_label}. "
                    f"Tienes {len(grouped_assignments)} pago(s) por {self._format_money(pending_total)}."
                )
            else:
                body = (
                    f"Sigues con {len(grouped_assignments)} pago(s) pendientes en {current_scope_label} "
                    f"por {self._format_money(pending_total)}."
                )
                if rejected_count > 0:
                    body += f" {rejected_count} fue(ron) rechazado(s) y requieren nueva ficha."
            dedupe_key = f"settlement:{notification_kind}:payer:{scope_type}:{scope_id}:{payer_profile_id}:{current_time.strftime('%Y%m%d%H')}"
            try:
                provider_message_id = self.push_service.send_to_external_id(
                    external_id=payer.auth_user_id,
                    title=title,
                    message=body,
                    url=self._payments_dashboard_url(),
                    dedupe_key=dedupe_key,
                )
            except Exception:
                results.append(
                    SettlementNotificationDispatchResult(
                        dedupe_key=dedupe_key,
                        profile_id=payer_profile_id,
                        title=title,
                        status="failed",
                    )
                )
                continue

            for assignment in grouped_assignments:
                if assignment.first_payer_notification_sent_at is None:
                    assignment.first_payer_notification_sent_at = current_time
                assignment.last_payer_notification_sent_at = current_time
                assignment.payer_notification_count = int(assignment.payer_notification_count or 0) + 1
                db.add(assignment)
            results.append(
                SettlementNotificationDispatchResult(
                    dedupe_key=dedupe_key,
                    profile_id=payer_profile_id,
                    title=title,
                    status="sent",
                    provider_message_id=provider_message_id,
                )
            )

        for (scope_type, scope_id, payee_profile_id), grouped_assignments in payee_groups.items():
            payee = profiles.get(payee_profile_id)
            if payee is None or not payee.is_active or not payee.pick_reminder_email_enabled or not payee.auth_user_id:
                continue
            incoming_total = sum((assignment.amount for assignment in grouped_assignments), start=Decimal("0.00"))
            current_scope_label = scope_label_map.get((scope_type, scope_id), "tu competencia")
            title = "Se asignaron pagos a tu favor"
            body = (
                f"En {current_scope_label} te asignaron {len(grouped_assignments)} pago(s) "
                f"por {self._format_money(incoming_total)}. Revisa tu panel de pagos."
            )
            dedupe_key = f"settlement:generated:payee:{scope_type}:{scope_id}:{payee_profile_id}:{current_time.strftime('%Y%m%d%H')}"
            try:
                provider_message_id = self.push_service.send_to_external_id(
                    external_id=payee.auth_user_id,
                    title=title,
                    message=body,
                    url=self._payments_dashboard_url(),
                    dedupe_key=dedupe_key,
                )
            except Exception:
                results.append(
                    SettlementNotificationDispatchResult(
                        dedupe_key=dedupe_key,
                        profile_id=payee_profile_id,
                        title=title,
                        status="failed",
                    )
                )
                continue

            for assignment in grouped_assignments:
                if assignment.first_payee_notification_sent_at is None:
                    assignment.first_payee_notification_sent_at = current_time
                assignment.last_payee_notification_sent_at = current_time
                assignment.payee_notification_count = int(assignment.payee_notification_count or 0) + 1
                db.add(assignment)
            results.append(
                SettlementNotificationDispatchResult(
                    dedupe_key=dedupe_key,
                    profile_id=payee_profile_id,
                    title=title,
                    status="sent",
                    provider_message_id=provider_message_id,
                )
            )

        if results:
            db.commit()
        return results

    def _auto_confirm_due_assignments(self, db: Session) -> None:
        now = datetime.now(UTC)
        due_rows = list(
            db.scalars(
                select(SettlementAssignment).where(
                    SettlementAssignment.status == SettlementStatus.PROOF_SUBMITTED,
                    SettlementAssignment.auto_confirm_at.is_not(None),
                    SettlementAssignment.auto_confirm_at <= now,
                )
            )
        )
        if not due_rows:
            return
        for row in due_rows:
            self._mark_confirmed(row, confirmed_by_profile_id=row.payee_profile_id, automatic=True)
            db.add(row)
        db.commit()
        for vip_id in {row.scope_id for row in due_rows if row.scope_type == PaymentScopeType.VIP}:
            self._sync_vip_lifecycle_status(db, vip_id)

    def _sync_vip_lifecycle_status(self, db: Session, vip_id: str) -> None:
        vip = db.get(VipCompetition, vip_id)
        if vip is None or vip.lifecycle_status != "closed_pending_payments":
            return
        assignments = list(
            db.scalars(
                select(SettlementAssignment).where(
                    SettlementAssignment.scope_type == PaymentScopeType.VIP,
                    SettlementAssignment.scope_id == vip_id,
                )
            )
        )
        if assignments and all(row.status == SettlementStatus.CONFIRMED for row in assignments):
            vip.lifecycle_status = "settled"
            vip.is_active = False
            db.add(vip)
            db.commit()

    def _mark_confirmed(
        self,
        row: SettlementAssignment,
        *,
        confirmed_by_profile_id: str | None,
        automatic: bool,
    ) -> None:
        row.status = SettlementStatus.CONFIRMED
        row.confirmed_by_profile_id = confirmed_by_profile_id
        row.confirmed_at = datetime.now(UTC)
        row.confirmed_automatically = automatic
        row.rejected_by_profile_id = None
        row.rejected_at = None
        row.rejection_reason = None
        row.auto_confirm_at = None

    def _ensure_scope_exists(
        self,
        db: Session,
        scope_type: PaymentScopeType,
        scope_id: str,
    ) -> Season | VipCompetition:
        if scope_type == PaymentScopeType.SEASON:
            row = db.get(Season, scope_id)
            if row is None:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Temporada no encontrada.")
            return row
        if scope_type == PaymentScopeType.VIP:
            row = db.get(VipCompetition, scope_id)
            if row is None:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="VIP no encontrada.")
            return row
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="scope_type invalido para este flujo.")

    def _supported_scope_type(self, scope_type: str) -> PaymentScopeType:
        try:
            scope_type_enum = PaymentScopeType(scope_type)
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="scope_type invalido.") from exc
        if scope_type_enum not in {PaymentScopeType.SEASON, PaymentScopeType.VIP}:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Los pagos entre jugadores solo aplican a temporada o VIP.",
            )
        return scope_type_enum

    def _config_out(
        self,
        row: SettlementConfig | None,
        *,
        scope_type: PaymentScopeType | None = None,
        scope_id: str | None = None,
    ) -> SettlementConfigOut:
        if row is None:
            if scope_type is None or scope_id is None:
                raise ValueError("scope_type y scope_id son requeridos cuando no existe configuracion persistida")
            return SettlementConfigOut(
                scope_type=scope_type.value,
                scope_id=scope_id,
                max_payment_amount=float(DEFAULT_MAX_PAYMENT_AMOUNT),
                confirmation_window_hours=DEFAULT_CONFIRMATION_WINDOW_HOURS,
                commission_allocations=[],
            )
        return SettlementConfigOut(
            scope_type=row.scope_type.value,
            scope_id=row.scope_id,
            max_payment_amount=float(row.max_payment_amount),
            confirmation_window_hours=row.confirmation_window_hours,
            commission_recipient_profile_id=row.commission_recipient_profile_id,
            commission_allocations=[
                {
                    "profile_id": item["profile_id"],
                    "amount": float(item["amount"]),
                }
                for item in (row.commission_allocations or [])
            ],
            created_by_profile_id=row.created_by_profile_id,
            created_at=row.created_at,
            updated_at=row.updated_at,
        )

    @staticmethod
    def _to_money(value: Decimal | float | int) -> Decimal:
        return Decimal(str(value)).quantize(MONEY_QUANTIZER, rounding=ROUND_HALF_UP)

    @staticmethod
    def _ensure_utc(value: datetime) -> datetime:
        return value if value.tzinfo is not None else value.replace(tzinfo=UTC)

    @staticmethod
    def _format_money(value: Decimal) -> str:
        quantized = value.quantize(MONEY_QUANTIZER, rounding=ROUND_HALF_UP)
        return f"${quantized:,.2f} MXN"

    @staticmethod
    def _payments_dashboard_url() -> str:
        return f"{settings.frontend_site_url.rstrip('/')}/dashboard/payments"
