CREATE TABLE IF NOT EXISTS competition_teams (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  competition_id UUID NOT NULL REFERENCES competitions(id) ON DELETE CASCADE,
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  CONSTRAINT uq_competition_teams_competition_team UNIQUE (competition_id, team_id)
);

CREATE TABLE IF NOT EXISTS season_teams (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  season_id UUID NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  conference_name VARCHAR(80),
  division_name VARCHAR(80),
  group_label VARCHAR(32),
  seed INTEGER,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  CONSTRAINT uq_season_teams_season_team UNIQUE (season_id, team_id)
);

CREATE INDEX IF NOT EXISTS idx_competition_teams_competition_id ON competition_teams(competition_id);
CREATE INDEX IF NOT EXISTS idx_competition_teams_team_id ON competition_teams(team_id);
CREATE INDEX IF NOT EXISTS idx_season_teams_season_id ON season_teams(season_id);
CREATE INDEX IF NOT EXISTS idx_season_teams_team_id ON season_teams(team_id);

INSERT INTO competition_teams (competition_id, team_id)
SELECT competition_id, id
FROM teams
WHERE competition_id IS NOT NULL
ON CONFLICT (competition_id, team_id) DO NOTHING;

INSERT INTO season_teams (season_id, team_id)
SELECT seasons.id, competition_teams.team_id
FROM seasons
JOIN competition_teams ON competition_teams.competition_id = seasons.competition_id
ON CONFLICT (season_id, team_id) DO NOTHING;
