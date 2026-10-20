# API Reference — Number Reputation Remediation Desk

Typed contract for every HTTP surface this sample touches: the enterprise-scoped
reputation read, the remediation submit/poll/list endpoints, and the inbound
webhook route exposed by `webhook_receiver.py`.

All Telnyx API calls are made against `TELNYX_API_BASE` (default
`https://api.telnyx.com/v2`) with `Authorization: Bearer $TELNYX_API_KEY`.
The enterprise is the resource root: every path below is scoped under
`/enterprises/{enterprise_id}`.

---

## 1. Read reputation for a phone number

`GET /v2/enterprises/{enterprise_id}/reputation/phone_numbers/{phone_number}`

Reads the enterprise-scoped reputation record for a single E.164 number.
Used by `check_reputation.py` to derive the flagged set.

### Path parameters

| Name | Type | Required | Description |
| --- | --- | --- | --- |
| `enterprise_id` | string | yes | Enterprise resource id (registered once, shared with Branded Calling). |
| `phone_number` | string | yes | E.164 number, URL-encoded (e.g. `%2B15550000001`). |

### Example request

```bash
curl -s "https://api.telnyx.com/v2/enterprises/$TELNYX_ENTERPRISE_ID/reputation/phone_numbers/%2B15550000001" \
  -H "Authorization: Bearer $TELNYX_API_KEY"
```

### Response — `200 OK`

```json
{
  "data": {
    "phone_number": "+15550000001",
    "spam_risk": "high",
    "spam_score": 82,
    "spam_category": "telemarketing",
    "last_refreshed_at": "2026-07-20T12:00:00Z"
  }
}
```

### Status codes

| Code | Meaning |
| --- | --- |
| `200` | Reputation record returned. |
| `400` | Malformed `phone_number` (not E.164). |
| `401` | Missing or invalid API key. |
| `404` | Number not found in this enterprise's reputation scope. |
| `500` | Upstream error. |

---

## 2. Submit phone numbers for remediation

`POST /v2/enterprises/{enterprise_id}/reputation/remediation`

Submits 1–2,000 E.164 numbers for the two-tier remediation review. Returns
`202 Accepted` with a persisted request in `status: pending`. Used by
`submit_remediation.py`.

### Request body

| Field | Type | Required | Constraints | Description |
| --- | --- | --- | --- | --- |
| `phone_numbers` | array&lt;string&gt; | yes | 1–2,000 items, E.164 | Numbers to remediate. |
| `call_purpose` | string | yes | 1–2,000 chars | Human-readable description of the outbound calling purpose. |
| `contact_email` | string | no | max 255 chars | Contact for review follow-up. |
| `webhook_url` | string | no | max 2,048 chars | Callback URL for the tiered remediation events. |

### Example request

```bash
curl -s -X POST "https://api.telnyx.com/v2/enterprises/$TELNYX_ENTERPRISE_ID/reputation/remediation" \
  -H "Authorization: Bearer $TELNYX_API_KEY" \
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
  "data": {
    "id": "remediation-0001",
    "status": "pending",
    "phone_numbers_count": 2,
    "phone_numbers_submitted": 2,
    "phone_numbers_ineligible": 0,
    "call_purpose": "Outbound appointment reminders for our dental clinic.",
    "webhook_url": "https://example.com/hooks/remediation"
  }
}
```

`submit_remediation.py` asserts `status == "pending"` and the presence of all
three counts (`phone_numbers_count`, `phone_numbers_submitted`,
`phone_numbers_ineligible`) before writing the request id to
`remediation_request_id.txt`.

### Status codes

| Code | Meaning |
| --- | --- |
| `202` | Request persisted; review queued. |
| `400` | Validation failure — see below. |
| `401` | Missing or invalid API key. |
| `404` | Enterprise not found. |
| `500` | Upstream error. |

### `400` validation contract

The documented limits are encoded in the tool itself and demonstrated by
`python submit_remediation.py --invalid-purpose`:

| Violation | Limit |
| --- | --- |
| `call_purpose` too long | > 2,000 chars |
| `phone_numbers` batch too large | > 2,000 items |
| `phone_numbers` empty | < 1 item |
| `contact_email` too long | > 255 chars |
| `webhook_url` too long | > 2,048 chars |

```json
{
  "errors": [
    { "code": "10009", "title": "call_purpose exceeds maximum length of 2000" }
  ]
}
```

---

## 3. Get a remediation request

`GET /v2/enterprises/{enterprise_id}/reputation/remediation/{id}`

Returns the request detail, including the per-number `results` buckets once
the review completes. Used by `poll_remediation.py` (fallback observation
path) and `report.py` (final render).

### Path parameters

| Name | Type | Required | Description |
| --- | --- | --- | --- |
| `enterprise_id` | string | yes | Enterprise resource id. |
| `id` | string | yes | Remediation request id returned by the submit call. |

