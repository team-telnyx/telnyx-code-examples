# API Reference — Chargeback Adjudication

This document describes the HTTP endpoints exposed by the `chargeback-adjudication` Edge sample. All routes are handled by the single Edge `fetch` entry point in `src/index.ts`.

---

## Table of Contents

- [POST /webhook/chargeback](#post-webhookchargeback)
- [POST /webhook/inbound-message](#post-webhookinbound-message)

---

## POST /webhook/chargeback

Births a `DisputeCase` actor for a new chargeback dispute. The actor self-provisions via `env.DISPUTES.idFromName(disputeId)`, seeds mock evidence rows into agent SQL, computes the response deadline, and arms the stable `decide:<disputeId>` task (delay 0) for exactly-once decision execution.

### Request

| Field        | Type    | Required | Description                                                                 |
|--------------|---------|----------|-----------------------------------------------------------------------------|
| `disputeId`  | string  | Yes      | Unique identifier for the chargeback dispute. Used as the actor name.       |
| `customer`   | string  | Yes      | Customer phone number (E.164) associated with the disputed charge.          |
| `amount`     | number  | Yes      | The disputed transaction amount in the smallest currency unit (e.g., cents).|
| `orderId`    | string  | Yes      | The merchant order ID linked to the disputed charge.                        |
| `respondBy`  | string  | No       | ISO 8601 deadline by which the chargeback must be answered. Payload-first; falls back to `RESPONSE_DEADLINE_DAYS` env var (default 7 days). |

### Example Request

```bash
curl -X POST https://<edge-url>/webhook/chargeback \
  -H "Content-Type: application/json" \
  -d '{
    "disputeId": "chgbk_01H8X2ABC",
    "customer": "+15551234567",
    "amount": 1299,
    "orderId": "ord_12345",
    "respondBy": "2026-10-15T14:30:00Z"
  }'
```

### Response

**Status: 200 OK**

```json
{
  "ok": true,
  "message": "DisputeCase chgbk_01H8X2ABC born and decide task armed"
}
```

### Error Responses

**Status: 400 Bad Request** — Missing required fields.

```json
{
  "ok": false,
  "message": "Missing required fields: disputeId, customer, orderId"
}
```

---

## POST /webhook/inbound-message

Re-wakes an existing `DisputeCase` actor when a customer replies with new evidence (e.g., a delivery photo via MMS). The actor re-assembles the full evidence file (including prior transcript from agent SQL), re-runs the Decision Model with the new fact, updates the verdict, and appends to the append-only audit ledger.

### Request

| Field       | Type   | Required | Description                                                                 |
|-------------|--------|----------|-----------------------------------------------------------------------------|
| `disputeId` | string | Yes      | The dispute ID of the actor to re-wake.                                     |
| `text`      | string | Yes      | The inbound message text content (customer's written evidence or reply).   |
| `mediaUrl`  | string | No       | URL to MMS media (e.g., a delivery photo). Passed into the Decision Model state as `evidence.mediaUrl`. |

### Example Request

```bash
curl -X POST https://<edge-url>/webhook/inbound-message \
  -H "Content-Type: application/json" \
  -d '{
    "disputeId": "chgbk_01H8X2ABC",
    "text": "Here is my delivery confirmation photo",
    "mediaUrl": "https://media.telnyx.com/media/abc123.jpg"
  }'
```

### Response

**Status: 200 OK**

```json
{
  "ok": true
}
```

### Error Responses

**Status: 400 Bad Request** — `disputeId` missing from payload.

```json
{
  "error": "disputeId required"
}
```

---

## Status Codes Summary

| Status Code | Meaning                  | Applicable Endpoints              |
|-------------|--------------------------|-----------------------------------|
| 200         | Success                  | `/webhook/chargeback`, `/webhook/inbound-message` |
| 400         | Bad Request (missing fields) | `/webhook/chargeback`, `/webhook/inbound-message` |
| 404         | Not Found (unknown route) | All routes                        |
| 500         | Internal Server Error    | All routes (unexpected failures)  |

---

## Internal Actor Task Handlers

These are not HTTP endpoints but are invoked internally by the Agent SDK's task scheduler. They are documented here for completeness of the API contract.

### `decide` task (`decide:<disputeId>`)

Armed at case birth with delay 0. Invokes `DisputeCase.decide()` which:
1. Assembles the evidence file from agent SQL (orders, deliveries, contactLog).
2. Calls Telnyx Decision Models (`POST /v2/ai/typesafe/v1/systemone`) with `choice`, `score`, and `noul` questions in shared state.
3. Applies the decision policy via `applyPolicy()`.

The stable task ID (`decide:<disputeId>`) ensures exactly-once execution across retries. The `decided` flag is a secondary guard.

### `deadline` task (`respond:<disputeId>`)

Armed when the Decision Model returns `choice=request_evidence`. Fires after `deadlineMs` (computed from `respondBy` payload or `RESPONSE_DEADLINE_DAYS` env fallback). If the case is still undecided, marks `status: "auto_lost"` and appends an `auto_lost` audit row. Survives pod restarts via durable scheduling.

### `onNewEvidence` method

Invoked by the `/webhook/inbound-message` handler. Re-assembles evidence with the new media URL, re-runs the Decision Model, appends a `re-evaluated` audit row, and re-applies policy.

### Audit Ledger Events

Every observable action lands in the `audit` SQL table (append-only). Event types:

| Event | Meaning |
|---|---|
| `decision` | Policy applied a Decision Model ruling (`choice`, `score`, `noul` recorded) |
| `re-evaluated` | New evidence arrived; full verdict stored before policy re-runs |
| `fraud_hold` | `noul > 0.8` — routed to human review, never auto-rebated |
| `auto_lost` | Deadline expired before any final decision |
| `sms_sent` | Outbound SMS accepted by the Telnyx API (`to`, `from`, message `id`) |
| `sms_demo` | Live send skipped (`DEMO_MODE` true); message logged instead |
| `sms_error` | Outbound SMS failed — error text recorded for diagnosis |
| `reviewer_missing` | Fraud hold fired but `REVIEWER_ONCALL_E164` is not configured |
| `task_error` | A scheduled task (`decide`/`onNewEvidence`) failed — error text recorded |

---

## Telnyx Decision Models API (External)

The actor calls the Telnyx Decision Models API directly via `fetch` (the `TELNYX` binding in v0.15.1 does not yet expose the typesafe endpoint).

### Endpoint

```
POST https://api.telnyx.com/v2/ai/typesafe/v1/systemone
```

### Request Headers

| Header           | Value                |
|------------------|----------------------|
| `Authorization`  | `Bearer <TELNYX_API_KEY>` |
| `Content-Type`   | `application/json`   |
| `Accept`         | `application/json`   |

### Request Body

| Field       | Type     | Description                                                                 |
|-------------|----------|-----------------------------------------------------------------------------|
| `state`     | string   | JSON-serialized shared state containing the assembled evidence file.        |
| `questions` | object   | Map of question id → question object (see below).                            |

#### Question Object Schema

| Field          | Type    | Required | Description                                                                 |
|----------------|---------|----------|-----------------------------------------------------------------------------|
| `type`         | string  | Yes      | One of: `"choice"`, `"score"`, `"noul"`.                                    |
| `instructions` | string  | Yes      | Prompt instructions for the model.                                          |
| `criteria`     | object/array | choice/score | For `choice`: map of option key → description. For `score`: array of rubric band descriptions. Omitted for `noul`. |

Example request:

```json
{
  "state": "{\"order\":{...},\"delivery\":{...}}",
  "questions": {
    "decision": {
      "type": "choice",
      "instructions": "Rule on the chargeback.",
      "criteria": {
        "approve_rebate": "Delivery evidence supports the customer's order.",
        "request_evidence": "Evidence is inconclusive; more proof is needed.",
        "deny": "Evidence supports the merchant; deny the dispute."
      }
    },
    "loseProb": {
      "type": "score",
      "instructions": "0=we clearly win, 100=we clearly lose.",
      "criteria": ["0-25 clearly win", "25-75 uncertain", "75-100 clearly lose"]
    },
    "fraud": {
      "type": "noul",
      "instructions": "1 if this looks like a fraud attempt, else 0."
    }
  }
}
```

### Response

**Status: 200 OK** — JSON object with per-question results under `answers`, keyed by question id:

```json
{
  "model": "telnyx/decision-pro",
  "answers": {
    "decision": {
      "type": "choice",
      "choice": "deny",
      "probabilities": { "approve_rebate": 0.32, "request_evidence": 0.002, "deny": 0.68 },
      "confidence": 0.42
    },
    "loseProb": {
      "type": "score",
      "score": 0.45,
      "legend": { "0": "0-25 clearly win", "1": "25-75 uncertain", "2": "75-100 clearly lose" },
      "confidence": 0.33
    },
    "fraud": {
      "type": "noul",
      "noul": 0.05
    }
  },
  "usage": { "input_tokens": 339, "output_tokens": 4, "cached_input_tokens": 0 }
}
```

The actor reads `answers.decision.choice`, `answers.loseProb.score`, and `answers.fraud.noul`.

### Retry Behavior

- On `429` or `502`-class responses, the actor retries up to `MAX_RETRIES` (5) times with jittered exponential backoff (base 1s, doubling, capped at 30s, plus random jitter).
- Non-retryable `4xx` responses (other than `429`) throw immediately with the response body snippet.
- Honors `Retry-After` header if present.
- Throws after exhausting retries.
