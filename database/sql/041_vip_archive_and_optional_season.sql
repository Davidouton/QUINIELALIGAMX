-- Apply before deploying the independent Quinielón / VIP archive update.
-- Existing rows remain compatible with the previously deployed backend.
begin;

alter table public.vip_competitions
  add column if not exists archived_at timestamptz;
alter table public.vip_competitions
  alter column season_id drop not null;

create index if not exists ix_vip_competitions_archived_at
  on public.vip_competitions(archived_at);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.vip_competitions'::regclass
      and conname = 'ck_vip_season_required'
  ) then
    alter table public.vip_competitions
      add constraint ck_vip_season_required
      check (competition_kind = 'weekly_pool' or season_id is not null);
  end if;
end;
$$;

commit;
