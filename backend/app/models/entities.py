from datetime import date, datetime
from decimal import Decimal
from enum import Enum
from uuid import uuid4

from sqlalchemy import Boolean, Date, DateTime, Enum as SqlEnum, ForeignKey, Integer, Numeric, String, Text, UniqueConstraint, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


def uuid_str() -> str:
    return str(uuid4())


def enum_values(enum_cls: type[Enum]) -> list[str]:
    return [member.value for member in enum_cls]


UUID_SQL = Uuid(as_uuid=False)


class RoleCode(str, Enum):
    MASTER_ADMIN = "master_admin"
    ADMIN = "admin"
    USER = "user"


class MatchdayStatus(str, Enum):
    DRAFT = "draft"
    ACTIVE = "active"
    CLOSED = "closed"
    PUBLISHED = "published"


class MatchStatus(str, Enum):
    SCHEDULED = "scheduled"
    FINAL = "final"
    POSTPONED = "postponed"
    CANCELLED = "cancelled"


class TournamentFormat(str, Enum):
    STANDARD = "standard"
    WORLD_CUP = "world_cup"


class MatchStageType(str, Enum):
    REGULAR = "regular"
    GROUP = "group"
    ROUND_OF_32 = "round_of_32"
    ROUND_OF_16 = "round_of_16"
    QUARTERFINAL = "quarterfinal"
    SEMIFINAL = "semifinal"
    THIRD_PLACE = "third_place"
    FINAL = "final"


class PickSelection(str, Enum):
    HOME = "home"
    DRAW = "draw"
    AWAY = "away"


class SyncStatus(str, Enum):
    SUCCESS = "success"
    FAILED = "failed"


class VipMembershipStatus(str, Enum):
    PENDING = "pending"
    APPROVED = "approved"
    REJECTED = "rejected"


class PickReminderKind(str, Enum):
    OPENING = "opening"
    PRE_GAME = "pre_game"


class PaymentScopeType(str, Enum):
    SEASON = "season"
    VIP = "vip"
    QUINIELA_PLUS = "quiniela_plus"


class PaymentStatus(str, Enum):
    PENDING_CHECKOUT = "pending_checkout"
    CHECKOUT_CREATED = "checkout_created"
    PAID = "paid"
    EXPIRED = "expired"
    CANCELLED = "cancelled"
    FAILED = "failed"


class QuinielaPlusBillingPeriod(str, Enum):
    WEEKLY = "weekly"
    MONTHLY = "monthly"
    QUARTERLY = "quarterly"
    SEMIANNUAL = "semiannual"
    ANNUAL = "annual"


class QuinielaPlusMembershipStatus(str, Enum):
    ACTIVE = "active"
    EXPIRED = "expired"
    CANCELLED = "cancelled"


class Profile(Base):
    __tablename__ = "profiles"

    id: Mapped[str] = mapped_column(UUID_SQL, primary_key=True, default=uuid_str)
    auth_user_id: Mapped[str] = mapped_column(UUID_SQL, unique=True, index=True)
    email: Mapped[str | None] = mapped_column(String(255), index=True)
    display_name: Mapped[str] = mapped_column(String(120))
    favorite_team_id: Mapped[str | None] = mapped_column(
        UUID_SQL,
        ForeignKey("teams.id", ondelete="SET NULL"),
        nullable=True,
    )
    contact_phone: Mapped[str | None] = mapped_column(String(32))
    bank_name: Mapped[str | None] = mapped_column(String(120))
    deposit_account: Mapped[str | None] = mapped_column(String(160))
    modality: Mapped[str] = mapped_column(String(24), default="pre_pago", nullable=False)
    aval_profile_id: Mapped[str | None] = mapped_column(
        UUID_SQL,
        ForeignKey("profiles.id", ondelete="SET NULL"),
        nullable=True,
    )
    theme_preference: Mapped[str] = mapped_column(String(32), default="standard", nullable=False)
    pick_reminder_email_enabled: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    pick_reminder_opening_enabled: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    pick_reminder_hours_before: Mapped[int | None] = mapped_column(Integer)
    role_code: Mapped[RoleCode] = mapped_column(
        SqlEnum(RoleCode, native_enum=False, values_callable=enum_values),
        default=RoleCode.USER,
        nullable=False,
        index=True,
    )
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
    )


