```markdown
---
name: two-channel-otp
title: "Two-Channel 2FA / OTP — Cross-Channel SMS + Voice Verification"
description: "A durable auth session actor that sends a one-time code by SMS and verifies it by voice, defeating SIM-swap and SMS-interception attacks."
language: typescript
framework: edge
telnyx_products: [Messaging, Voice, Agent SDK, StateStore, Scheduled Tasks]
---

# two-channel-otp

A durable authentication session that sends a one-time code by SMS and verifies it by voice — cross-channel 2FA that survives pod restarts and defeats SMS interception.

## The Story

A regional bank's mobile app lets customers approve high-value wire transfers. When a customer initiates a $50,000+ transfer, the bank needs to confirm the request is genuinely theirs — not a SIM-swap attacker who has already intercepted the SMS code. The bank's fraud team needs a verification flow where capturing one channel is not enough to complete the action.

The actor IS the auth session. Born when a customer requests a high-value action, it generates a 6-digit code, stores it durably with an issue time and 120-second expiry, and sends it by SMS. When the customer calls the verification line, the actor wakes — whether it was just born or re-activated after a platform reboot mid-session — and asks the caller to speak or dial the code. If the spoken code matches and hasn't expired, the session marks itself verified and the transfer is confirmed. If it doesn't match, the actor re-issues a fresh code, and after three failures it locks the session, writes a row to a SQL review table, and pages the security on-call. The expiry timer is the actor's own self-wake: it voids a stale code exactly once, and if the platform reboots between the SMS and the voice call, the code still validates because the state and the timer both survive.

The rest of this README is the API surface of that story.

## Why Telnyx

Telnyx provides the **AI Communications Infrastructure** that makes cross-channel verification possible: Messaging delivers the one-time code over SMS, Voice captures the spoken code via `gather-using-ai` (STT) or `gather` (DTMF), and the Agent SDK's durable actors keep the session state and expiry timer alive across pod restarts — all with zero-credential API bindings that inject auth automatically.

## Telnyx API Endpoints Used

- **Messaging** — `telnyx.messages.send()` delivers the 6-digit code by SMS to the user's E.164 number.
- **Voice / Call Control** — `call.initiated` webhook triggers the actor; `gather-using-ai` captures the spoken code via STT; `gather` captures DTMF keypad entry as fallback.
- **Agent SDK** — `Agent` base class with `idFromName()` for durable actor addressing, `setState()` / `getState()` for merge-patch session state, and `schedule()` for the self-waking expiry timer.
- **StateStore** — fixed-shape session state (`code`, `issuedAt`, `expiresAt`, `fails`, `status`) persisted across restarts.
- **SQL** — `locks` table for the security review surface after 3 failed attempts.
- **Scheduled Tasks** — `schedule(120, "expire", ...)` for the code expiry self-wake.

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          Telnyx Edge Runtime                            │
│                                                                         │
│  ┌──────────────────┐     ┌──────────────────────────┐                 │
│  │   HTTP /issue    │────▶│  env.SESSIONS.idFromName │                 │
│  │  (POST /issue)   │     │     (userE164)           │                 │
│  └──────────────────┘     └──────────┬───────────────┘                 │
│                                      │                                   │
│                                      ▼                                   │
│                          ┌─────────────────────┐                         │
│                          │   AuthSession       │  ◄─── Durable Actor    │
│                          │   (Agent)           │                         │
│                          │                     │                         │
│                          │  state: {           │                         │
│                          │    user, code,      │                         │
│                          │    issuedAt,        │                         │
│                          │    expiresAt,       │                         │
│                          │    fails, status    │                         │
│                          │  }                  │                         │
│                          └──────┬──────┬───────┘                         │
│                                 │      │                                 │
│                    ┌────────────┘      └─────────────┐                   │
│                    │                                 │                   │
│                    ▼                                 ▼                   │
│          ┌──────────────────┐           ┌────────────────────┐          │
│          │  TELNYX.messages │           │  TELNYX.calls      │          │
│          │  .send()         │           │  (gather-using-ai  │          │
│          │  (SMS code)      │           │   / gather DTMF)   │          │
│          └──────────────────┘           └────────────────────┘          │
│                    │                                 │                   │
│                    │                                 │                   │
│                    ▼                                 │                   │
│          ┌──────────────────┐                        │                   │
│          │   User's Phone   │                        │                   │
│          │  (SMS channel)   │                        │                   │
│          └──────────────────┘                        │                   │
│                    │                                 │                   │
│                    │  User calls verification line   │                   │
│                    │                                 │                   │
│                    │                                 ▼                   │
│                    │                   ┌────────────────────┐            │
│                    │                   │  call.initiated    │            │
│                    │                   │  webhook           │            │
│                    │                   └────────┬───────────┘            │
│                    │                            │                        │
│                    │                            ▼                        │
│                    │                   ┌────────────────────┐            │
│                    │                   │  onCallStart()     │            │
│                    │                   │  (actor wakes)     │            │
│                    │                   └────────┬───────────┘            │
│                    │                            │                        │
│                    │                            ▼                        │
│                    │                   ┌────────────────────┐            │
│                    │                   │  captureCode()     │            │
│                    │                   │  STT → DTMF fallback│            │
│                    │                   └────────┬───────────┘            │
│                    │                            │                        │
│                    │                            ▼                        │
│                    │                   ┌────────────────────┐            │
│                    │                   │  match? → verified │            │
│                    │                   │  fail? → reissue   │            │
│                    │                   │  3 fails → lock    │            │
│                    │                   └────────┬───────────┘            │
│                    │                            │                        │
│                    │                            ▼                        │
│                    │                   ┌────────────────────┐            │
│                    │                   │  env.LOCKS (SQL)   │            │
│                    │                   │  + security SMS    │            │
│                    │                   └────────────────────┘            │
│                    │                                                     │
│                    │                                                     │
│                    │                   ┌────────────────────┐            │
│                    │                   │  schedule(120s)    │            │
│                    │                   │  → expire()        │            │
│                    │                   └────────────────────┘            │
│                    │                                                     │
│                    └─────────────────────────────────────────────────────┘
│                                                                         │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │  Cross-channel security:                                          │   │
│  │  SMS delivers the code (channel 1)                                │   │
│  │  Voice verifies the code (channel 2)                              │   │
│  │  Intercepting SMS alone is NOT enough — you must also control     │   │
│  │  the voice leg.                                                   │   │
│  └──────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────┘
```

