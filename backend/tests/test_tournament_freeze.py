from datetime import UTC, datetime, timedelta

from app.models.entities import MatchResult, PickPoint, PickSelection, Season, SeasonMembership, UserPick
from app.services.scoring_service import ScoringService

from conftest import (
    LEADER_MEMBERSHIP_ID,
    MATCHDAY_ID,
    MATCH_ONE_ID,
    PROFILE_LEADER_ID,
    PROFILE_USER_ID,
    SEASON_ID,
    SessionLocal,
    USER_MEMBERSHIP_ID,
)


def test_scoring_only_counts_eligible_members_frozen_at_tournament_start() -> None:
    db = SessionLocal()
    try:
        season = db.get(Season, SEASON_ID)
        assert season is not None
        season.start_matchday_id = MATCHDAY_ID
        season.participants_lock_at = datetime.now(UTC) - timedelta(minutes=5)
        db.add(season)

        user_membership = db.get(SeasonMembership, USER_MEMBERSHIP_ID)
        leader_membership = db.get(SeasonMembership, LEADER_MEMBERSHIP_ID)
        assert user_membership is not None
        assert leader_membership is not None
        user_membership.is_active = True
        leader_membership.is_active = False
        db.add(user_membership)
        db.add(leader_membership)

        db.add(
            UserPick(
                profile_id=PROFILE_USER_ID,
                match_id=MATCH_ONE_ID,
                selection=PickSelection.HOME,
                predicted_home_score=2,
                predicted_away_score=1,
            )
        )
        db.add(
            UserPick(
                profile_id=PROFILE_LEADER_ID,
                match_id=MATCH_ONE_ID,
                selection=PickSelection.HOME,
                predicted_home_score=2,
                predicted_away_score=1,
            )
        )
        db.add(
            MatchResult(
                match_id=MATCH_ONE_ID,
                home_score=2,
                away_score=1,
                is_official=True,
            )
        )
        db.commit()

        summary = ScoringService().recalculate(db)
        db.refresh(user_membership)
        db.refresh(leader_membership)
    finally:
        db.close()

    assert summary["evaluated_picks"] == 1
    assert user_membership.eligible_for_scoring is True
    assert leader_membership.eligible_for_scoring is False

    db = SessionLocal()
    try:
        pick_points = db.query(PickPoint).filter_by(profile_id=PROFILE_USER_ID).all()
        leader_points = db.query(PickPoint).filter_by(profile_id=PROFILE_LEADER_ID).all()
    finally:
        db.close()

    assert len(pick_points) == 1
    assert len(leader_points) == 0
