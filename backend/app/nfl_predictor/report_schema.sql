begin;
create table if not exists public.nfp_kelly_reports (
 id text primary key, metadata jsonb not null, imported_at timestamptz not null default now()
);
create table if not exists public.nfp_kelly_rows (
 report_id text not null references public.nfp_kelly_reports(id), game_id text not null,
 season integer not null, week integer not null, market text not null, payload jsonb not null,
 primary key(report_id,game_id,market)
);
create index if not exists nfp_kelly_rows_filter on public.nfp_kelly_rows(report_id,market,season,week);
alter table public.nfp_kelly_reports enable row level security;
alter table public.nfp_kelly_rows enable row level security;
revoke all on public.nfp_kelly_reports,public.nfp_kelly_rows from public;
do $$ begin
 if exists(select 1 from pg_roles where rolname='anon') then
  revoke all on public.nfp_kelly_reports,public.nfp_kelly_rows from anon;
 end if;
 if exists(select 1 from pg_roles where rolname='authenticated') then
  revoke all on public.nfp_kelly_reports,public.nfp_kelly_rows from authenticated;
 end if;
end $$;
commit;
