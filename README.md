# FinCore

FinCore is a digital wallet and payments simulator for demonstrating how money movement, ledger integrity, reconciliation, and dispute handling work together. It uses synthetic identities and simulated US dollars. Keep the demo on a local or isolated test environment.

## What you can try

| Workspace | Features |
| --- | --- |
| Customer | Wallet balances, beneficiaries, transfers, simulated top-ups, CSV statements, and disputes |
| Operations | Provider event reconciliation, risk alerts, ledger totals, audit history, and dispute review |
| Finance | Refunds and reversals through compensating ledger entries |

## Architecture

The Next.js dashboard calls an Express API, which owns sessions, wallets, payments, disputes, and the PostgreSQL ledger. A separate Python FastAPI service computes fees, interest, reconciliation differences, and risk signals. Redis is provisioned in Compose for future background jobs.

Financial amounts are stored as integer cents. PostgreSQL checks each posting for two balanced journal entries. Transfers update balances atomically, request keys protect retries, and signed payment events are deduplicated. A reversal creates a new posting and preserves the original history.

## Run locally

Install Node.js 20 or later, PostgreSQL 16, and Python 3.12. Create a dedicated PostgreSQL database and give the application user permission to create tables. The API initializes its schema and seeds synthetic accounts when demo mode is enabled.

Run the following from the repository root in three PowerShell terminals. Adjust the database URL for your PostgreSQL instance.

**1. Start the API**

```powershell
npm ci
$env:DATABASE_URL = 'postgresql://fincore:YOUR_LOCAL_PASSWORD@127.0.0.1:5432/fincore'
$env:DEMO_MODE = 'true'
npm run api
```

**2. Start analytics**

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r analytics/requirements.txt
.\.venv\Scripts\python.exe -m uvicorn analytics.main:app --host 127.0.0.1 --port 8000
```

**3. Start the dashboard**

```powershell
npm run dev
```

| Service | Default URL |
| --- | --- |
| Dashboard | [localhost:3000](http://127.0.0.1:3000/) |
| API readiness | [localhost:4000/ready](http://127.0.0.1:4000/ready) |
| Analytics API docs | [localhost:8000/docs](http://127.0.0.1:8000/docs) |

### Docker Compose

Copy `.env.example` to `.env`. Set matching values for `POSTGRES_PASSWORD` and the password in `COMPOSE_DATABASE_URL`. URL-encode the password in the connection string when needed. Set `WEBHOOK_SECRET`, choose a six-digit `SIMULATION_MFA_CODE`, and set `DEMO_MODE=true`. Run `docker compose up --build` and open the dashboard. The web port binds to loopback and the remaining services stay on the Compose network.

## Demo walkthrough

1. Select **Customer demo** and send $25 in simulated funds to Jordan Lee. Confirm that the balance and statement both reflect the transfer. For sensitive actions, the default synthetic password is `FinCoreDemo!2026` and the default confirmation code is `246810`. Use your configured code if you changed it.
2. Under **Wallets**, simulate a successful and a failed top-up. The successful settlement credits the wallet. The failed payment stays in payment history with no balance change.
3. Raise a dispute on a posted transaction. Sign out and select **Operations demo** to review the dispute and inspect reconciliation outcomes, audit entries, and risk alerts.
4. Select **Finance demo** to reverse an eligible transfer using its reference from **Recent postings**.

## Tests and verification

Use a separate disposable database for API tests because the suite creates synthetic records. Before running Playwright, start the API and dashboard with demo data.

```powershell
$env:DATABASE_URL = 'postgresql://fincore:YOUR_LOCAL_PASSWORD@127.0.0.1:5432/fincore_test'
$env:DEMO_MODE = 'true'
npm test
.\.venv\Scripts\python.exe -m pytest analytics
npm run build
npx playwright install chromium
npm run test:e2e
```

Set `FINCORE_PREVIEW_URL` if your dashboard uses a different port. Set `FINCORE_BROWSER_CHANNEL=chrome` or `msedge` to use an installed browser.

Local verification recorded 6 API tests, 4 Python tests, and 3 browser tests passing. The restore drill recovered a database with a zero-cent journal net and zero wallet balance mismatches. See the [verification evidence](docs/evidence.md) for the results of concurrent transfers, duplicate payment events, settlement failures, reversals, and analytics timeout recovery.

## Project files

| Path | Purpose |
| --- | --- |
| [app/](app/) | Next.js customer and staff dashboards |
| [api/](api/) | Express API, PostgreSQL schema, and transaction logic |
| [analytics/](analytics/) | FastAPI calculators, risk rules, and Python tests |
| [test/](test/) and [e2e/](e2e/) | API integration tests and browser tests |
| [compose.yaml](compose.yaml) | Local container configuration |
| [docs/](docs/) | Architecture, API contracts, verification, and recovery |

## Documentation and project status

- [Architecture and assessment coverage](docs/architecture.md)
- [OpenAPI specification](docs/openapi.json) and [Postman collection](docs/fincore.postman_collection.json)
- [Deployment and recovery runbook](docs/deployment.md)

The current release is a local capstone demonstration. External provider and notification integrations, ledger holds, background workers, and deployment evidence remain open.
