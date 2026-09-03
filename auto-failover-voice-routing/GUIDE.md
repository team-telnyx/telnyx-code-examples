# Auto-Failover Voice Routing — Developer Guide

This guide walks you through the `auto-failover-voice-routing` sample: a Flask app that implements a **telecom-native circuit breaker** pattern. When your primary SIP connection starts failing, the app detects the failures via Call Control webhooks, trips a circuit breaker stored in an in-memory KV store, automatically routes subsequent calls to a backup SIP connection, and sends an SMS alert to your ops team.

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

- **Python 3.8+**
- A **Telnyx account** with:
  - An API key (with `Call Control` and `Messaging` permissions)
  - A **primary SIP connection** (Connection ID)
  - A **backup SIP connection** (Connection ID)
  - A **Telnyx phone number** (for outbound calls and SMS alerts)
  - A **webhook signing secret** (for verifying incoming webhooks)
- `pip` (Python package manager)

---

## Environment Setup

1. **Clone the repo** (or copy the sample folder):

   ```bash
   cd auto-failover-voice-routing
   ```

2. **Install dependencies:**

   ```bash
   pip install -r requirements.txt
   ```

3. **Create a `.env` file** from the example:

   ```bash
   cp .env.example .env
   ```

4. **Edit `.env`** and fill in your real Telnyx credentials:

   ```env
   TELNYX_API_KEY=your_telnyx_api_key_here
   TELNYX_PRIMARY_CONNECTION_ID=your_primary_sip_connection_id
   TELNYX_BACKUP_CONNECTION_ID=your_backup_sip_connection_id
   TELNYX_FROM_NUMBER=+1555XXXXXXXX
   TELNYX_OPS_ALERT_NUMBER=+1555XXXXXXXX
   TELNYX_WEBHOOK_SECRET=your_webhook_signing_secret
   FAILURE_THRESHOLD=3
   COOLDOWN_SECONDS=300
   DEMO_MODE=true
   PORT=5000
   ```

   > **Important:** Never commit your real `.env` file. The `.gitignore` already excludes it.

---

## How It Works

### KV Store & Circuit Breaker

The app uses an in-memory dictionary (`_kv_store`) as a simplified KV store. In production, you would replace `kv_get`, `kv_put`, and `kv_increment` with calls to a real KV store like Redis or DynamoDB.

The circuit breaker state is stored under three keys:

| Key                   | Description                                      |
|-----------------------|--------------------------------------------------|
| `primary:failures`    | Integer counter of consecutive failures          |
| `primary:last_fail`   | Unix timestamp of the last failure               |
| `primary:tripped`     | Boolean — `True` when the breaker is open        |

The circuit breaker has four states:

1. **Closed** — Normal operation. Calls route to the primary connection. Failures are counted.
2. **Open** — The failure threshold has been reached. Calls route to the backup connection. An SMS alert is sent.
3. **Half-Open** — The cooldown period has expired. The next call is allowed to test the primary connection. If it succeeds, the breaker resets to Closed. If it fails, the breaker goes back to Open.
4. **Closed (recovered)** — The breaker has been reset after a successful half-open test.

The `get_circuit_state()` function retrieves all three values and returns them as a dictionary. The `trip_circuit_breaker()` function sets `tripped=True`, records the timestamp, and sends an SMS alert. The `reset_circuit_breaker()` function zeroes out all counters.

### Webhook Handler

The `/webhooks/call-control` endpoint (`call_control_webhook`) receives Call Control webhooks from Telnyx. It:

1. **Verifies the webhook signature** using `telnyx.Webhook.construct_event()` with the `Telnyx-Signature` header and your webhook secret. This ensures the request genuinely came from Telnyx.
2. **Extracts the event type** from `telnyx_event.data.event_type`.
3. **Checks for `call.state_changed` events** where the state is `failed`, `busy`, or `no_answer`.
4. **Calls `handle_call_failure()`** with the payload.

The `handle_call_failure()` function:

