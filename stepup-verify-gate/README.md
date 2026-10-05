---
name: stepup-verify-gate
title: SIM-Swap Step-Up Verify Gate
description: A durable actor that gates logins with Number Lookup and step-up flash-call/voice verification when SIM-swap fraud is detected.
language: typescript
framework: edge
telnyx_products: [number-lookup, verify, edge-compute]
---

# stepup-verify-gate

A durable Telnyx Edge actor that gates patient-portal logins with Number Lookup and step-up flash-call or voice verification when SIM-swap fraud is detected.

## The Story

A regional healthcare clinic sends 2FA codes by SMS to patients logging into their online portal — but when an attacker performs a SIM-swap, they port the victim's number and start receiving those codes, gaining access to medical records, prescription refills, and appointment scheduling. Patient safety and HIPAA compliance are at stake: a compromised account can lead to identity theft, fraudulent prescriptions, and erosion of trust in the clinic's digital services. The clinic needs to know, at the moment of login, whether the person holding the phone number is still the legitimate patient.

The actor IS the number's trust record. Born the instant a patient enters their phone number, the VerifyGate actor runs a Number Lookup to snapshot the current carrier and line type, then compares that snapshot against a durable SQL ledger of every prior lookup for that number. If the carrier changed or the line type flipped from mobile to VoIP, the actor refuses SMS and instead issues a flash-call verification — the code is embedded in the caller ID — or a voice-call verification where an automated assistant reads the code aloud. Every step-up is recorded in the ledger, and after three step-ups within thirty days, the actor locks the number for manual review. The actor survives restarts: if the platform reboots mid-verification, the actor re-runs the lookup, compares against the same baseline, and continues without double-locking or drifting. The rest of this README is the API surface of that story.

## Why Telnyx

Telnyx provides **AI Communications Infrastructure** — a global, programmable platform for identity, verification, and real-time communications that operates at the edge with sub-50ms latency. Number Lookup gives you carrier intelligence on who currently holds a phone number, Verify provides multi-channel OTP delivery including flash-call and voice verification, and Edge Compute runs durable actors that remember state across restarts. Together, these primitives let you build fraud-resistant authentication that adapts to the threat landscape in real time.

## Telnyx API Endpoints Used

| Endpoint | Method | Purpose |
|---|---|---|
| `/v2/number_lookup/{phone_number}` | GET | Carrier snapshot: `line_type`, `spid_carrier_name`, `spid_carrier_type` |
| `/v2/verifications/sms` | POST | Clean-path SMS verification code delivery |
| `/v2/verifications/flashcall` | POST | Step-up verification: code embedded in caller ID |
| `/v2/verifications/call` | POST | Step-up verification: voice-call with code read aloud |
| `/v2/verifications/by_phone_number/{phone_number}/actions/verify` | POST | Verify submitted code → `response_code: accepted\|rejected` |
| Verify profile webhooks | POST | `verify.sent`, `verify.failed`, `verify.delivered` delivery receipts |

## Architecture

```
Patient Portal App
       │
       │  @rpc challenge(userE164)
       ▼
┌─────────────────────────────────────┐
│  VerifyGate Actor (Agent SDK)       │
│  env.GATES.idFromName(userE164)     │
│  ─ one durable trust record per #   │
│                                     │
│  1. GET /v2/number_lookup/{phone}   │
│     → line_type, spid_carrier_name  │
│                                     │
│  2. SQL ledger: carrier_history     │
│     baseline = first lookup ever   │
│                                     │
│  3. detectSimSwap(current, baseline)│
│     • carrier changed?             │
│     • line_type flipped?           │
│                                     │
│  ┌─ clean mobile + same carrier ──┐ │
│  │ POST /v2/verifications/sms     │ │
│  │ → verify.sent/delivered webhook│ │
│  └────────────────────────────────┘ │
│                                     │
│  ┌─ step-up (carrier change) ─────┐ │
│  │ POST /v2/verifications/flashcall│ │
│  │   (or /verifications/call)     │ │
│  │ → code in caller ID / voice    │ │
│  └────────────────────────────────┘ │
│                                     │
│  4. POST .../actions/verify {code}  │
│     → response_code: accepted       │
│                                     │
│  5. SQL ledger: stepups table       │
│     • reason, at, resolved          │
│     • 3 step-ups in 30 days → LOCK  │
│     • this.schedule() for unlock    │
│                                     │
│  6. Restart proof: baseline read    │
│     from SQL, not in-memory state   │
└─────────────────────────────────────┘
       │
       │  SQL: carrier_history + stepups
       ▼
   Durable Ledger (survives restarts)
```

## Environment Variables

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|-----------------|
| `DEMO_MODE` | `string` | `your_demo_mode_here` | **yes** | DEMO_MODE | — |
| `TELNYX_API_KEY` | `string` | `your_telnyx_api_key_here` | **yes** | TELNYX_API_KEY | — |
| `TELNYX_WEBHOOK_PUBLIC_KEY` | `string` | `your_telnyx_webhook_public_key_here` | **yes** | TELNYX_WEBHOOK_PUBLIC_KEY | — |
| `VERIFY_PROFILE_ID` | `string` | `your_verify_profile_id_here` | **yes** | VERIFY_PROFILE_ID | — |

