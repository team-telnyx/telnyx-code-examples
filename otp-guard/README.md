---
name: otp-guard
title: "OTP Guard — The Second Lock for Dangerous Actions"
description: "A durable Telnyx Edge actor that guards one high-risk action behind a Telnyx Verify code, owning the attempt budget, expiry clock, lockout, and audit trail."
language: typescript
framework: edge
telnyx_products: [Verify, Messaging]
---

# OTP Guard — The Second Lock for Dangerous Actions

A durable verification session, built as a Telnyx Edge actor, that puts a Telnyx Verify code in front of one high-risk action — and remembers everything about it, even across a crash.

## The Story

At a community credit union's treasury operations desk, business members can change the payout destination on their accounts — the routing and account numbers that decide where their money actually lands. A single fraudulent change can redirect a six-figure ACH batch before anyone notices, and the examiner wants a defensible record of who authorized what, when, and from which phone. The desk cannot afford a silent failure, a guessable state, or a rate limiter that resets on the next deploy.

The actor IS the verification session. It is born the instant a member clicks "change payout account," it evolves as the code is triggered, entered, rejected, retried, and locked, and it either commits the change or dies expired — and it survives the sending platform rebooting mid-flow, because the attempt budget, the expiry clock, the lockout, and the audit trail live in the actor, not in a cache someone can flush. Twenty minutes later, from a different device, the same session answers with the same budget and the same history. The rest of this README is the API surface of that story.

## Why Telnyx

Telnyx Verify owns the code itself — generation, delivery, and profile policy — so you never build an OTP store, never hand-roll a random-number generator over raw SMS, and never guess at delivery semantics. The Telnyx Edge runtime owns the session: a durable actor with state, a scheduler for cool-downs, and an append-only audit trail that survives process death. Together they form the **AI Communications Infrastructure** layer this sample is built on — managed verification primitives wired into a stateful, crash-resilient entity that guards a real financial action.

## Telnyx API Endpoints Used

| Method | Endpoint | Purpose |
|--------|----------|---------|
| `POST` | `/v2/verify_profiles` | Create the step-up verify profile (6-digit code, 300-second expiry) |
| `POST` | `/v2/verifications/sms` | Trigger the SMS verification against the step-up profile |
| `POST` | `/v2/verifications/check/{verification_id}` | Check the submitted code by verification id |
| `POST` | `/webhooks/verify` (inbound) | Receive `verification.complete` events as a second signal |
| — | `TELNYX.messages.send` (binding) | Send SMS notifications on commit and lockout (live mode only) |

Reference docs:

