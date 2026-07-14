# AI Subscription Cancel-Save Retention Agent — API Reference

Endpoint shapes match the actual `app.py` implementation.

## Webhooks

### `POST /webhooks/voice`

Receives [Telnyx Call Control](https://developers.telnyx.com/docs/voice/call-control) webhook events. Deduplicated by Telnyx event ID for one hour.

**Events handled**

| Event | App behavior |
|-------|--------------|
| `call.initiated` (inbound) | Answer the call |
| `call.answered` | Verify customer, greet, ask why cancel |
| `call.speak.ended` | Start speech gather |
| `call.gather.ended` | Classify reason or accept/decline offer |
| `call.hangup` | Finalize open case as `needs_followup` |

You cannot usefully curl this endpoint from your terminal — Telnyx delivers events automatically. To test locally, drive it from the [Telnyx Portal](https://portal.telnyx.com) or expose your server with [ngrok](https://ngrok.com).

```bash
curl -X POST http://localhost:5000/webhooks/voice
```

Returns `200 {"status":"ok"}` once verified. Returns `401 {"error":"invalid signature"}` if `TELNYX_PUBLIC_KEY` is set and the signature does not verify.

## Customers

### `POST /customers`

Seed or create a customer. Phone number is required and is what the inbound caller ID is matched against.

**Example**

```bash
curl -X POST http://localhost:5000/customers \
  -H "Content-Type: application/json" \
  -d '{
    "customer_id": "CUST-001",
    "name": "Jordan",
    "phone": "+15551112233",
    "plan": "pro"
  }'
```

**Response `201`**

```json
{
  "customer": {
    "customer_id": "CUST-001",
    "name": "Jordan",
    "phone": "+15551112233",
    "plan": "pro",
    "status": "active",
    "created_at": "2026-07-14T18:42:00Z"
  }
}
```

**Response `400`**

```json
{"error": "phone is required"}
```

**Response `409`**

```json
{"error": "customer exists"}
```

### `GET /customers`

List seeded customers.

**Example**

```bash
curl http://localhost:5000/customers
```

**Response `200`**

```json
{
  "customers": [
    {
      "customer_id": "CUST-001",
      "name": "Jordan",
      "phone": "+15551112233",
      "plan": "pro",
      "status": "active",
      "created_at": "2026-07-14T18:42:00Z"
    }
  ],
  "total": 1
}
```

## Retention Cases

### `GET /retention-cases`

List retention cases, newest first. Optional query params: `status` (`open|complete`), `outcome` (`saved|cancelled|paused|transferred|needs_followup`).

**Example**

```bash
curl http://localhost:5000/retention-cases
curl "http://localhost:5000/retention-cases?outcome=saved"
```

**Response `200`**

```json
{
  "cases": [
    {
      "case_id": "ret-3f2a8c01",
      "customer_id": "CUST-001",
      "phone": "+15551112233",
      "name": "Jordan",
      "plan": "pro",
      "status": "complete",
      "outcome": "saved",
      "reason": "too_expensive",
      "offer": "25% off for 3 months",
      "summary": "Customer says the price has crept up and competitor is cheaper.",
      "transcript": [
        {"role": "user", "content": "I want to cancel my subscription."},
        {"role": "assistant", "content": "Thanks for letting me know..."},
        {"role": "user", "content": "It's too expensive."},
        {"role": "user", "content": "Yes, I'll take it."}
      ],
      "created_at": "2026-07-14T18:42:00Z",
      "completed_at": "2026-07-14T18:44:12Z",
      "accepted_offer": true
    }
  ],
  "total": 1
}
```

### `GET /retention-cases/<case_id>`

Get one retention case with full transcript.

**Example**

```bash
curl http://localhost:5000/retention-cases/ret-3f2a8c01
```

**Response `200`** — same shape as a single case above.

**Response `404`**

```json
{"error": "not found"}
```

### `POST /retention-cases/<case_id>/complete`

Manually finalize a case. Useful for back-office follow-up when a rep closes a case outside the voice flow.

**Body**

```json
{
  "outcome": "saved",
  "accepted_offer": true,
  "notes": "Closed by rep after 5-min callback"
}
```

`outcome` must be one of `saved`, `cancelled`, `paused`, `transferred`, `needs_followup`.

**Example**

```bash
curl -X POST http://localhost:5000/retention-cases/ret-3f2a8c01/complete \
  -H "Content-Type: application/json" \
  -d '{"outcome": "saved", "accepted_offer": true}'
```

**Response `200`**

```json
{
  "case_id": "ret-3f2a8c01",
  "status": "complete",
  "outcome": "saved",
  "accepted_offer": true,
  "completed_at": "2026-07-14T19:01:42Z"
}
```

**Response `400`**

```json
{"error": "invalid outcome"}
```

**Response `404`**

```json
{"error": "case not found"}
```

## Health

### `GET /health`

**Example**

```bash
curl http://localhost:5000/health
```

**Response `200`**

```json
{
  "status": "ok",
  "active_calls": 0,
  "open_cases": 1,
  "customers": 12
}
```

## Reason Values

`too_expensive`, `not_using`, `missing_feature`, `support_issue`, `competitor_switch`, `temporary_pause`, `other`.

## Outcome Values

`saved`, `cancelled`, `paused`, `transferred`, `needs_followup`.

## Status Values

`open`, `complete`.

## Error Format

All errors return JSON:

```json
{"error": "message"}
```

| HTTP status | Meaning |
|-------------|---------|
| `200` | Success |
| `201` | Created |
| `400` | Bad request — missing or invalid field |
| `401` | Invalid webhook signature |
| `404` | Resource not found |
| `409` | Customer already exists |
