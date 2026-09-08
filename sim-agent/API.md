# API Reference — SIMAgent

The worker (`src/index.ts`) exposes the HTTP surface; all durable state lives inside the `SIMAgent` actor, one per SIM card. In **demo mode** (`DEMO_MODE=true`, the default), webhook bodies are parsed without signature verification and outbound actions are simulated. In **live mode** (`DEMO_MODE=false`), every webhook request is verified against the Telnyx Ed25519 signature (`telnyx.webhooks.unwrap`) before processing.

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/sim` | Initialize (or re-provision) the agent for a SIM card. |
| POST | `/api/usage` | Record a usage delta against a SIM. |
| GET | `/api/sim` | Retrieve current SIM agent state and active schedules. |
| POST | `/api/demo` | Run the full demo flow: usage → 80% alert → plan Q&A → upgrade. |
| POST | `/webhooks/usage` | Ingest a Telnyx data-usage event. |
| POST | `/webhooks/sms` | Ingest an inbound customer SMS (`message.received`). |
| POST | `/webhooks/call` | Answer an inbound call (`call.initiated`) with usage context. |
| GET | `/health` | Health check. |

---

## POST /api/sim

### Request

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `simId` | string | Yes | 3–64 letters, numbers, underscores, or hyphens. Names the durable actor. |
| `phoneNumber` | string | No | Customer phone number (E.164) that receives alerts and replies. |
| `plan` | string | No | Plan preset: `1GB` (default), `5GB`, `10GB`, `20GB`, `unlimited`. |

```json
{ "simId": "sim-abc123", "phoneNumber": "+15551234567", "plan": "1GB" }
```

### Response — 201 Created

```json
{
  "simId": "sim-abc123",
  "phoneNumber": "+15551234567",
  "plan": { "name": "1GB Starter", "dataLimitMB": 1024 },
  "usageMB": 0,
  "alerts": [{ "threshold": 80, "sent": false }],
  "billingCycleStart": "2026-09-08T00:00:00.000Z",
  "history": [],
  "liveMode": false,
  "model": "zai-org/GLM-5.2",
  "error": ""
}
```

Initializing also arms two durable schedules: `usage-check` (threshold re-check every `USAGE_CHECK_SECONDS`) and `billing-cycle` (counter reset every `BILLING_CYCLE_SECONDS`).

## POST /api/usage

### Request

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `simId` | string | Yes | SIM to credit usage against. |
| `deltaMB` | number | Yes | Usage delta in MB (non-negative). |

### Response — 200 OK

Returns the updated `SIMState`. If usage crosses 80% of the plan limit and the alert has not been sent, the agent sends a proactive SMS and marks the threshold alert.

## GET /api/sim

Query: `?simId=sim-abc123`.

### Response — 200 OK

```json
{
  "state": { "simId": "sim-abc123", "usageMB": 900, "plan": { "name": "10GB", "dataLimitMB": 10240 } },
  "schedules": [{ "id": "usage-check", "method": "checkThresholds", "due": 1788999878245 }]
}
```

## POST /api/demo

Runs the whole narrative in one call: initialize a SIM, feed usage past the 80% threshold (proactive alert), answer plan-option and upgrade SMS commands, then return the snapshot.

### Request

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `simId` | string | No | Defaults to `sim-demo-<timestamp>`. |
| `phoneNumber` | string | No | Defaults to `+15551234567`. |
| `plan` | string | No | Defaults to `1GB`. |

### Response — 200 OK

```json
{
  "status": "complete",
  "simId": "sim-demo-1788909878245",
  "initializedPlan": "1GB Starter",
  "snapshot": { "state": { "...": "..." }, "schedules": ["..."] }
}
```

## POST /webhooks/usage

Ingests a data-usage event shaped like a Telnyx webhook: `data.payload.sim_card_id` (or `data.payload.to` for the MSISDN fallback) plus `data.payload.usage_mb` or `data.payload.usage_bytes`.

### Response — 200 OK

```json
{ "status": "processed", "sim_card_id": "sim-abc123" }
```

## POST /webhooks/sms

Ingests `message.received` events. `data.payload.text` is the customer's message; `data.payload.from` is the reply-to number. Commands:

| Command | Behavior |
|---------|----------|
| `options` / `plans` | LLM-generated plan comparison (fallback: preset list). |
| `upgrade to <plan>` | Auto-provisions the upgrade via `POST /v2/sim_cards/{id}` (live) and confirms by SMS. |
| `usage` / `history` / `summary` | Sends a usage summary with plan, usage, and percentage. |
| anything else | LLM natural-language reply (fallback: help text). |

### Response — 200 OK

```json
{ "status": "processed", "sim_card_id": "sim-abc123" }
```

## POST /webhooks/call

On `call.initiated`, the agent builds a usage-history message. In live mode the worker performs Call Control `answer` + `speak` against `https://api.telnyx.com/v2/calls/{call_control_id}/actions/...`; in demo mode the action is simulated and the message is returned instead.

### Response — 200 OK (demo)

```json
{ "status": "answered", "demo": true, "sim_card_id": "sim-abc123", "message": "SIM sim-abc123 | Plan: 1GB Starter | ..." }
```

## Error responses

| Status | Meaning |
|--------|---------|
| 400 | Malformed request (missing/invalid `simId`, negative usage, unknown plan). |
| 401 | Live-mode webhook signature verification failed. |
| 500 | Unexpected server error; details are logged internally, never returned. |

## Notes

- **Durable state**: usage counters, plan, alert flags, and history persist per actor via `getState()` / `setState()` — no external KV is used.
- **Safe demo mode**: in demo mode the agent logs simulated sends (`sms.sent.demo` events) and skips all Telnyx API calls. Switch to live mode with `DEMO_MODE=false`.
- **No real numbers**: all phone numbers in this sample use placeholder formats (e.g. `+1555XXXXXXXX`).
