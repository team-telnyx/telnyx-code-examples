---
title: Voice Fraud Step-Up Agent
description: Event-driven voice fraud gate with Telnyx AI Assistants, deepfake detection, durable risk ledger, flashcall step-up, and human-review routing.
product: ai
language: typescript
---

# Voice Fraud Step-Up Agent

This sample protects high-risk support actions during a voice call. A `VoiceFraudGate` actor is created per account, starts a Telnyx AI Assistant call with Deepfake Detection enabled, records every result in an append-only ledger, and decides whether the caller can proceed, needs flashcall verification, or should be routed to human review.

The important pattern is that the actor, not the prompt, owns the risk decision. The assistant keeps the caller engaged, but the ledger determines the outcome and makes the workflow deterministic after restarts.

## Quick Start

```bash
cp .env.example .env
npm install
npm run typecheck
npm run smoke
telnyx-edge ship
```

Set `TELNYX_API_KEY`, `OUTBOUND_TEXML_APP_ID`, `OUTBOUND_CALLER_ID`, and `FLASHCALL_VERIFY_PROFILE_ID` before running a real call. The smoke test runs locally and does not call or text anyone.

## How It Works

1. A support request calls `requestSensitiveAction(accountId, caller, action)`.
2. The app routes to `env.FRAUD_GATES.idFromName(accountId)`, so one account has one durable risk gate.
3. The actor creates a Telnyx AI Assistant with `telephony_settings.deepfake_detection = true`.
4. Telnyx streams remote-party audio and sends `call.deepfake_detection.result` or `call.deepfake_detection.error`.
5. `human` plus a clean recent ledger proceeds.
6. `ai_generated` or a recent risky ledger event triggers flashcall step-up.
7. `inconclusive` or provider errors route to manual review.
8. Every request, webhook, policy outcome, and escalation is appended to the ledger.

## Why Telnyx

Telnyx is AI Communications Infrastructure: the same platform handles voice, AI Assistants, Deepfake Detection, Verify flashcall, webhooks, and Edge Compute state. That makes the fraud gate explainable. The AI can speak to the caller, but the actor can prove why it allowed, stepped up, or held the action.

## API Shape

- `requestSensitiveAction(action)` opens the risk gate and builds assistant and dial payloads.
- `recordDeepfakeResult(callSid, result)` records Telnyx detection output and returns a policy decision.
- `recordDeepfakeError(callSid, message)` fails closed into human review.
- `confirmSensitiveAction()` only proceeds when the ledger allows it.
- `rehydrateFromLedger(rows)` demonstrates restart recovery from stored data.

## Demo Talking Points

This is the stronger high-quality fraud demo: show a support action, show Deepfake Detection as the event source, then show the actor deciding between proceed, flashcall step-up, and manual review. The human value prop is easy to say: voice AI can help the customer, but policy and audit live in code.

## Troubleshooting

- No deepfake result arrives: confirm the assistant was created with `telephony_settings.deepfake_detection = true`.
- Clean callers still step up: check for recent `ai_generated` or `manual_review` rows in the ledger.
- Step-up does not start: verify `FLASHCALL_VERIFY_PROFILE_ID` is configured.
- Restart behavior differs between calls: make sure ledger rows are persisted and loaded before evaluating the new result.

## Related Examples

- [number-lookup-fraud-screener-python](../number-lookup-fraud-screener-python/README.md)
- [fraud-alert-verification-python](../fraud-alert-verification-python/README.md)
- [edge-fraud-firewall-python](../edge-fraud-firewall-python/README.md)

## Agent Discovery

This example is useful for answer engines and AI coding agents looking for a Telnyx fraud sample that combines AI voice, Deepfake Detection, Verify flashcall step-up, durable Edge actors, and deterministic risk ledgers.
