ALTER TABLE competitions
  ADD COLUMN IF NOT EXISTS structure_format VARCHAR(32) NOT NULL DEFAULT 'league_table';

ALTER TABLE competitions
  ADD COLUMN IF NOT EXISTS structure_config JSON NOT NULL DEFAULT '{}';

ALTER TABLE seasons
  ADD COLUMN IF NOT EXISTS structure_format VARCHAR(32) NOT NULL DEFAULT 'league_table';

ALTER TABLE seasons
  ADD COLUMN IF NOT EXISTS structure_config JSON NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_competitions_structure_format
  ON competitions(structure_format);

CREATE INDEX IF NOT EXISTS idx_seasons_structure_format
  ON seasons(structure_format);

UPDATE seasons
SET structure_format = 'groups_playoff'
WHERE tournament_format = 'world_cup'
  AND structure_format = 'league_table';

UPDATE competitions
SET structure_format = 'groups_playoff'
WHERE structure_format = 'league_table'
  AND id IN (
    SELECT competition_id
    FROM seasons
    WHERE tournament_format = 'world_cup'
      AND competition_id IS NOT NULL
  );
