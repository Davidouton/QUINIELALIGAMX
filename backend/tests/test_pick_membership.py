from decimal import Decimal

from app.models.entities import Profile, RoleCode, SeasonMembership, VipCompetition, VipCompetitionKind, VipCompetitionMatchday, VipMembership, VipMembershipStatus

from conftest import PROFILE_USER_ID, SEASON_ID, SessionLocal, USER_MEMBERSHIP_ID

VIP_ID = "80000000-0000-0000-0000-000000000001"
VIP_MATCHDAY_ID = "80000000-0000-0000-0000-000000000002"
VIP_USER_MEMBERSHIP_ID = "80000000-0000-0000-0000-000000000003"
VIP_ONLY_PROFILE_ID = "80000000-0000-0000-0000-000000000004"
VIP_ONLY_MEMBERSHIP_ID = "80000000-0000-0000-0000-000000000005"
VIP_REGULAR_ONLY_PROFILE_ID = "80000000-0000-0000-0000-000000000006"
VIP_REGULAR_ONLY_SEASON_MEMBERSHIP_ID = "80000000-0000-0000-0000-000000000007"


def test_user_cannot_create_pick_without_active_season_membership(client) -> None:
    db = SessionLocal()
    try:
        membership = db.get(SeasonMembership, USER_MEMBERSHIP_ID)
        assert membership is not None
        membership.is_active = False
        db.add(membership)
        db.commit()
    finally:
        db.close()

    response = client.post(
        "/api/v1/picks",
        json={
            "match_id": "50000000-0000-0000-0000-000000000001",
            "selection": "home",
            "predicted_home_score": 2,
            "predicted_away_score": 1,
        },
        headers={"Authorization": "Bearer test-token"},
    )

    assert response.status_code == 403
    assert response.json()["detail"] == "No estas dado de alta en este torneo. Pidele al admin que te active la temporada."


def test_global_picks_filters_players_by_regular_context(client) -> None:
    db = SessionLocal()
    try:
        vip_only_profile = Profile(
            id=VIP_ONLY_PROFILE_ID,
            auth_user_id="33333333-3333-3333-3333-333333333333",
            email="viponly@example.com",
            display_name="VIP Solo",
            role_code=RoleCode.USER,
            is_active=True,
        )
        vip = VipCompetition(
            id=VIP_ID,
            season_id=SEASON_ID,
            competition_kind=VipCompetitionKind.MATCHDAY,
            name="VIP Premium",
            entry_fee_amount=Decimal("0.00"),
        )
        vip_matchday = VipCompetitionMatchday(
            id=VIP_MATCHDAY_ID,
            vip_competition_id=VIP_ID,
            matchday_id="30000000-0000-0000-0000-000000000001",
        )
        vip_user_membership = VipMembership(
            id=VIP_USER_MEMBERSHIP_ID,
            vip_competition_id=VIP_ID,
            profile_id=PROFILE_USER_ID,
            status=VipMembershipStatus.APPROVED,
            is_paid=True,
        )
        vip_only_membership = VipMembership(
            id=VIP_ONLY_MEMBERSHIP_ID,
            vip_competition_id=VIP_ID,
            profile_id=VIP_ONLY_PROFILE_ID,
            status=VipMembershipStatus.APPROVED,
            is_paid=True,
        )
        db.add_all([vip_only_profile, vip, vip_matchday, vip_user_membership, vip_only_membership])
        db.commit()
    finally:
        db.close()

    response = client.get(
        f"/api/v1/global-picks?matchday_id=30000000-0000-0000-0000-000000000001&context_type=season&context_id={SEASON_ID}",
        headers={"Authorization": "Bearer test-token"},
    )

    assert response.status_code == 200
    players = {player["display_name"] for player in response.json()["players"]}
    assert players == {"Usuario Demo", "Lider Semanal"}