### Example request

```bash
curl -s "https://api.telnyx.com/v2/enterprises/$TELNYX_ENTERPRISE_ID/reputation/remediation/remediation-0001" \
  -H "Authorization: Bearer $TELNYX_API_KEY"
```

### Response — `200 OK` (in progress)

```json
{
  "data": {
    "id": "remediation-0001",
    "status": "in_progress",
    "tier1_completed_at": "2026-07-20T12:05:00Z"
  }
}
```

### Response — `200 OK` (completed)

```json
{
  "data": {
    "id": "remediation-0001",
    "status": "completed",
    "tier1_completed_at": "2026-07-20T12:05:00Z",
    "tier2_completed_at": "2026-07-20T12:31:00Z",
    "results": {
      "remediated": ["+15550000001"],
      "not_flagged": ["+15550000002"],
      "requires_review": ["+15550000003"],
      "ineligible": [],
      "refused": []
    }
  }
}
```

### Meta-statuses

| Status | Terminal | Meaning |
| --- | --- | --- |
| `pending` | no | Persisted, not yet picked up. |
| `in_progress` | no | Review running (tier 1 and/or tier 2). |
| `completed` | yes | Both tiers finished; `results` populated. |
| `failed` | yes | Review failed; see `failure_reason`. |
| `cancelled` | yes | Request cancelled before completion. |

### Outcome buckets

| Bucket | Meaning |
| --- | --- |
| `remediated` | Flag cleared by the review. |
| `not_flagged` | No flag present at review time. |
| `requires_review` | Needs operator follow-up — see the review guidance docs. |
| `ineligible` | Not eligible for remediation. |
| `refused` | Remediation refused. |

### Status codes

| Code | Meaning |
| --- | --- |
| `200` | Request detail returned. |
| `401` | Missing or invalid API key. |
| `404` | Request not found, or not owned by this enterprise. |
| `500` | Upstream error. |

---

## 4. List remediation requests

`GET /v2/enterprises/{enterprise_id}/reputation/remediation`

Lists remediation requests for the enterprise. Not exercised by the CLI
scripts, but included for completeness (list ref verified live).

### Query parameters

| Name | Type | Required | Description |
| --- | --- | --- | --- |
| `page` | integer | no | Page number (1-based). |
| `page_size` | integer | no | Items per page. |

### Example request

```bash
curl -s "https://api.telnyx.com/v2/enterprises/$TELNYX_ENTERPRISE_ID/reputation/remediation?page=1&page_size=20" \
  -H "Authorization: Bearer $TELNYX_API_KEY"
```

### Response — `200 OK`

```json
{
  "data": [
    { "id": "remediation-0001", "status": "completed" },
    { "id": "remediation-0002", "status": "in_progress" }
  ],
  "meta": { "page": 1, "page_size": 20, "total": 2 }
}
```

### Status codes

| Code | Meaning |
| --- | --- |
| `200` | Page of requests returned. |
| `401` | Missing or invalid API key. |
| `404` | Enterprise not found. |
| `500` | Upstream error. |

---

## 5. Inbound webhook — `POST /hooks/remediation`

Route exposed by `webhook_receiver.py` (Flask). Telnyx POSTs the tiered
remediation events here. The handler verifies the Telnyx Ed25519 signature
via `client.webhooks.unwrap(...)` and reads event fields from
`data.payload`.

### Request headers

| Header | Required | Description |
| --- | --- | --- |
| `telnyx-signature-ed25519` | yes | Ed25519 signature over the raw body. |
| `telnyx-timestamp` | yes | Signature timestamp. |
| `Content-Type` | yes | `application/json`. |

### Event types handled

| Event type | Meaning |
| --- | --- |
| `number_reputation.remediation.tier1_complete` | Tier-1 review done; continuing to tier 2. |
| `number_reputation.remediation.completed` | Both tiers done; `results` populated. |
| `number_reputation.remediation.failed` | Review failed; `failure_reason` set. |

### Example event payload

```json
{
  "data": {
    "event_type": "number_reputation.remediation.tier1_complete",
    "payload": {
      "id": "remediation-0001",
      "status": "in_progress",
      "tier1_completed_at": "2026-07-20T12:05:00Z"
    }
  }
}
```

### Response — `200 OK`

```json
{ "received": true }
```

### Status codes

| Code | Meaning |
| --- | --- |
| `200` | Event accepted (handled or ignored). |
| `401` | Signature verification failed. |
| `500` | Unhandled server error. |

---

## Error envelope

All Telnyx API errors use the same shape:

```json
{
  "errors": [
    {
      "code": "10009",
      "title": "Human-readable message",
      "detail": "Optional additional context"
    }
  ]
}
```

The CLI scripts catch `requests.HTTPError`, print the status code, and exit
non-zero. No exception details are echoed to HTTP responses from the Flask
receiver.
