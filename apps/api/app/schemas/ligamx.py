from pydantic import BaseModel, Field


class TeamOut(BaseModel):
    id: int
    name: str
    short_name: str


class MatchOut(BaseModel):
    id: int
    matchday: int = Field(ge=1)
    home_team_id: int
    away_team_id: int
    home_team_name: str
    away_team_name: str
    home_score: int | None
    away_score: int | None
    status: str
    kickoff_utc: str


class StandingRow(BaseModel):
    position: int = Field(ge=1)
    team_id: int
    team_name: str
    played: int
    wins: int
    draws: int
    losses: int
    goals_for: int
    goals_against: int
    goal_difference: int
    points: int