class Competition(Base):
    __tablename__ = "competitions"

    id: Mapped[str] = mapped_column(UUID_SQL, primary_key=True, default=uuid_str)
    sport_name: Mapped[str] = mapped_column(String(80), index=True)
    name: Mapped[str] = mapped_column(String(120))
    slug: Mapped[str] = mapped_column(String(120), unique=True, index=True)
    provider_league_id: Mapped[str | None] = mapped_column(String(120), index=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False, index=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=100, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
    )


class Season(Base):
    __tablename__ = "seasons"

    id: Mapped[str] = mapped_column(UUID_SQL, primary_key=True, default=uuid_str)
    name: Mapped[str] = mapped_column(String(120))
    slug: Mapped[str] = mapped_column(String(120), unique=True, index=True)
    competition_id: Mapped[str | None] = mapped_column(
        UUID_SQL,
        ForeignKey("competitions.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    tournament_format: Mapped[TournamentFormat] = mapped_column(
        SqlEnum(TournamentFormat, native_enum=False, values_callable=enum_values),
        default=TournamentFormat.STANDARD,
        nullable=False,
        index=True,
    )
    is_active: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    start_matchday_id: Mapped[str | None] = mapped_column(UUID_SQL, nullable=True, index=True)
    end_matchday_id: Mapped[str | None] = mapped_column(UUID_SQL, nullable=True, index=True)
    participants_lock_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    entry_fee_amount: Mapped[Decimal] = mapped_column(Numeric(10, 2), default=Decimal("0.00"), nullable=False)
    weekly_first_place_amount: Mapped[Decimal] = mapped_column(Numeric(10, 2), default=Decimal("0.00"), nullable=False)
    weekly_second_place_amount: Mapped[Decimal] = mapped_column(Numeric(10, 2), default=Decimal("0.00"), nullable=False)
    weekly_third_place_amount: Mapped[Decimal] = mapped_column(Numeric(10, 2), default=Decimal("0.00"), nullable=False)
    admin_commission_pct: Mapped[Decimal] = mapped_column(Numeric(5, 2), default=Decimal("0.00"), nullable=False)
    reserve_pct: Mapped[Decimal] = mapped_column(Numeric(5, 2), default=Decimal("0.00"), nullable=False)
    first_place_pct: Mapped[Decimal] = mapped_column(Numeric(5, 2), default=Decimal("0.00"), nullable=False)
    second_place_pct: Mapped[Decimal] = mapped_column(Numeric(5, 2), default=Decimal("0.00"), nullable=False)
    third_place_pct: Mapped[Decimal] = mapped_column(Numeric(5, 2), default=Decimal("0.00"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
    )


class Matchday(Base):
    __tablename__ = "matchdays"
    __table_args__ = (UniqueConstraint("season_id", "number", name="uq_matchdays_season_number"),)

    id: Mapped[str] = mapped_column(UUID_SQL, primary_key=True, default=uuid_str)
    season_id: Mapped[str] = mapped_column(UUID_SQL, ForeignKey("seasons.id", ondelete="CASCADE"), index=True)
    number: Mapped[int] = mapped_column(Integer)
    name: Mapped[str] = mapped_column(String(120))
    default_lock_offset_minutes: Mapped[int] = mapped_column(Integer, default=10, nullable=False)
    picks_reopened_override: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    status: Mapped[MatchdayStatus] = mapped_column(
        SqlEnum(MatchdayStatus, native_enum=False, values_callable=enum_values),
        default=MatchdayStatus.DRAFT,
        nullable=False,
        index=True,
    )
    starts_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    ends_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
    )


class WorldCupGroup(Base):
    __tablename__ = "world_cup_groups"
    __table_args__ = (UniqueConstraint("season_id", "group_label", name="uq_world_cup_groups_season_label"),)

    id: Mapped[str] = mapped_column(UUID_SQL, primary_key=True, default=uuid_str)
    season_id: Mapped[str] = mapped_column(UUID_SQL, ForeignKey("seasons.id", ondelete="CASCADE"), index=True)
    group_label: Mapped[str] = mapped_column(String(16), index=True)
    display_name: Mapped[str | None] = mapped_column(String(120))
    sort_order: Mapped[int] = mapped_column(Integer, default=100, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
    )


class Team(Base):
    __tablename__ = "teams"

    id: Mapped[str] = mapped_column(UUID_SQL, primary_key=True, default=uuid_str)
    competition_id: Mapped[str | None] = mapped_column(
        UUID_SQL,
        ForeignKey("competitions.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    external_id: Mapped[str | None] = mapped_column(String(100), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(120))
    short_name: Mapped[str] = mapped_column(String(16))
    slug: Mapped[str] = mapped_column(String(120), unique=True, index=True)
    crest_url: Mapped[str | None] = mapped_column(Text)
    home_venue: Mapped[str | None] = mapped_column(String(255))
    primary_color: Mapped[str | None] = mapped_column(String(16))
    secondary_color: Mapped[str | None] = mapped_column(String(16))
    accent_color: Mapped[str | None] = mapped_column(String(16))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
    )


class WorldCupGroupTeam(Base):
    __tablename__ = "world_cup_group_teams"
    __table_args__ = (UniqueConstraint("group_id", "team_id", name="uq_world_cup_group_teams_group_team"),)

    id: Mapped[str] = mapped_column(UUID_SQL, primary_key=True, default=uuid_str)
    group_id: Mapped[str] = mapped_column(
        UUID_SQL,
        ForeignKey("world_cup_groups.id", ondelete="CASCADE"),
        index=True,
    )
    team_id: Mapped[str] = mapped_column(UUID_SQL, ForeignKey("teams.id", ondelete="CASCADE"), index=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=100, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
    )


class Match(Base):
    __tablename__ = "matches"

    id: Mapped[str] = mapped_column(UUID_SQL, primary_key=True, default=uuid_str)
    matchday_id: Mapped[str] = mapped_column(UUID_SQL, ForeignKey("matchdays.id", ondelete="CASCADE"), index=True)
    external_id: Mapped[str | None] = mapped_column(String(100), unique=True, index=True)
    home_team_id: Mapped[str | None] = mapped_column(
        UUID_SQL,
        ForeignKey("teams.id", ondelete="RESTRICT"),
        nullable=True,
        index=True,
    )
    away_team_id: Mapped[str | None] = mapped_column(
        UUID_SQL,
        ForeignKey("teams.id", ondelete="RESTRICT"),
        nullable=True,
        index=True,
    )
    stage_type: Mapped[MatchStageType] = mapped_column(
        SqlEnum(MatchStageType, native_enum=False, values_callable=enum_values),
        default=MatchStageType.REGULAR,
        nullable=False,
        index=True,
    )
    group_label: Mapped[str | None] = mapped_column(String(16), index=True)
    bracket_slot: Mapped[str | None] = mapped_column(String(32), index=True)
    home_placeholder: Mapped[str | None] = mapped_column(String(64))
    away_placeholder: Mapped[str | None] = mapped_column(String(64))
    kickoff_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    picks_lock_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    venue: Mapped[str | None] = mapped_column(String(255))
    status: Mapped[MatchStatus] = mapped_column(
        SqlEnum(MatchStatus, native_enum=False, values_callable=enum_values),
        default=MatchStatus.SCHEDULED,
        nullable=False,
        index=True,
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
    )


class Odds(Base):
    __tablename__ = "odds"

    id: Mapped[str] = mapped_column(UUID_SQL, primary_key=True, default=uuid_str)
    match_id: Mapped[str] = mapped_column(UUID_SQL, ForeignKey("matches.id", ondelete="CASCADE"), index=True)
    provider_name: Mapped[str] = mapped_column(String(120), index=True)
    home_value: Mapped[Decimal | None] = mapped_column(Numeric(10, 2))
    draw_value: Mapped[Decimal | None] = mapped_column(Numeric(10, 2))
    away_value: Mapped[Decimal | None] = mapped_column(Numeric(10, 2))
    spread_home_line: Mapped[str | None] = mapped_column(String(24))
    spread_home_odds: Mapped[str | None] = mapped_column(String(24))
    spread_away_line: Mapped[str | None] = mapped_column(String(24))
    spread_away_odds: Mapped[str | None] = mapped_column(String(24))
    total_line: Mapped[str | None] = mapped_column(String(24))
    over_value: Mapped[str | None] = mapped_column(String(24))
    under_value: Mapped[str | None] = mapped_column(String(24))
    synced_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class UserPick(Base):
    __tablename__ = "user_picks"
    __table_args__ = (UniqueConstraint("profile_id", "match_id", name="uq_user_picks_profile_match"),)

    id: Mapped[str] = mapped_column(UUID_SQL, primary_key=True, default=uuid_str)
    profile_id: Mapped[str] = mapped_column(UUID_SQL, ForeignKey("profiles.id", ondelete="CASCADE"), index=True)
    match_id: Mapped[str] = mapped_column(UUID_SQL, ForeignKey("matches.id", ondelete="CASCADE"), index=True)
    selection: Mapped[PickSelection] = mapped_column(
        SqlEnum(PickSelection, native_enum=False, values_callable=enum_values),
        nullable=False,
    )
    predicted_home_score: Mapped[int] = mapped_column(Integer)
    predicted_away_score: Mapped[int] = mapped_column(Integer)
    advancing_team_id: Mapped[str | None] = mapped_column(
        UUID_SQL,
        ForeignKey("teams.id", ondelete="SET NULL"),
        index=True,
    )
    is_admin_override: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    admin_override_note: Mapped[str | None] = mapped_column(Text)
    overridden_by_profile_id: Mapped[str | None] = mapped_column(
        UUID_SQL,
        ForeignKey("profiles.id", ondelete="SET NULL"),
        index=True,
    )
    overridden_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
    )


class MatchResult(Base):
    __tablename__ = "match_results"

    id: Mapped[str] = mapped_column(UUID_SQL, primary_key=True, default=uuid_str)
    match_id: Mapped[str] = mapped_column(
        UUID_SQL,
        ForeignKey("matches.id", ondelete="CASCADE"),
        unique=True,
        index=True,
    )
    home_score: Mapped[int] = mapped_column(Integer)
    away_score: Mapped[int] = mapped_column(Integer)
    advancing_team_id: Mapped[str | None] = mapped_column(
        UUID_SQL,
        ForeignKey("teams.id", ondelete="SET NULL"),
        index=True,
    )
    is_official: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    source_provider_name: Mapped[str | None] = mapped_column(String(120), index=True)
    source_external_id: Mapped[str | None] = mapped_column(String(120), index=True)
    source_updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_synced_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    is_manual_override: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    updated_by_profile_id: Mapped[str | None] = mapped_column(
        UUID_SQL,
        ForeignKey("profiles.id", ondelete="SET NULL"),
        index=True,
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
    )


class RawMatchResult(Base):
    __tablename__ = "raw_match_results"

    id: Mapped[str] = mapped_column(UUID_SQL, primary_key=True, default=uuid_str)
    sync_log_id: Mapped[str | None] = mapped_column(
        UUID_SQL,
        ForeignKey("sync_logs.id", ondelete="SET NULL"),
        index=True,
    )
    provider_name: Mapped[str] = mapped_column(String(120), index=True)
    external_result_id: Mapped[str | None] = mapped_column(String(120), index=True)
    external_match_id: Mapped[str | None] = mapped_column(String(120), index=True)
    match_key: Mapped[str | None] = mapped_column(String(160), index=True)
    mapped_match_id: Mapped[str | None] = mapped_column(
        UUID_SQL,
        ForeignKey("matches.id", ondelete="SET NULL"),
        index=True,
    )
    home_score: Mapped[int | None] = mapped_column(Integer)
    away_score: Mapped[int | None] = mapped_column(Integer)
    result_status: Mapped[str | None] = mapped_column(String(80))
    is_official: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    payload_json: Mapped[str] = mapped_column(Text)
    source_updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    fetched_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    applied_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class ScoringRule(Base):
    __tablename__ = "scoring_rules"

    id: Mapped[str] = mapped_column(UUID_SQL, primary_key=True, default=uuid_str)
    rule_key: Mapped[str] = mapped_column(String(80), unique=True, index=True)
    points: Mapped[int] = mapped_column(Integer, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class SeasonMembership(Base):
    __tablename__ = "season_memberships"
    __table_args__ = (UniqueConstraint("season_id", "profile_id", name="uq_season_memberships"),)

    id: Mapped[str] = mapped_column(UUID_SQL, primary_key=True, default=uuid_str)
    season_id: Mapped[str] = mapped_column(UUID_SQL, ForeignKey("seasons.id", ondelete="CASCADE"), index=True)
    profile_id: Mapped[str] = mapped_column(UUID_SQL, ForeignKey("profiles.id", ondelete="CASCADE"), index=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    is_paid: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    eligible_for_scoring: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    activated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    eligible_locked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    activated_by_profile_id: Mapped[str | None] = mapped_column(
        UUID_SQL,
        ForeignKey("profiles.id", ondelete="SET NULL"),
        index=True,
    )
    notes: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
    )


class PickReminderEmailEvent(Base):
    __tablename__ = "pick_reminder_email_events"
    __table_args__ = (UniqueConstraint("dedupe_key", name="uq_pick_reminder_email_events_dedupe"),)

    id: Mapped[str] = mapped_column(UUID_SQL, primary_key=True, default=uuid_str)
    dedupe_key: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    profile_id: Mapped[str] = mapped_column(UUID_SQL, ForeignKey("profiles.id", ondelete="CASCADE"), index=True)
    matchday_id: Mapped[str] = mapped_column(UUID_SQL, ForeignKey("matchdays.id", ondelete="CASCADE"), index=True)
    reminder_kind: Mapped[PickReminderKind] = mapped_column(
        SqlEnum(PickReminderKind, native_enum=False, values_callable=enum_values),
        nullable=False,
        index=True,
    )
    target_match_date: Mapped[date | None] = mapped_column(Date)
    hours_before: Mapped[int | None] = mapped_column(Integer)
    recipient_email: Mapped[str] = mapped_column(String(255))
    provider_name: Mapped[str] = mapped_column(String(80), default="resend", nullable=False)
    provider_message_id: Mapped[str | None] = mapped_column(String(160), index=True)
    sent_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class VipCompetition(Base):
    __tablename__ = "vip_competitions"

    id: Mapped[str] = mapped_column(UUID_SQL, primary_key=True, default=uuid_str)
    season_id: Mapped[str] = mapped_column(UUID_SQL, ForeignKey("seasons.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(160))
    entry_fee_amount: Mapped[Decimal] = mapped_column(Numeric(10, 2), default=Decimal("0.00"), nullable=False)
    admin_commission_pct: Mapped[Decimal] = mapped_column(Numeric(5, 2), default=Decimal("0.00"), nullable=False)
    first_place_pct: Mapped[Decimal] = mapped_column(Numeric(5, 2), default=Decimal("0.00"), nullable=False)
    second_place_pct: Mapped[Decimal] = mapped_column(Numeric(5, 2), default=Decimal("0.00"), nullable=False)
    third_place_pct: Mapped[Decimal] = mapped_column(Numeric(5, 2), default=Decimal("0.00"), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_by_profile_id: Mapped[str | None] = mapped_column(
        UUID_SQL,
        ForeignKey("profiles.id", ondelete="SET NULL"),
        index=True,
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
    )


class VipCompetitionMatchday(Base):
    __tablename__ = "vip_competition_matchdays"
    __table_args__ = (UniqueConstraint("vip_competition_id", "matchday_id", name="uq_vip_competition_matchday"),)

    id: Mapped[str] = mapped_column(UUID_SQL, primary_key=True, default=uuid_str)
    vip_competition_id: Mapped[str] = mapped_column(
        UUID_SQL,
        ForeignKey("vip_competitions.id", ondelete="CASCADE"),
        index=True,
    )
    matchday_id: Mapped[str] = mapped_column(UUID_SQL, ForeignKey("matchdays.id", ondelete="CASCADE"), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class VipMembership(Base):
    __tablename__ = "vip_memberships"
    __table_args__ = (UniqueConstraint("vip_competition_id", "profile_id", name="uq_vip_membership_profile"),)

    id: Mapped[str] = mapped_column(UUID_SQL, primary_key=True, default=uuid_str)
    vip_competition_id: Mapped[str] = mapped_column(
        UUID_SQL,
        ForeignKey("vip_competitions.id", ondelete="CASCADE"),
        index=True,
    )
    profile_id: Mapped[str] = mapped_column(UUID_SQL, ForeignKey("profiles.id", ondelete="CASCADE"), index=True)
    status: Mapped[VipMembershipStatus] = mapped_column(
        SqlEnum(VipMembershipStatus, native_enum=False, values_callable=enum_values),
        default=VipMembershipStatus.PENDING,
        nullable=False,
        index=True,
    )
    requested_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    decided_by_profile_id: Mapped[str | None] = mapped_column(
        UUID_SQL,
        ForeignKey("profiles.id", ondelete="SET NULL"),
        index=True,
    )
    admin_note: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
    )


class QuinielaPlusLeague(Base):
    __tablename__ = "quiniela_plus_leagues"

    id: Mapped[str] = mapped_column(UUID_SQL, primary_key=True, default=uuid_str)
    sport_name: Mapped[str] = mapped_column(String(80))
    league_name: Mapped[str] = mapped_column(String(120))
    slug: Mapped[str] = mapped_column(String(120), unique=True, index=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=100, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
    )


class QuinielaPlusPlan(Base):
    __tablename__ = "quiniela_plus_plans"

    id: Mapped[str] = mapped_column(UUID_SQL, primary_key=True, default=uuid_str)
    name: Mapped[str] = mapped_column(String(160))
    billing_period: Mapped[QuinielaPlusBillingPeriod] = mapped_column(
        SqlEnum(QuinielaPlusBillingPeriod, native_enum=False, values_callable=enum_values),
        nullable=False,
        index=True,
    )
    included_leagues_count: Mapped[int | None] = mapped_column(Integer)
    includes_all_leagues: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    price_amount: Mapped[Decimal] = mapped_column(Numeric(10, 2), default=Decimal("0.00"), nullable=False)
    currency: Mapped[str] = mapped_column(String(8), default="mxn", nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=100, nullable=False)
    created_by_profile_id: Mapped[str | None] = mapped_column(
        UUID_SQL,
        ForeignKey("profiles.id", ondelete="SET NULL"),
        index=True,
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
    )


class QuinielaPlusMembership(Base):
    __tablename__ = "quiniela_plus_memberships"

    id: Mapped[str] = mapped_column(UUID_SQL, primary_key=True, default=uuid_str)
    profile_id: Mapped[str] = mapped_column(UUID_SQL, ForeignKey("profiles.id", ondelete="CASCADE"), index=True)
    plan_id: Mapped[str] = mapped_column(
        UUID_SQL,
        ForeignKey("quiniela_plus_plans.id", ondelete="RESTRICT"),
        index=True,
    )
    source_payment_id: Mapped[str | None] = mapped_column(
        UUID_SQL,
        ForeignKey("payments.id", ondelete="SET NULL"),
        unique=True,
        index=True,
    )
    status: Mapped[QuinielaPlusMembershipStatus] = mapped_column(
        SqlEnum(QuinielaPlusMembershipStatus, native_enum=False, values_callable=enum_values),
        default=QuinielaPlusMembershipStatus.ACTIVE,
        nullable=False,
        index=True,
    )
    starts_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    ends_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
    )


class QuinielaPlusMembershipLeague(Base):
    __tablename__ = "quiniela_plus_membership_leagues"
    __table_args__ = (UniqueConstraint("membership_id", "league_id", name="uq_qp_membership_league"),)

    id: Mapped[str] = mapped_column(UUID_SQL, primary_key=True, default=uuid_str)
    membership_id: Mapped[str] = mapped_column(
        UUID_SQL,
        ForeignKey("quiniela_plus_memberships.id", ondelete="CASCADE"),
        index=True,
    )
    league_id: Mapped[str] = mapped_column(
        UUID_SQL,
        ForeignKey("quiniela_plus_leagues.id", ondelete="CASCADE"),
        index=True,
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class CommerceSettings(Base):
    __tablename__ = "commerce_settings"

    id: Mapped[str] = mapped_column(UUID_SQL, primary_key=True, default=uuid_str)
    quiniela_plus_checkout_enabled: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    quiniela_plus_checkout_message: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
    )


class PricingRule(Base):
    __tablename__ = "pricing_rules"

    id: Mapped[str] = mapped_column(UUID_SQL, primary_key=True, default=uuid_str)
    scope_type: Mapped[PaymentScopeType] = mapped_column(
        SqlEnum(PaymentScopeType, native_enum=False, values_callable=enum_values),
        nullable=False,
        index=True,
    )
    scope_id: Mapped[str] = mapped_column(UUID_SQL, nullable=False, index=True)
    label: Mapped[str] = mapped_column(String(160))
    amount: Mapped[Decimal] = mapped_column(Numeric(10, 2), default=Decimal("0.00"), nullable=False)
    currency: Mapped[str] = mapped_column(String(8), default="mxn", nullable=False)
    starts_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    ends_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    start_matchday_number: Mapped[int | None] = mapped_column(Integer)
    end_matchday_number: Mapped[int | None] = mapped_column(Integer)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_by_profile_id: Mapped[str | None] = mapped_column(
        UUID_SQL,
        ForeignKey("profiles.id", ondelete="SET NULL"),
        index=True,
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
    )


class Payment(Base):
    __tablename__ = "payments"

    id: Mapped[str] = mapped_column(UUID_SQL, primary_key=True, default=uuid_str)
    profile_id: Mapped[str] = mapped_column(UUID_SQL, ForeignKey("profiles.id", ondelete="CASCADE"), index=True)
    scope_type: Mapped[PaymentScopeType] = mapped_column(
        SqlEnum(PaymentScopeType, native_enum=False, values_callable=enum_values),
        nullable=False,
        index=True,
    )
    scope_id: Mapped[str] = mapped_column(UUID_SQL, nullable=False, index=True)
    pricing_rule_id: Mapped[str | None] = mapped_column(
        UUID_SQL,
        ForeignKey("pricing_rules.id", ondelete="SET NULL"),
        index=True,
    )
    provider_name: Mapped[str] = mapped_column(String(40), default="stripe", nullable=False)
    amount: Mapped[Decimal] = mapped_column(Numeric(10, 2), default=Decimal("0.00"), nullable=False)
    currency: Mapped[str] = mapped_column(String(8), default="mxn", nullable=False)
    status: Mapped[PaymentStatus] = mapped_column(
        SqlEnum(PaymentStatus, native_enum=False, values_callable=enum_values),
        default=PaymentStatus.PENDING_CHECKOUT,
        nullable=False,
        index=True,
    )
    stripe_checkout_session_id: Mapped[str | None] = mapped_column(String(160), unique=True, index=True)
    stripe_payment_intent_id: Mapped[str | None] = mapped_column(String(160), index=True)
    stripe_customer_id: Mapped[str | None] = mapped_column(String(160), index=True)
    checkout_url: Mapped[str | None] = mapped_column(Text)
    metadata_json: Mapped[str | None] = mapped_column(Text)
    paid_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
    )


class PickPoint(Base):
    __tablename__ = "pick_points"

    id: Mapped[str] = mapped_column(UUID_SQL, primary_key=True, default=uuid_str)
    pick_id: Mapped[str] = mapped_column(UUID_SQL, ForeignKey("user_picks.id", ondelete="CASCADE"), unique=True, index=True)
    profile_id: Mapped[str] = mapped_column(UUID_SQL, ForeignKey("profiles.id", ondelete="CASCADE"), index=True)
    match_id: Mapped[str] = mapped_column(UUID_SQL, ForeignKey("matches.id", ondelete="CASCADE"), index=True)
    matchday_id: Mapped[str] = mapped_column(UUID_SQL, ForeignKey("matchdays.id", ondelete="CASCADE"), index=True)
    result_points: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    exact_score_points: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    advancing_team_points: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    total_points: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    calculated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class StandingsMatchday(Base):
    __tablename__ = "standings_matchday"
    __table_args__ = (UniqueConstraint("matchday_id", "profile_id", name="uq_standings_matchday"),)

    id: Mapped[str] = mapped_column(UUID_SQL, primary_key=True, default=uuid_str)
    matchday_id: Mapped[str] = mapped_column(UUID_SQL, ForeignKey("matchdays.id", ondelete="CASCADE"), index=True)
    profile_id: Mapped[str] = mapped_column(UUID_SQL, ForeignKey("profiles.id", ondelete="CASCADE"), index=True)
    total_points: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    correct_results: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    exact_scores: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    rank_position: Mapped[int] = mapped_column(Integer, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
    )


class StandingsOverall(Base):
    __tablename__ = "standings_overall"
    __table_args__ = (UniqueConstraint("season_id", "profile_id", name="uq_standings_overall"),)

    id: Mapped[str] = mapped_column(UUID_SQL, primary_key=True, default=uuid_str)
    season_id: Mapped[str] = mapped_column(UUID_SQL, ForeignKey("seasons.id", ondelete="CASCADE"), index=True)
    profile_id: Mapped[str] = mapped_column(UUID_SQL, ForeignKey("profiles.id", ondelete="CASCADE"), index=True)
    total_points: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    correct_results: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    exact_scores: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    rank_position: Mapped[int] = mapped_column(Integer, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
    )


class WeeklyLeader(Base):
    __tablename__ = "weekly_leaders"

    id: Mapped[str] = mapped_column(UUID_SQL, primary_key=True, default=uuid_str)
    matchday_id: Mapped[str] = mapped_column(
        UUID_SQL,
        ForeignKey("matchdays.id", ondelete="CASCADE"),
        unique=True,
        index=True,
    )
    profile_id: Mapped[str] = mapped_column(UUID_SQL, ForeignKey("profiles.id", ondelete="CASCADE"), index=True)
    total_points: Mapped[int] = mapped_column(Integer, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class PublishedMatchday(Base):
    __tablename__ = "published_matchdays"

    id: Mapped[str] = mapped_column(UUID_SQL, primary_key=True, default=uuid_str)
    matchday_id: Mapped[str] = mapped_column(
        UUID_SQL,
        ForeignKey("matchdays.id", ondelete="CASCADE"),
        unique=True,
        index=True,
    )
    published_by_profile_id: Mapped[str | None] = mapped_column(
        UUID_SQL,
        ForeignKey("profiles.id", ondelete="SET NULL"),
        index=True,
    )
    published_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    notes: Mapped[str | None] = mapped_column(Text)


class HistoricalChampion(Base):
    __tablename__ = "historical_champions"

    id: Mapped[str] = mapped_column(UUID_SQL, primary_key=True, default=uuid_str)
    tournament_name: Mapped[str] = mapped_column(String(160), index=True)
    champion_name: Mapped[str] = mapped_column(String(160), index=True)
    awarded_profile_id: Mapped[str | None] = mapped_column(
        UUID_SQL,
        ForeignKey("profiles.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    place_label: Mapped[str] = mapped_column(String(80), nullable=False, default="Campeon", index=True)
    trophy_asset_id: Mapped[str | None] = mapped_column(
        UUID_SQL,
        ForeignKey("trophy_assets.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    image_url: Mapped[str | None] = mapped_column(Text)
    total_points: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
    )


class TrophyAsset(Base):
    __tablename__ = "trophy_assets"

    id: Mapped[str] = mapped_column(UUID_SQL, primary_key=True, default=uuid_str)
    name: Mapped[str] = mapped_column(String(160), nullable=False, index=True)
    category: Mapped[str] = mapped_column(String(80), nullable=False, default="Trofeo", index=True)
    asset_code: Mapped[str | None] = mapped_column(String(120), unique=True, index=True)
    season_id: Mapped[str | None] = mapped_column(
        UUID_SQL,
        ForeignKey("seasons.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    matchday_number: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)
    award_place_label: Mapped[str | None] = mapped_column(String(80), nullable=True, index=True)
    image_url: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
    )


class ProfileTrophyAward(Base):
    __tablename__ = "profile_trophy_awards"
    __table_args__ = (UniqueConstraint("source_type", "source_ref_id", name="uq_profile_trophy_awards_source"),)

    id: Mapped[str] = mapped_column(UUID_SQL, primary_key=True, default=uuid_str)
    profile_id: Mapped[str] = mapped_column(UUID_SQL, ForeignKey("profiles.id", ondelete="CASCADE"), index=True)
    trophy_asset_id: Mapped[str | None] = mapped_column(
        UUID_SQL,
        ForeignKey("trophy_assets.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    season_id: Mapped[str | None] = mapped_column(
        UUID_SQL,
        ForeignKey("seasons.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    matchday_id: Mapped[str | None] = mapped_column(
        UUID_SQL,
        ForeignKey("matchdays.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    tournament_name: Mapped[str | None] = mapped_column(String(160), index=True)
    place_label: Mapped[str] = mapped_column(String(80), nullable=False, default="Trofeo", index=True)
    total_points: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    source_type: Mapped[str] = mapped_column(String(80), nullable=False, default="manual", index=True)
    source_ref_id: Mapped[str | None] = mapped_column(UUID_SQL, nullable=True)
    awarded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
    )


class RulePage(Base):
    __tablename__ = "rules_pages"

    id: Mapped[str] = mapped_column(UUID_SQL, primary_key=True, default=uuid_str)
    slug: Mapped[str] = mapped_column(String(80), unique=True, index=True)
    title: Mapped[str] = mapped_column(String(160), nullable=False, default="Reglamento")
    content_markdown: Mapped[str] = mapped_column(Text, nullable=False, default="")
    version_label: Mapped[str | None] = mapped_column(String(60))
    updated_by_profile_id: Mapped[str | None] = mapped_column(
        UUID_SQL,
        ForeignKey("profiles.id", ondelete="SET NULL"),
        index=True,
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
    )


class SyncLog(Base):
    __tablename__ = "sync_logs"

    id: Mapped[str] = mapped_column(UUID_SQL, primary_key=True, default=uuid_str)
    provider_name: Mapped[str] = mapped_column(String(120), index=True)
    resource_type: Mapped[str] = mapped_column(String(120), index=True)
    status: Mapped[SyncStatus] = mapped_column(
        SqlEnum(SyncStatus, native_enum=False, values_callable=enum_values),
        nullable=False,
    )
    records_processed: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    error_message: Mapped[str | None] = mapped_column(Text)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    finished_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
