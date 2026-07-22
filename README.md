# Portfolio Management System

A personal portfolio dashboard for tracking Indian equities, US equities, and Indian ETFs in one place. Add a holding by ticker, record its purchase details, refresh live quotes on demand, and follow portfolio performance through allocation, return metrics, and a daily value history.

## What it includes

- Symbol lookup and quote retrieval for Yahoo Finance-compatible instruments
- Holdings with quantity, average purchase price, and purchase date
- Editable purchase prices so broker-reported averages can be recorded exactly
- A unified view across Indian stocks, US stocks, and Indian ETFs
- On-demand price refresh with a daily portfolio snapshot
- Portfolio value, invested capital, unrealized gain/loss, absolute return, CAGR, and XIRR
- Allocation and historical portfolio-value charts
- Redis-backed persistence for holdings, quote metadata, and daily snapshots
- Responsive Vite/React interface and a FastAPI JSON API

## Architecture

```text
Browser
  -> web/   Vite + React dashboard
  -> api/   FastAPI application
              -> Yahoo Finance via yfinance (quotes and price history)
              -> Redis (holdings and daily portfolio snapshots)
```

The browser never connects to Redis directly. Credentials remain server-side in the API environment. The API stores user-entered transactions and one portfolio snapshot per calendar day; refreshing again on the same day updates that day's snapshot instead of creating duplicate chart points.

Yahoo Finance symbols must be used as published. For example, NSE symbols generally end in `.NS`, BSE symbols in `.BO`, and US symbols typically use their exchange ticker without a suffix. Indian ETFs listed on NSE also normally use `.NS`.

## Prerequisites

- Node.js 20 or newer and npm
- Python 3.11 or newer
- Access to a Redis server

## Configuration

Copy the safe template, then edit `.env` with your own Redis connection values:

```bash
cp .env.example .env
```

Do not commit `.env`. Environment files are ignored by Git, while `.env.example` contains placeholders and documents the supported API, Redis, portfolio, and market-data settings. If a Redis password has been pasted into chat, source control, logs, or another non-secret channel, rotate it before using the deployment.

`REDIS_URL` is optional. Leave it blank when using `REDIS_USERNAME`, `REDIS_PASSWORD`, `REDIS_HOST`, and `REDIS_PORT`. Define `REDIS_PORT` only once: a later duplicate entry overrides the earlier one. The active local configuration uses the supplied Redis Cloud port rather than the default Redis port.

The frontend uses same-origin `/api` requests. In local development, Vite proxies those requests to FastAPI at `http://127.0.0.1:8000`; in production, configure the web server or platform to route `/api/*` to the API service.

## Install and run

From the repository root, install both applications with:

```bash
make setup
```

The equivalent manual commands are `python3 -m venv api/.venv`, `api/.venv/bin/python -m pip install -r api/requirements.txt`, and `npm --prefix web install`.

### 1. Start the API

From the repository root, run:

```bash
make api
```

The interactive API reference is available at [http://127.0.0.1:8000/docs](http://127.0.0.1:8000/docs).

### 2. Start the web app

In another terminal, from the repository root, run:

```bash
make web
```

Open the local URL printed by Vite, normally [http://localhost:5173](http://localhost:5173).

### Manual commands by directory

If you prefer not to use `make`, run the API and web app in separate terminals:

```bash
# Terminal 1 — repository root
cd "/path/to/portfolio-management-system"
python3 -m venv api/.venv
api/.venv/bin/python -m pip install -r api/requirements.txt
api/.venv/bin/python -m uvicorn api.app.main:app --reload --host 0.0.0.0 --port 8000
```

```bash
# Terminal 2 — web directory
cd "/path/to/portfolio-management-system/web"
npm install
npm run dev
```

Then open [http://localhost:5173](http://localhost:5173). The frontend proxies `/api` requests to the API on port `8000`.

## API at a glance

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/health` | Check API and Redis readiness |
| `GET` | `/api/instruments/search?q=...` | Find supported Yahoo Finance instruments |
| `GET` | `/api/portfolio` | Read holdings, totals, metrics, allocations, and history |
| `GET`, `POST` | `/api/transactions` | List or add dated purchase transactions |
| `PUT`, `DELETE` | `/api/transactions/{id}` | Update or remove a transaction |
| `POST` | `/api/refresh` | Refresh quotes and upsert today's portfolio snapshot |

The transaction is the source of truth: a holding can contain multiple purchases, each with its own date, quantity, and price. The API aggregates transactions by instrument for the uniform holdings view and uses the dated cash flows for XIRR.

## Production checks

Run the API import check and production frontend build together from the repository root:

```bash
make check
```

The compiled frontend assets are written beneath `web/dist`.

## Railway backend deployment

Create the Railway service from this repository and set its **Root Directory** to `/api`. Railpack then reads `api/railpack.json`, installs the Python dependencies from `api/requirements.txt`, and starts FastAPI with:

```bash
uvicorn app.main:app --host 0.0.0.0 --port $PORT
```

Add the API, Redis, portfolio, and market-data values from the local environment as Railway service variables. Do not add Redis credentials to the Vercel frontend project. After deployment, generate a Railway public domain and verify `/api/health` before connecting the frontend.

## Vercel frontend deployment

Create the Vercel project from this repository with these settings:

- **Root Directory:** `web`
- **Framework Preset:** Vite
- **Build Command:** `npm run build`
- **Output Directory:** `dist/client`

`web/vercel.json` preserves the frontend's existing same-origin `/api/*` requests and proxies them to `https://pms-production-dba2.up.railway.app/api/*` on Railway. No Railway URL environment variable is needed in Vercel.

After Vercel creates the production deployment, copy its stable URL from **Settings → Domains**. In the Railway API service's **Variables** tab, set:

```env
API_CORS_ORIGINS=https://your-project.vercel.app
```

Multiple allowed frontend origins can be comma-separated without quotes. Use origins only, with no path or trailing slash. Redeploy Railway after changing the variable, then redeploy Vercel so the rewrite configuration and environment variable are active.

For production, serve the generated frontend assets from `web/dist`, run FastAPI behind a production ASGI process, route `/api/*` to it, restrict CORS to the deployed frontend origin, use TLS, and keep Redis inaccessible from the public internet. This project is designed as a personal portfolio tracker; add authentication and per-user data isolation before exposing it to other users.

## How performance is interpreted

- **Invested value:** sum of quantity multiplied by recorded average purchase price.
- **Current value:** sum of quantity multiplied by the latest stored quote.
- **Absolute return:** total unrealized gain or loss divided by invested value.
- **CAGR:** annualized return from the earliest recorded purchase to the current portfolio value. It is most meaningful for a single initial investment.
- **XIRR:** money-weighted annualized return using dated purchases as negative cash flows and current portfolio value as the final positive cash flow.

These metrics depend on the completeness and accuracy of the entered transactions. Deposits, withdrawals, dividends, fees, taxes, stock splits, sales, and currency conversion can materially affect performance. Unless they are explicitly entered and modeled, the displayed figures should be treated as indicative rather than broker- or tax-grade calculations.

## Market-data and legal notice

Market data is obtained through the unofficial `yfinance` interface to Yahoo Finance and may be delayed, incomplete, adjusted, temporarily unavailable, or subject to symbol and exchange-specific differences. Yahoo Finance can change its endpoints or availability without notice. Cache responsibly and review Yahoo's terms before deploying or redistributing data.

This software is for personal record-keeping and educational use. It does not provide investment, tax, accounting, or legal advice, and the displayed data should not be used as the sole basis for a trading decision. Verify prices, corporate actions, returns, and tax lots against official exchange data and your broker statements.
