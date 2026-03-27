# Checkpoint 2026-03-20

## Estado actual

- El flujo de `Get odds` ya corre desde su propia pestaña en Admin.
- `Get odds` usa The Odds API, guarda raw en `public.lmx_odds_5d` y luego sincroniza contra la app.
- La UI de `Get odds` ya:
  - muestra preview de tabla
  - convierte momios ML a decimal solo para visualizacion
  - filtra por rango de `fecha del juego`
  - vuelve a leer el ultimo snapshot desde Supabase
- `Equipos` ya tiene soporte para:
  - editar equipos existentes
  - `home_venue`
  - `primary_color`
  - `secondary_color`
  - `accent_color`
- El guardado de frontend ya tiene timeout y no se queda pensando infinito:
  - `frontend/src/lib/api/backend.ts`

## Bloqueo actual

El repo esta dentro de `Desktop` con iCloud/almacenamiento bajo demanda.

Se confirmo porque la carpeta `APP` sigue mostrando icono de nube en Finder. Mientras siga asi:

- Python tarda muchisimo importando paquetes de `.venv`
- Next tarda mucho arrancando con `node_modules`
- `uvicorn` llega a colgarse o fallar por timeouts del filesystem

El problema actual ya no apunta a la logica de la app, sino al filesystem sincronizado.

## Cambios importantes ya hechos

- `scripts/dev-up.sh`
  - backend sin `--reload`
  - backend con `--ws none`
- `Makefile`
  - `backend-dev` sin `--reload`
  - `backend-dev` con `--ws none`
- `frontend/package.json`
  - `next dev` sin `--turbopack`
- `backend/app/main.py`
  - se desactivo el bootstrap automatico de DB al arrancar por default
- `backend/app/core/config.py`
  - `run_startup_db_bootstrap: bool = False`

## Siguiente paso recomendado

### Opcion 1
Esperar a que desaparezca la nube de la carpeta `APP` y luego correr:

```bash
cd /Users/davidoutonballina/Desktop/LIGAMX/APP
pkill -f "uvicorn app.main:app" || true
pkill -f "next dev" || true
make dev-up
```

### Opcion 2
Mejor opcion: mover el proyecto fuera de `Desktop/iCloud`.

```bash
pkill -f "uvicorn app.main:app" || true
pkill -f "next dev" || true

mkdir -p ~/Code
mv /Users/davidoutonballina/Desktop/LIGAMX ~/Code/
```

Luego reinstalar dependencias limpias:

```bash
cd ~/Code/LIGAMX/APP/backend
rm -rf .venv
python3 -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"

cd ~/Code/LIGAMX/APP/frontend
rm -rf node_modules
npm install

cd ~/Code/LIGAMX/APP
make dev-up
```

## Pendiente inmediato al volver

1. Confirmar que `8000` y `3000` levantan rapido.
2. Probar guardar un equipo en `Admin > Equipos`.
3. Si ya guarda, seguir con pulido visual de `Get odds` y `Equipos`.

