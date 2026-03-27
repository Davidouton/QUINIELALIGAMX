# Checkpoint 2026-03-25

## Estado actual

- La app ya trae una linea visual mucho mas `flat` y compacta en mobile y desktop.
- El dashboard del usuario fue la zona mas trabajada:
  - header slim
  - panel/menu mas ligero
  - filtros planos
  - stats compactas
  - tablas/listas sin cards pesadas
- Ya se extendio esa direccion al resto de pantallas grandes:
  - `Ranking`
  - `Salon de la Fama`
  - `Reglamento`
  - `Settings`
  - varias pantallas de `Admin`

## Cambios importantes hechos hoy

### Dashboard y mobile-first

- Se aplano gran parte de la UI del dashboard para que funcione mejor en celular vertical.
- Se quitaron muchos contenedores tipo card y se cambiaron por layout plano con bordes minimos.
- Se compactaron tipografias, paddings y headers.
- `Jornada`, `Proximos juegos`, `Probabilidades`, `Premios` y `E. Avanzadas` ya siguen el mismo lenguaje.
- `Picks` quedo mas util para mobile:
  - filas mas compactas
  - abreviaciones mobile
  - labels completos en desktop
  - inputs mas cuadrados para captura de marcadores

Archivos mas tocados:

- `frontend/src/components/dashboard/dashboard-home.tsx`
- `frontend/src/components/dashboard/performance-race-chart.tsx`
- `frontend/src/components/dashboard/matchday-points-table.tsx`
- `frontend/src/components/dashboard/pick-results-table.tsx`
- `frontend/src/components/dashboard/advanced-stats-panel.tsx`
- `frontend/src/components/picks/pick-board.tsx`
- `frontend/src/components/layout/dashboard-sidebar.tsx`

### Base visual compartida

- Se aplanaron los estilos base para que el resto del frontend herede mejor el look:
  - menos sombra
  - menos blur
  - radios mas compactos
  - campos y botones mas contenidos

Archivo clave:

- `frontend/src/app/globals.css`

### Pantallas no tocadas antes

- `Ranking` ya no se siente como tabla con filas-tarjeta; ahora es mas limpia y plana.
- `Salon de la Fama` ya trae tabs compactos, podium mas ligero y tablas historicas sin filas infladas.
- `Reglamento` quedo mas limpio, sin bloque pesado envolvente.
- `Settings` quedo mas ligero y alineado con el nuevo estilo.
- `Admin` ya hereda una base mas compacta y se ajustaron al menos:
  - subnav
  - control room / resumen
  - settings
  - users

Archivos:

- `frontend/src/components/leaderboard/leaderboard-page-content.tsx`
- `frontend/src/components/hall-of-fame/hall-of-fame-page-content.tsx`
- `frontend/src/components/rules/rules-page-content.tsx`
- `frontend/src/components/settings/settings-page-content.tsx`
- `frontend/src/components/admin/admin-subnav.tsx`
- `frontend/src/components/admin/admin-control-room.tsx`
- `frontend/src/components/admin/admin-settings-panel.tsx`
- `frontend/src/components/admin/admin-users-panel.tsx`

### Ajuste fino de consistencia visual

- Se detecto que varias pantallas nuevas habian quedado `flat pero enmarcadas`, no realmente iguales al dashboard.
- Se corrigio esa diferencia:
  - menos bordes visibles
  - mas separacion por espacio y filas
  - menos bloques tipo caja
- El resumen de `Admin` ahora usa el mismo concepto del dashboard:
  - menu inline en desktop
  - menu comprimible con boton `Menu` en mobile
  - tabs y contenido mucho mas flat

Archivos clave de este ajuste:

- `frontend/src/app/globals.css`
- `frontend/src/components/admin/admin-control-room.tsx`
- `frontend/src/components/leaderboard/leaderboard-page-content.tsx`
- `frontend/src/components/hall-of-fame/hall-of-fame-page-content.tsx`
- `frontend/src/components/rules/rules-page-content.tsx`
- `frontend/src/components/settings/settings-page-content.tsx`
- `frontend/src/components/admin/admin-settings-panel.tsx`
- `frontend/src/components/admin/admin-users-panel.tsx`

## Nota importante

- En esta carpeta no hay repositorio `git`, asi que este checkpoint queda guardado como archivo local y no como commit.

## Pendiente inmediato para retomar

1. Recorrer visualmente las pantallas ya compactadas y detectar ajustes finos de spacing y jerarquia.
2. Dar una pasada puntual al resto de paneles admin que aun conserven demasiado volumen visual por estructura propia.
3. Afinar consistencia entre mobile y desktop donde aun haya labels abreviados o headers muy largos.
4. Revisar especificamente `Admin > Resumen` en mobile para pulir densidad, filas y orden visual.

## Comando recomendado al volver

```bash
cd /Users/davidoutonballina/Desktop/LIGAMX/APP && bash /Users/davidoutonballina/Desktop/LIGAMX/APP/scripts/dev-up.sh
```

Luego revisar:

```text
http://localhost:3000/dashboard
http://localhost:3000/dashboard/leaderboard
http://localhost:3000/dashboard/hall-of-fame
http://localhost:3000/dashboard/rules
http://localhost:3000/dashboard/settings
http://localhost:3000/dashboard/admin
```

## Verificacion hecha

- `frontend`: `npm run build:verify`

## Marca de tiempo

- Generado el `2026-03-25 America/Mexico_City`
