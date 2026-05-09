from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, model_validator


PaymentScopeTypeLiteral = Literal["season", "vip", "quiniela_plus"]
PaymentStatusLiteral = Literal[
    "pending_checkout",
    "checkout_created",
    "paid",
    "expired",
    "cancelled",
    "failed",
]


class PricingRuleOut(BaseModel):
    id: str
    scope_type: PaymentScopeTypeLiteral
    scope_id: str
    label: str
    amount: float
    currency: str = "mxn"
    starts_at: datetime | None = None
    ends_at: datetime | None = None
    start_matchday_number: int | None = None
    end_matchday_number: int | None = None
    is_active: bool = True
    created_by_profile_id: str | None = None
    created_at: datetime
    updated_at: datetime


class PricingRuleUpsertRequest(BaseModel):
    scope_type: PaymentScopeTypeLiteral
    scope_id: str
    label: str = Field(min_length=1, max_length=160)
    amount: float = Field(gt=0, le=1_000_000)
    currency: str = Field(default="mxn", min_length=3, max_length=8)
    starts_at: datetime | None = None
    ends_at: datetime | None = None
    start_matchday_number: int | None = Field(default=None, ge=1, le=100)
    end_matchday_number: int | None = Field(default=None, ge=1, le=100)
    is_active: bool = True

    @model_validator(mode="after")
    def validate_ranges(self) -> "PricingRuleUpsertRequest":
        if self.starts_at and self.ends_at and self.ends_at <= self.starts_at:
            raise ValueError("ends_at debe ser posterior a starts_at")
        if (
            self.start_matchday_number is not None
            and self.end_matchday_number is not None
            and self.end_matchday_number < self.start_matchday_number
        ):
            raise ValueError("end_matchday_number debe ser mayor o igual a start_matchday_number")
        return self


class EffectivePricingResponse(BaseModel):
    scope_type: PaymentScopeTypeLiteral
    scope_id: str
    label: str
    amount: float
    currency: str
    pricing_rule_id: str


class CheckoutSessionRequest(BaseModel):
    scope_type: PaymentScopeTypeLiteral
    scope_id: str
    selected_league_ids: list[str] = Field(default_factory=list, max_length=12)


class CheckoutSessionResponse(BaseModel):
    payment_id: str
    checkout_session_id: str
    checkout_url: str
    scope_type: PaymentScopeTypeLiteral
    scope_id: str
    label: str
    amount: float
    currency: str
    status: PaymentStatusLiteral


class PaymentOut(BaseModel):
    id: str
    scope_type: PaymentScopeTypeLiteral
    scope_id: str
    pricing_rule_id: str | None = None
    provider_name: str
    amount: float
    currency: str
    status: PaymentStatusLiteral
    stripe_checkout_session_id: str | None = None
    stripe_payment_intent_id: str | None = None
    stripe_customer_id: str | None = None
    checkout_url: str | None = None
    paid_at: datetime | None = None
    created_at: datetime
    updated_at: datetime


class WebhookAckResponse(BaseModel):
    received: bool = True
    event_type: str
