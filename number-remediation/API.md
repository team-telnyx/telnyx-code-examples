# API Reference — Number Reputation Remediation Desk

Typed contract for every route exposed by `app.py`. All routes are served by the Flask app on `PORT` (default `5000`).

Base URL (local): `http://localhost:5000`

## Authentication

The app authenticates to Telnyx with `TELNYX_API_KEY` (loaded from the environment). Inbound webhook requests are verified with the Telnyx Ed25519 public key (`TELNYX_PUBLIC_KEY`) via `client.webhooks.unwrap()`. No auth header is required to call the local routes.

## Enterprise scoping

All reputation and remediation calls are scoped to `TELNYX_ENTERPRISE_ID`. The enterprise is the resource root; the same enterprise is shared with Branded Calling. Requests for a remediation ID that is not owned by the configured enterprise return `404`.

## Demo mode

When `DEMO_MODE=true` (default) or `TELNYX_API_KEY` is unset, the app returns deterministic synthetic data and never contacts the Telnyx API. Set `DEMO_MODE=false` with a valid `TELNYX_API_KEY` and `TELNYX_ENTERPRISE_ID` to hit the live endpoints.

---

## Validation limits (pinned by the API contract)

| Field | Constraint |
| --- | --- |
| `phone_numbers` | 1–2,000 E.164 numbers per request |
| `call_purpose` | 1–2,000 characters, required |
| `contact_email` | max 255 characters, optional |
| `webhook_url` | max 2,048 characters, optional |

Violations are rejected locally with `400` before any upstream call.

---

## `GET /health`

Liveness probe. Reports whether the app is running in demo mode.

### Request

No body, no parameters.

### Example request

```bash
curl -s http://localhost:5000/health
```

### Response — `200 OK`

```json
{
  "status": "ok",
  "demo_mode": true
}
```

### Status codes

| Code | Meaning |
| --- | --- |
| `200` | App is up. |

---

## `POST /reputation/check`

Stage 1 — flagged-number intake. Reads enterprise-scoped reputation data for each supplied number, separates flagged from clean numbers, and writes the flagged set to `flagged.csv`.

### Request body

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `phone_numbers` | `string[]` | yes | E.164 numbers to read reputation data for. Must be a non-empty list. |

### Example request

```bash
curl -s -X POST http://localhost:5000/reputation/check \
  -H "Content-Type: application/json" \
  -d '{
    "phone_numbers": ["+15550000001", "+15550000002", "+15550000003"]
  }'
```

### Response — `200 OK`

```json
{
  "flagged": [
    {
      "phone_number": "+15550000001",
      "spam_risk": "high",
      "spam_score": 85,
      "spam_category": "telemarketing",
      "last_refreshed_at": "2026-07-28T12:00:00+00:00"
    }
  ],
  "clean": [
    {
      "phone_number": "+15550000002",
      "spam_risk": "low",
      "spam_score": 12,
      "spam_category": null,
      "last_refreshed_at": "2026-07-28T12:00:00+00:00"
    }
  ],
  "flagged_csv": "flagged.csv"
}
```

| Field | Type | Description |
| --- | --- | --- |
| `flagged` | `object[]` | Numbers classified as flagged (`spam_risk` of `high`/`medium`, or a populated `spam_category`). |
| `clean` | `object[]` | Numbers with no flag. |
| `flagged_csv` | `string \| null` | Path to the written CSV, or `null` when nothing was flagged. |

Each reputation record carries `phone_number`, `spam_risk`, `spam_score`, `spam_category`, and `last_refreshed_at`.

### Status codes

| Code | Meaning |
| --- | --- |
| `200` | Reputation read succeeded; buckets returned. |
| `400` | `phone_numbers` missing, not a list, or empty. |
| `500` | Unexpected server error. |

---

## `POST /remediation/submit`

Stage 2 — submit a remediation request. Validates the payload against the pinned limits, submits to `POST /v2/enterprises/{enterprise_id}/reputation/remediation`, asserts the `202` contract fields, and stores the request ID.

### Request body

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `phone_numbers` | `string[]` | yes | 1–2,000 E.164 numbers to remediate. |
| `call_purpose` | `string` | yes | 1–2,000 characters describing the intended calling use. |
| `contact_email` | `string` | no | Max 255 characters. |
| `webhook_url` | `string` | no | Max 2,048 characters. Where tiered remediation events are delivered. |

### Example request

