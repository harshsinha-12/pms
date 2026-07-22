# Portfolio API

FastAPI backend backed by Redis and Yahoo Finance. Transactions are the source of truth;
holdings, P&L, allocation, returns, quote caches, and daily snapshots are derived data.

## Run locally

```bash
cd api
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
cp .env.example .env
# Fill in your Redis connection values in .env.
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

Interactive API documentation is available at `http://localhost:8000/docs`.

## API

- `GET /health` (also available at `GET /api/health`)
- `GET /api/instruments/search?q=reliance`
- `GET /api/portfolio`
- `GET /api/transactions`
- `POST /api/transactions`
- `PUT /api/transactions/{id}`
- `DELETE /api/transactions/{id}`
- `POST /api/refresh`

The create endpoint accepts an optional `price`. If omitted, the current Yahoo quote is
used; an explicitly supplied executed or average price always wins. USD transactions
capture their USD/INR rate so historical cost remains stable while current valuations use
the latest cached USD/INR rate.

## Tests

Tests use in-memory fakes and make no Redis or Yahoo Finance calls.

```bash
cd api
pytest -q
```
