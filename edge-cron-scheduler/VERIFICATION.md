# DEV-833 repair verification — 2026-09-08

Source: PR #173, base commit `6d9a1792fa6f1803ba53328639890b3ed6871079`.

## Passing

- Clean dependency install; published Edge runtime 0.15.2 and Telnyx SDK 7.20.0.
- TypeScript build and 11 Node tests using the real Agent SDK and SQLite.
- HTTP local server: two automatic occurrences each of call, SMS and webhook jobs; six distinct successful simulated execution rows.
- Disk-backed restart test retains registry, timer records and execution history.
- Failure notification outcomes, dependency success/skips, duplicate suppression, authentication, validation and CRUD tests.
- Repository sample verifier and generated index checks.
- Telnyx CLI v0.3.0 bundles the application and generates the actor stack.
- Local Edge Docker stack: authenticated RPC, job creation, KV persistence, SQL history and the first scheduled batch work.

## Local verification

Run `npm ci`, then `npm test`. Start the local demo with `npm start` and run `npm run test:http` with its scheduler token to check repeated automatic executions.

All outbound communications in these checks were simulated or mocked. No live SMS or calls were sent.