```bash
curl -s -X POST http://localhost:5000/remediation/submit \
  -H "Content-Type: application/json" \
  -d '{
    "phone_numbers": ["+15550000001", "+15550000003"],
    "call_purpose": "Outbound appointment reminders for our dental clinic.",
    "webhook_url": "https://example.com/hooks/remediation"
  }'
```

### Response — `202 Accepted`

```json
{
  "id": "3f1c2b7a-9d4e-4a11-8c2f-0b6e5d7a1c90",
  "status": "pending",
  "phone_numbers_count": 2,
  "phone_numbers_submitted": 2,
  "phone_numbers_ineligible": 0,
  "created_at": "2026-07-28T12:00:00+00:00"
}
```

| Field | Type | Description |
| --- | --- | --- |
| `id` | `string` | Remediation request ID. Stored in-process for the CLI flow. |
| `status` | `string` | Initial meta-status, always `pending` on accept. |
| `phone_numbers_count` | `integer` | Total numbers in the request. |
| `phone_numbers_submitted` | `integer` | Numbers accepted into the review pipeline. |
| `phone_numbers_ineligible` | `integer` | Numbers rejected as ineligible at submission time. |
| `created_at` | `string` | ISO-8601 creation timestamp. |

The three count fields are asserted before the request ID is stored; a missing field surfaces as `502`.

### Status codes

| Code | Meaning |
| --- | --- |
| `202` | Request accepted and persisted with `status: pending`. |
| `400` | Validation failure — empty/oversized `phone_numbers`, missing or over-length `call_purpose`, over-length `contact_email` or `webhook_url`, or a malformed E.164 number. |
| `502` | Upstream `202` body was missing a required contract field. |
| `500` | Unexpected server error. |

### Validation error example — `400 Bad Request`

```json
{
  "error": "call_purpose exceeds limit: 2500 > 2000"
}
```

---

## `GET /remediation/{request_id}`

Stage 3 (single read) — fetch a remediation request. Returns the meta-status and, once terminal, the per-number `results` buckets.

### Path parameters

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `request_id` | `string` | yes | The remediation request ID returned by submit. |

### Example request

```bash
curl -s http://localhost:5000/remediation/3f1c2b7a-9d4e-4a11-8c2f-0b6e5d7a1c90
```

### Response — `200 OK`

```json
{
  "id": "3f1c2b7a-9d4e-4a11-8c2f-0b6e5d7a1c90",
  "status": "completed",
  "tier1_completed_at": "2026-07-28T12:04:00+00:00",
  "tier2_completed_at": "2026-07-28T12:31:00+00:00",
  "results": {
    "remediated": ["+15550000001"],
    "not_flagged": ["+15550000002"],
    "requires_review": ["+15550000003"],
    "ineligible": [],
    "refused": []
  }
}
```

| Field | Type | Description |
| --- | --- | --- |
| `id` | `string` | Remediation request ID. |
| `status` | `string` | Meta-status: `pending`, `in_progress`, `completed`, `failed`, or `cancelled`. |
| `tier1_completed_at` | `string \| null` | When tier-1 review finished. |
| `tier2_completed_at` | `string \| null` | When tier-2 review finished. |
| `results` | `object` | Per-number outcome buckets, populated once completed. |

### `results` buckets

| Bucket | Type | Description |
| --- | --- | --- |
| `remediated` | `string[]` | Numbers cleared by remediation. |
| `not_flagged` | `string[]` | Numbers that were not flagged on review. |
| `requires_review` | `string[]` | Numbers needing manual review. |
| `ineligible` | `string[]` | Numbers ineligible for remediation. |
| `refused` | `string[]` | Numbers the carrier declined to remediate. |

### Status codes

| Code | Meaning |
| --- | --- |
| `200` | Request found and returned. |
| `404` | Request not found, or not owned by the configured enterprise. |
| `500` | Unexpected server error. |

---

## `GET /remediation/{request_id}/poll`

Stage 3 (polling fallback) — polls the request endpoint until a terminal status (`completed`, `failed`, `cancelled`) is reached, sleeping `POLL_INTERVAL_SECONDS` (default `60`) between attempts, up to 30 polls. In demo mode the first read is returned immediately.

### Path parameters

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `request_id` | `string` | yes | The remediation request ID to poll. |

### Example request

```bash
curl -s http://localhost:5000/remediation/3f1c2b7a-9d4e-4a11-8c2f-0b6e5d7a1c90/poll
```

### Response — `200 OK`

Same shape as `GET /remediation/{request_id}` — the last observed request detail, with `status` at a terminal value when polling succeeded.

