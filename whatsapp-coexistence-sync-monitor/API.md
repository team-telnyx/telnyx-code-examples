# WhatsApp Coexistence Sync Monitor — API Reference

This document describes the HTTP endpoints exposed by the WhatsApp Coexistence Sync Monitor Flask application. It covers the webhook receiver, health check, and the Telnyx API endpoints the service calls internally.

---

## Base URL

When running locally, the service listens on `http://0.0.0.0:5000` by default (override with the `PORT` environment variable).

---

## Endpoints

| Method | Path                          | Description                                        |
| ------ | ----------------------------- | -------------------------------------------------- |
| POST   | `/webhooks/whatsapp/echo`     | Receives `message.echo` webhooks from Telnyx.      |
| GET    | `/health`                     | Health check endpoint.                             |

---

## POST `/webhooks/whatsapp/echo`

Receives Telnyx webhook events. The endpoint verifies the Ed25519 signature, checks the number's coexistence state, and logs accepted `message.echo` events to the JSONL file.

### Headers

| Header                        | Type   | Required | Description                                                                 |
| ----------------------------- | ------ | -------- | --------------------------------------------------------------------------- |
| `telnyx-signature-ed25519`    | string | Yes      | Base64-encoded Ed25519 signature of the raw request body.                   |
| `telnyx-timestamp`            | string | Yes      | Unix timestamp (seconds) when the webhook was signed. Must be within `MAX_TIMESTAMP_SKEW_SECONDS` (default 300s) of the server's current time. |
| `Content-Type`                | string | Yes      | Must be `application/json`.                                                 |

### Request Body

The raw JSON payload from Telnyx. The service parses it and expects the following structure:

| Field                     | Type   | Required | Description                                                                 |
| ------------------------- | ------ | -------- | --------------------------------------------------------------------------- |
| `event_type`              | string | Yes      | Must be `message.echo` for the event to be processed. Other event types are ignored (HTTP 200). |
| `data.id`                 | string | Yes      | Unique event ID.                                                            |
| `data.origin`             | string | No       | Origin of the message. Expected value: `whatsapp_business_app`.             |
| `data.payload.from`       | string | No       | Sender phone number (E.164 format).                                         |
| `data.payload.to`         | string | No       | Recipient phone number (E.164 format).                                      |
| `data.payload.text`       | string | No       | Message body text.                                                          |
| `data.payload.id`         | string | No       | Message ID.                                                                 |
| `data.payload.cost`       | object | No       | Billing cost. For manual-channel echoes this is `null` (no billing event).  |

### Example Request

```bash
curl -X POST http://localhost:5000/webhooks/whatsapp/echo \
  -H "Content-Type: application/json" \
  -H "telnyx-signature-ed25519: <base64-encoded-signature>" \
  -H "telnyx-timestamp: 1712345678" \
  -d '{
    "event_type": "message.echo",
    "data": {
      "id": "event-12345",
      "origin": "whatsapp_business_app",
      "payload": {
        "from": "+1555XXXXXXX",
        "to": "+1555YYYYYYY",
        "text": "Hello from the WhatsApp Business app",
        "id": "message-abc123",
        "cost": null
      }
    }
  }'
```

### Response — 200 OK

Returned when the webhook is accepted. The body varies depending on the outcome:

| Scenario                                                        | Response Body                                                                 |
| --------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Valid signature, `event_type` is `message.echo`, number is active, message logged | `{"ok": true}` |
| Valid signature, `event_type` is not `message.echo` (ignored) | `{"status": "ignored"}` |
| Valid signature, `event_type` is `message.echo`, but number is **not** in `active` coexistence state (skipped, not logged) | `{"ok": "skipped", "reason": "number_not_active"}` |

**Example:**

```json
{
  "ok": true
}
```

#### Response — 400 Bad Request

Returned when the request body is not valid JSON.

```json
{
  "error": "Invalid JSON"
}
```

#### Response — 401 Unauthorized

Returned when the signature is missing, invalid, or the timestamp skew exceeds `MAX_TIMESTAMP_SKEW_SECONDS`. The request body is **not** processed.

```json
{
  "error": "Invalid signature"
}
```

### Status Codes

| Status Code | Description                                                                                     |
| ----------- | ----------------------------------------------------------------------------------------------- |
| `200`       | Request processed (or intentionally skipped).                                                   |
| `400`       | Request body is not valid JSON.                                                                 |
| `401`       | Signature missing, invalid, or timestamp skew too large. Request body not processed.            |
| `500`       | Internal server error (e.g., failure writing to the log file).                                  |

---

## GET `/health`

Simple health check to verify the service is running.

### Example Request

```bash
curl http://localhost:5000/health
```

### Response — 200 OK

```json
{
  "status": "ok"
}
```

### Status Codes

| Status Code | Description                |
| ----------- | -------------------------- |
| `200`       | Service is healthy.        |
| `500`       | Service is not healthy.    |

---

## Internal Telnyx API Calls

The service makes the following calls to the Telnyx API (outside of demo mode). These are not exposed as HTTP endpoints but are documented here for completeness.

### GET `/v2/whatsapp/business_accounts/{waba_id}/phone_numbers`

Called by the **State Checker** to verify the coexistence status of the configured WhatsApp number.

**Parameters:**

| Parameter | Type   | Required | Description                                        |
| --------- | ------ | -------- | -------------------------------------------------- |
| `waba_id` | string | Yes      | WhatsApp Business Account ID (from `WABA_ID` env var). |

**Response (relevant fields):**

| Field               | Type    | Description                                                                 |
| ------------------- | ------- | --------------------------------------------------------------------------- |
| `phone_number`      | string  | The phone number (E.164 format).                                            |
| `is_on_biz_app`     | boolean | Whether the number is enabled on the WhatsApp Business app.                 |
| `coexistence_state` | string  | Lifecycle state: `active`, `sync_pending`, `syncing`, `sync_complete`, `pending_onboarding`, `history_declined`, `sync_deadline_expired`, `offboarded`, `disconnected`, or `null`. Only `active` allows Cloud API sends. |

The service checks that `is_on_biz_app` is `true` and `coexistence_state` is `active` before processing webhooks. Results are cached for `STATE_CHECK_TTL_SECONDS` (default 60 seconds).

---

## Environment Variables

| Variable                     | Type    | Default          | Description                                                                 |
| ---------------------------- | ------- | ---------------- | --------------------------------------------------------------------------- |
| `TELNYX_API_KEY`             | string  | —                | Telnyx API key (required in live mode).                                     |
| `TELNYX_PUBLIC_KEY`          | string  | —                | Telnyx public key (base64 Ed25519) for webhook signature verification.      |
| `WABA_ID`                    | string  | —                | WhatsApp Business Account ID (required in live mode).                       |
| `WHATSAPP_NUMBER`            | string  | —                | The coexistence-enabled WhatsApp number to monitor (E.164 format, required in live mode). |
| `DEMO_MODE`                  | boolean | `true`           | When `true`, simulates the coexistence state check (no real API calls).      |
| `ECHO_LOG_PATH`              | string  | `echo_log.jsonl` | Path to the append-only JSONL log file.                                     |
| `STATE_CHECK_TTL_SECONDS`    | integer | `60`             | TTL (seconds) for the state check cache.                                    |
| `MAX_TIMESTAMP_SKEW_SECONDS` | integer | `300`            | Maximum allowed timestamp skew for webhook signature verification.          |
| `PORT`                       | integer | `5000`           | Port the Flask server listens on.                                           |
