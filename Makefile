PYTHON ?= python3
API_PYTHON := api/.venv/bin/python

.PHONY: setup install-api install-web api web build check

setup: install-api install-web

install-api:
	$(PYTHON) -m venv api/.venv
	$(API_PYTHON) -m pip install -r api/requirements.txt

install-web:
	npm --prefix web install

api:
	$(API_PYTHON) -m uvicorn api.app.main:app --reload --host 0.0.0.0 --port 8000

web:
	npm --prefix web run dev

build:
	npm --prefix web run build

check:
	cd api && .venv/bin/python -m pytest tests -q
	npm --prefix web run build
	npm --prefix web run test:sites
