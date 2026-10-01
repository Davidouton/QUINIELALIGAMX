begin;
create table if not exists public.nfp_games (
 game_id text primary key, season integer not null, week integer not null check(week between 1 and 22),
 kickoff_at timestamptz, home_team text not null, away_team text not null,
 payload jsonb not null, updated_at timestamptz not null default now(),
 unique(season, week, home_team, away_team), check(home_team <> away_team)
);
create table if not exists public.nfp_team_metrics (
 season integer not null, game_id text not null, team text not null, payload jsonb not null,
 updated_at timestamptz not null default now(), primary key(season, game_id, team)
);
create table if not exists public.nfp_runs (
 id uuid primary key, status text not null check(status in ('running','complete','failed','skipped')),
 started_at timestamptz not null default now(), finished_at timestamptz,
 stage text not null default 'starting', details jsonb not null default '{}'::jsonb
);
create table if not exists public.nfp_odds (
 run_id uuid not null references public.nfp_runs(id), game_id text not null references public.nfp_games(game_id),
 captured_at timestamptz not null, bookmaker text not null, payload jsonb not null,
 primary key(run_id, game_id)
);
create table if not exists public.nfp_predictions (
 run_id uuid not null references public.nfp_runs(id), game_id text not null references public.nfp_games(game_id),
 season integer not null, week integer not null, payload jsonb not null,
 bets jsonb not null, primary key(run_id, game_id)
);
create index if not exists nfp_predictions_week on public.nfp_predictions(season, week);
create index if not exists nfp_runs_recent on public.nfp_runs(started_at desc);
alter table public.nfp_games enable row level security;
alter table public.nfp_team_metrics enable row level security;
alter table public.nfp_runs enable row level security;
alter table public.nfp_odds enable row level security;
alter table public.nfp_predictions enable row level security;
-- All access is through the authenticated backend. No browser database credentials.
revoke all on public.nfp_games, public.nfp_team_metrics, public.nfp_runs, public.nfp_odds, public.nfp_predictions from public;
do $$ begin
 if exists(select 1 from pg_roles where rolname='anon') then
  revoke all on public.nfp_games, public.nfp_team_metrics, public.nfp_runs, public.nfp_odds, public.nfp_predictions from anon;
 end if;
 if exists(select 1 from pg_roles where rolname='authenticated') then
  revoke all on public.nfp_games, public.nfp_team_metrics, public.nfp_runs, public.nfp_odds, public.nfp_predictions from authenticated;
 end if;
end $$;
commit;