1. Checks if the failure occurred on the **primary connection** (by comparing `connection_id` in the payload).
2. Increments the `primary:failures` counter via `kv_increment()`.
3. Updates `primary:last_fail` with the current timestamp.
4. If failures reach the `FAILURE_THRESHOLD` (default: 3), it calls `trip_circuit_breaker()` — but only if the breaker isn't already tripped.

### Call Routing

The `/api/route` endpoint (`route_call`) determines which SIP connection to use for an outbound call:

1. Accepts a JSON body with a `to` phone number.
2. Calls `should_route_to_backup()` to check the circuit breaker state:
   - If the breaker is **tripped** and the **cooldown has not expired**, it returns `True` → route to backup.
   - If the breaker is **tripped** but the **cooldown has expired**, it returns `False` → enter half-open state, test primary.
   - If the breaker is **not tripped**, it returns `False` → route to primary.
3. In **demo mode**, it logs what would happen and returns a JSON response with the chosen `connection_id` and current circuit state — no real call is placed.
4. In **live mode**, it calls `telnyx.Call.create()` with the selected `connection_id` to place a real call via the Telnyx Call Control API.

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

The app runs in **demo mode** by default (`DEMO_MODE=true`). In demo mode:

- No real calls are placed — the `/api/route` endpoint logs what it *would* do and returns a demo response.
- No real SMS alerts are sent — `trip_circuit_breaker()` logs the alert message instead of calling `telnyx.Message.create()`.
- The webhook handler still processes events normally, so you can test the circuit breaker logic end-to-end.

To switch to **live mode**:

1. Set `DEMO_MODE=false` in your `.env` file.
2. Ensure all Telnyx credentials are valid and your SIP connections are properly configured.
3. Restart the app.

In live mode, the app will place real calls and send real SMS alerts. Use caution — you will incur Telnyx charges.

---

## Running the App

Start the Flask development server:

```bash
python app.py
```

The app will listen on `http://0.0.0.0:5000` (or the port specified in `PORT`).

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
python app.py
```

### 2. Check the circuit state (should be closed)

```bash
curl http://localhost:5000/api/circuit-state
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
curl -X POST http://localhost:5000/webhooks/call-control \
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

> **Note:** In demo mode, webhook signature verification will fail because the signature is mocked. To test webhooks locally, you can temporarily disable signature verification or use a tool like [ngrok](https://ngrok.com/) with a real Telnyx webhook configuration.

### 4. Check the circuit state after 3 failures (should be open)

```bash
curl http://localhost:5000/api/circuit-state
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
curl -X POST http://localhost:5000/api/route \
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
curl -X POST http://localhost:5000/api/circuit-reset
```

### 7. Run the smoke test

```bash
python smoke_test.py
```

This verifies that the app module loads without errors.

---

## Next Steps

Now that you understand how the circuit breaker pattern works with Telnyx Call Control and SMS, here are some ways to extend this sample:

- **Replace the in-memory KV store** with Redis or DynamoDB for persistence across restarts and multi-instance deployments.
- **Add half-open recovery logic** — after the cooldown, automatically attempt a test call on the primary connection and reset the breaker if it succeeds.
- **Add metrics** — export circuit breaker state to Prometheus or Datadog for monitoring.
- **Add retry logic** — implement exponential backoff for calls routed to the backup connection.
- **Multi-region failover** — extend the pattern to support failover across multiple geographic regions.

### Useful Resources

- [Telnyx Call Control API Docs](https://developers.telnyx.com/docs/call-control/api)
- [Telnyx SMS/Messaging API Docs](https://developers.telnyx.com/docs/messaging)
- [Telnyx Webhooks Guide](https://developers.telnyx.com/docs/webhooks)
- [Telnyx Python SDK Reference](https://developers.telnyx.com/docs/sdk/python)
- [Circuit Breaker Pattern (Martin Fowler)](https://martinfowler.com/bliki/CircuitBreaker.html)
