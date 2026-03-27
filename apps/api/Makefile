PYTHON ?= python3
VENV ?= .venv
PIP := $(VENV)/bin/pip
PY := $(VENV)/bin/python

.PHONY: setup start build test lint format migrate upgrade seed getodds getodds-dry

setup:
	$(PYTHON) -m venv $(VENV)
	$(PIP) install --upgrade pip
	$(PIP) install -e .[dev]

start:
	PYTHONPATH=. $(PY) -m uvicorn app.main:app --reload --reload-dir app --reload-exclude ".venv/*" --host 0.0.0.0 --port 8000

build:
	$(PY) -m compileall app

test:
	PYTHONPATH=. $(PY) -m pytest

lint:
	$(PY) -m ruff check .
	$(PY) -m black --check .

format:
	$(PY) -m ruff check --fix .
	$(PY) -m black .

migrate:
	PYTHONPATH=. $(PY) -m alembic revision --autogenerate -m "schema update"

upgrade:
	PYTHONPATH=. $(PY) -m alembic upgrade head

seed:
	$(PY) -m scripts.seed

getodds:
	PYTHONPATH=. $(PY) scripts/01_GetODDS.py

getodds-dry:
	PYTHONPATH=. $(PY) scripts/01_GetODDS.py --dry-run
