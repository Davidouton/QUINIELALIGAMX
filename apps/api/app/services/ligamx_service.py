from app.data.mock_ligamx import MATCHES, TEAMS, MatchData
from app.schemas.ligamx import MatchOut, StandingRow, TeamOut

TEAM_MAP = {team.id: team for team in TEAMS}


def list_teams() -> list[TeamOut]:
    return [TeamOut(id=team.id, name=team.name, short_name=team.short_name) for team in TEAMS]


def get_team(team_id: int) -> TeamOut | None:
    team = TEAM_MAP.get(team_id)
    if team is None:
        return None
    return TeamOut(id=team.id, name=team.name, short_name=team.short_name)


def list_matches(matchday: int | None = None, status: str | None = None) -> list[MatchOut]:
    filtered_matches = MATCHES
    if matchday is not None:
        filtered_matches = tuple(match for match in filtered_matches if match.matchday == matchday)
    if status is not None:
        filtered_matches = tuple(match for match in filtered_matches if match.status == status)

    return [to_match_out(match) for match in filtered_matches]


def to_match_out(match: MatchData) -> MatchOut:
    return MatchOut(
        id=match.id,
        matchday=match.matchday,
        home_team_id=match.home_team_id,
        away_team_id=match.away_team_id,
        home_team_name=TEAM_MAP[match.home_team_id].name,
        away_team_name=TEAM_MAP[match.away_team_id].name,
        home_score=match.home_score,
        away_score=match.away_score,
        status=match.status,
        kickoff_utc=match.kickoff_utc,
    )


def build_standings(matchday: int | None = None) -> list[StandingRow]:
    table = {
        team.id: {
            "team_id": team.id,
            "team_name": team.name,
            "played": 0,
            "wins": 0,
            "draws": 0,
            "losses": 0,
            "goals_for": 0,
            "goals_against": 0,
            "goal_difference": 0,
            "points": 0,
        }
        for team in TEAMS
    }

    for match in MATCHES:
        if match.status != "finished":
            continue
        if matchday is not None and match.matchday > matchday:
            continue
        if match.home_score is None or match.away_score is None:
            continue

        home = table[match.home_team_id]
        away = table[match.away_team_id]

        home["played"] += 1
        away["played"] += 1
        home["goals_for"] += match.home_score
        home["goals_against"] += match.away_score
        away["goals_for"] += match.away_score
        away["goals_against"] += match.home_score

        if match.home_score > match.away_score:
            home["wins"] += 1
            home["points"] += 3
            away["losses"] += 1
        elif match.home_score < match.away_score:
            away["wins"] += 1
            away["points"] += 3
            home["losses"] += 1
        else:
            home["draws"] += 1
            away["draws"] += 1
            home["points"] += 1
            away["points"] += 1

    rows = []
    for row in table.values():
        row["goal_difference"] = row["goals_for"] - row["goals_against"]
        rows.append(row)

    rows.sort(
        key=lambda row: (
            -row["points"],
            -row["goal_difference"],
            -row["goals_for"],
            row["team_name"],
        )
    )

    standings = []
    for index, row in enumerate(rows, start=1):
        standings.append(StandingRow(position=index, **row))

    return standings
