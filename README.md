# QuinielaMaestra

Monorepo base para una quiniela profesional de Liga MX con frontend en Next.js, backend en FastAPI y base de datos en Supabase Postgres.

## Estructura recomendada

```text
/quinielamaestra
  /frontend   -> Next.js 15 + TypeScript + Tailwind CSS
  /backend    -> FastAPI + SQLAlchemy + lógica de negocio
  /database   -> SQL inicial, seeds y políticas para Supabase
  /docs       -> arquitectura, contratos y decisiones técnicas
```

Nota: el directorio `apps/api` permanece como legado del workspace anterior. La nueva base de trabajo para `QuinielaMaestra` vive en `frontend`, `backend` y `database`.

## Stack

- Frontend: Next.js 15 + TypeScript + Tailwind CSS
- Backend: FastAPI + SQLAlchemy
- Base de datos: Supabase Postgres
- Auth: Supabase Auth
- Deploy frontend: Vercel

## Primer flujo V1

1. Registro o login con Supabase Auth
2. Backend valida JWT emitido por Supabase
3. Usuario consulta jornada activa
4. Usuario consulta partidos de la jornada
5. Usuario captura picks
6. Backend guarda picks y valida cierre
7. Usuario consulta sus picks
8. Usuario consulta leaderboard general o por jornada

## Setup rápido

### Backend

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"
cp .env.example .env
uvicorn app.main:app --reload --port 8000
```

### Frontend

```bash
cd frontend
npm install
cp .env.example .env.local
npm run dev
```

### Base de datos

1. Crear proyecto en Supabase.
2. Ejecutar `database/sql/000_init.sql`.
3. Ejecutar `database/seeds/001_seed_v1.sql`.

## Documentación

- [Arquitectura](./docs/ARCHITECTURE.md)
- [API inicial](./docs/API.md)

