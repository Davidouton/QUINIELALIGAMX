from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import JSON, Date, DateTime, ForeignKey, Integer, Numeric, String, Text, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base
from app.models.entities import UUID_SQL, uuid_str


class QuinielaPlusStatsSnapshot(Base):
    __tablename__ = "quiniela_plus_stats_snapshots"

    id: Mapped[str] = mapped_column(UUID_SQL, primary_key=True, default=uuid_str)
    source_name: Mapped[str] = mapped_column(String(80), default="football_md", nullable=False, index=True)
    competition_id: Mapped[str] = mapped_column(String(80), index=True)
    generated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), index=True)
    window_start: Mapped[date | None] = mapped_column(Date, index=True)
    window_end: Mapped[date | None] = mapped_column(Date, index=True)
    fixture_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    payload_json: Mapped[dict | None] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)


class QuinielaPlusStatsMatch(Base):
    __tablename__ = "quiniela_plus_stats_matches"
    __table_args__ = (UniqueConstraint("snapshot_id", "fixture_id", name="uq_qp_stats_snapshot_fixture"),)

    id: Mapped[str] = mapped_column(UUID_SQL, primary_key=True, default=uuid_str)
    snapshot_id: Mapped[str] = mapped_column(
        UUID_SQL,
        ForeignKey("quiniela_plus_stats_snapshots.id", ondelete="CASCADE"),
        index=True,
    )
    match_id: Mapped[str | None] = mapped_column(UUID_SQL, ForeignKey("matches.id", ondelete="SET NULL"), index=True)
    fixture_id: Mapped[str] = mapped_column(String(80), index=True)
    match_date: Mapped[date | None] = mapped_column(Date, index=True)
    kickoff_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), index=True)
    round_label: Mapped[str | None] = mapped_column(String(40))
    group_label: Mapped[str | None] = mapped_column(String(40))
    home_name: Mapped[str] = mapped_column(String(160), index=True)
    away_name: Mapped[str] = mapped_column(String(160), index=True)
    home_win_prob: Mapped[Decimal | None] = mapped_column(Numeric(8, 4))
    draw_prob: Mapped[Decimal | None] = mapped_column(Numeric(8, 4))
    away_win_prob: Mapped[Decimal | None] = mapped_column(Numeric(8, 4))
    xg_home: Mapped[Decimal | None] = mapped_column(Numeric(8, 4))
    xg_away: Mapped[Decimal | None] = mapped_column(Numeric(8, 4))
    most_likely_score: Mapped[str | None] = mapped_column(String(16))
    most_likely_score_prob: Mapped[Decimal | None] = mapped_column(Numeric(8, 4))
    btts_prob: Mapped[Decimal | None] = mapped_column(Numeric(8, 4))
    over_1_5_prob: Mapped[Decimal | None] = mapped_column(Numeric(8, 4))
    over_2_5_prob: Mapped[Decimal | None] = mapped_column(Numeric(8, 4))
    over_3_5_prob: Mapped[Decimal | None] = mapped_column(Numeric(8, 4))
    scoreline_probabilities: Mapped[dict | None] = mapped_column(JSON)
    payload_json: Mapped[dict | None] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class QuinielaPlusValueRecommendation(Base):
    __tablename__ = "quiniela_plus_value_recommendations"

    id: Mapped[str] = mapped_column(UUID_SQL, primary_key=True, default=uuid_str)
    snapshot_id: Mapped[str] = mapped_column(
        UUID_SQL,
        ForeignKey("quiniela_plus_stats_snapshots.id", ondelete="CASCADE"),
        index=True,
    )
    stats_match_id: Mapped[str] = mapped_column(
        UUID_SQL,
        ForeignKey("quiniela_plus_stats_matches.id", ondelete="CASCADE"),
        index=True,
    )
    match_id: Mapped[str | None] = mapped_column(UUID_SQL, ForeignKey("matches.id", ondelete="SET NULL"), index=True)
    fixture_id: Mapped[str] = mapped_column(String(80), index=True)
    market_key: Mapped[str] = mapped_column(String(40), index=True)
    selection_key: Mapped[str] = mapped_column(String(40), index=True)
    line_value: Mapped[Decimal | None] = mapped_column(Numeric(8, 3))
    model_probability: Mapped[Decimal | None] = mapped_column(Numeric(8, 4))
    market_probability: Mapped[Decimal | None] = mapped_column(Numeric(8, 4))
    market_odds: Mapped[Decimal | None] = mapped_column(Numeric(10, 3))
    fair_odds_decimal: Mapped[Decimal | None] = mapped_column(Numeric(10, 3))
    edge_probability: Mapped[Decimal | None] = mapped_column(Numeric(8, 4), index=True)
    confidence_label: Mapped[str] = mapped_column(String(40), default="watch", nullable=False, index=True)
    recommendation: Mapped[str] = mapped_column(String(40), default="paper", nullable=False, index=True)
    reason: Mapped[str | None] = mapped_column(Text)
    payload_json: Mapped[dict | None] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)
