# LigaMX Backend (FastAPI)

Backend API con arquitectura modular (`routes`, `services`, `models`) y base para escalar.

## Stack
- FastAPI + Uvicorn
- SQLAlchemy + Alembic
- PostgreSQL (prod/dev)
- pytest
- ruff + black

## Endpoints iniciales
- `GET /health`
- `GET /ligamx/teams`
- `GET /ligamx/teams/{team_id}`
- `GET /ligamx/matches`
- `GET /ligamx/standings`
- `POST /auth/login`
- `POST /users`
- `GET /users`
- `GET /users/{id}`

`GET /users` y `GET /users/{id}` requieren token Bearer en `Authorization`.

## Inicio rápido
1. Crear venv e instalar dependencias:
   - `make setup`
2. Configurar entorno:
   - `cp .env.example .env`
3. Correr migraciones:
   - `make upgrade`
4. Poblar usuario inicial:
   - `make seed`
5. Levantar API:
   - `make start`

## Scripts
- `make start`: servidor de desarrollo
- `make build`: compilación básica de bytecode para producción
- `make test`: tests
- `make lint`: calidad de código
- `make format`: formateo automático
- `make migrate`: nueva revisión Alembic
- `make upgrade`: aplicar migraciones
- `make seed`: crear usuario de prueba
- `make getodds`: Script 01_GetODDS (calendario + odds Liga MX próximos 5 días)
- `make getodds-dry`: mismo fetch pero sin guardar en DB
  - Tip plan free: usa `LIGAMX_SEASON=2024` y `ODDS_START_DATE=2024-MM-DD`

## Script 01_GetODDS
- Archivo: `scripts/01_GetODDS.py`
- Tabla objetivo: `public.lmx_odds_5d`
- DB env precedence: `ODDS_DATABASE_URL` -> `DATABASE_URL` -> `SUPABASE_DATABASE_URL`
- SQL recomendado para Supabase: `sql/001_create_ligamx_odds_5d.sql`
- Guía de setup: `../../docs/supabase/SETUP_01_GETODDS.md`
