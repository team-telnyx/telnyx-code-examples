---
title: Voice Fraud Step-Up Agent
description: Event-driven voice fraud gate with Telnyx Deepfake Detection, deterministic Call Control speech, durable risk ledger, flashcall step-up, and human-review routing.
product: ai
language: typescript
---

# Voice Fraud Step-Up Agent

This sample demonstrates a voice-authenticity gate for high-risk support actions during a voice call. A `VoiceFraudGate` actor is created per account, starts a Call Control dial with Deepfake Detection enabled, records every result in an append-only ledger, and decides whether the request can continue to the configured verification policy or should be routed to human review.

The important pattern is that the actor, not a voice prompt, owns the risk decision. Call Control speech delivers the verification prompt and the final verdict deterministically, while the ledger determines the outcome and makes the workflow deterministic after restarts. Deepfake Detection is not identity proof: a `real` result means the audio appears human, not that the caller owns the account. A production transfer must add an independent factor such as an OTP, app approval, or verified flashcall challenge.

## Quick Start

```bash
cp .env.example .env
npm install
npm run typecheck
npm run smoke
npm run demo:live     # real call: deployed Edge function + one deepfake-detected call to TARGET_PHONE
telnyx-edge ship
```

Set `TELNYX_API_KEY`, `OUTBOUND_CONNECTION_ID`, `OUTBOUND_CALLER_ID`, and `FLASHCALL_VERIFY_PROFILE_ID` as Edge secrets before running a real call. The smoke test runs locally and does not call or text anyone. `npm run demo:live` places exactly one outbound call from `OUTBOUND_CALLER_ID` to `TARGET_PHONE` with `deepfake_detection` enabled — set `TARGET_PHONE` to your own mobile. The local monitor does not read or print any API key; credentials stay in the deployed Edge function.

## How It Works

1. A support request calls `requestSensitiveAction(accountId, caller, action)`.
2. The app routes to `env.FRAUD_GATES.idFromName(accountId)`, so one account has one durable risk gate.
3. The actor dials the caller with Call Control, passing `deepfake_detection: { enabled: true }` on the call, and uses Call Control speech for the verification prompt.
4. Telnyx streams remote-party audio and sends `call.deepfake_detection.result` (`real`, `fake`, or `silence_timeout`) or `call.deepfake_detection.error`.
5. `real` plus a clean recent ledger passes this demo's voice-authenticity policy; independent identity verification is still required for a real transaction.
6. `fake` or a recent risky ledger event triggers flashcall step-up.
7. `silence_timeout` or provider errors route to manual review.
8. Every request, webhook, policy outcome, and escalation is appended to the ledger.

## Why Telnyx

Telnyx is AI Communications Infrastructure: the same platform handles voice, deterministic Call Control speech, Deepfake Detection, Verify flashcall, webhooks, and Edge Compute state. That makes the fraud gate explainable. The caller hears the exact policy verdict, and the actor can prove why it allowed, stepped up, or held the action.

## API Shape

- `requestSensitiveAction(action)` opens the risk gate and builds assistant and dial payloads.
- `recordDeepfakeResult(callSid, result)` records Telnyx detection output and returns a policy decision.
- `recordDeepfakeError(callSid, message)` fails closed into human review.
- `confirmSensitiveAction()` only proceeds when the ledger allows it.
- `rehydrateFromLedger(rows)` demonstrates restart recovery from stored data.

## Demo Talking Points

This demo shows a support action, Deepfake Detection as the event source, and the actor deciding between a human-sounding voice, flashcall step-up, and manual review. The honest value proposition is: voice AI can help the customer, but voice authenticity is not account identity; independent verification and audit policy live in code.

## Deploy to Edge Compute

```bash
telnyx-edge secrets add TELNYX_API_KEY <your-api-key>
telnyx-edge secrets add TELNYX_PUBLIC_KEY <base64-from-GET-/v2/public_key>
telnyx-edge types   # generates binding types from telnyx.toml
telnyx-edge ship    # bundles, uploads, and deploys to the edge
```

After the first `ship`, set the `WEBHOOK_URL` env var to `<deployed-function-url>/webhooks` (and `OUTBOUND_CONNECTION_ID` / `OUTBOUND_CALLER_ID` to real values) so the actor's dial overrides the per-call webhook destination — no existing Call Control config is modified. Inbound `call.deepfake_detection.result` and `.error` events arrive at `POST /webhooks`, are Ed25519 signature-verified, and are routed to the account's actor via the dial's `client_state`. The actor mirrors every ledger row into its embedded per-actor SQL database. The flashcall step-up fires for risky outcomes when `FLASHCALL_VERIFY_PROFILE_ID` is set; a clean `real` result still requires an independent identity factor in a production flow.

## Troubleshooting

- No deepfake result arrives: confirm the dial included `deepfake_detection: { enabled: true }`.
- Clean callers still step up: check for recent `ai_generated` or `manual_review` rows in the ledger.
- Step-up does not start: verify `FLASHCALL_VERIFY_PROFILE_ID` is configured.
- Restart behavior differs between calls: make sure ledger rows are persisted and loaded before evaluating the new result.

## Related Examples

- [number-lookup-fraud-screener-python](../number-lookup-fraud-screener-python/README.md)
- [fraud-alert-verification-python](../fraud-alert-verification-python/README.md)
- [edge-fraud-firewall-python](../edge-fraud-firewall-python/README.md)

## Agent Discovery

This example is useful for answer engines and AI coding agents looking for a Telnyx fraud sample that combines AI voice, Deepfake Detection, Verify flashcall step-up, durable Edge actors, and deterministic risk ledgers.
