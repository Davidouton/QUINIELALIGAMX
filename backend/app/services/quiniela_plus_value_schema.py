from sqlalchemy import text


QUINIELA_PLUS_VALUE_SCHEMA_SQL = """
create extension if not exists pgcrypto;

create table if not exists public.quiniela_plus_stats_snapshots (
  id uuid primary key default gen_random_uuid(),
  source_name text not null default 'football_md',
  competition_id text,
  generated_at timestamptz,
  window_start date,
  window_end date,
  fixture_count integer not null default 0,
  payload_json jsonb default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.quiniela_plus_stats_matches (
  id uuid primary key default gen_random_uuid(),
  snapshot_id uuid not null references public.quiniela_plus_stats_snapshots(id) on delete cascade,
  match_id uuid references public.matches(id) on delete set null,
  fixture_id text not null,
  match_date date,
  kickoff_at timestamptz,
  round_label text,
  group_label text,
  home_name text not null,
  away_name text not null,
  home_win_prob numeric(8,4),
  draw_prob numeric(8,4),
  away_win_prob numeric(8,4),
  xg_home numeric(8,4),
  xg_away numeric(8,4),
  most_likely_score text,
  most_likely_score_prob numeric(8,4),
  btts_prob numeric(8,4),
  over_1_5_prob numeric(8,4),
  over_2_5_prob numeric(8,4),
  over_3_5_prob numeric(8,4),
  scoreline_probabilities jsonb default '{}'::jsonb,
  payload_json jsonb default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  constraint uq_qp_stats_snapshot_fixture unique (snapshot_id, fixture_id)
);

create table if not exists public.quiniela_plus_value_recommendations (
  id uuid primary key default gen_random_uuid(),
  snapshot_id uuid not null references public.quiniela_plus_stats_snapshots(id) on delete cascade,
  stats_match_id uuid not null references public.quiniela_plus_stats_matches(id) on delete cascade,
  match_id uuid references public.matches(id) on delete set null,
  fixture_id text not null,
  market_key text not null,
  selection_key text not null,
  line_value numeric(8,3),
  model_probability numeric(8,4),
  market_probability numeric(8,4),
  market_odds numeric(10,3),
  fair_odds_decimal numeric(10,3),
  edge_probability numeric(8,4),
  confidence_label text not null default 'watch',
  recommendation text not null default 'paper',
  reason text,
  payload_json jsonb default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists idx_qp_stats_snapshots_created_at
  on public.quiniela_plus_stats_snapshots(created_at desc);
create index if not exists idx_qp_stats_snapshots_window
  on public.quiniela_plus_stats_snapshots(window_start, window_end);
create index if not exists idx_qp_stats_matches_fixture
  on public.quiniela_plus_stats_matches(fixture_id);
create index if not exists idx_qp_stats_matches_kickoff
  on public.quiniela_plus_stats_matches(kickoff_at);
create index if not exists idx_qp_stats_matches_match_id
  on public.quiniela_plus_stats_matches(match_id);
create index if not exists idx_qp_value_snapshot
  on public.quiniela_plus_value_recommendations(snapshot_id);
create index if not exists idx_qp_value_fixture_market
  on public.quiniela_plus_value_recommendations(fixture_id, market_key);
create index if not exists idx_qp_value_edge
  on public.quiniela_plus_value_recommendations(edge_probability desc);
create index if not exists idx_qp_value_recommendation
  on public.quiniela_plus_value_recommendations(recommendation, confidence_label);
"""


def ensure_quiniela_plus_value_tables(connection) -> None:
    for statement in QUINIELA_PLUS_VALUE_SCHEMA_SQL.split(";"):
        statement = statement.strip()
        if statement:
            connection.execute(text(statement))
