from dataclasses import dataclass
from typing import Literal

MatchStatus = Literal["finished", "scheduled"]


@dataclass(frozen=True)
class TeamData:
    id: int
    name: str
    short_name: str


@dataclass(frozen=True)
class MatchData:
    id: int
    matchday: int
    home_team_id: int
    away_team_id: int
    home_score: int | None
    away_score: int | None
    status: MatchStatus
    kickoff_utc: str


TEAMS: tuple[TeamData, ...] = (
    TeamData(id=1, name="America", short_name="AME"),
    TeamData(id=2, name="Chivas", short_name="CHI"),
    TeamData(id=3, name="Tigres", short_name="TIG"),
    TeamData(id=4, name="Monterrey", short_name="MTY"),
    TeamData(id=5, name="Cruz Azul", short_name="CAZ"),
    TeamData(id=6, name="Pumas", short_name="PUM"),
)

MATCHES: tuple[MatchData, ...] = (
    MatchData(
        id=1,
        matchday=1,
        home_team_id=1,
        away_team_id=2,
        home_score=2,
        away_score=1,
        status="finished",
        kickoff_utc="2026-01-10T01:00:00Z",
    ),
    MatchData(
        id=2,
        matchday=1,
        home_team_id=3,
        away_team_id=4,
        home_score=1,
        away_score=1,
        status="finished",
        kickoff_utc="2026-01-10T03:00:00Z",
    ),
    MatchData(
        id=3,
        matchday=1,
        home_team_id=5,
        away_team_id=6,
        home_score=0,
        away_score=1,
        status="finished",
        kickoff_utc="2026-01-11T01:00:00Z",
    ),
    MatchData(
        id=4,
        matchday=2,
        home_team_id=2,
        away_team_id=6,
        home_score=3,
        away_score=0,
        status="finished",
        kickoff_utc="2026-01-17T01:00:00Z",
    ),
    MatchData(
        id=5,
        matchday=2,
        home_team_id=4,
        away_team_id=5,
        home_score=2,
        away_score=2,
        status="finished",
        kickoff_utc="2026-01-17T03:00:00Z",
    ),
    MatchData(
        id=6,
        matchday=2,
        home_team_id=1,
        away_team_id=3,
        home_score=1,
        away_score=0,
        status="finished",
        kickoff_utc="2026-01-18T01:00:00Z",
    ),
    MatchData(
        id=7,
        matchday=3,
        home_team_id=6,
        away_team_id=1,
        home_score=None,
        away_score=None,
        status="scheduled",
        kickoff_utc="2026-01-24T01:00:00Z",
    ),
    MatchData(
        id=8,
        matchday=3,
        home_team_id=3,
        away_team_id=5,
        home_score=None,
        away_score=None,
        status="scheduled",
        kickoff_utc="2026-01-24T03:00:00Z",
    ),
    MatchData(
        id=9,
        matchday=3,
        home_team_id=4,
        away_team_id=2,
        home_score=None,
        away_score=None,
        status="scheduled",
        kickoff_utc="2026-01-25T01:00:00Z",
    ),
)
