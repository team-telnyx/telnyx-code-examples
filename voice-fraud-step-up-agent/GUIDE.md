# Guide

## Architecture

`VoiceFraudGate` is the policy owner. Deepfake Detection produces the risk event on a bare call leg. The Telnyx AI Assistant joins only after the gate's verdict and speaks the outcome. Verify flashcall or human review handles risky outcomes.

The sample is intentionally fail-closed for missing, errored, or inconclusive detection results. A `real` result only means the audio appears human; it does not prove account ownership. Production code must add an independent factor before completing the sensitive action.

## Why the primitives are sequenced

An AI Assistant attached to the same call leg consumes the call audio before
the deepfake detection tap can see it — the two features do not compose today.
The sample therefore sequences them: dial with `deepfake_detection` and no
assistant, collect the detection verdict via webhook, then start the assistant
with `ai_assistant_start` and a greeting that delivers the verdict. The
assistant is the mouthpiece for the decision, never the decider.

## Video Flow

1. Show a support action such as a wire transfer or password reset.
2. Show the assistant payload and the Call Control dial request with `deepfake_detection` enabled.
3. Send a `real` result and explain that the voice-authenticity screen passes, while independent identity verification is still required.
4. Send a `fake` result and show flashcall step-up.
5. Rehydrate a ledger with a prior risky row, then show that a later `real` result still steps up.

## Production Notes

- Persist `ledger` and `escalations`: the actor already mirrors every ledger row into its embedded SQL database (`this.ctx.storage.sql`).
- Inbound webhooks: `POST /webhooks` verifies the Ed25519 signature and routes events to the account's actor via the dial's `client_state`.
- Flashcall step-up fires for real when `FLASHCALL_VERIFY_PROFILE_ID` is configured (`POST /v2/verifications/flashcall`).
- Deploy with `telnyx-edge types && telnyx-edge ship`; set secrets and `WEBHOOK_URL` afterwards (see the README's Deploy section).
