# Checkpoint v1.08

## Estado actual

- La rama `main` esta sincronizada con GitHub.
- Backend y frontend siguen desplegandose desde el monorepo `Davidouton/QUINIELALIGAMX`.
- Se creo en Railway el servicio programado `Pick_reminders_cron`.
- El Cron esta configurado para ejecutarse cada 15 minutos:

```cron
*/15 * * * *
```

- El servicio usa una configuracion independiente para no iniciar FastAPI ni ejecutar migraciones:

```text
/backend/railway.cron.json
```

- Comando del Cron:

```bash
PYTHONPATH=. python scripts/send_pick_reminders.py --window-minutes 70
```

## Recordatorios push de picks

- Los recordatorios se envian por OneSignal.
- Se reutilizan las mismas variables del backend mediante referencias de Railway:
  - `APP_ENV`
  - `DATABASE_URL`
  - `FRONTEND_SITE_URL`
  - `ONESIGNAL_APP_ID`
  - `ONESIGNAL_REST_API_KEY`
- El usuario debe tener habilitados los recordatorios push y el permiso del navegador.
- La opcion visible actual programa el aviso aproximadamente una hora antes del cierre.
- Con el Cron cada 15 minutos, el aviso normalmente llega entre 45 y 60 minutos antes del cierre.
- Nunca se envia despues de que el pick ya cerro.
- El texto ya no promete una hora exacta:

```text
Tu pick esta proximo a cerrar
Aun no tienes pick en: AME vs CHI. El cierre esta proximo en Jornada X (fecha).
```

- La distribucion es progresiva por horario de cierre:
  - Si A cierra a las 17:00, se revisa cerca de las 16:00.
  - Si B cierra a las 19:00, se revisa cerca de las 18:00.
  - Si C cierra a las 21:00, se revisa cerca de las 20:00.
- Si varios partidos cierran a la misma hora, se agrupan en una sola notificacion.
- Solo aparecen los partidos que ese usuario todavia no ha pronosticado.
- Cada bloque se deduplica por torneo, horario de cierre, preferencia y usuario.

## Otras notificaciones push existentes

- Marcador, puntos y standings al terminar cada partido.
- Standing, puntos y podio al cierre/publicacion de la jornada.
- Estas notificaciones se disparan desde los flujos de resultados y publicacion; no dependen del Cron de recordatorios.

## Torneos privados de prueba

- Se agrego el estado de visibilidad `testing`.
- En Admin > Temporadas aparece como:

```text
Pruebas · solo usuarios asignados
```

- Un torneo de prueba:
  - No aparece en Inscripciones.
  - No admite autoinscripcion por API.
  - No puede configurarse como temporada default.
  - No es visible para usuarios sin autorizacion.
  - Oculta tambien sus jornadas y partidos a usuarios no autorizados.
- Los administradores siempre pueden verlo.
- Para autorizar a un usuario:
  1. Ir a Admin > Usuarios.
  2. Seleccionar el torneo de prueba.
  3. Usar `Dar de alta en el torneo`.
- La membresia activa de temporada funciona como permiso de visibilidad; no se creo una lista de acceso separada.
- Los torneos de prueba autorizados se tratan como torneos vigentes en:
  - Dashboard
  - Picks
  - Ranking
  - Reglas
  - Premios
  - Selectores generales de temporada
- `Inscripciones` conserva un filtro exclusivo para temporadas `live`, por lo que los torneos `testing` no se ofrecen para alta publica.

## Admin > Partidos

- Se corrigio el filtro por temporada en la lista editable.
- Antes, seleccionar una temporada solo filtraba las opciones del selector de jornadas y la tabla podia volver a cargar todos los partidos.
- Ahora:
  - Seleccionar una temporada muestra solo partidos de sus jornadas.
  - `Todas las jornadas` significa todas las jornadas de la temporada seleccionada.
  - Seleccionar una jornada limita la tabla a esa jornada.
  - Los administradores pueden filtrar tambien torneos privados de prueba.

## Railway

### Backend principal

- Mantiene `/backend/railway.json`.
- Inicia `uvicorn` y puede ejecutar las migraciones de arranque configuradas.

### Cron de recordatorios

- Debe usar `/backend/railway.cron.json` en Settings > Config-as-code.
- La configuracion correcta en Railway es:

```text
Root Directory:      /backend
Railway Config File: /backend/railway.cron.json
```

- Los cambios morados/staged de Railway deben aplicarse con `Review Changes > Deploy Changes`; un simple redeploy puede reutilizar la configuracion anterior.
- No debe tener dominio publico.
- No debe tener Healthcheck Path.
- Serverless queda desactivado por Railway al existir un Cron Schedule.
- Restart Policy queda en `Never`.
- Una ejecucion correcta imprime JSON y termina; no debe mostrar `Started server process`.

Ejemplo de salida valida sin recordatorios pendientes:

```json
{
  "dry_run": false,
  "now_utc": "...",
  "results": []
}
```

## Commits incluidos

```text
79895a3 Fix admin match filtering by season
89c05d5 Expose assigned testing tournaments across dashboard
825f66e Show assigned testing tournaments in picks
d335861 Add v1.08 checkpoint
c8e562f Add Railway config for reminder cron
9dbb235 Add private testing tournaments
76a2be2 Send pick reminders per lock window
1bf842f Fix matchday recalculation and odds resync matching
```

## Verificacion realizada

- Validacion de sintaxis Python con `py_compile`.
- Validacion de JSON para `backend/railway.cron.json`.
- `git diff --check` sin errores.
- Se agregaron pruebas para visibilidad de torneos de prueba y bloqueo de autoinscripcion.
- No se ejecutaron las suites completas locales porque el entorno no tenia instalados `pytest` ni las dependencias del frontend.

## Pendiente inmediato

1. Confirmar en Railway que la primera ejecucion de `Pick_reminders_cron` termine como `Completed/Succeeded`.
2. Confirmar que los logs impriman el JSON del script y no inicien `uvicorn`.
3. Probar un recordatorio real con un usuario que tenga push habilitado y un partido sin pick.
4. Validar en produccion que un torneo `Pruebas` asignado aparezca en Dashboard, Picks, Ranking, Reglas y Premios, pero no en Inscripciones.
5. Validar en Admin > Partidos que el filtro por temporada limite correctamente la tabla editable.

## Marca de tiempo

- Actualizado el `2026-07-18` en zona `America/Mexico_City`.
