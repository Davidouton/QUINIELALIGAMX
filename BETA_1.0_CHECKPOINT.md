# BETA 1.0

## Estado actual

- La app ya tiene una direccion visual mucho mas consistente entre `mobile` y `desktop`.
- El lenguaje base es:
  - flat
  - tablas limpias
  - botones rectos con borde fantasma
  - scroll tactil sin barra visible en tablas horizontales
- El dashboard de usuario y `Picks` son la referencia visual principal del sistema.
- `Admin` ya quedo mucho mas cerca de ese mismo estandar.

## Lo mas importante que ya quedo

### Navegacion general

- Se agrego `Quiniela +` para todos los usuarios.
- Se agrego `Premios` publico para todos los usuarios.
- `Quiniela +` quedo arriba de `Dashboard` en el panel.
- En desktop ya no existe el boton de `comprimir`; el panel queda fijo expandido.
- Al fondo del panel ahora aparece:
  - `Powered by Outonpro`
  - `Beta 1.0`

## Dashboard y vistas de usuario

- Dashboard compactado y aplanado.
- Header slim.
- Menu interno flat.
- Metricas superiores en una sola linea para mobile.
- `Puntos por jornada` con formato mas compacto.
- `Jornada`, `Proximos juegos`, `Probabilidades`, `E. Avanzadas` y `Premios` se fueron pasando al lenguaje plano/tabular.
- `Picks Globales` ya existe y revela picks solo al cerrarse el pick del partido.

## Settings

- Se agrego `Modalidad`:
  - `Pre-pago`
  - `Aval`
- Si es `Aval`, se habilita selector de usuario aval.
- Se agregaron:
  - `Banco`
  - `Cuenta de deposito`

## Admin

### Estado general

- La mayor parte de `Admin` ya esta sin cards pesadas.
- Se estandarizaron tablas y botones a un mismo look.
- Se fueron quitando barras de scroll visibles para dejar solo scroll tactil en tablas horizontales.

### Pantallas admin trabajadas

- `Resumen`
- `Configuracion`
- `Premios`
- `Usuarios`
- `Info usuarios`
- `Temporadas`
- `Jornadas`
- `Partidos`
- `Resultados`
- `Probabilidades`
- `Equipos`
- `Trofeos`
- `Salon de la fama`
- `Editar regl.`

### Ajustes recientes importantes

- `Admin > Resultados`
  - en mobile ya no usa cards
  - ahora usa una sola tabla horizontal flat
  - scroll tactil sin barra visible
- `Admin > Salon de la Fama`
  - scroll horizontal sin barra visible
- `Admin > Trofeos`
  - scroll horizontal sin barra visible
- `Admin > Equipos`
  - scroll horizontal sin barra visible
- `Admin > Jornadas`
  - se mantuvo tabla completa con desplazamiento horizontal
  - se restauraron acciones visibles como `Reabrir picks`, `Editar`, `Borrar jornada`
- `Admin > Usuarios`
  - acciones en horizontal tambien en mobile

## Nuevas rutas / modulos

- `/dashboard/quiniela-plus`
- `/dashboard/prizes`
- `/dashboard/admin/user-info`

## Archivos clave tocados recientemente

- `frontend/src/app/globals.css`
- `frontend/src/components/layout/dashboard-sidebar.tsx`
- `frontend/src/components/picks/pick-board.tsx`
- `frontend/src/components/settings/settings-page-content.tsx`
- `frontend/src/components/prizes/prizes-page-content.tsx`
- `frontend/src/components/quiniela-plus/quiniela-plus-page-content.tsx`
- `frontend/src/components/admin/admin-results-panel.tsx`
- `frontend/src/components/admin/admin-matchdays-panel.tsx`
- `frontend/src/components/admin/admin-matches-panel.tsx`
- `frontend/src/components/admin/admin-users-panel.tsx`
- `frontend/src/components/admin/admin-seasons-panel.tsx`
- `frontend/src/components/admin/admin-teams-panel.tsx`
- `frontend/src/components/admin/admin-trophies-panel.tsx`
- `frontend/src/components/admin/admin-hall-of-fame-panel.tsx`
- `frontend/src/components/admin/admin-rules-panel.tsx`
- `frontend/src/components/admin/admin-odds-panel.tsx`
- `frontend/src/components/admin/admin-user-info-panel.tsx`

## Backend importante que ya quedo

- `PrizeSummary` publico para pantalla `Premios`
- `Quiniela +` no requiere backend nuevo fuerte aun
- `Settings` ya guarda:
  - `modality`
  - `aval_profile_id`
  - `bank_name`
  - `deposit_account`
- `Admin > Info usuarios` ya consume esos datos

## Pendiente natural al retomar

1. Recorrer visualmente todas las pantallas en mobile y desktop para detectar remanentes de estilo viejo.
2. Revisar si alguna tabla todavia muestra barra visible o usa wrappers viejos.
3. Afinar detalles de spacing, widths y jerarquia tipografica.
4. Preparar la pasada final de deploy/webapp mobile.

## Comando para correr todo

```bash
cd /Users/davidoutonballina/Desktop/LIGAMX/APP && { kill -9 $(lsof -ti:8000) 2>/dev/null || true; kill -9 $(lsof -ti:3000) 2>/dev/null || true; } && bash /Users/davidoutonballina/Desktop/LIGAMX/APP/scripts/dev-up.sh
```

## Verificacion mas reciente

- `frontend`: `npm run build:verify`

## Marca de tiempo

- Generado el `2026-03-26 America/Mexico_City`
