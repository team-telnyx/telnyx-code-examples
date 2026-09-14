# API Reference — Email Batch Retry Agent

This document is the typed contract for the `BatchAgent` actor's HTTP surface. It covers the two routes exposed by the actor's `fetch()` handler.

**Base URL:** The actor is reachable at its deployed Edge Runtime URL. All paths below are relative to that base.

**Authentication:** The actor itself does not require an API key for inbound requests. Outbound calls to the Telnyx Email Batch API are authenticated via the `TELNYX_API_KEY` secret (or the `TELNYX` binding), and operator SMS uses the `TELNYX` binding.

---

## `POST /campaigns`

Creates a new campaign, initializes durable per-message state, and fires the initial batch send immediately (via the `sendBatch` task).

### Request Body

`Content-Type: application/json`

| Field | Type | Required | Description |
|---|---|---|---|
| `campaignId` | `string` | **Yes** | Unique identifier for the campaign. Used as the actor state key and in audit records. |
| `messages` | `Array<object>` | **Yes** | Array of message payloads. Must be non-empty. |
| `messages[].to` | `string` | **Yes** | Recipient E.164 phone number (e.g. `+15551234567`). Validated against `/^\+?[1-9]\d{7,14}$/`. |
| `messages[].from` | `string` | **Yes** | Sender identifier (E.164 number or alphanumeric sender ID). |
| `messages[].subject` | `string` | **Yes** | Email subject line. |
| `messages[].text` | `string` | **Yes** | Plain-text email body. |

### Example Request

```bash
curl -X POST https://<actor-url>/campaigns \
  -H "Content-Type: application/json" \
  -d '{
    "campaignId": "campaign-2026-03",
    "messages": [
      {
        "to": "+15551234567",
        "from": "Acme Corp",
        "subject": "March Newsletter",
        "text": "Hello! Here is your March update."
      },
      {
        "to": "+15557654321",
        "from": "Acme Corp",
        "subject": "March Newsletter",
        "text": "Hello! Here is your March update."
      }
    ]
  }'
```

### Response — `202 Accepted`

The campaign was created and the initial batch send has been queued.

```json
{
  "campaignId": "campaign-2026-03",
  "status": "CREATED"
}
```

### Response — `400 Bad Request`

Returned when the request body is malformed or fails validation.

| Condition | Example body |
|---|---|
| Invalid JSON | `{"error": "Invalid JSON body"}` |
| Missing `campaignId` or empty `messages` | `{"error": "campaignId and non-empty messages[] required"}` |
| Missing message field | `{"error": "Each message requires to, from, subject, text"}` |
| Invalid E.164 `to` number | `{"error": "Invalid E.164 'to' number: +123"}` |

---

## GET /campaigns/:id

Returns the full durable campaign state — the complete audit trail including per-message status, attempt counts, idempotency keys, and last errors.

### Path Parameters

| Parameter | Type | Required | Description |
|---|---|---|---|
| `id` | `string` | **Yes** | The `campaignId` passed at creation. |

### Example Request

```bash
curl https://<actor-url>/campaigns/campaign-2026-03
```

### Response — `200 OK`

```json
{
  "campaignId": "campaign-2026-03",
  "total": 100,
  "sent": 98,
  "failed": 0,
  "exhausted": 2,
  "messages": [
    {
      "index": 0,
      "to": "+15551234567",
      "from": "Acme Corp",
      "subject": "March Newsletter",
      "text": "Hello!",
      "status": "SENT",
      "attempts": 1,
      "lastError": null,
      "idempotencyKey": "campaign-2026-03-1712345678901-a1b2c3d4"
    },
    {
      "index": 97,
      "to": "+15557654321",
      "from": "Acme Corp",
      "subject": "March Newsletter",
      "text": "Hello!",
      "status": "EXHAUSTED",
      "attempts": 3,
      "lastError": "Simulated failure (mock mode)",
      "idempotencyKey": "campaign-2026-03-1712345978901-e5f6g7h8"
    }
  ],
  "status": "PARTIAL_FAILURE",
  "createdAt": "2026-03-01T10:00:00.000Z",
  "completedAt": "2026-03-01T10:05:00.000Z"
}
```

### Response — `404 Not Found`

Returned when no campaign with the given ID exists on this actor.

```json
{
  "error": "Campaign not found"
}
```

---

## Status Codes

| Code | Description |
|---|---|
| `200` | Successful GET — campaign audit trail returned. |
| `202` | Campaign created; initial batch send queued. |
| `400` | Malformed request body or validation failure. |
| `404` | Route not found, or campaign ID does not exist on this actor. |
| `500` | Internal error (e.g. missing `TELNYX_API_KEY` secret, upstream API failure). The actor logs the exception; the response body is generic. |

---

## Notes on Actor Behavior

- **State machine:** `CREATED → SENDING → RETRYING → COMPLETED | PARTIAL_FAILURE`. The current state is always reflected in the `status` field of the audit trail.
- **Idempotency keys:** Each batch attempt (initial + each retry) generates a fresh `Idempotency-Key` header. Keys are recorded per-message in the audit trail.
- **Retry backoff:** Failed messages are retried at 60s, then 300s (5m). Max 3 attempts per message (1 initial + 2 retries). Messages still failing after the final retry are marked `EXHAUSTED`.
- **Mock mode:** When `MOCK_MODE=true`, the batch API is simulated — indices 97 and 98 fail on the first attempt and heal on the first retry. No real emails are sent.
- **Operator notification:** On completion (`COMPLETED` or `PARTIAL_FAILURE`), the actor sends an SMS summary to the operator via the `TELNYX` binding.
- **Audit persistence:** Finished campaign records are written to the `RESULT_KV` binding under `campaign:<id>` with a 30-day TTL.
