# NFL Predictor dentro de Quiniela

Ruta web: `/dashboard/quiniela-plus/nfl-predictor`, desde **Quiniela+ → Predictor NFL**. Exclusivo para super admin (`master_admin`); usuarios y administradores normales reciben 403 en la API. La ruta anterior redirige a esta sección. Usa el inicio de sesión de Quiniela y su backend FastAPI. No depende de tener abierto Excel ni de ejecutar un programa en tu Mac.

## Componentes

- `backend/app/nfl_predictor`: modelo adaptado desde NFLPredictor (ELO de mercado, EPA/SR, Poisson/Logit), ingesta automática y persistencia PostgreSQL.
- `GET /api/v1/nfl-predictor?season=2026&week=4`: resultados de la última ejecución completa de cada partido; requiere cuenta activa, rol `master_admin` y token Supabase.
- Tablas `nfp_games`, `nfp_team_metrics`, `nfp_odds`, `nfp_runs`, `nfp_predictions` dentro del **mismo Supabase** de Quiniela. No se modifican los picks, premios, resultados ni rankings de la quiniela.
- Nueva sección de navegación con filtros de jornada/mercado, probabilidades, cuota usada, EV, marcador y estado de actualización.

## Inicialización, una sola vez

Desde `backend`, con el `.env` existente y dependencias instaladas:

```bash
.venv/bin/python -m pip install -r requirements.txt
.venv/bin/python -m app.nfl_predictor.online migrate
.venv/bin/python -m app.nfl_predictor.online seed \
  --games ~/Desktop/NFL/NFLMASTERDATA25.xlsx \
  --metrics ~/Desktop/NFLPredictor/data/nfl_team_epa_sr_asof.csv
```

La migración crea solamente las tablas del predictor. Su copia revisable está en `database/sql/037_nfl_predictor.sql`; el comando usa `backend/app/nfl_predictor/schema.sql` para funcionar también en un despliegue cuyo root es backend. Mantener ambas iguales.

La importación es inicial: omite partidos y métricas ya existentes para no revertir actualizaciones online. No importa pronósticos antiguos como si fueran actuales. El Excel original queda intacto. Después, calendario, resultados, líneas y métricas se actualizan por proveedores.

Variables del proceso:

- `DATABASE_URL`: reutiliza la conexión del backend. Si es un pooler de transacciones (6543), configura `NFL_PREDICTOR_DATABASE_URL` con conexión directa o **Session pooler 5432**. El bloqueo de ejecución requiere conservar la sesión PostgreSQL.
- `THE_ODDS_API_KEY`: reutiliza la clave actual de Quiniela. También acepta `ODDS_API_KEY` para compatibilidad local.
- `NFL_BOOKMAKER`: opcional; por defecto usa el bookmaker configurado en Quiniela (draftkings).
- `PGSSLMODE=require`: valor predeterminado.

Las credenciales de base de datos y proveedor se quedan exclusivamente en backend/cron, nunca en variables `NEXT_PUBLIC_*`.

## Automatización en la infraestructura existente

**Activar solo uno** de estos programadores. Ambos usan el mismo comando:

```bash
PYTHONPATH=. python -m app.nfl_predictor.online run
```

### Railway (junto al backend de Quiniela)

Crear un segundo servicio dentro del mismo proyecto de Railway apuntando al mismo repositorio, root `backend`. Seleccionar el archivo de configuración `/backend/railway.nfl-predictor.json`. Compartir `DATABASE_URL` y `THE_ODDS_API_KEY` del backend mediante referencias de variables. Este servicio es un cron, no un servidor HTTP: termina al concluir el cálculo.

El archivo configura `17 11,17,23 * * *` (UTC): tres ejecuciones diarias. El servicio web conserva su configuración actual `backend/railway.json`; no sustituirla por la del cron.

### GitHub Actions (alternativa)

El workflow `.github/workflows/nfl-predictor.yml` ya contiene el mismo horario, ejecución manual y exclusión mutua. Configurar secretos del repositorio `NFL_PREDICTOR_DATABASE_URL` (Session pooler) y `THE_ODDS_API_KEY`. Después de inicializar, establecer la variable de repositorio `NFL_PREDICTOR_ENABLED=true`. No se activa sin esa variable.

No guardar `.env`, claves ni bases de datos en commits. Los horarios de Actions pueden sufrir retrasos; no usarlo como servicio de tiempo real.

## Qué hace cada ejecución

1. Adquiere un bloqueo PostgreSQL para evitar dos cálculos simultáneos.
2. Sincroniza calendario y resultados de nflverse (desde 2018). Normaliza equipos y convierte el spread del proveedor a handicap del local. Campos vacíos del proveedor no borran datos existentes.
3. Elige la siguiente jornada con partidos pendientes en los próximos diez días. Si no hay, registra `skipped` sin consumir la cuota de líneas.
4. Descarga PBP de la temporada en curso y actualiza métricas por equipo/partido. Los datos históricos ya están en Supabase. Antes del primer partido de temporada utiliza el histórico disponible.
5. Consulta Odds API para NFL, enlaza por equipos/hora y guarda las cuotas con su fecha de consulta. Rechaza cotizaciones del bookmaker con más de 24 horas.
6. Recalcula ELO, métricas previas y Poisson/Logit; publica solamente partidos que todavía no comienzan y que tienen cotización del bookmaker.
7. Guarda predicciones y selecciones dentro de una transacción; marca `complete` únicamente al terminar. La web lee solo ejecuciones completas. Un fallo preserva el último resultado publicado; el estado y la etapa del fallo quedan en `nfp_runs`.

