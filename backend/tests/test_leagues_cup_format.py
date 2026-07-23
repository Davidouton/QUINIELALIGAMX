from types import SimpleNamespace

from app.models.entities import MatchStageType
from app.services.world_cup_service import WorldCupService


def test_leagues_cup_builds_separate_tables_and_scores_shootouts() -> None:
    teams = {
        "mls-1": SimpleNamespace(
            id="mls-1", name="MLS One", short_name="M1", crest_url=None, competition_id="mls"
        ),
        "lmx-1": SimpleNamespace(
            id="lmx-1", name="Liga MX One", short_name="L1", crest_url=None, competition_id="lmx"
        ),
    }
    links = [
        SimpleNamespace(team_id="mls-1", division_name="MLS"),
        SimpleNamespace(team_id="lmx-1", division_name="LIGA MX"),
    ]
    matches = [
        SimpleNamespace(
            id="phase-one",
            stage_type=MatchStageType.REGULAR,
            home_team_id="mls-1",
            away_team_id="lmx-1",
        ),
        SimpleNamespace(
            id="quarterfinal",
            stage_type=MatchStageType.QUARTERFINAL,
            home_team_id="mls-1",
            away_team_id="lmx-1",
        ),
    ]
    results = {
        "phase-one": SimpleNamespace(
            is_official=True,
            home_score=1,
            away_score=1,
            advancing_team_id="mls-1",
        ),
        "quarterfinal": SimpleNamespace(
            is_official=True,
            home_score=4,
            away_score=0,
            advancing_team_id="mls-1",
        ),
    }

    tables = WorldCupService._build_leagues_cup_tables(
        matches,
        results,
        teams,
        links,
        {"mls": "MLS", "lmx": "LIGA MX"},
    )

    by_league = {table.league_label: table.standings[0] for table in tables}
    assert by_league["MLS"].played == 1
    assert by_league["MLS"].points == 2
    assert by_league["MLS"].recent_form == ["shootout_win"]
    assert by_league["LIGA MX"].played == 1
    assert by_league["LIGA MX"].points == 1
    assert by_league["LIGA MX"].recent_form == ["shootout_loss"]
