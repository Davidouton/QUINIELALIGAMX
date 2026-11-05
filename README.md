# QuinielaMaestra

Monorepo base para una quiniela profesional de Liga MX con frontend en Next.js, backend en FastAPI y base de datos en Supabase Postgres.

## Estructura recomendada

```text
/quinielamaestra
  /frontend   -> Next.js 15 + TypeScript + Tailwind CSS
  /backend    -> FastAPI + SQLAlchemy + lógica de negocio
  /database   -> SQL inicial, seeds y políticas para Supabase
  /docs       -> arquitectura, contratos y decisiones técnicas
```

Nota: el directorio `apps/api` permanece como legado del workspace anterior. La nueva base de trabajo para `QuinielaMaestra` vive en `frontend`, `backend` y `database`.

## Stack

- Frontend: Next.js 15 + TypeScript + Tailwind CSS
- Backend: FastAPI + SQLAlchemy
- Base de datos: Supabase Postgres
- Auth: Supabase Auth
- Deploy frontend: Vercel

## Primer flujo V1

1. Registro o login con Supabase Auth
2. Backend valida JWT emitido por Supabase
3. Usuario consulta jornada activa
4. Usuario consulta partidos de la jornada
5. Usuario captura picks
6. Backend guarda picks y valida cierre
7. Usuario consulta sus picks
8. Usuario consulta leaderboard general o por jornada

## Setup rápido

### Backend

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"
cp .env.example .env
uvicorn app.main:app --reload --port 8000
```

### Frontend

```bash
cd frontend
npm install
cp .env.example .env.local
npm run dev
```

### Base de datos

1. Crear proyecto en Supabase.
2. Ejecutar `database/sql/000_init.sql`.
3. Ejecutar `database/seeds/001_seed_v1.sql`.

## Documentación

- [Arquitectura](./docs/ARCHITECTURE.md)
- [API inicial](./docs/API.md)

## Quinielón Semanal

En **Administración → VIP**, elige el modo **Quinielón Semanal**,
el importe de entrada y los porcentajes de premios. Este modo es independiente
de las temporadas. Guarda la VIP y registra sus
10 partidos con local, visitante y fecha/hora de Ciudad de México. Selecciona un
partido común para el desempate. Las inscripciones se habilitan cuando los diez
partidos están configurados.

Los participantes aprobados registran local, empate o visitante en **VIP**. Cada
acierto vale un punto. Cada pronóstico cierra exactamente diez minutos antes de
su partido; los demás siguen abiertos hasta su propio cierre. El total de goles
del partido de desempate se guarda con su pronóstico y cierra al mismo tiempo.
Las inscripciones públicas cierran con el primer partido; el administrador puede
dar acceso después, pero no habilita pronósticos de partidos ya cerrados.

El administrador captura los marcadores oficiales y el ranking se actualiza al
consultarlo. A igualdad de aciertos, gana la menor diferencia absoluta con el
total de goles del desempate. Si el empate persiste, se comparten los premios de
las posiciones ocupadas, como en la liquidación VIP. La bolsa sigue sumando una
entrada por miembro aprobado, con su estado de pago independiente.

Los partidos y el desempate quedan fijos al recibir el primer pronóstico o
alcanzar el primer cierre. Para cerrar la VIP y pasar a liquidación deben estar
registrados los diez resultados.

Antes de desplegar este modo, ejecuta `database/sql/040_vip_weekly_pool.sql` en
Supabase; después publica backend y frontend. La migración crea únicamente las
tablas de este modo, con RLS y acceso de escritura a través del backend. Railway
tiene las migraciones automáticas de arranque desactivadas.

### Archivo e independencia de temporadas

El catálogo VIP permite buscar por nombre y consultar **Activas** o
**Archivadas**. El administrador puede **Archivar** una VIP y después
**Restaurarla**. Archivar la retira del catálogo activo y bloquea nuevas
inscripciones y pronósticos; conserva resultados, participantes, pagos y el
estado de liquidación. Los pagos pendientes pueden seguir administrándose.

Para actualizar una instalación existente sin interrumpir el backend anterior:

1. Aplicar `041_vip_archive_and_optional_season.sql`.
2. Desplegar el backend y frontend actualizados, que aceptan temporadas nulas.
3. Aplicar `042_detach_weekly_vip_seasons.sql` para separar los Quinielones
   existentes de sus temporadas anteriores, conservando todos sus registros.
