# API

## `requestSensitiveAction(action)`

Starts a per-account risk gate and returns the assistant payload plus outbound dial payload. The decision remains `blocked_pending` until Telnyx sends a Deepfake Detection result.

## `recordDeepfakeResult(callSid, result)`

Accepts `human`, `ai_generated`, or `inconclusive` from `call.deepfake_detection.result`, appends the event to the ledger, and returns a policy outcome.

## `recordDeepfakeError(callSid, message)`

Accepts `call.deepfake_detection.error`, appends the event, and routes to manual review.

## `confirmSensitiveAction()`

Allows the sensitive action only when the latest ledger outcome is `proceed`.

## `rehydrateFromLedger(rows)`

Loads persisted ledger rows so the same decision can be recreated after an actor restart or deploy.
