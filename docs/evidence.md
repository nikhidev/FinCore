# Local verification evidence

## Integration suite

Six PostgreSQL-backed Supertest cases passed locally. The suite exercises session and role errors, input validation, wallet ownership, the signature check, settlement amount mismatch, concurrent event replay, failed settlement, concurrent overspending, transfer retries, idempotency conflicts, compensating reversals, immutable entries, rejection of an unbalanced posting, dispute ownership, CSV export, session revocation and an upstream timeout followed by recovery.

Four pytest cases passed for rounding, fee and interest calculation, statement precision, reconciliation, risk flags and invalid inputs. The local correctness benchmark processed 10,000 rounded Decimal values in 6.38 ms and produced the expected sum of 200.00. The Next.js production build and its type check passed.

Three Playwright cases passed in Chrome. They covered customer sign-in and statement download, invalid transfer amount feedback, and mobile navigation in the operations workspace. A live operations request through Next.js and Express returned synthetic risk analysis from FastAPI.

## Restore drill

A PostgreSQL custom-format dump of the integration database was restored into a fresh local database. The restored copy contained 9 postings and 3 provider events. Journal net was 0 cents and the wallet balance comparison found 0 mismatches. Backup, restore and verification took 2.96 seconds. The drill used synthetic data on loopback. Cloud backup encryption and recovery remain to be demonstrated.

## Incident results

| Scenario | Observed result |
| --- | --- |
| Concurrent overspending | Two requests tried to send 800 cents from a 1,000-cent wallet. One posted and one received a 409. Remaining balance was 200 cents. |
| Duplicate signed event | Two requests shared one provider event ID. One receipt was marked a duplicate and the wallet was credited once. |
| Settlement mismatch | A 999-cent event for a 1,000-cent intent was recorded as a mismatch, leaving the intent pending. |
| Failed settlement | Intent status was failed. The posting ID was empty and wallet balance stayed unchanged. |
| Reversal and replay | Reversal restored the original balances. Its retry returned the same compensation. A second compensation was rejected. |
| Unbalanced write | PostgreSQL rejected the attempted posting without both journal entries. Posted journal net remained zero. |
| Analytics latency | A controlled upstream stall returned a request-correlated 503 after about 2.5 seconds. The next request succeeded once the fixture responded. |
