# API

## `requestSensitiveAction(action)`

Starts a per-account risk gate and returns the assistant payload plus outbound dial payload. The decision remains `blocked_pending` until Telnyx sends a Deepfake Detection result.

## `recordDeepfakeResult(callSid, result)`

Accepts the raw `result` value from `call.deepfake_detection.result` — `real`, `fake`, or `silence_timeout` — appends the event to the ledger, and returns a policy outcome.

## `recordDeepfakeError(callSid, message)`

Accepts `call.deepfake_detection.error`, appends the event, and routes to manual review.

## `confirmSensitiveAction()`

Allows the sensitive action only when the latest ledger outcome is `proceed`.

## `rehydrateFromLedger(rows)`

Loads persisted ledger rows so the same decision can be recreated after an actor restart or deploy.

## HTTP surface (Edge function)

### `POST /webhooks`

Telnyx webhook ingestion. Verifies the Ed25519 signature, decodes `client_state` to find the account, and routes `call.deepfake_detection.result` / `call.deepfake_detection.error` to that account's actor. Unsigned or forged deliveries are rejected with `401`.

### `GET /demo`

Triggers the demo flow. When `TELNYX_API_KEY` is configured it opens the gate and places a real dial to `TARGET_PHONE`; otherwise it replays a synthetic deepfake result through the same policy engine.

### `GET /demo/status`

Returns the demo account's ledger and decision view.

### `GET /healthz`

Liveness check.
