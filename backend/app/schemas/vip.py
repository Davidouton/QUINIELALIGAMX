from datetime import datetime

from pydantic import BaseModel, Field, model_validator

from app.models.entities import VipMembershipStatus


class VipMatchdayOut(BaseModel):
    id: str
    season_id: str
    number: int
    name: str


class VipLeaderboardEntryOut(BaseModel):
    profile_id: str
    display_name: str
    total_points: int
    correct_results: int
    exact_scores: int
    rank_position: int


class VipMembershipOut(BaseModel):
    id: str
    profile_id: str
    display_name: str
    status: VipMembershipStatus
    is_paid: bool = False
    requested_at: datetime
    decided_at: datetime | None = None
    decided_by_profile_id: str | None = None
    decided_by_display_name: str | None = None
    admin_note: str | None = None


class VipCompetitionOut(BaseModel):
    id: str
    season_id: str
    season_name: str
    name: str
    entry_fee_amount: float
    admin_commission_pct: float = 0
    first_place_pct: float = 0
    second_place_pct: float = 0
    third_place_pct: float = 0
    is_active: bool
    matchdays: list[VipMatchdayOut] = []
    approved_members_count: int = 0
    pending_requests_count: int = 0
    gross_pool_amount: float = 0
    admin_commission_amount: float = 0
    distributable_prize_pool_amount: float = 0
    first_place_amount: float = 0
    second_place_amount: float = 0
    third_place_amount: float = 0
    remaining_pool_amount: float = 0
    join_locked: bool = False
    join_lock_at: datetime | None = None
    join_lock_match_label: str | None = None
    my_membership: VipMembershipOut | None = None
    leaderboard: list[VipLeaderboardEntryOut] = []


class VipRequestJoinResponse(BaseModel):
    vip_id: str
    membership: VipMembershipOut


class AdminVipUpsertRequest(BaseModel):
    name: str = Field(min_length=1, max_length=160)
    entry_fee_amount: float = Field(default=0, ge=0, le=1000000)
    admin_commission_pct: float = Field(default=0, ge=0, le=100)
    first_place_pct: float = Field(default=0, ge=0, le=100)
    second_place_pct: float = Field(default=0, ge=0, le=100)
    third_place_pct: float = Field(default=0, ge=0, le=100)
    matchday_ids: list[str] = Field(min_length=1)
    is_active: bool = True

    @model_validator(mode="after")
    def validate_prize_distribution(self) -> "AdminVipUpsertRequest":
        payout_pct = self.first_place_pct + self.second_place_pct + self.third_place_pct
        if payout_pct > 100:
            raise ValueError("La suma de 1er, 2do y 3er lugar no puede rebasar 100%")
        return self


class AdminVipMembershipDecisionRequest(BaseModel):
    admin_note: str | None = None


class AdminVipMembershipPaymentRequest(BaseModel):
    is_paid: bool
    admin_note: str | None = None


class AdminVipCompetitionOut(BaseModel):
    id: str
    season_id: str
    season_name: str
    name: str
    entry_fee_amount: float
    admin_commission_pct: float = 0
    first_place_pct: float = 0
    second_place_pct: float = 0
    third_place_pct: float = 0
    is_active: bool
    created_by_profile_id: str | None = None
    created_by_display_name: str | None = None
    matchdays: list[VipMatchdayOut] = []
    memberships: list[VipMembershipOut] = []
    approved_members_count: int = 0
    pending_requests_count: int = 0
    gross_pool_amount: float = 0
    admin_commission_amount: float = 0
    distributable_prize_pool_amount: float = 0
    first_place_amount: float = 0
    second_place_amount: float = 0
    third_place_amount: float = 0
    remaining_pool_amount: float = 0
    join_locked: bool = False
    join_lock_at: datetime | None = None
    join_lock_match_label: str | None = None
    leaderboard: list[VipLeaderboardEntryOut] = []
