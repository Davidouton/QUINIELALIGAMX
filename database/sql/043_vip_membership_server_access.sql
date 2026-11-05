-- VIP requests and approvals go through the backend's authenticated routes.
-- Prevent direct client writes from bypassing administrator approval.
-- Existing memberships, payment flags and decisions remain unchanged.
begin;

alter table public.vip_memberships enable row level security;
revoke all on table public.vip_memberships from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on table public.vip_memberships from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on table public.vip_memberships from authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant select, insert, update, delete on table public.vip_memberships to service_role;
  end if;
end;
$$;

-- The table owner and Supabase service_role retain their RLS bypass.
-- Do not FORCE ROW LEVEL SECURITY: the server enforces role checks.
commit;