- [Trigger SMS verification](https://developers.telnyx.com/api-reference/verify/trigger-sms-verification)
- [Verify code by id](https://developers.telnyx.com/api-reference/verify/verify-verification-code-by-id)
- [Create a verify profile](https://developers.telnyx.com/api-reference/verify/create-a-verify-profile)
- [Receiving webhooks](https://developers.telnyx.com/docs/identity/verify/receiving-webhooks)

## Architecture

```
                    ┌──────────────────────────────────────────────┐
   POST /actions/   │  OtpGuard extends Agent<Env, GuardState>     │
   :id/start  ─────▶│  idFromName("action-4471")                   │
                    │                                              │
                    │  state: { action_kind, phone_number,         │
                    │           destination, verify_id,            │
                    │           verify_profile_id, status,         │
                    │           attempts_left, expires_at,         │
                    │           locked_until, audit[] }            │
                    └───────────────┬──────────────────────────────┘
                                    │
             ┌──────────────────────┼───────────────────────┐
             ▼                      ▼                       ▼
   ┌──────────────────┐   ┌──────────────────┐   ┌────────────────────┐
   │ Telnyx Verify    │   │ this.schedule()  │   │ Append-only audit  │
   │ (owns the code)  │   │ (cool-down lift) │   │ (actor's own trail)│
   │                  │   │                  │   │                    │
   │ POST /v2/        │   │ 600s →           │   │ verification_      │
   │  verifications/  │   │  liftLockout()   │   │  triggered         │
   │  sms             │   │                  │   │ code_submitted     │
   │ POST /v2/        │   │                  │   │ budget_exhausted   │
   │  verifications/  │   │                  │   │ action_committed   │
   │  check/{id}      │   │                  │   │ lockout_lifted     │
   └──────────────────┘   └──────────────────┘   └────────────────────┘
             ▲
             │  verification.complete (webhook, second signal)
   POST /webhooks/verify ── Ed25519 signature verified ──▶ actor
```

The actor is the single writer for the attempt budget. Two simultaneous wrong codes are serialized by the actor runtime, so the budget decrements exactly twice — never three times. Kill the worker between trigger and check and the next `POST /actions/:id/submit` re-activates the same actor via `idFromName("action-4471")`, with budget, expiry, and audit trail intact.

## Environment Variables

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|-----------------|
| `TELNYX_API_KEY` | `string` | `your_telnyx_api_key_here` | **yes** | TELNYX_API_KEY | — |
| `TELNYX_PUBLIC_KEY` | `string` | `your_telnyx_public_key_here` | **yes** | TELNYX_PUBLIC_KEY | — |
| `DEMO_MODE` | `string` | `true` | no | When `true` (default), Verify trigger/check calls are stubbed inline so the demo runs without burning real verifications. Set `false` for live mode. | — |
| `DEMO_PHONE` | `string` | `+15551234567` | no | E.164 phone number used by the demo curl flows when `phone_number` is omitted from the start request. | — |
| `VERIFY_PROFILE_ID` | `string` | `your_verify_profile_id_here` | no | Pre-existing verify profile id. If set, the actor attaches it instead of creating a new step-up profile. | Telnyx Portal → Verify → Profiles |
| `PUBLIC_BASE_URL` | `string` | `https://your-app.telnyx.app` | no | Public base URL used to build the webhook URL when creating a verify profile in live mode. | Your deployment |
| `DISPATCH_FROM_NUMBER` | `string` | `+15559876543` | no | Telnyx number used as the `from` for SMS notifications on commit and lockout (live mode only). | Telnyx Portal → Numbers |
| `AI_MODEL` | `string` | `unused` | no | Reserved. No inference is performed in this sample. | — |

## Setup

```bash
# 1. Clone and enter the sample
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/otp-guard

# 2. Configure environment
cp .env.example .env
# Edit .env and fill in TELNYX_API_KEY and TELNYX_PUBLIC_KEY
# Leave DEMO_MODE=true to run the full demo without real verifications

# 3. Install dependencies
npm install

# 4. Authenticate the Edge CLI and generate binding types
telnyx-edge auth api-key set "$TELNYX_API_KEY"
telnyx-edge types

# 5. Run the smoke test
npx tsx smoke_test.ts

# 6. Deploy
telnyx-edge ship
```

### Demo flow (DEMO_MODE=true, the default)

```bash
BASE=https://your-app.telnyx.app
ACTION=action-4471

# Create the step-up verify profile (one-time)
curl -X POST "$BASE/actions/$ACTION/verify-profile"

# Trigger the verification
curl -X POST "$BASE/actions/$ACTION/start" \
  -H 'content-type: application/json' \
  -d '{"phone_number":"+15551234567","destination":"acct_998877"}'

# Submit the demo accept code
curl -X POST "$BASE/actions/$ACTION/submit" \
  -H 'content-type: application/json' \
  -d '{"code":"123456"}'

# Submit a wrong code (repeat to exhaust the budget)
curl -X POST "$BASE/actions/$ACTION/submit" \
  -H 'content-type: application/json' \
  -d '{"code":"000000"}'

# Read the audit trail
curl "$BASE/actions/$ACTION/audit"
```

In demo mode the accept code is `123456`; any other 4–8 digit code is rejected. Three rejections lock the session for 600 seconds and schedule `liftLockout`.

### Live mode

Set `DEMO_MODE=false`, provide a real `TELNYX_API_KEY`, and either let the actor create a step-up profile (requires `PUBLIC_BASE_URL`) or set `VERIFY_PROFILE_ID` to an existing profile. Real verifications and real SMS notifications will then be sent.

## API Reference

| Method | Route | Body | Description |
|--------|-------|------|-------------|
| `POST` | `/actions/:id/verify-profile` | `{}` | One-time: create or attach the step-up verify profile. |
| `POST` | `/actions/:id/start` | `{ phone_number?, action_kind?, destination? }` | Trigger the SMS verification, persist `verify_id`, start the expiry clock. |
| `POST` | `/actions/:id/submit` | `{ code }` | Submit the code; branches to accepted / rejected / expired / locked. |
| `GET` | `/actions/:id/audit` | — | Return the actor's audit trail and current session state. |
| `POST` | `/webhooks/verify` | Verify webhook payload | Ed25519-verified receiver for `verification.complete` events. |

Status values returned by the actor: `idle`, `pending`, `committed`, `locked`, `expired`. Error statuses: `rate_limited` (with `retry_after_secs`), `api_error`, `no_profile`, `no_session`.

See [API.md](./API.md) for full request/response shapes and status codes.

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| `{"error":"phone_number must be E.164..."}` | Phone number not in `+<country><number>` format | Use E.164, e.g. `+15551234567`, or set `DEMO_PHONE`. |
| `{"status":"no_profile"}` on start | No verify profile attached | Call `POST /actions/:id/verify-profile` first, or set `VERIFY_PROFILE_ID`. |
| `{"status":"rate_limited"}` | Verify per-number or per-profile rate limit hit | Wait `retry_after_secs` (surfaced from `Retry-After`) and retry. |
| `{"error":"invalid_signature"}` on webhook | Ed25519 signature mismatch | Confirm `TELNYX_PUBLIC_KEY` is the correct base64 public key and the raw body is unmodified. |
| `{"error":"webhook_verification_not_configured"}` | `TELNYX_PUBLIC_KEY` secret missing | Add the secret via `telnyx-edge secrets add TELNYX_PUBLIC_KEY "..."`. |
| Session stuck `locked` | Budget exhausted; cool-down not yet elapsed | Wait for the scheduled `liftLockout`, or re-trigger after the lock expires. |
| `{"status":"expired"}` on submit | Code expired (300s) or verification id unknown | Call `POST /actions/:id/start` again for a clean re-trigger. |

## Agent Discovery

- [Agent signup](https://telnyx.com/agent-signup.md)
- [Telnyx AI examples](https://github.com/team-telnyx/ai)
- [llms.txt](https://telnyx.com/llms.txt)

## Related Examples

- [`sms-two-factor-auth-nodejs`](https://github.com/team-telnyx/telnyx-code-examples/tree/main/sms-two-factor-auth-nodejs) — hand-rolled OTP over raw SMS.
- [`sms-two-factor-agent`](https://github.com/team-telnyx/telnyx-code-examples/tree/main/sms-two-factor-agent) — agent-driven 2FA flow.
- `two-channel-otp` (W17) — the channel-fallback flagship; this sample is the step-up policy flagship.

## Resources

- [Verify quickstart](https://developers.telnyx.com/docs/identity/verify/quickstart)
- [Verify API reference](https://developers.telnyx.com/api-reference/verify/trigger-sms-verification)
- [Telnyx Edge runtime SDK](https://www.npmjs.com/package/@telnyx/edge-runtime)
- [Verify product page](https://telnyx.com/products/verify)
- [Telnyx pricing](https://telnyx.com/pricing)
