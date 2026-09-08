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

## Remaining external runtime integration blocker

With the installed `telnyx/actor-runtime:dev`, `telnyx/function-runtime:dev` and Dapr 1.13.6 images, the first batch runs but the next automatic batch does not. The SDK retains `cron-poll` with its next deadline while Dapr's `__alarm__` reminder is absent. The `npm run test:http` test correctly fails for this stack. This has not been validated on a deployed Telnyx account.

Aligning the SDK clock to seconds prevents a fractional deadline from being later than Dapr's rounded reminder. It does not resolve the subsequent reminder loss. Do not hide this with an HTTP polling workaround: recurring dispatch must work without external requests. Health reports degraded/503 after a task is over 60 seconds late.

The generated local Docker stack also needs a persistent `/data` mount for SQL if containers are recreated. Otherwise KV survives in Postgres while the SDK's SQL tables disappear, and the SDK correctly refuses to start with lost task data. For the integration experiment a temporary Compose override mounted a named volume at `/data` and supplied a local token; no production runtime files were changed.

## Reproduce

1. Run `npm ci`, then `npm test`.
2. Run `npm start` in default demo mode; supply the printed token to `npm run test:http`. This passes locally.
3. With the legacy CLI and local images, generate the stack using `telnyx-edge-v0.3.0 dev --generate-only --port 8794`. Supply a temporary `SCHEDULER_TOKEN` environment variable to the function container and a persistent actor `/data` volume through a local Compose override.
4. Start the stack and run `SCHEDULER_URL=http://127.0.0.1:8794 SCHEDULER_TOKEN=... npm run test:http`. The first batch appears in `/logs`, but the two-cycle assertion times out.

All outbound communications were simulated or mocked. No live SMS/calls were sent. Code changes have not been deployed or pushed to the PR.
