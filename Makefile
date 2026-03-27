.PHONY: frontend-install frontend-dev backend-install backend-dev dev-up

frontend-install:
	cd frontend && npm install

frontend-dev:
	cd frontend && npm run dev

backend-install:
	cd backend && python3 -m venv .venv && . .venv/bin/activate && pip install -e ".[dev]"

backend-dev:
	cd backend && . .venv/bin/activate && uvicorn app.main:app --reload --port 8000 --ws none

dev-up:
	bash scripts/dev-up.sh
