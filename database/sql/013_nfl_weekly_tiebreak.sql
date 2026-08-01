ALTER TABLE matchdays
ADD COLUMN IF NOT EXISTS tiebreak_match_id UUID;

CREATE INDEX IF NOT EXISTS idx_matchdays_tiebreak_match
ON matchdays(tiebreak_match_id);

CREATE TABLE IF NOT EXISTS weekly_tiebreak_picks (
  id UUID PRIMARY KEY,
  matchday_id UUID NOT NULL REFERENCES matchdays(id) ON DELETE CASCADE,
  profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  predicted_total INTEGER NOT NULL CHECK (predicted_total >= 0 AND predicted_total <= 300),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  CONSTRAINT uq_weekly_tiebreak_pick UNIQUE (matchday_id, profile_id)
);

CREATE INDEX IF NOT EXISTS idx_weekly_tiebreak_matchday
ON weekly_tiebreak_picks(matchday_id);

CREATE INDEX IF NOT EXISTS idx_weekly_tiebreak_profile
ON weekly_tiebreak_picks(profile_id);

ALTER TABLE standings_matchday
ADD COLUMN IF NOT EXISTS tiebreak_difference INTEGER;