def test_global_picks_filters_players_by_vip_context(client) -> None:
    db = SessionLocal()
    try:
        vip_only_profile = Profile(
            id=VIP_ONLY_PROFILE_ID,
            auth_user_id="33333333-3333-3333-3333-333333333333",
            email="viponly@example.com",
            display_name="VIP Solo",
            role_code=RoleCode.USER,
            is_active=True,
        )
        regular_only_profile = Profile(
            id=VIP_REGULAR_ONLY_PROFILE_ID,
            auth_user_id="44444444-4444-4444-4444-444444444444",
            email="regularonly@example.com",
            display_name="Regular Solo",
            role_code=RoleCode.USER,
            is_active=True,
        )
        regular_only_membership = SeasonMembership(
            id=VIP_REGULAR_ONLY_SEASON_MEMBERSHIP_ID,
            season_id=SEASON_ID,
            profile_id=VIP_REGULAR_ONLY_PROFILE_ID,
            is_active=True,
            is_paid=True,
        )
        vip = VipCompetition(
            id=VIP_ID,
            season_id=SEASON_ID,
            competition_kind=VipCompetitionKind.MATCHDAY,
            name="VIP Premium",
            entry_fee_amount=Decimal("0.00"),
        )
        vip_matchday = VipCompetitionMatchday(
            id=VIP_MATCHDAY_ID,
            vip_competition_id=VIP_ID,
            matchday_id="30000000-0000-0000-0000-000000000001",
        )
        vip_user_membership = VipMembership(
            id=VIP_USER_MEMBERSHIP_ID,
            vip_competition_id=VIP_ID,
            profile_id=PROFILE_USER_ID,
            status=VipMembershipStatus.APPROVED,
            is_paid=True,
        )
        vip_only_membership = VipMembership(
            id=VIP_ONLY_MEMBERSHIP_ID,
            vip_competition_id=VIP_ID,
            profile_id=VIP_ONLY_PROFILE_ID,
            status=VipMembershipStatus.APPROVED,
            is_paid=True,
        )
        db.add_all(
            [
                vip_only_profile,
                regular_only_profile,
                regular_only_membership,
                vip,
                vip_matchday,
                vip_user_membership,
                vip_only_membership,
            ]
        )
        db.commit()
    finally:
        db.close()

    response = client.get(
        f"/api/v1/global-picks?matchday_id=30000000-0000-0000-0000-000000000001&context_type=vip&context_id={VIP_ID}",
        headers={"Authorization": "Bearer test-token"},
    )

    assert response.status_code == 200
    players = {player["display_name"] for player in response.json()["players"]}
    assert players == {"Usuario Demo", "VIP Solo"}


def test_global_picks_defaults_to_vip_when_regular_membership_is_inactive(client) -> None:
    db = SessionLocal()
    try:
        membership = db.get(SeasonMembership, USER_MEMBERSHIP_ID)
        assert membership is not None
        membership.is_active = False

        vip_only_profile = Profile(
            id=VIP_ONLY_PROFILE_ID,
            auth_user_id="33333333-3333-3333-3333-333333333333",
            email="viponly@example.com",
            display_name="VIP Solo",
            role_code=RoleCode.USER,
            is_active=True,
        )
        vip = VipCompetition(
            id=VIP_ID,
            season_id=SEASON_ID,
            competition_kind=VipCompetitionKind.MATCHDAY,
            name="VIP Premium",
            entry_fee_amount=Decimal("0.00"),
        )
        vip_matchday = VipCompetitionMatchday(
            id=VIP_MATCHDAY_ID,
            vip_competition_id=VIP_ID,
            matchday_id="30000000-0000-0000-0000-000000000001",
        )
        vip_user_membership = VipMembership(
            id=VIP_USER_MEMBERSHIP_ID,
            vip_competition_id=VIP_ID,
            profile_id=PROFILE_USER_ID,
            status=VipMembershipStatus.APPROVED,
            is_paid=True,
        )
        vip_only_membership = VipMembership(
            id=VIP_ONLY_MEMBERSHIP_ID,
            vip_competition_id=VIP_ID,
            profile_id=VIP_ONLY_PROFILE_ID,
            status=VipMembershipStatus.APPROVED,
            is_paid=True,
        )
        db.add_all([membership, vip_only_profile, vip, vip_matchday, vip_user_membership, vip_only_membership])
        db.commit()
    finally:
        db.close()

    response = client.get(
        "/api/v1/global-picks?matchday_id=30000000-0000-0000-0000-000000000001",
        headers={"Authorization": "Bearer test-token"},
    )

    assert response.status_code == 200
    players = {player["display_name"] for player in response.json()["players"]}
    assert players == {"Usuario Demo", "VIP Solo"}
