create extension if not exists pgcrypto;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'app_role') then
    create type public.app_role as enum ('master_admin', 'admin', 'user');
  end if;
  if not exists (select 1 from pg_type where typname = 'matchday_status') then
    create type public.matchday_status as enum ('draft', 'active', 'closed', 'published');
  end if;
  if not exists (select 1 from pg_type where typname = 'match_status') then
    create type public.match_status as enum ('scheduled', 'final', 'postponed', 'cancelled');
  end if;
  if not exists (select 1 from pg_type where typname = 'pick_selection') then
    create type public.pick_selection as enum ('home', 'draw', 'away');
  end if;
  if not exists (select 1 from pg_type where typname = 'sync_status') then
    create type public.sync_status as enum ('success', 'failed');
  end if;
end $$;

create table if not exists public.roles (
  code public.app_role primary key,
  label text not null,
  created_at timestamptz not null default timezone('utc', now())
);

insert into public.roles (code, label)
values
  ('master_admin', 'Master Admin'),
  ('admin', 'Admin'),
  ('user', 'Usuario General')
on conflict (code) do nothing;

create table if not exists public.profiles (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null unique references auth.users(id) on delete cascade,
  email text unique,
  display_name text not null,
  role_code public.app_role not null default 'user' references public.roles(code),
  is_active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.seasons (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  is_active boolean not null default false,
  start_matchday_id uuid,
  end_matchday_id uuid,
  participants_lock_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.matchdays (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references public.seasons(id) on delete cascade,
  number integer not null check (number > 0),
  name text not null,
  default_lock_offset_minutes integer not null default 10,
  picks_reopened_override boolean not null default false,
  status public.matchday_status not null default 'draft',
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (season_id, number)
);

create table if not exists public.teams (
  id uuid primary key default gen_random_uuid(),
  external_id text unique,
  name text not null,
  short_name text not null,
  slug text not null unique,
  crest_url text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.matches (
  id uuid primary key default gen_random_uuid(),
  matchday_id uuid not null references public.matchdays(id) on delete cascade,
  external_id text unique,
  home_team_id uuid not null references public.teams(id) on delete restrict,
  away_team_id uuid not null references public.teams(id) on delete restrict,
  kickoff_at timestamptz not null,
  picks_lock_at timestamptz not null,
  venue text,
  status public.match_status not null default 'scheduled',
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint matches_home_away_diff check (home_team_id <> away_team_id)
);

create table if not exists public.odds (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches(id) on delete cascade,
  provider_name text not null,
  home_value numeric(10,2),
  draw_value numeric(10,2),
  away_value numeric(10,2),
  synced_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.match_results (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null unique references public.matches(id) on delete cascade,
  home_score integer not null check (home_score >= 0),
  away_score integer not null check (away_score >= 0),
  is_official boolean not null default false,
  source_provider_name text,
  source_external_id text,
  source_updated_at timestamptz,
  last_synced_at timestamptz,
  is_manual_override boolean not null default false,
  updated_by_profile_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.user_picks (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  match_id uuid not null references public.matches(id) on delete cascade,
  selection public.pick_selection not null,
  predicted_home_score integer not null check (predicted_home_score >= 0),
  predicted_away_score integer not null check (predicted_away_score >= 0),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (profile_id, match_id)
);

create table if not exists public.scoring_rules (
  id uuid primary key default gen_random_uuid(),
  rule_key text not null unique,
  points integer not null,
  is_active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.season_memberships (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references public.seasons(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  is_active boolean not null default false,
  is_paid boolean not null default false,
  eligible_for_scoring boolean not null default false,
  activated_at timestamptz,
  eligible_locked_at timestamptz,
  activated_by_profile_id uuid references public.profiles(id) on delete set null,
  notes text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (season_id, profile_id)
);

create table if not exists public.pick_points (
  id uuid primary key default gen_random_uuid(),
  pick_id uuid not null unique references public.user_picks(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  match_id uuid not null references public.matches(id) on delete cascade,
  matchday_id uuid not null references public.matchdays(id) on delete cascade,
  result_points integer not null default 0,
  exact_score_points integer not null default 0,
  total_points integer not null default 0,
  calculated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.standings_matchday (
  id uuid primary key default gen_random_uuid(),
  matchday_id uuid not null references public.matchdays(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  total_points integer not null default 0,
  correct_results integer not null default 0,
  exact_scores integer not null default 0,
  rank_position integer not null check (rank_position > 0),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (matchday_id, profile_id)
);

create table if not exists public.standings_overall (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references public.seasons(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  total_points integer not null default 0,
  correct_results integer not null default 0,
  exact_scores integer not null default 0,
  rank_position integer not null check (rank_position > 0),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (season_id, profile_id)
);

create table if not exists public.weekly_leaders (
  id uuid primary key default gen_random_uuid(),
  matchday_id uuid not null unique references public.matchdays(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  total_points integer not null,
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.published_matchdays (
  id uuid primary key default gen_random_uuid(),
  matchday_id uuid not null unique references public.matchdays(id) on delete cascade,
  published_by_profile_id uuid references public.profiles(id) on delete set null,
  published_at timestamptz not null default timezone('utc', now()),
  notes text
);

create table if not exists public.sync_logs (
  id uuid primary key default gen_random_uuid(),
  provider_name text not null,
  resource_type text not null,
  status public.sync_status not null,
  records_processed integer not null default 0,
  error_message text,
  started_at timestamptz not null default timezone('utc', now()),
  finished_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.raw_match_results (
  id uuid primary key default gen_random_uuid(),
  sync_log_id uuid references public.sync_logs(id) on delete set null,
  provider_name text not null,
  external_result_id text,
  external_match_id text,
  match_key text,
  mapped_match_id uuid references public.matches(id) on delete set null,
  home_score integer,
  away_score integer,
  result_status text,
  is_official boolean not null default false,
  payload_json text not null,
  source_updated_at timestamptz,
  fetched_at timestamptz not null default timezone('utc', now()),
  applied_at timestamptz
);

create index if not exists idx_profiles_role_code on public.profiles(role_code);
create index if not exists idx_matchdays_season on public.matchdays(season_id, number);
create index if not exists idx_matchdays_status on public.matchdays(status);
create index if not exists idx_matches_matchday on public.matches(matchday_id, kickoff_at);
create index if not exists idx_matches_status on public.matches(status);
create index if not exists idx_odds_match_provider on public.odds(match_id, provider_name);
create index if not exists idx_match_results_provider on public.match_results(source_provider_name, last_synced_at desc);
create index if not exists idx_raw_match_results_provider on public.raw_match_results(provider_name, fetched_at desc);
create index if not exists idx_raw_match_results_match on public.raw_match_results(mapped_match_id, fetched_at desc);
create index if not exists idx_user_picks_profile on public.user_picks(profile_id, created_at desc);
create index if not exists idx_user_picks_match on public.user_picks(match_id);
create index if not exists idx_season_memberships_season_profile on public.season_memberships(season_id, profile_id);
create index if not exists idx_pick_points_matchday on public.pick_points(matchday_id, total_points desc);
create index if not exists idx_standings_matchday_rank on public.standings_matchday(matchday_id, rank_position);
create index if not exists idx_standings_overall_rank on public.standings_overall(season_id, rank_position);
create index if not exists idx_sync_logs_resource on public.sync_logs(resource_type, started_at desc);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists trg_profiles_updated_at on public.profiles;
create trigger trg_profiles_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

drop trigger if exists trg_seasons_updated_at on public.seasons;
create trigger trg_seasons_updated_at
before update on public.seasons
for each row execute function public.set_updated_at();

drop trigger if exists trg_matchdays_updated_at on public.matchdays;
create trigger trg_matchdays_updated_at
before update on public.matchdays
for each row execute function public.set_updated_at();

drop trigger if exists trg_teams_updated_at on public.teams;
create trigger trg_teams_updated_at
before update on public.teams
for each row execute function public.set_updated_at();

drop trigger if exists trg_matches_updated_at on public.matches;
create trigger trg_matches_updated_at
before update on public.matches
for each row execute function public.set_updated_at();

drop trigger if exists trg_match_results_updated_at on public.match_results;
create trigger trg_match_results_updated_at
before update on public.match_results
for each row execute function public.set_updated_at();

drop trigger if exists trg_user_picks_updated_at on public.user_picks;
create trigger trg_user_picks_updated_at
before update on public.user_picks
for each row execute function public.set_updated_at();

drop trigger if exists trg_season_memberships_updated_at on public.season_memberships;
create trigger trg_season_memberships_updated_at
before update on public.season_memberships
for each row execute function public.set_updated_at();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (auth_user_id, email, display_name, role_code)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'display_name', split_part(coalesce(new.email, 'Usuario'), '@', 1)),
    'user'
  )
  on conflict (auth_user_id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();

create or replace function public.current_profile_id()
returns uuid
language sql
stable
as $$
  select p.id
  from public.profiles p
  where p.auth_user_id = auth.uid()
  limit 1
$$;

alter table public.profiles enable row level security;
alter table public.user_picks enable row level security;
alter table public.standings_matchday enable row level security;
alter table public.standings_overall enable row level security;
alter table public.weekly_leaders enable row level security;
alter table public.published_matchdays enable row level security;

drop policy if exists "profiles_select_self" on public.profiles;
create policy "profiles_select_self"
on public.profiles
for select
to authenticated
using (auth.uid() = auth_user_id);

drop policy if exists "profiles_update_self" on public.profiles;
create policy "profiles_update_self"
on public.profiles
for update
to authenticated
using (auth.uid() = auth_user_id)
with check (auth.uid() = auth_user_id);

drop policy if exists "user_picks_select_own" on public.user_picks;
create policy "user_picks_select_own"
on public.user_picks
for select
to authenticated
using (profile_id = public.current_profile_id());

drop policy if exists "user_picks_insert_own" on public.user_picks;
create policy "user_picks_insert_own"
on public.user_picks
for insert
to authenticated
with check (profile_id = public.current_profile_id());

drop policy if exists "user_picks_update_own" on public.user_picks;
create policy "user_picks_update_own"
on public.user_picks
for update
to authenticated
using (profile_id = public.current_profile_id())
with check (profile_id = public.current_profile_id());

drop policy if exists "standings_matchday_public_read" on public.standings_matchday;
create policy "standings_matchday_public_read"
on public.standings_matchday
for select
to authenticated
using (true);

drop policy if exists "standings_overall_public_read" on public.standings_overall;
create policy "standings_overall_public_read"
on public.standings_overall
for select
to authenticated
using (true);

drop policy if exists "weekly_leaders_public_read" on public.weekly_leaders;
create policy "weekly_leaders_public_read"
on public.weekly_leaders
for select
to authenticated
using (true);

drop policy if exists "published_matchdays_public_read" on public.published_matchdays;
create policy "published_matchdays_public_read"
on public.published_matchdays
for select
to authenticated
using (true);

insert into public.scoring_rules (rule_key, points, is_active)
values
  ('result_correct', 3, true),
  ('exact_score', 2, true)
on conflict (rule_key) do update set
  points = excluded.points,
  is_active = excluded.is_active;
