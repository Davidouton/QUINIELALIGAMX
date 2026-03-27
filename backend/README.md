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

