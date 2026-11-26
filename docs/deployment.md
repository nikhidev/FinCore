# Deployment and recovery runbook

## Release governance

Use a protected main branch with required status checks. Require an independent reviewer for ledger, calculations, authentication and database changes. Include a migration impact and recovery note in each change touching persisted data. Tag approved releases with semantic version numbers. For a hotfix, branch from the deployed tag, reproduce the issue with a regression test, get review, and promote the new tag through staging. Merge the fix back to main.

## Staging and production-style deployment

Use a dedicated VM or managed container host. Assign a domain, configure its DNS, and use a reverse proxy with automatic HTTPS and the web container's loopback port as the upstream. Expose proxy ports only. Keep PostgreSQL, Redis, FastAPI and Express private. Inject unique credentials and confirmation/webhook settings through the host secret store. Set DEMO_MODE=false and build with NEXT_PUBLIC_DEMO_MODE=false. Keep production-style, staging and test databases, keys and network configuration separate. Use a distinct release migration identity for schema operations when replacing startup initialization with versioned migrations.

Record the release digest and check the web login, API readiness and healthy analytics. Confirm external traffic uses HTTPS and the database port is unreachable from outside the private network. Monitor readiness, sustained 5xx, API latency, database saturation, reconciliation mismatches, and backup age. Retain structured logs and correlate incidents using the response request ID. Roll back the application image only after confirming the database schema remains compatible.

## Backup and restore drill

Create a PostgreSQL custom-format dump with pg_dump. Encrypt the dump through the organization's backup key management and store it in a restricted backup destination. Record the resulting checksum and creation time. Restore using pg_restore into an isolated database. Verify user, wallet, transaction and event counts. Verify the journal net, postings without two legs, duplicate event identifiers, and wallet balances against journal totals. Record the timestamp and duration alongside retention and access-control checks.

## Incident exercise

Use a disposable database and run the Node integration suite. Trace the event timestamp and ID through Express and provider_events. For a duplicate event, confirm the stored receipt is reused and only one posting exists. For a mismatch or failed settlement, inspect the intent status and journal evidence. For an unbalanced posting, capture the deferred constraint rejection and verify zero net after rollback. For peak latency, compare structured duration and upstream analytics health before retrying. Document discovery time, decisions, affected intents, root cause, correction and proof of recovery.

GitHub controls, cloud hosting and the deployment drill require the target repository and environment. This runbook records the intended procedure for that phase.
