# Supabase setup for Script 01_GetODDS

## 1) Crear proyecto
1. Entra a Supabase y crea un proyecto nuevo.
2. Guarda el `Database URL` de `Settings -> Database`.

## 2) Crear tabla objetivo
1. Abre `SQL Editor`.
2. Ejecuta el contenido de `apps/api/sql/001_create_ligamx_odds_5d.sql`.
3. Si también vas a usar auth/users desde este backend, ejecuta `apps/api/sql/002_create_users.sql`.

Nota: en una base compartida, los objetos de Liga MX quedan con prefijo `lmx_`
para convivir con otros proyectos.

## 3) Configurar variables en apps/api/.env
Usa esta base:

```env
APP_DATABASE_URL=postgresql://postgres:<PASSWORD>@db.<PROJECT_REF>.supabase.co:5432/postgres
# Opcional: si quieres separar la DB del script de odds
ODDS_DATABASE_URL=postgresql://postgres:<PASSWORD>@db.<PROJECT_REF>.supabase.co:5432/postgres
# Compatibilidad con setups anteriores:
# DATABASE_URL=postgresql://postgres:<PASSWORD>@db.<PROJECT_REF>.supabase.co:5432/postgres

API_FOOTBALL_BASE_URL=https://v3.football.api-sports.io
API_FOOTBALL_KEY=<TU_API_KEY>
# Solo si usas RapidAPI:
# API_FOOTBALL_HEADER_NAME=x-rapidapi-key
# API_FOOTBALL_HOST_HEADER=api-football-v1.p.rapidapi.com

LIGAMX_LEAGUE_ID=262
LIGAMX_SEASON=2026
ODDS_LOOKAHEAD_DAYS=5
# Optional: historical start date override (useful for free plans)
# ODDS_START_DATE=2024-03-01
ODDS_TIMEZONE=America/Mexico_City
ODDS_BOOKMAKER=Bet365
# Si conoces el ID del bookmaker, descomenta:
# ODDS_BOOKMAKER_ID=8
ODDS_REQUEST_TIMEOUT_SECONDS=25
ODDS_REQUEST_DELAY_SECONDS=0.25
```

Si tienes plan free y te aparece el error de temporada, usa por ejemplo:
- `LIGAMX_SEASON=2024`
- `ODDS_START_DATE=2024-03-01`

## 4) Ejecutar script
Desde la raíz del repo:

```bash
make getodds
```

Para ver salida sin guardar en DB:

```bash
cd apps/api
PYTHONPATH=. .venv/bin/python scripts/01_GetODDS.py --dry-run
```
