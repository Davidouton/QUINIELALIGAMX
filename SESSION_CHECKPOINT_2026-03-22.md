# Checkpoint 2026-03-22

## Estado actual

- La app ya tiene una experiencia de usuario bastante mas clara:
  - `Dashboard`
  - `Picks Center`
  - `Settings`
  - `Leaderboard`
  - `Admin`
- `Dashboard` ya funge como home principal del usuario.
- `Settings` ya existe y guarda datos de perfil reales.
- Se agrego la base de tema por `equipo favorito`.
- Se agrego una tabla de probabilidades en `Dashboard` sacada desde odds guardados.

## Cambios importantes hechos hoy

### Settings

- Se creo la pagina:
  - `frontend/src/app/(dashboard)/dashboard/settings/page.tsx`
- Se creo el formulario principal:
  - `frontend/src/components/settings/settings-page-content.tsx`
- Campos ya soportados:
  - `NickName`
  - `Correo`
  - `Telefono`
  - `Cuenta de deposito`
  - `Equipo favorito`
  - `Ambiente`
- `Ambiente` soporta:
  - `standard`
  - `favorite_team`

### Tema por equipo favorito

- Se agrego un bridge de tema del dashboard:
  - `frontend/src/components/layout/dashboard-theme-bridge.tsx`
- Se agrego logica de tokens de color:
  - `frontend/src/lib/theme/app-theme.ts`
- Se conectaron variables CSS globales para poder pintar el dashboard segun el equipo favorito:
  - `frontend/src/app/globals.css`

### Backend de perfil

- El modelo `Profile` ya tiene:
  - `favorite_team_id`
  - `contact_phone`
  - `deposit_account`
  - `theme_preference`
- Se agrego soporte de lectura/escritura por `GET /me` y `PUT /me`
- Se agrego migracion ligera al startup para columnas nuevas de `profiles`

Archivos backend principales:

- `backend/app/models/entities.py`
- `backend/app/schemas/profile.py`
- `backend/app/repositories/profile_repository.py`
- `backend/app/services/profile_service.py`
- `backend/app/api/v1/routes/me.py`
- `backend/app/main.py`

### Dashboard principal

- La pagina principal del usuario `/dashboard` ya fue alineada como `Dashboard`.
- El sidebar ya no dice `Resumen`; ahora dice `Dashboard`.
- La home ya tiene CTA rapidos a:
  - `Picks Center`
  - `Settings`

Archivos:

- `frontend/src/components/dashboard/dashboard-home.tsx`
- `frontend/src/components/layout/dashboard-sidebar.tsx`
- `frontend/src/components/layout/top-nav.tsx`

### Probabilidades desde odds

- Se agrego una tabla `Mercado deviggeado` dentro de `Dashboard`.
- La logica vive en backend y sale junto con `MatchOut`.
- El servicio toma `home_value`, `draw_value`, `away_value` y calcula:
  - implied probability
  - remocion de vig via normalizacion

Archivos:

- `backend/app/repositories/odds_repository.py`
- `backend/app/services/match_service.py`
- `backend/app/schemas/match.py`
- `frontend/src/types/api.ts`
- `frontend/src/components/dashboard/dashboard-home.tsx`

## Bug encontrado al final del dia

- La tabla de probabilidades mostraba `NaN%`.
- Causa:
  - los odds guardados venian en formato `American odds`
  - el calculo inicial los trataba como `decimal odds`
- Ya se corrigio el backend para soportar:
  - odds americanas positivas
  - odds americanas negativas
  - odds decimales

Archivo corregido:

- `backend/app/services/match_service.py`

## Pendiente inmediato para retomar manana

1. Reiniciar backend para que tome el fix final de probabilidades.
2. Refrescar `/dashboard` y confirmar que desaparecen los `NaN%`.
3. Si ya salen bien los porcentajes, decidir si tambien mostramos:
   - fair odds
   - provider/bookmaker
   - orden por mayor probabilidad

## Comando recomendado al volver

```bash
cd /Users/davidoutonballina/Desktop/LIGAMX/APP
pkill -f "uvicorn app.main:app" || true
pkill -f "next dev" || true
make dev-up
```

Luego revisar:

```text
http://localhost:3000/dashboard
http://localhost:3000/dashboard/settings
```

## Verificacion hecha

- `backend`: `py_compile`
- `frontend`: `tsc --noEmit`

## Marca de tiempo

- Generado el `2026-03-22 00:20:17 CST`
