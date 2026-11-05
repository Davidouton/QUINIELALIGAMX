-- Apply AFTER deploying the backend that accepts null VIP season_id/name.
-- Remove only the legacy season link; retain matches, picks, members and money.
begin;

update public.vip_competitions
set season_id = null
where competition_kind = 'weekly_pool'
  and season_id is not null;

commit;
