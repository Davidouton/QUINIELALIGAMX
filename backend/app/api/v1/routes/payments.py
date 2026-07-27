from fastapi import APIRouter, Depends, Header, Request, status
from sqlalchemy.orm import Session

from app.api.deps import get_current_profile, get_db, require_roles
from app.models.entities import Profile, RoleCode
from app.schemas.payments import (
    CheckoutSessionRequest,
    CheckoutSessionResponse,
    EffectivePricingResponse,
    MySettlementsResponse,
    PaymentOut,
    PricingRuleOut,
    PricingRuleUpsertRequest,
    SettlementAssignmentOut,
    SettlementAssignmentDispatchOut,
    SettlementAssignmentOverrideRequest,
    SettlementConfigOut,
    SettlementConfigUpdateRequest,
    SettlementGenerateRequest,
    SettlementGeneratedScopeOut,
    SettlementManualAssignmentRequest,
    SettlementProofSubmitRequest,
    SettlementRejectRequest,
    SettlementScopeSummaryOut,
    WebhookAckResponse,
)
from app.services.payment_service import PaymentService
from app.services.settlement_service import SettlementService

router = APIRouter()
service = PaymentService()
settlement_service = SettlementService()


@router.get("/payments/pricing-rules", response_model=list[PricingRuleOut])
def list_pricing_rules(
    db: Session = Depends(get_db),
    _: Profile = Depends(require_roles(RoleCode.ADMIN, RoleCode.MASTER_ADMIN)),
) -> list[PricingRuleOut]:
    return service.list_pricing_rules(db)


@router.post(
    "/payments/pricing-rules",
    response_model=PricingRuleOut,
    status_code=status.HTTP_201_CREATED,
)
def create_pricing_rule(
    payload: PricingRuleUpsertRequest,
    db: Session = Depends(get_db),
    current_profile: Profile = Depends(require_roles(RoleCode.ADMIN, RoleCode.MASTER_ADMIN)),
) -> PricingRuleOut:
    return service.create_pricing_rule(db, payload, current_profile)


@router.put("/payments/pricing-rules/{pricing_rule_id}", response_model=PricingRuleOut)
def update_pricing_rule(
    pricing_rule_id: str,
    payload: PricingRuleUpsertRequest,
    db: Session = Depends(get_db),
    _: Profile = Depends(require_roles(RoleCode.ADMIN, RoleCode.MASTER_ADMIN)),
) -> PricingRuleOut:
    return service.update_pricing_rule(db, pricing_rule_id, payload)


@router.get("/payments/pricing", response_model=EffectivePricingResponse)
def get_effective_pricing(
    scope_type: str,
    scope_id: str,
    db: Session = Depends(get_db),
    _: Profile = Depends(get_current_profile),
) -> EffectivePricingResponse:
    return service.get_effective_pricing(db, scope_type, scope_id)


@router.get("/payments/my-payments", response_model=list[PaymentOut])
def list_my_payments(
    db: Session = Depends(get_db),
    current_profile: Profile = Depends(get_current_profile),
) -> list[PaymentOut]:
    return service.list_my_payments(db, current_profile)


@router.post("/payments/checkout-session", response_model=CheckoutSessionResponse)
def create_checkout_session(
    payload: CheckoutSessionRequest,
    db: Session = Depends(get_db),
    current_profile: Profile = Depends(get_current_profile),
) -> CheckoutSessionResponse:
    return service.create_checkout_session(db, current_profile, payload)


@router.post("/payments/webhook", response_model=WebhookAckResponse)
async def stripe_webhook(
    request: Request,
    stripe_signature: str | None = Header(default=None, alias="Stripe-Signature"),
    db: Session = Depends(get_db),
) -> WebhookAckResponse:
    payload = await request.body()
    event_type = service.handle_webhook(db, payload, stripe_signature)
    return WebhookAckResponse(received=True, event_type=event_type)


@router.get("/payments/settlements/admin/generated", response_model=list[SettlementGeneratedScopeOut])
def list_admin_generated_settlements(
    db: Session = Depends(get_db),
    _: Profile = Depends(require_roles(RoleCode.ADMIN, RoleCode.MASTER_ADMIN)),
) -> list[SettlementGeneratedScopeOut]:
    return settlement_service.list_generated_scopes(db)


@router.get("/payments/settlements/admin/summary", response_model=SettlementScopeSummaryOut)
def get_admin_settlement_summary(
    scope_type: str,
    scope_id: str,
    db: Session = Depends(get_db),
    _: Profile = Depends(require_roles(RoleCode.ADMIN, RoleCode.MASTER_ADMIN)),
) -> SettlementScopeSummaryOut:
    return settlement_service.get_scope_summary(db, scope_type, scope_id)


