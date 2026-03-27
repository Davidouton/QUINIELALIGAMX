# API Inicial QuinielaMaestra

## Public / autenticado

- `GET /api/v1/health`
- `GET /api/v1/me`
- `GET /api/v1/matchdays`
- `GET /api/v1/matches`
- `GET /api/v1/matches/{id}`
- `POST /api/v1/picks`
- `PUT /api/v1/picks/{id}`
- `GET /api/v1/my-picks`
- `GET /api/v1/results`
- `GET /api/v1/leaderboard`
- `GET /api/v1/leaderboard/matchday/{id}`
- `GET /api/v1/leaderboard/overall`
- `GET /api/v1/published-results`

## Admin / master admin

- `POST /api/v1/admin/matches/sync`
- `POST /api/v1/admin/results/sync`
- `POST /api/v1/admin/odds/sync`
- `POST /api/v1/admin/results/recalculate`
- `POST /api/v1/admin/matchdays/{id}/publish`
- `GET /api/v1/admin/users`
- `PATCH /api/v1/admin/users/{id}/role`