## Environment Variables

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|-----------------|
| `TELNYX_API_KEY` | `string` | `your_telnyx_api_key_here` | **yes** | TELNYX_API_KEY | — |
| `VERIFICATION_LINE_E164` | `string` | `+1555XXXXXXXX` | **yes** | E.164 number of the inbound verification voice line | Telnyx Mission Control / Phone Numbers |
| `SECURITY_REVIEW_E164` | `string` | `+1555XXXXXXXX` | **yes** | E.164 number to SMS on security lock events | Telnyx Mission Control / Phone Numbers |
| `STT_TIMEOUT_MS` | `string` | `6000` | no | Timeout in ms before falling back from STT to DTMF | — |
| `CODE_TTL_SECONDS` | `string` | `120` | no | Code expiry time in seconds | — |
| `MAX_FAILURES` | `string` | `3` | no | Max failed attempts before locking the session | — |
| `DEMO_MODE` | `string` | `true` | no | When `true` (default), logs actions instead of sending real SMS/calls | — |

## Setup

```bash
# Clone the repository
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/two-channel-otp

# Install dependencies
npm install

# Copy the example environment file
cp .env.example .env

# Edit .env and set your Telnyx API key and phone numbers
# TELNYX_API_KEY=your_telnyx_api_key_here
# VERIFICATION_LINE_E164=+1555XXXXXXXX
# SECURITY_REVIEW_E164=+1555XXXXXXXX

# Authenticate with Telnyx CLI
telnyx-edge auth api-key set <your_api_key>

# Generate type definitions from telnyx.toml bindings
telnyx-edge types

# Run the smoke test
npx tsx smoke_test.ts

# Deploy
telnyx-edge ship
```

## API Reference

### `POST /issue`

Issues a new 6-digit verification code for a user.

**Request:**

```json
{
  "userE164": "+15551234567"
}
```

**Response (200):**

```json
{
  "ok": true,
  "expiresInMs": 120000
}
```

**Errors:**

| Status | Body | Description |
|--------|------|-------------|
| 400 | `{"error": "Invalid JSON"}` | Request body is not valid JSON |
| 400 | `{"error": "userE164 is required and must be E.164"}` | Missing or malformed `userE164` |

