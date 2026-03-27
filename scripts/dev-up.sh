#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND_DIR="$ROOT_DIR/backend"
FRONTEND_DIR="$ROOT_DIR/frontend"
INTERRUPTED=0

cleanup() {
  trap - EXIT INT TERM

  if [[ -n "${FRONTEND_PID:-}" ]] && kill -0 "$FRONTEND_PID" 2>/dev/null; then
    kill "$FRONTEND_PID" 2>/dev/null || true
  fi

  if [[ -n "${BACKEND_PID:-}" ]] && kill -0 "$BACKEND_PID" 2>/dev/null; then
    kill "$BACKEND_PID" 2>/dev/null || true
  fi
}

handle_interrupt() {
  INTERRUPTED=1
  cleanup
}

trap cleanup EXIT
trap handle_interrupt INT TERM

if [[ ! -x "$BACKEND_DIR/.venv/bin/python" ]]; then
  echo "Falta backend/.venv. Corre la instalacion del backend primero."
  exit 1
fi

if [[ ! -x "$FRONTEND_DIR/node_modules/next/dist/bin/next" ]]; then
  echo "Falta frontend/node_modules. Corre npm install en frontend primero."
  exit 1
fi

echo "Levantando backend en http://127.0.0.1:8000 ..."
(
  cd "$BACKEND_DIR"
  source .venv/bin/activate
  exec uvicorn app.main:app --reload --host 127.0.0.1 --port 8000 --ws none
) &
BACKEND_PID=$!

echo "Levantando frontend en http://localhost:3000 ..."
(
  cd "$FRONTEND_DIR"
  exec npm run dev:reset
) &
FRONTEND_PID=$!

echo "Backend PID: $BACKEND_PID"
echo "Frontend PID: $FRONTEND_PID"
echo "Presiona Ctrl+C para detener ambos."

wait
WAIT_STATUS=$?

if [[ "$INTERRUPTED" -eq 1 ]]; then
  echo "Servicios detenidos."
  exit 0
fi

exit "$WAIT_STATUS"