@router.put("/payments/settlements/admin/config", response_model=SettlementConfigOut)
def upsert_admin_settlement_config(
    payload: SettlementConfigUpdateRequest,
    db: Session = Depends(get_db),
    current_profile: Profile = Depends(require_roles(RoleCode.ADMIN, RoleCode.MASTER_ADMIN)),
) -> SettlementConfigOut:
    return settlement_service.update_config(db, payload, current_profile)


@router.post("/payments/settlements/admin/generate", response_model=SettlementScopeSummaryOut)
def generate_admin_settlement_split(
    payload: SettlementGenerateRequest,
    db: Session = Depends(get_db),
    current_profile: Profile = Depends(require_roles(RoleCode.ADMIN, RoleCode.MASTER_ADMIN)),
) -> SettlementScopeSummaryOut:
    return settlement_service.generate_assignments(db, payload, current_profile)


@router.delete("/payments/settlements/admin/assignments", response_model=SettlementScopeSummaryOut)
def clear_admin_settlement_assignments(
    scope_type: str,
    scope_id: str,
    db: Session = Depends(get_db),
    _: Profile = Depends(require_roles(RoleCode.ADMIN, RoleCode.MASTER_ADMIN)),
) -> SettlementScopeSummaryOut:
    return settlement_service.clear_assignments(db, scope_type, scope_id)


@router.post("/payments/settlements/admin/manual", response_model=SettlementScopeSummaryOut)
def create_admin_manual_settlement(
    payload: SettlementManualAssignmentRequest,
    db: Session = Depends(get_db),
    current_profile: Profile = Depends(require_roles(RoleCode.ADMIN, RoleCode.MASTER_ADMIN)),
) -> SettlementScopeSummaryOut:
    return settlement_service.create_manual_assignment(db, payload, current_profile)


@router.put("/payments/settlements/admin/assignments/{settlement_id}", response_model=SettlementScopeSummaryOut)
def override_admin_settlement_assignment(
    settlement_id: str,
    payload: SettlementAssignmentOverrideRequest,
    db: Session = Depends(get_db),
    _: Profile = Depends(require_roles(RoleCode.ADMIN, RoleCode.MASTER_ADMIN)),
) -> SettlementScopeSummaryOut:
    return settlement_service.override_assignment(db, settlement_id, payload)


@router.post("/payments/settlements/admin/assign", response_model=SettlementAssignmentDispatchOut)
def dispatch_admin_settlement_assignments(
    scope_type: str,
    scope_id: str,
    db: Session = Depends(get_db),
    _: Profile = Depends(require_roles(RoleCode.ADMIN, RoleCode.MASTER_ADMIN)),
) -> SettlementAssignmentDispatchOut:
    assignments_count, notification_dispatches = settlement_service.dispatch_assignments(db, scope_type, scope_id)
    return SettlementAssignmentDispatchOut(
        assignments_count=assignments_count,
        notification_dispatches=notification_dispatches,
    )


@router.get("/payments/settlements/mine", response_model=MySettlementsResponse)
def list_my_settlements(
    db: Session = Depends(get_db),
    current_profile: Profile = Depends(get_current_profile),
) -> MySettlementsResponse:
    return settlement_service.list_my_settlements(db, current_profile)


@router.put("/payments/settlements/{settlement_id}/proof", response_model=SettlementAssignmentOut)
def submit_settlement_proof(
    settlement_id: str,
    payload: SettlementProofSubmitRequest,
    db: Session = Depends(get_db),
    current_profile: Profile = Depends(get_current_profile),
) -> SettlementAssignmentOut:
    return settlement_service.submit_proof(db, settlement_id, current_profile, payload)


@router.post("/payments/settlements/{settlement_id}/confirm", response_model=SettlementAssignmentOut)
def confirm_settlement(
    settlement_id: str,
    db: Session = Depends(get_db),
    current_profile: Profile = Depends(get_current_profile),
) -> SettlementAssignmentOut:
    return settlement_service.confirm_assignment(db, settlement_id, current_profile)


@router.post("/payments/settlements/{settlement_id}/reject", response_model=SettlementAssignmentOut)
def reject_settlement(
    settlement_id: str,
    payload: SettlementRejectRequest,
    db: Session = Depends(get_db),
    current_profile: Profile = Depends(get_current_profile),
) -> SettlementAssignmentOut:
    return settlement_service.reject_assignment(db, settlement_id, current_profile, payload)
