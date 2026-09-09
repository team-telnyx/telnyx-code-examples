# Auto-Failover Voice Routing — Developer Guide

This guide walks you through the `auto-failover-voice-routing` sample: a Telnyx **Edge Compute Agent SDK** service that implements a **telecom-native circuit breaker** pattern. When your primary SIP connection starts failing, the sample detects the failures via Call Control webhooks, trips a circuit breaker stored in the durable `FAILOVER_KV` KV binding, automatically routes subsequent calls to a backup SIP connection, and sends an SMS alert to your ops team.

---

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Environment Setup](#environment-setup)
3. [How It Works](#how-it-works)
   - [KV Store & Circuit Breaker](#kv-store--circuit-breaker)
   - [Webhook Handler](#webhook-handler)
   - [Call Routing](#call-routing)
   - [Circuit State API](#circuit-state-api)
   - [Manual Reset](#manual-reset)
   - [Health Check](#health-check)
4. [Demo Mode vs Live Mode](#demo-mode-vs-live-mode)
5. [Running the App](#running-the-app)
6. [Testing the Flow](#testing-the-flow)
7. [Next Steps](#next-steps)

---

## Prerequisites

Before running this sample, you need:

- **Node.js 18+**
- The **telnyx-edge CLI** (`npm i -g @telnyx/edge-cli` or see the Edge docs) for `telnyx-edge dev` and `telnyx-edge ship`
- A **Telnyx account** with:
  - An API key (with `Call Control` and `Messaging` permissions)
  - A **primary SIP connection** (Connection ID)
  - A **backup SIP connection** (Connection ID)
  - A **Telnyx phone number** (for outbound calls and SMS alerts)
  - A **webhook signing public key** (for verifying incoming webhooks in live mode)

---

## Environment Setup

1. **Clone the repo** (or copy the sample folder):

   ```bash
   cd auto-failover-voice-routing
   ```

2. **Install dependencies and build:**

   ```bash
   npm install
   npm run build
   ```

3. **Create a `.env` file** from the example:

   ```bash
   cp .env.example .env
   ```

4. **Edit `.env`** and fill in your real Telnyx credentials:

   ```env
   TELNYX_API_KEY=your_telnyx_api_key_here
   TELNYX_PUBLIC_KEY=your_telnyx_public_key_base64
   TELNYX_PRIMARY_CONNECTION_ID=your_primary_sip_connection_id
   TELNYX_BACKUP_CONNECTION_ID=your_backup_sip_connection_id
   TELNYX_FROM_NUMBER=+1555XXXXXXXX
   SMS_FROM_NUMBER=+1555XXXXXXXX
   TELNYX_OPS_ALERT_NUMBER=+1555XXXXXXXX
   FAILURE_THRESHOLD=3
   COOLDOWN_SECONDS=300
   DIAL_TIMEOUT_SECS=30
   TTS_VOICE=Telnyx.Ultra.f786b574-daa5-4673-aa0c-cbe3e8534c02
   DEMO_MODE=true
   ```

   > **Important:** Never commit your real `.env` file. The `.gitignore` already excludes it. On Edge Compute the same values come from `[env_vars]`, `[[secrets]]`, and the `[storage.kv.FAILOVER_KV]` block in `telnyx.toml`.

---

## How It Works

### KV Store & Circuit Breaker

The sample stores breaker state in a real **Telnyx KV namespace** bound as `env.FAILOVER_KV` (see the `[storage.kv.FAILOVER_KV]` block in `telnyx.toml`), so it survives restarts and is shared between the edge worker and the actor. The pure breaker helpers live in `src/breaker.ts`.

The circuit breaker state is stored under three keys:

| Key                   | Description                                      |
|-----------------------|--------------------------------------------------|
| `primary:failures`    | Integer counter of consecutive failures          |
| `primary:last_fail`   | Unix timestamp of the last failure               |
| `primary:tripped`     | Boolean — `true` when the breaker is open        |

The circuit breaker has four states:

1. **Closed** — Normal operation. Calls route to the primary connection. Failures are counted.
2. **Open** — The failure threshold has been reached. Calls route to the backup connection. An SMS alert is sent.
3. **Half-Open** — The cooldown period has expired. The next call is allowed to test the primary connection. If it succeeds, the breaker resets to Closed. If it fails, the breaker goes back to Open.
4. **Closed (recovered)** — The breaker has been reset after a successful half-open test.

`readBreaker()` retrieves all three values; the actor's `recordOutcome()` increments the counter, records the timestamp, and — at the threshold — calls `tripBreaker()` and sends the ops SMS. The actor's `resetBreaker()` zeroes out all counters.

### Webhook Handler

The `/webhooks/call-control` endpoint in `src/index.ts` receives Call Control webhooks from Telnyx. It:

1. **Verifies the webhook signature** using `telnyx.webhooks.unwrap()` with the Ed25519 public key from the `TELNYX_PUBLIC_KEY` secret. In demo mode (`DEMO_MODE=true`) the signature check is skipped so you can test locally with mock payloads.
2. **Extracts the event type** from `event.data.event_type`.
3. **Detects failures** — `call.hangup` events whose `hangup_cause` is one of the failure causes (`NO_ANSWER`, `USER_BUSY`, `CALL_REJECTED`, `DESTINATION_OUT_OF_ORDER`, `NETWORK_OUT_OF_ORDER`, `NO_ROUTE_DESTINATION`, `SERVICE_UNAVAILABLE`, `TIMEOUT`) **and** whose call leg was dialed over the primary connection (looked up in KV), plus `call.state_changed` events with state `failed`, `busy`, or `no_answer`.
4. **Dispatches to the actor** — failure events call `env.FAILOVER_AGENT.idFromName("failover").recordOutcome(event)`, which:
   1. Checks if the failure occurred on the **primary connection** (by comparing `connection_id` in the payload).
   2. Increments the `primary:failures` counter in KV.
   3. Updates `primary:last_fail` with the current timestamp.
   4. If failures reach the `FAILURE_THRESHOLD` (default: 3), it trips the breaker — but only if it isn't already tripped — and sends an SMS alert to `TELNYX_OPS_ALERT_NUMBER`.

Non-failure events also dispatch to the actor's `handleCallEvent()`:

- **`call.answered`** — the actor announces the fraud alert over Call Control (`calls.actions.speak` with SSML): the Meridian Trust Bank script, a calm emotion tag on the primary leg and an apologetic one (plus a "running on backup systems" intro) on the backup leg. If the configured `TTS_VOICE` errors, it falls back to `Telnyx.NaturalHD.Alloy`.
- **`call.speak.ended`** — stage machine: after the greeting speech the actor starts a DTMF `gather` (`valid_digits="12"`, one digit); after the resolution speech it hangs the call up.
- **`call.gather.ended`** — digit `1` confirms the purchase, digit `2` freezes the card, anything else takes the safe default (freeze + flag for review). Each outcome speaks a confirmation and sends the customer an SMS to the originally dialed number with an `MTB-xxxxx` reference.

### Call Routing

The `/api/route` endpoint in the worker determines which SIP connection to use for an outbound call:

1. Accepts a JSON body with a `to` phone number.
2. Reads the breaker from `env.FAILOVER_KV` and applies `shouldRouteToBackup()`:
   - If the breaker is **tripped** and the **cooldown has not expired**, it routes to backup.
   - If the breaker is **tripped** but the **cooldown has expired**, it enters half-open state and tests primary.
   - If the breaker is **not tripped**, it routes to primary.
3. In **demo mode**, it logs what would happen and returns a JSON response with the chosen `connection_id` and current circuit state — no real call is placed.
4. In **live mode**, it calls `env.TELNYX.calls.dial()` with the selected `connection_id` and records `call_control_id → connection_id` and the callee in KV, so later hangup webhooks can attribute failures to the right connection.

### Circuit State API

The `/api/circuit-state` endpoint (`circuit_state`) returns the current circuit breaker state as JSON, including a human-readable `status` field:

- `"closed"` — Normal operation
- `"open"` — Breaker tripped, routing to backup
- `"half-open"` — Cooldown expired, testing primary

### Manual Reset

The `/api/circuit-reset` endpoint (`circuit_reset`) allows you to manually reset the circuit breaker to the closed state. This is useful for testing or when you've resolved the underlying issue and want to immediately restore primary routing without waiting for the cooldown.

### Health Check

The `/health` endpoint returns a simple JSON response confirming the app is running and reporting whether demo mode is active.

---

## Demo Mode vs Live Mode

The sample runs in **demo mode** by default (`DEMO_MODE=true`). In demo mode:

- No real calls are placed — the `/api/route` endpoint logs what it *would* do and returns a demo response.
- No real SMS alerts are sent — the actor logs the alert message (and emits it as a durable event) instead of calling `env.TELNYX.messages.send()`.
- Webhook signature verification is skipped, so mock payloads work for local testing.
- The webhook handler still processes events normally, so you can test the circuit breaker and call flow end-to-end.

To switch to **live mode**:

1. Set `DEMO_MODE=false` in your `.env` file (and in `[env_vars]` in `telnyx.toml`).
2. Store the Ed25519 **public** key for webhook verification: `telnyx-edge secrets add TELNYX_PUBLIC_KEY <base64>`.
3. Ensure all Telnyx credentials are valid and your SIP connections are properly configured.
4. Deploy with `telnyx-edge ship` (or restart `telnyx-edge dev` locally).

In live mode, the sample will place real calls and send real SMS alerts. Use caution — you will incur Telnyx charges.

---

## Running the App

Build and start the local Edge dev server:

```bash
npm run build
npm start
```

`npm start` runs `telnyx-edge dev`, which serves the worker at `http://localhost:8787`.

### Endpoints Overview

| Method | Path                  | Description                              |
|--------|-----------------------|------------------------------------------|
| POST   | `/webhooks/call-control` | Receives Call Control webhooks         |
| POST   | `/api/route`          | Determines which SIP connection to use   |
| GET    | `/api/circuit-state`  | Returns current circuit breaker state    |
| POST   | `/api/circuit-reset`  | Manually resets the circuit breaker      |
| GET    | `/health`             | Health check                             |

---

## Testing the Flow

### 1. Start the app

```bash
npm start
```

### 2. Check the circuit state (should be closed)

```bash
curl http://localhost:8787/api/circuit-state
```

Expected response:

```json
{
  "failures": 0,
  "last_fail": 0,
  "tripped": false,
  "status": "closed"
}
```

### 3. Simulate failures

In demo mode, you can simulate call failures by sending mock webhook payloads:

```bash
curl -X POST http://localhost:8787/webhooks/call-control \
  -H "Content-Type: application/json" \
  -H "Telnyx-Signature: mock" \
  -d '{
    "data": {
      "event_type": "call.state_changed",
      "payload": {
        "connection_id": "your_primary_connection_id",
        "state": "failed"
      }
    }
  }'
```

> **Note:** In demo mode (`DEMO_MODE=true`) webhook signature verification is skipped, so this mock payload is processed as-is. In live mode the Ed25519 signature is verified against `TELNYX_PUBLIC_KEY` — real Telnyx webhooks (e.g. through an ngrok tunnel) will pass.

### 4. Check the circuit state after 3 failures (should be open)

```bash
curl http://localhost:8787/api/circuit-state
```

Expected response:

```json
{
  "failures": 3,
  "last_fail": 1234567890.123,
  "tripped": true,
  "status": "open"
}
```

### 5. Route a call (should use backup)

```bash
curl -X POST http://localhost:8787/api/route \
  -H "Content-Type: application/json" \
  -d '{"to": "+15551234567"}'
```

Expected response (demo mode):

```json
{
  "demo": true,
  "to": "+15551234567",
  "connection_id": "your_backup_connection_id",
  "circuit_state": {
    "failures": 3,
    "last_fail": 1234567890.123,
    "tripped": true
  },
  "message": "Demo mode: no real call placed."
}
```

### 6. Reset the circuit breaker

```bash
curl -X POST http://localhost:8787/api/circuit-reset
```

### 7. Run the smoke test

```bash
npm run smoke
```

This builds an in-process actor host with a mock Telnyx binding and exercises the full breaker flow end to end: health, routing (primary → backup → reset → primary), failure triage (including the half-open probe), and the fraud-alert call flow (announce → gather → resolve → hangup).

---

## Next Steps

Now that you understand how the circuit breaker pattern works with Telnyx Call Control, Telnyx KV, and SMS on the Edge Agent SDK, here are some ways to extend this sample:

- **Add half-open recovery logic** — after the cooldown, automatically attempt a test call on the primary connection and reset the breaker if it succeeds.
- **Add metrics** — export circuit breaker state to Prometheus or Datadog for monitoring.
- **Add retry logic** — implement exponential backoff for calls routed to the backup connection.
- **Multi-region failover** — extend the pattern to support failover across multiple geographic regions.

### Useful Resources

- [Telnyx Call Control API Docs](https://developers.telnyx.com/docs/call-control/api)
- [Telnyx SMS/Messaging API Docs](https://developers.telnyx.com/docs/messaging)
- [Telnyx Webhooks Guide](https://developers.telnyx.com/docs/webhooks)
- [Telnyx Edge Compute Docs](https://developers.telnyx.com/docs/edge)
- [Circuit Breaker Pattern (Martin Fowler)](https://martinfowler.com/bliki/CircuitBreaker.html)