### `POST /webhook`

Receives Call Control events from Telnyx.

**Event: `call.initiated`**

When a call arrives on the verification line, the webhook extracts the caller's E.164 from `data.payload.from.e164`, addresses the `AuthSession` actor via `env.SESSIONS.idFromName(callerE164)`, and calls `onCallStart()`.

### Actor RPC: `issue(user)`

- Generates a 6-digit code
- Stores `{ code, issuedAt, expiresAt, fails: 0, status: "open" }` in durable state
- Sends the code by SMS via `this.env.TELNYX.messages.send()`
- Schedules `expire` task for `CODE_TTL_SECONDS` (default 120s)
- Returns `{ ok: true, expiresInMs }`

### Actor RPC: `onCallStart(callerE164, callControlId)`

- Addresses the actor by caller E.164
- If no valid open session: re-issues a fresh code and speaks a message
- If valid session: speaks a prompt, calls `captureCode()`, then:
  - **Match**: sets `status: "verified"`, speaks confirmation
  - **Mismatch**: increments `fails`, re-issues or locks (after 3)
  - **Expired**: re-issues or locks

### Actor RPC: `captureCode(callControlId, expectedCode)`

- **Primary**: `gather-using-ai` (STT) — captures spoken code, validates 6 digits
- **Fallback**: `gather` (DTMF) — captures keypad entry after `STT_TIMEOUT_MS`
- Returns the 6-digit string or `null`

### Actor RPC: `lock(user, callId)`

- Sets `status: "locked"`, clears `code`
- Inserts a row into `env.LOCKS` SQL table: `locks(user_e164, ts, reason, call_id)`
- Sends one SMS to `SECURITY_REVIEW_E164` with user number + attempt count

### Actor Task: `expire()`

- If `status === "open"`: sets `status: "expired"`, clears `code`
- Self-scheduled via `schedule(120, "expire", ...)` — survives pod restarts

## Troubleshooting

| Issue | Cause | Solution |
|-------|-------|----------|
| Code not validating after restart | Actor state not durable | Ensure `telnyx.toml` has `[[actors]]` binding configured |
| SMS not received | `DEMO_MODE` is `true` | Set `DEMO_MODE=false` in `.env` |
| STT not capturing code | No microphone/audio on call | User can fall back to DTMF by dialing the code |
| Lock not appearing in SQL | `LOCKS` binding not configured | Add `[storage.sqldb.LOCKS]` to `telnyx.toml` |
| Webhook not firing | Verification line not pointed at Edge function | Configure the Telnyx voice application webhook URL |
| Actor not waking on call | Caller E.164 doesn't match session key | Ensure `issue()` and `onCallStart()` use the same E.164 format |

## Agent Discovery

- [Telnyx Agent Signup](https://telnyx.com/agent-signup.md)
- [Team Telnyx AI GitHub](https://github.com/team-telnyx/ai)
- [llms.txt](https://telnyx.com/llms.txt)

## Related Examples

- **DEV-830 — SMS Two-Factor**: Same-channel SMS in/out (code sent and returned by SMS). This sample uses cross-channel SMS + voice.
- **DEV-90 — WhatsApp OTP**: WhatsApp-based one-time password verification.
- **otp-sms (Vapi)**: Voice agent sends SMS code and verifies by voice — the conceptual inspiration for this sample.

## Resources

- [Telnyx Messaging — Send Message](https://developers.telnyx.com/docs/messaging/messages/send-message)
- [Telnyx Voice — Gather Using AI](https://developers.telnyx.com/docs/voice/programmable-voice/gather-using-ai)
- [Telnyx API Reference — Gather](https://developers.telnyx.com/api-reference/call-commands/gather)
- [Telnyx Agent SDK](https://developers.telnyx.com/docs/agent-sdk)
- [Telnyx Agent SDK — Scheduled Tasks](https://developers.telnyx.com/docs/agent-sdk/scheduled-tasks)
- [Telnyx Stateful Actors](https://developers.telnyx.com/docs/edge-compute/stateful-actors)
- [VapiAI Examples — otp-sms](https://github.com/VapiAI/examples)
- [Telnyx Pricing](https://telnyx.com/pricing)
```
