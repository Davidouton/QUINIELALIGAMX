-- Script 01_GetODDS target table (Supabase/PostgreSQL / The Odds API)

CREATE TABLE IF NOT EXISTS public.lmx_odds_5d (
  id BIGSERIAL PRIMARY KEY,
  pulled_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  snapshot_date DATE NOT NULL,
  window_start DATE NOT NULL,
  window_end DATE NOT NULL,
  provider_name TEXT NOT NULL DEFAULT 'the_odds_api',
  fixture_id TEXT NOT NULL,
  match_date TIMESTAMPTZ NOT NULL,
  home_team TEXT NOT NULL,
  away_team TEXT NOT NULL,
  home_code TEXT,
  away_code TEXT,
  source_match_key TEXT,
  bookmaker_name TEXT NOT NULL,
  ml_home NUMERIC(10,3),
  ml_draw NUMERIC(10,3),
  ml_away NUMERIC(10,3),
  spread_home_line NUMERIC(10,3),
  spread_home_odds NUMERIC(10,3),
  spread_away_line NUMERIC(10,3),
  spread_away_odds NUMERIC(10,3),
  total_line NUMERIC(10,3),
  over_value NUMERIC(10,3),
  under_value NUMERIC(10,3),
  btts_yes NUMERIC(10,3),
  over_1_5 NUMERIC(10,3),
  over_2_5 NUMERIC(10,3),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (snapshot_date, fixture_id, bookmaker_name)
);

CREATE INDEX IF NOT EXISTS idx_lmx_odds_5d_match_date
  ON public.lmx_odds_5d (match_date);

CREATE INDEX IF NOT EXISTS idx_lmx_odds_5d_fixture_id
  ON public.lmx_odds_5d (fixture_id);

CREATE INDEX IF NOT EXISTS idx_lmx_odds_5d_source_match_key
  ON public.lmx_odds_5d (source_match_key);