### Status codes

| Code | Meaning |
| --- | --- |
| `200` | Polling finished; last observed detail returned. |
| `500` | Unexpected server error. |

---

## `GET /remediation/{request_id}/report`

Stage 4 — render the final report as Markdown. Includes the meta-status, tier-1/tier-2 timestamps, all five outcome buckets with counts, and review guidance when `requires_review` is non-empty.

### Path parameters

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `request_id` | `string` | yes | The remediation request ID to report on. |

### Example request

```bash
curl -s http://localhost:5000/remediation/3f1c2b7a-9d4e-4a11-8c2f-0b6e5d7a1c90/report
```

### Response — `200 OK`

`Content-Type: text/markdown`

```markdown
# Number Reputation Remediation Report

- Request ID: `3f1c2b7a-9d4e-4a11-8c2f-0b6e5d7a1c90`
- Meta-status: **completed**
- Tier 1 completed at: 2026-07-28T12:04:00+00:00
- Tier 2 completed at: 2026-07-28T12:31:00+00:00

## Outcome buckets

| Bucket | Count | Numbers |
| --- | --- | --- |
| remediated | 1 | +15550000001 |
| not_flagged | 1 | +15550000002 |
| requires_review | 1 | +15550000003 |
| ineligible | 0 | - |
| refused | 0 | - |
```

### Status codes

| Code | Meaning |
| --- | --- |
| `200` | Report rendered as Markdown. |
| `500` | Unexpected server error. |

---

## `POST /webhooks/remediation`

Inbound webhook receiver for the tiered remediation events. Verifies the Telnyx Ed25519 signature with `client.webhooks.unwrap()` against `TELNYX_PUBLIC_KEY`, then logs the event type, request ID, and status.

### Events consumed

| Event type | Meaning |
| --- | --- |
| `number_reputation.remediation.tier1_complete` | Tier-1 review finished; request continues into tier 2. |
| `number_reputation.remediation.completed` | Both tiers finished; `results` buckets are populated. |
| `number_reputation.remediation.failed` | Remediation failed. |

### Request headers

| Header | Required | Description |
| --- | --- | --- |
| `telnyx-signature-ed25519` | yes | Telnyx webhook signature. |
| `telnyx-timestamp` | yes | Signature timestamp. |

### Request body

Telnyx webhook envelope. Relevant fields live under `data`:

| Field | Type | Description |
| --- | --- | --- |
| `data.event_type` | `string` | One of the three remediation event types. |
| `data.payload.id` | `string` | Remediation request ID. |
| `data.payload.status` | `string` | Current meta-status. |
| `data.payload.results` | `object` | Outcome buckets, present when populated. |

### Example request

```bash
curl -s -X POST http://localhost:5000/webhooks/remediation \
  -H "Content-Type: application/json" \
  -H "telnyx-signature-ed25519: <signature>" \
  -H "telnyx-timestamp: <timestamp>" \
  -d '{
    "data": {
      "event_type": "number_reputation.remediation.tier1_complete",
      "payload": {
        "id": "3f1c2b7a-9d4e-4a11-8c2f-0b6e5d7a1c90",
        "status": "in_progress"
      }
    }
  }'
```

### Response — `200 OK`

```json
{
  "received": true,
  "event_type": "number_reputation.remediation.tier1_complete"
}
```

### Status codes

| Code | Meaning |
| --- | --- |
| `200` | Event verified and accepted. |
| `400` | Signature verification failed, or the payload could not be parsed. |
| `500` | Unexpected server error. |

---

## Upstream Telnyx endpoints

The app calls these Telnyx API endpoints through the SDK. They are documented here for reference; they are not served by this app.

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/v2/enterprises/{enterprise_id}/reputation/phone_numbers` | Read per-number reputation data (`spam_risk`, scores, `spam_category`, `last_refreshed_at`). |
| `POST` | `/v2/enterprises/{enterprise_id}/reputation/remediation` | Submit 1–2,000 numbers with a `call_purpose`; returns `202 Accepted` with `status: pending`. |
| `GET` | `/v2/enterprises/{enterprise_id}/reputation/remediation/{id}` | Request detail with `results` buckets once completed; `404` if not found or not owned. |
| `GET` | `/v2/enterprises/{enterprise_id}/reputation/remediation` | List remediation requests for the enterprise. |

## Error envelope

All error responses from this app use a single-field JSON envelope:

```json
{
  "error": "human-readable message"
}
```

Messages are generic and never include credentials, tokens, or unmasked phone numbers.
