# Arquitectura QuinielaMaestra

## Principios

- Separacion estricta entre `frontend`, `backend` y `database`
- Supabase Auth para autenticacion; backend como fuente principal de autorizacion y negocio
- FastAPI modular por dominio
- SQL de Supabase como contrato inicial de datos
- Capa provider para integraciones deportivas externas
- Preparado para crecer hacia workers, cron jobs y recalculos asincronos

## Vista general

```text
Frontend (Next.js)
  -> Supabase Auth
  -> Backend REST API

Backend (FastAPI)
  -> JWT validation de Supabase
  -> Services / repositories
  -> Postgres (Supabase)
  -> Provider adapters

Database (Supabase Postgres)
  -> tablas operativas
  -> scoring
  -> leaderboards
  -> triggers y RLS recomendadas
```

## Dominios del backend

- `auth/profile`: identidad, perfil y roles
- `matchdays`: temporadas y jornadas
- `matches`: partidos y resultados
- `picks`: captura y edicion con reglas de cierre
- `leaderboard`: ranking por jornada y general
- `admin`: sync, publicacion y cambios de rol
- `providers`: contratos con APIs deportivas externas

## Flujo de autenticacion

1. Frontend autentica contra Supabase Auth.
2. Frontend obtiene access token.
3. Frontend consume FastAPI con bearer token.
4. FastAPI valida el JWT y busca el `profile`.
5. Roles y permisos se controlan desde `profiles.role_code`.

## Estrategia de integracion externa

- `providers/base.py` define el contrato
- `providers/mock_provider.py` permite desarrollo temprano
- `services/sync_matches.py`, `sync_results.py`, `sync_odds.py` encapsulan mapeo y persistencia
- Cambiar de proveedor no debe tocar routers ni modelos de negocio

## Escalabilidad prevista

- V1: sync manual via endpoints admin
- V2: jobs programados para sync y recalculo
- V3: colas o workers para procesos largos

