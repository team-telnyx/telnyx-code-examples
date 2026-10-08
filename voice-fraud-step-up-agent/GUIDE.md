# Guide

## Architecture

`VoiceFraudGate` is the policy owner. The Telnyx AI Assistant keeps the caller on the line. Deepfake Detection produces the risk event. Verify flashcall or human review handles risky outcomes.

The sample is intentionally fail-closed. A missing, errored, or inconclusive detection result does not complete the sensitive action.

## Video Flow

1. Show a support action such as a wire transfer or password reset.
2. Show the AI Assistant payload with `deepfake_detection` enabled.
3. Send a `human` result and show the action proceeds.
4. Send an `ai_generated` result and show flashcall step-up.
5. Rehydrate a ledger with a prior risky row, then show that a later `human` result still steps up.

## Production Notes

Persist `ledger` and `escalations` in SQL. Use real Telnyx webhooks for `call.deepfake_detection.result` and `call.deepfake_detection.error`. Replace the local flashcall payload builder with `POST /v2/verifications/flashcall`.
