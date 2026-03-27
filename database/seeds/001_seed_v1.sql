insert into public.seasons (id, name, slug, is_active)
values ('11111111-1111-1111-1111-111111111111', 'Clausura 2026', 'clausura-2026', true)
on conflict (id) do nothing;

insert into public.matchdays (id, season_id, number, name, status, starts_at, ends_at)
values
  (
    '22222222-2222-2222-2222-222222222221',
    '11111111-1111-1111-1111-111111111111',
    2,
    'Jornada 2',
    'published',
    '2026-01-15T00:00:00Z',
    '2026-01-18T23:59:59Z'
  ),
  (
    '22222222-2222-2222-2222-222222222222',
    '11111111-1111-1111-1111-111111111111',
    3,
    'Jornada 3',
    'active',
    '2026-01-22T00:00:00Z',
    '2026-01-25T23:59:59Z'
  )
on conflict (id) do nothing;

insert into public.teams (id, external_id, name, short_name, slug)
values
  ('33333333-3333-3333-3333-333333333331', 'AME', 'America', 'AME', 'america'),
  ('33333333-3333-3333-3333-333333333332', 'CHI', 'Chivas', 'CHI', 'chivas'),
  ('33333333-3333-3333-3333-333333333333', 'TIG', 'Tigres', 'TIG', 'tigres'),
  ('33333333-3333-3333-3333-333333333334', 'MTY', 'Monterrey', 'MTY', 'monterrey')
on conflict (id) do nothing;

insert into public.matches (
  id,
  matchday_id,
  external_id,
  home_team_id,
  away_team_id,
  kickoff_at,
  picks_lock_at,
  venue,
  status
)
values
  (
    '44444444-4444-4444-4444-444444444441',
    '22222222-2222-2222-2222-222222222221',
    'LIGA-2026-2001',
    '33333333-3333-3333-3333-333333333331',
    '33333333-3333-3333-3333-333333333332',
    '2026-01-16T02:00:00Z',
    '2026-01-16T02:00:00Z',
    'Estadio Azteca',
    'final'
  ),
  (
    '44444444-4444-4444-4444-444444444442',
    '22222222-2222-2222-2222-222222222221',
    'LIGA-2026-2002',
    '33333333-3333-3333-3333-333333333333',
    '33333333-3333-3333-3333-333333333334',
    '2026-01-17T03:00:00Z',
    '2026-01-17T03:00:00Z',
    'Universitario',
    'final'
  ),
  (
    '44444444-4444-4444-4444-444444444443',
    '22222222-2222-2222-2222-222222222222',
    'LIGA-2026-3001',
    '33333333-3333-3333-3333-333333333331',
    '33333333-3333-3333-3333-333333333333',
    '2026-01-24T01:00:00Z',
    '2026-01-24T01:00:00Z',
    'Estadio Azteca',
    'scheduled'
  ),
  (
    '44444444-4444-4444-4444-444444444444',
    '22222222-2222-2222-2222-222222222222',
    'LIGA-2026-3002',
    '33333333-3333-3333-3333-333333333334',
    '33333333-3333-3333-3333-333333333332',
    '2026-01-25T01:00:00Z',
    '2026-01-25T01:00:00Z',
    'BBVA',
    'scheduled'
  )
on conflict (id) do nothing;

insert into public.match_results (match_id, home_score, away_score, is_official)
values
  ('44444444-4444-4444-4444-444444444441', 2, 1, true),
  ('44444444-4444-4444-4444-444444444442', 1, 1, true)
on conflict (match_id) do nothing;

insert into public.published_matchdays (matchday_id, notes)
values ('22222222-2222-2222-2222-222222222221', 'Resultados oficiales publicados')
on conflict (matchday_id) do nothing;