Para una ejecución manual usar el comando anterior. No se ejecuta desde una solicitud HTTP, evitando timeouts del navegador y consumo no autorizado de cuota.

## Precisiones y límites

- La web muestra datos actualizados al último pipeline; no promete resultados ni momios en tiempo real. Cada actualización del proveedor requiere que este ya haya publicado los datos. Un fallo de PBP detiene la publicación nueva.
- El ELO conserva la exigencia original de moneylines históricas válidas. Si el proveedor no tiene una línea de un partido terminado, el pipeline falla en `predict` hasta completar ese dato; no inventa una expectativa silenciosamente.
- Las variables deportivas usan un corte anterior al primer partido de la jornada. Las cuotas actuales sí se renuevan en cada ejecución previa al partido.
- EPA de la primera jornada puede faltar y se imputa con entrenamiento; la cobertura queda en `nfp_runs.details.epa_coverage`.
- La probabilidad de empate ML usa una aproximación Skellam; no modela explícitamente overtime. El EV contempla pushes y no equivale a rentabilidad demostrada ni ejecuta apuestas.
- Esta integración no sincroniza automáticamente el marcador con los partidos de la quiniela: son datos analíticos del predictor. Evita alterar la puntuación de usuarios con una importación del modelo.

## Comprobación

```bash
cd backend
.venv/bin/python -m pytest tests/test_nfl_predictor_model.py tests/test_nfl_predictor_online.py
cd ../frontend
node node_modules/typescript/bin/tsc --noEmit --incremental false
npm run build:verify
```

Referencias: [calendario y convenciones de nflverse](https://raw.githubusercontent.com/nflverse/nflreadr/main/data-raw/dictionary_schedules.csv), [conexiones Supabase](https://supabase.com/docs/guides/database/connecting-to-postgres), [horarios de GitHub Actions](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule).

## Reporte Kelly y evaluación histórica

Quiniela+ → Predictor NFL → Reporte Kelly muestra **Motor NFL · histórico** por defecto, con filtros de mercado (ML, spread, totales y contras), temporada y semana; tabla paginada, curva interactiva de ganancia/pérdida acumulada, ROI y W/L/push. Sigue restringido a `master_admin` activo, incluido el endpoint `/api/v1/nfl-predictor/report`.

El selector permite consultar también las cifras guardadas en `NFLPredictorbet_MUCHADATA2.xlsx`. No son apuestas confirmadas: los montos provienen de fórmulas. La comparación usa la intersección de partidos con cálculo en ambas fuentes y elimina duplicados del Excel por fecha/equipos. Conserva sus errores de cálculo para que sea una referencia fiel, no una medida validada de rentabilidad.

El backtest llama al mismo `data.prepare` y `pipeline.run` del motor; entrena de nuevo cada semana, calcula ELO/estadísticas anteriores al inicio de la jornada y calibra con semanas previas separadas. Las probabilidades originales del Excel no entran al entrenamiento. Selecciona el lado de mayor probabilidad por mercado y el opuesto para las contras; Kelly completo usa una base fija por mercado, sin capitalización ni límite conjunto de exposición. Kelly negativo implica monto cero.

Para reproducir/importar desde `backend`:

```sh
.venv/bin/python -m app.nfl_predictor.report /ruta/NFLPredictorbet_MUCHADATA2.xlsx
.venv/bin/python -m app.nfl_predictor.backtest /ruta/NFLPredictorbet_MUCHADATA2.xlsx \
  --metrics /ruta/nfl_team_epa_sr_asof.csv --output /ruta/cache-backtest --publish
```

`--publish` reemplaza atómicamente solo el reporte histórico del motor en `nfp_kelly_reports`/`nfp_kelly_rows`; sin esa opción genera JSON local. No modifica pronósticos en vivo ni apuestas. El cache por semana se identifica por SHA256 de datos y código. Es necesario aplicar `database/sql/038_nfl_kelly_report.sql`; ambos comandos también inicializan estas tablas con RLS sin permisos de clientes Supabase.

La primera ejecución cubrió 2,163 partidos (10,815 selecciones) entre 2018 y enero de 2026, incluyendo 2025 W17. Omite 2018 W1–W4 por menos de 50 partidos anteriores. Se recuperaron 16 años faltantes del calendario según temporada/mes. Los IDs repetidos del archivo no sirven para identificar partidos; se utiliza fecha/local/visitante. El reporte original conserva sus filas mediante identificadores de fila propios.

Limitación de la evaluación: las líneas/momios históricos del archivo no tienen timestamps verificados. El corte semanal protege resultados y estadísticas, pero **no acredita que esas cuotas estuvieran disponibles al inicio de esa semana**. El backtest no sustituye la validación en vivo con snapshots fechados. Las probabilidades de empate ML corresponden al modelo actual, sin ajuste especial retrospectivo.
