# QuinielaMaestra Backend

Backend FastAPI modular para autenticacion, picks, resultados, leaderboards y sincronizacion con proveedores deportivos.

## Comandos

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"
cp .env.example .env
uvicorn app.main:app --reload --port 8000
```

## Deploy en Railway

El backend ya incluye configuracion en [railway.json](./railway.json) para correr en Railway con:

- `startCommand`: `PYTHONPATH=. uvicorn app.main:app --host 0.0.0.0 --port $PORT --ws none --workers ${WEB_CONCURRENCY:-2}`
- `healthcheckPath`: `/api/v1/health`

Para un monorepo como este, en Railway todavia hay que hacer dos pasos manuales:

1. Crear el servicio desde GitHub.
2. En `Settings -> Build`, poner `Root Directory` a `/backend`.
3. En `Settings -> Deploy`, si quieres usar config as code explicita, apunta el archivo a `/backend/railway.json`.

Variables minimas recomendadas:

```env
APP_ENV=production
DATABASE_URL=...
ALLOWED_ORIGINS=https://tu-frontend.vercel.app
FRONTEND_SITE_URL=https://tu-frontend.vercel.app
WEB_CONCURRENCY=2
SUPABASE_URL=...
SUPABASE_ANON_KEY=...
SUPABASE_JWT_SECRET=...
DEFAULT_PROVIDER=the_odds_api
THE_ODDS_API_KEY=...
THE_ODDS_API_BASE_URL=https://api.the-odds-api.com/v4
THE_ODDS_API_SPORT=soccer_mexico_ligamx
THE_ODDS_API_RESULTS_DAYS_FROM=3
```
