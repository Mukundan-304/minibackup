# Sentinel Adaptive API Shield

A local API protection demo with a FastAPI behavioral engine and a React dashboard. It combines per-client token buckets with rolling request history, EWMA rate estimates, behavioral risk scoring, and four policy states.

## Requirements

- Python 3.12
- Node.js LTS and npm

## Start in development

From PowerShell, start the API in one terminal:

```powershell
Set-Location D:\HybridSmartAPILimiter
.\.venv312\Scripts\python.exe -m uvicorn app.main:app --reload
```

In a second terminal, start the React dashboard:

```powershell
Set-Location D:\HybridSmartAPILimiter\frontend
npm install
npm run dev
```

Open the Vite URL printed in the second terminal (normally `http://localhost:5173`). Vite proxies `/api` and `/admin` requests to FastAPI on port 8000.

## Dashboard controls

- **Send test request** records a successful `/api/data` request.
- **Normal request**, **Simulate burst**, and **Trigger failure** exercise the API using the selected client ID.
- **Reset data** clears the in-memory client and event history.
- Metrics and client policies refresh automatically every two seconds.

## Build and serve the dashboard from FastAPI

```powershell
Set-Location D:\HybridSmartAPILimiter\frontend
npm install
npm run build
Set-Location D:\HybridSmartAPILimiter
.\.venv312\Scripts\python.exe -m uvicorn app.main:app
```

When `frontend\dist` exists, FastAPI serves the built dashboard at `http://127.0.0.1:8000/`. API documentation remains available at `http://127.0.0.1:8000/docs`.

## API routes

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/data` | Record a successful request for `X-Client-ID` |
| `GET` | `/api/fail` | Record an intentional test failure |
| `GET` | `/admin/status` | Read current clients, metrics, policy, and token state |
| `GET` | `/admin/events` | Read recent events; accepts `limit` from 1 to 500 |
| `POST` | `/admin/reset` | Clear in-memory client and event state |

State is stored in process memory and resets when the API restarts. The admin routes are unauthenticated for this localhost demo; do not expose the server to an untrusted network without adding authentication and access controls.
