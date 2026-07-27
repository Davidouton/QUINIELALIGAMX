from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, model_validator


PaymentScopeTypeLiteral = Literal["season", "survivor", "vip", "quiniela_plus"]
PaymentStatusLiteral = Literal[
    "pending_checkout",
    "checkout_created",
    "paid",
    "expired",
    "cancelled",
    "failed",
]
SettlementStatusLiteral = Literal[
    "pending_proof",
    "proof_submitted",
    "confirmed",
    "rejected",
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


class SettlementConfigOut(BaseModel):
    scope_type: PaymentScopeTypeLiteral
    scope_id: str
    max_payment_amount: float
    confirmation_window_hours: int
    created_by_profile_id: str | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None


class SettlementConfigUpdateRequest(BaseModel):
    scope_type: PaymentScopeTypeLiteral
    scope_id: str
    max_payment_amount: float = Field(gt=0, le=99_999_999.99)
    confirmation_window_hours: int = Field(ge=1, le=168)


class SettlementParticipantOut(BaseModel):
    profile_id: str
    display_name: str
    rank_position: int | None = None
    total_points: int = 0
    prize_amount: float = 0
    pending_entry_amount: float = 0
    net_amount: float = 0
    is_payer_candidate: bool = False
    is_selected_payer: bool = False
    contact_phone: str | None = None
    bank_name: str | None = None
    deposit_account: str | None = None
    modality: str | None = None
    aval_display_name: str | None = None


class SettlementAssignmentOut(BaseModel):
    id: str
    scope_type: PaymentScopeTypeLiteral
    scope_id: str
    scope_label: str | None = None
    payer_profile_id: str
    payer_display_name: str
    payer_contact_phone: str | None = None
    payee_profile_id: str
    payee_display_name: str
    payee_contact_phone: str | None = None
    payee_bank_name: str | None = None
    payee_deposit_account: str | None = None
    amount: float
    currency: str
    status: SettlementStatusLiteral
    proof_image_url: str | None = None
    proof_note: str | None = None
    proof_uploaded_at: datetime | None = None
    auto_confirm_at: datetime | None = None
    confirmed_automatically: bool = False
    confirmed_by_profile_id: str | None = None
    confirmed_by_display_name: str | None = None
    confirmed_at: datetime | None = None
    rejected_by_profile_id: str | None = None
    rejected_by_display_name: str | None = None
    rejected_at: datetime | None = None
    rejection_reason: str | None = None
    created_by_profile_id: str | None = None
    created_at: datetime
    updated_at: datetime


class SettlementScopeSummaryOut(BaseModel):
    scope_type: PaymentScopeTypeLiteral
    scope_id: str
    scope_label: str
    config: SettlementConfigOut
    participants: list[SettlementParticipantOut] = Field(default_factory=list)
    assignments: list[SettlementAssignmentOut] = Field(default_factory=list)
    selected_payer_profile_ids: list[str] = Field(default_factory=list)
    total_receivable_amount: float = 0
    total_selected_payable_amount: float = 0
    total_assigned_amount: float = 0
    uncovered_receiver_amount: float = 0
    unallocated_payer_amount: float = 0


class SettlementGeneratedScopeOut(BaseModel):
    scope_type: Literal["season", "vip"]
    scope_id: str
    scope_label: str
    assignments_count: int = 0
    pending_count: int = 0
    proof_submitted_count: int = 0
    confirmed_count: int = 0
    rejected_count: int = 0
    total_assigned_amount: float = 0
    updated_at: datetime


class SettlementGenerateRequest(BaseModel):
    scope_type: PaymentScopeTypeLiteral
    scope_id: str
    payer_profile_ids: list[str] = Field(default_factory=list, max_length=200)


class SettlementProofSubmitRequest(BaseModel):
    proof_image_url: str = Field(min_length=1, max_length=2000)
    proof_note: str | None = Field(default=None, max_length=2000)

    @model_validator(mode="after")
    def normalize(self) -> "SettlementProofSubmitRequest":
        self.proof_image_url = self.proof_image_url.strip()
        if self.proof_note is not None:
            note = self.proof_note.strip()
            self.proof_note = note or None
        return self


class SettlementRejectRequest(BaseModel):
    rejection_reason: str | None = Field(default=None, max_length=2000)

    @model_validator(mode="after")
    def normalize(self) -> "SettlementRejectRequest":
        if self.rejection_reason is not None:
            reason = self.rejection_reason.strip()
            self.rejection_reason = reason or None
        return self


class MySettlementsResponse(BaseModel):
    outgoing: list[SettlementAssignmentOut] = Field(default_factory=list)
    incoming: list[SettlementAssignmentOut] = Field(default_factory=list)
