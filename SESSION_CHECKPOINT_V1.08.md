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

## Railway

### Backend principal

- Mantiene `/backend/railway.json`.
- Inicia `uvicorn` y puede ejecutar las migraciones de arranque configuradas.

### Cron de recordatorios

- Debe usar `/backend/railway.cron.json` en Settings > Config-as-code.
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
4. Crear un torneo `Pruebas`, asignar un usuario desde Admin > Usuarios y validar visibilidad con una cuenta autorizada y otra no autorizada.

## Marca de tiempo

- Generado el `2026-07-17` en zona `America/Mexico_City`.
