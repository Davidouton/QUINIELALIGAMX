from fastapi import APIRouter, Depends, Header, Request, status
from sqlalchemy.orm import Session

from app.api.deps import get_current_profile, get_db, require_roles
from app.models.entities import Profile, RoleCode
from app.schemas.payments import (
    CheckoutSessionRequest,
    CheckoutSessionResponse,
    EffectivePricingResponse,
    PaymentOut,
    PricingRuleOut,
    PricingRuleUpsertRequest,
    WebhookAckResponse,
)
from app.services.payment_service import PaymentService

router = APIRouter()
service = PaymentService()


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
