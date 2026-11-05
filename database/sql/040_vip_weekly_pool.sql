-- Quinielón Semanal uses the existing VIP memberships, entry fees and payouts.
-- The API enforces ten fixtures, one shared tiebreaker and per-fixture deadlines.
-- Run after the existing VIP tables have been created by the backend.
begin;

create table if not exists public.vip_weekly_matches (
  id uuid primary key default gen_random_uuid(),
  vip_competition_id uuid not null references public.vip_competitions(id) on delete cascade,
  sort_order integer not null,
  home_team varchar(160) not null,
  away_team varchar(160) not null,
  kickoff_at timestamptz not null,
  is_tiebreaker boolean not null default false,
  home_score integer,
  away_score integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uq_vip_weekly_match_order unique (vip_competition_id, sort_order),
  constraint ck_vip_weekly_match_order check (sort_order between 1 and 10),
  constraint ck_vip_weekly_match_scores check (
    (home_score is null and away_score is null) or
    (home_score is not null and away_score is not null and
     home_score between 0 and 99 and away_score between 0 and 99)
  )
);

create index if not exists ix_vip_weekly_matches_vip_competition_id
  on public.vip_weekly_matches(vip_competition_id);
create index if not exists idx_vip_weekly_matches_vip_kickoff
  on public.vip_weekly_matches(vip_competition_id, kickoff_at);

create table if not exists public.vip_weekly_picks (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.vip_weekly_matches(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  selection varchar(4) not null,
  total_goals integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uq_vip_weekly_pick_profile unique (match_id, profile_id),
  constraint ck_vip_weekly_pick_selection check (selection in ('home', 'draw', 'away')),
  constraint ck_vip_weekly_pick_total check (total_goals between 0 and 99)
);

create index if not exists ix_vip_weekly_picks_match_id
  on public.vip_weekly_picks(match_id);
create index if not exists idx_vip_weekly_picks_profile
  on public.vip_weekly_picks(profile_id);

-- All reads and writes use the authenticated backend, which checks membership,
-- administrator permissions and the server's clock. No direct client access.
alter table public.vip_weekly_matches enable row level security;
alter table public.vip_weekly_picks enable row level security;
revoke all on public.vip_weekly_matches, public.vip_weekly_picks from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on public.vip_weekly_matches, public.vip_weekly_picks from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on public.vip_weekly_matches, public.vip_weekly_picks from authenticated;
  end if;
end;
$$;

commit;
