# FinCore

**A digital wallet, double-entry ledger, and payments operations simulator.**

FinCore shows how a wallet transfer moves from customer request to balanced ledger entries, then gives operations staff the tools to review payment events, investigate disputes, and reverse eligible transactions. The demo uses synthetic identities and simulated US dollars.

[Quick start](#quick-start) · [Demo walkthrough](#demo-walkthrough) · [Architecture](#architecture) · [Verification](#verification)

![FinCore customer dashboard showing a simulated USD balance, wallet actions, and quick access links](docs/dashboard.jpg)

## What you can do

| Workspace | Capabilities |
| :--- | :--- |
| **Customer** | Manage wallets and beneficiaries, send funds, simulate top-ups, export CSV statements, and raise disputes. |
| **Operations** | Reconcile provider events, review risk signals and audit records, and resolve disputes. |
| **Finance** | Refund eligible payments and reverse transfers through compensating ledger entries. |

## Quick start

### Docker Compose

Copy [`.env.example`](.env.example) to `.env`. Set `POSTGRES_PASSWORD` and use the same password in `COMPOSE_DATABASE_URL`, URL-encoded if needed. Set a local `WEBHOOK_SECRET`, choose a six-digit `SIMULATION_MFA_CODE`, and enable `DEMO_MODE=true`.

```sh
docker compose up --build
```

Open [localhost:3000](http://127.0.0.1:3000/) and choose a demo workspace. The dashboard binds to loopback. The API, database, analytics service, and Redis stay on the Compose network.

<details>
<summary><strong>Run without Docker on Windows</strong></summary>

Install Node.js 20 or later, PostgreSQL 16, and Python 3.12. Create a dedicated PostgreSQL database and give the application user permission to create tables. In three PowerShell terminals opened at the repository root:

**Terminal 1 · Express API**

```powershell
npm ci
$env:DATABASE_URL = 'postgresql://fincore:YOUR_LOCAL_PASSWORD@127.0.0.1:5432/fincore'
$env:DEMO_MODE = 'true'
npm run api
```

The API initializes its schema and seeds demo accounts on startup. Update the connection string to match your database.

**Terminal 2 · FastAPI analytics**

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r analytics/requirements.txt
.\.venv\Scripts\python.exe -m uvicorn analytics.main:app --host 127.0.0.1 --port 8000
```

**Terminal 3 · Next.js dashboard**

```powershell
npm run dev
```

| Service | Local endpoint |
| :--- | :--- |
| Dashboard | [localhost:3000](http://127.0.0.1:3000/) |
| API readiness | [localhost:4000/ready](http://127.0.0.1:4000/ready) |
| Analytics API docs | [localhost:8000/docs](http://127.0.0.1:8000/docs) |

</details>

## Demo walkthrough

1. **Post a transfer.** In **Customer demo**, send $25 to Jordan Lee. Compare the wallet balance and statement before and after the transfer.
2. **Test settlement.** Under **Wallets**, simulate one successful top-up and one failed top-up. The successful settlement credits the wallet and the failed one stays in payment history.
3. **Review a dispute.** Raise a dispute on a posted transaction. Switch to **Operations demo** to review it and inspect provider events, risk alerts, and audit history.
4. **Reverse the transfer.** Copy an eligible transfer reference from **Recent postings**, then use **Finance demo** to post a reversal and inspect the resulting entries.

The default synthetic password is `FinCoreDemo!2026`. Use confirmation code `246810` or the code you set in `SIMULATION_MFA_CODE`.

## Architecture

```mermaid
flowchart LR
    Web["Next.js dashboard"] --> API["Express API"]
    API --> Db["PostgreSQL ledger"]
    API --> Analytics["FastAPI analytics"]
    Provider["Simulated payment provider"] -->|Signed events| API
```

- **Ledger.** Money is stored as integer cents. PostgreSQL requires two balanced journal entries for every posting. Transfers update the affected balances atomically.
- **Payments.** Request keys protect retries, and signed provider events are deduplicated before settlement. Refunds and reversals preserve the original record and write a compensating posting.
- **Analytics.** FastAPI uses decimal arithmetic for fees, interest, and reconciliation. Risk signals support staff review of synthetic activity.

## Verification

| Suite | Local result |
| :--- | :--- |
| API integration | 6 passed |
| Python analytics | 4 passed |
| Browser end-to-end | 3 passed |
| Next.js production build | Passed |
| PostgreSQL restore drill | Zero-cent journal net and zero wallet balance mismatches |

See the [verification evidence](docs/evidence.md) for concurrent transfers, duplicate provider events, failed settlement, reversals, and analytics timeout recovery.

<details>
<summary><strong>Run the tests</strong></summary>

Use a disposable PostgreSQL database for the API suite. Start the API and dashboard with demo data before running Playwright.

```powershell
$env:DATABASE_URL = 'postgresql://fincore:YOUR_LOCAL_PASSWORD@127.0.0.1:5432/fincore_test'
$env:DEMO_MODE = 'true'
npm test
.\.venv\Scripts\python.exe -m pytest analytics
npm run build
npx playwright install chromium
npm run test:e2e
```

Set `FINCORE_PREVIEW_URL` for a different dashboard port or `FINCORE_BROWSER_CHANNEL` to use an installed Chrome or Edge browser.

</details>

## Documentation

| Reference | Contents |
| :--- | :--- |
| [Architecture and assessment coverage](docs/architecture.md) | Data model, ledger rules, and assessment status |
| [OpenAPI specification](docs/openapi.json) · [Postman collection](docs/fincore.postman_collection.json) | API contracts and local requests |
| [Deployment and recovery](docs/deployment.md) | Release, rollback, backups, and incident procedures |

FinCore is a local capstone demonstration. External provider and notification integrations, ledger holds, background workers, and deployment evidence remain open.
