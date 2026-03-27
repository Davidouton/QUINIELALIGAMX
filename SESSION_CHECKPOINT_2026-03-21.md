# Checkpoint 2026-03-21

## Estado actual

- Frontend y backend quedaron funcionando en local:
  - `http://localhost:3000`
  - `http://127.0.0.1:8000`
- El flujo de admin para catalogos ya esta operativo:
  - `Temporadas`
  - `Equipos`
  - `Jornadas`
  - `Partidos`
  - `Get odds`
- El import desde odds ya sincroniza completo el snapshot trabajado:
  - `9 matched`
  - `0 unmatched`
- Los partidos importados desde odds quedaron asociados a una jornada automatica tipo `Auto Odds 2026-03-20`, pensada como staging para luego moverlos a la jornada real.

## Cambios importantes hechos hoy

### Admin > Partidos

- La vista dejo de usar cards y ahora trabaja como tabla editable compacta.
- Se agrego borrado real por fila desde frontend y backend.
- La columna de acciones quedo compacta con:
  - `Save`
  - icono de basura
- Se quito `Reset`.
- Se mostro `Torneo` dentro de la tabla.
- `Cierre de picks` ahora se calcula automaticamente con el offset de la jornada al cambiar:
  - `jornada`
  - `hora de inicio`
- Los botones verdes y rojos quedaron mas brillantes y transluciditos.
- El layout de la tabla se compacto para reducir scroll.

Archivos principales:

- `frontend/src/components/admin/admin-matches-panel.tsx`
- `frontend/src/app/globals.css`
- `backend/app/api/v1/routes/admin.py`
- `backend/app/repositories/match_repository.py`

### Picks

- `Captura de picks` se rehizo en formato tabla compacta.
- Cada partido ahora vive en una sola fila.
- Se mantuvo el autosave.
- `Inicio` y `Cierre` quedaron en una sola linea corta.
- Se quito el `match_key` visible.
- Se agrego logo del equipo si existe `crest_url`, y si no, iniciales.
- El score se captura con cajas cortas mas directas para teclado numerico.
- El nombre visible de la seccion ahora es `Picks Center`.

Archivo principal:

- `frontend/src/components/picks/pick-board.tsx`

### Navegacion

- Se quito de la navegacion principal:
  - `Jornada y partidos`
  - `Resultados`
- Se renombro el acceso de picks a `Picks Center`.
- No se borraron las rutas; solo se quitaron del menu para simplificar la UX.

Archivos:

- `frontend/src/components/layout/dashboard-sidebar.tsx`
- `frontend/src/components/layout/top-nav.tsx`

## Decisiones de producto ya tomadas

- `Picks Center` concentra la experiencia principal que antes se repartia entre varias vistas.
- `Jornada y partidos` y `Resultados` se consideran redundantes por ahora en navegacion.
- La jornada `Auto Odds ...` no representa el source del partido; solo es una jornada temporal creada por el importador.

## Pendiente inmediato para manana

1. Revisar `Picks Center` ya en uso real y afinar densidad visual si todavia cabe mas.
2. Decidir si `Inicio` y `Cierre` pueden compactarse aun mas o combinarse.
3. Evaluar si conviene dejar fija la columna del partido dentro de la tabla.
4. Seguir limpiando la UX para que el flujo de captura sea el centro del dashboard.

## Verificacion hecha

- `frontend`: `./node_modules/.bin/tsc --noEmit`

## Marca de tiempo

- Generado el `2026-03-21 01:50:43 CST`