## Setup

```bash
# Clone the repository
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/stepup-verify-gate

# Install dependencies
npm install

# Copy and configure environment
cp .env.example .env
# Edit .env with your Telnyx API key, webhook public key, and verify profile ID

# Authenticate with Telnyx Edge
telnyx-edge auth api-key set <your_api_key>

# Generate type definitions from telnyx.toml bindings
npm run types

# Run smoke test
npx tsx smoke_test.ts

# Deploy
npm run deploy
```

## API Reference

### `POST /challenge?phone={userE164}`

Entry point — creates or activates the `VerifyGate` actor for the given phone number and runs the full challenge flow.

**Query Parameters:**
- `phone` (string, required) — E.164 formatted phone number (e.g. `+15551234567`)

**Response (200):**
```json
{
  "ok": true,
  "step_up": false,
  "method": "sms",
  "verification_id": "sms-verify-12345"
}
```

**Response (step-up path):**
```json
{
  "ok": true,
  "step_up": true,
  "method": "flashcall",
  "verification_id": "flashcall-verify-67890"
}
```

**Response (locked):**
```json
{
  "ok": false,
  "error": "Number locked for manual review",
  "locked": true
}
```

### `POST /verify?phone={userE164}&code={code}`

Verifies a code submitted by the user against the active verification.

**Query Parameters:**
- `phone` (string, required) — E.164 formatted phone number
- `code` (string, required) — The verification code entered by the user

**Response (200):**
```json
{
  "ok": true,
  "response_code": "accepted"
}
```

**Response (rejected):**
```json
{
  "ok": false,
  "response_code": "rejected"
}
```

### `POST /webhook/verify?phone={userE164}`

Webhook endpoint for Verify delivery receipts (`verify.sent`, `verify.failed`, `verify.delivered`). The request body is the raw Telnyx webhook payload; signature verification is performed via Ed25519.

**Headers:**
- `Telnyx-Signature` — Ed25519 signature header

**Response (200):**
```json
"OK"
```

## Troubleshooting

| Issue | Cause | Solution |
|-------|-------|----------|
| `Number locked for manual review` | 3 step-ups within 30 days | Wait for lock expiry (24h) or manually reset via SQL ledger |
| `Number lookup failed` | Invalid phone number or API error | Ensure phone is E.164 format; check API key permissions |
| `Invalid signature` (webhook) | Mismatched public key or tampered payload | Verify `TELNYX_WEBHOOK_PUBLIC_KEY` matches the profile's signing key |
| `TELNYX_API_KEY not configured` | Secret not set | Run `telnyx-edge secrets add TELNYX_API_KEY "<key>"` |
| `VERIFY_PROFILE_ID not configured` | Secret not set | Run `telnyx-edge secrets add VERIFY_PROFILE_ID "<id>"` |
| Demo mode always active | `isDemoMode()` returns `true` by default | Set `DEMO_MODE=false` in secrets to use live API calls |
| Actor doesn't persist state | SQL ledger not initialized | Ensure `carrier_history` and `stepups` tables exist in the SQL binding |

## Agent Discovery

- [Telnyx Agent Signup](https://telnyx.com/agent-signup.md)
- [Telnyx AI GitHub](https://github.com/team-telnyx/ai)
- [llms.txt](https://telnyx.com/llms.txt)

## Related Examples

- [dual-channel-otp](../../../dual-channel-otp/) — DEV-1192: Dual-channel OTP delivery (SMS + voice fallback)
- [sms-code-lifecycle](../../../sms-code-lifecycle/) — DEV-830: SMS verification code lifecycle management
- [number-lookup-basics](../../../number-lookup-basics/) — Basic Number Lookup carrier intelligence
- [verify-profile-webhooks](../../../verify-profile-webhooks/) — Verify API webhook handling patterns

## Resources

- [Number Lookup Documentation](https://developers.telnyx.com/docs/identity/number-lookup)
- [Trigger SMS Verification](https://developers.telnyx.com/api-reference/verify/trigger-sms-verification)
- [Trigger Flash Call Verification](https://developers.telnyx.com/api-reference/verify/trigger-flash-call-verification)
- [Verify Verification Code by Phone Number](https://developers.telnyx.com/api-reference/verify/verify-verification-code-by-phone-number)
- [Verify Webhooks](https://developers.telnyx.com/docs/identity/verify/receiving-webhooks)
- [Stateful Actors](https://developers.telnyx.com/docs/edge-compute/stateful-actors)
- [Agent SDK SQL](https://developers.telnyx.com/docs/agent-sdk/sql)
- [Telnyx Verify Product Page](https://telnyx.com/verify)
- [Telnyx Pricing](https://telnyx.com/pricing)
