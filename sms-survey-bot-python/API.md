# API Reference — SMS Survey Bot

All endpoints accept and return JSON. The app runs on `http://localhost:5000` by default.

---

## `POST /survey/start`

Start a survey for a participant and send them the first question.

### Request

```json
{
  "to": "+12125551234"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `to` | `string` | **yes** | Participant phone number in E.164 format (must start with `+`) |

### Response `200`

```json
{
  "participant": "+12125551234",
  "message_id": "msg-f5d7a7e0-1234-5678",
  "question_number": 1,
  "total_questions": 3,
  "status": "survey_started"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `participant` | `string` | The participant the survey was started for |
| `message_id` | `string` | Telnyx message ID of the first question sent |
| `question_number` | `integer` | 1-based index of the question just sent |
| `total_questions` | `integer` | Number of questions in the survey |
| `status` | `string` | Always `survey_started` on success |

**Try it:**

```bash
curl -X POST http://localhost:5000/survey/start \
  -H "Content-Type: application/json" \
  -d '{"to": "+12125551234"}'
```

---

## `POST /webhook/sms`

Inbound webhook called by Telnyx on `message.received`. The Ed25519 signature is
verified against the raw request body before parsing; a failed check returns `401`.
A reply of `START` (case-insensitive) begins a new survey; any other reply advances
the participant's active survey. Not intended to be called directly by clients.

### Request (Telnyx event)

```json
{
  "data": {
    "event_type": "message.received",
    "payload": {
      "from": { "phone_number": "+12125551234" },
      "text": "5"
    }
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `data.event_type` | `string` | Event type; only `message.received` is processed |
| `data.payload.from.phone_number` | `string` | Sender's phone number |
| `data.payload.text` | `string` | Reply body |

### Headers

| Header | Required | Description |
|--------|----------|-------------|
| `telnyx-signature-ed25519` | **yes** | Ed25519 signature of the raw body |
| `telnyx-timestamp` | **yes** | Unix timestamp used for replay protection |

### Response `200` — question advanced

```json
{
  "status": "question_sent",
  "message_id": "msg-aaaa-bbbb",
  "question_number": 2,
  "total_questions": 3
}
```

### Response `200` — survey completed

```json
{
  "status": "survey_completed",
  "message_id": "msg-cccc-dddd",
  "participant": "+12125551234",
  "responses_count": 3
}
```

### Response `200` — invalid reply (question resent)

```json
{
  "status": "invalid_response",
  "message_id": "msg-eeee-ffff",
  "message": "Response rejected. Resending question."
}
```

### Response `200` — ignored (non-survey event)

```json
{ "status": "ignored" }
```

### Response `401` — bad signature

```json
{ "error": "invalid signature" }
```

---

## `GET /survey/results`

Return progress and recorded answers for every participant.

### Response `200`

```json
{
  "total_participants": 1,
  "results": [
    {
      "participant": "+12125551234",
      "status": "in_progress",
      "responses_count": 1,
      "responses": [
        { "question_id": 1, "question_text": "How satisfied...", "response": "5" }
      ]
    }
  ]
}
```

| Field | Type | Description |
|-------|------|-------------|
| `total_participants` | `integer` | Number of participants with survey state |
| `results[].participant` | `string` | Participant phone number |
| `results[].status` | `string` | `in_progress` or `completed` |
| `results[].responses_count` | `integer` | Number of recorded answers |
| `results[].responses` | `array` | Recorded answers (question id, text, response) |

**Try it:**

```bash
curl http://localhost:5000/survey/results
```

---

## `GET /survey/participant/<participant>`

Return progress and recorded answers for a single participant. URL-encode the
leading `+` as `%2B`.

### Response `200`

```json
{
  "participant": "+12125551234",
  "status": "completed",
  "responses_count": 3,
  "responses": [
    { "question_id": 1, "question_text": "How satisfied...", "response": "5" },
    { "question_id": 2, "question_text": "Would you recommend...", "response": "Y" },
    { "question_id": 3, "question_text": "How likely...", "response": "4" }
  ]
}
```

### Response `404`

```json
{ "error": "Participant not found" }
```

**Try it:**

```bash
curl http://localhost:5000/survey/participant/%2B12125551234
```

---

## Error Handling

All endpoints return JSON. Error bodies use a generic `error` message; exception
details are logged server-side and never returned to the caller.

```json
{ "error": "Description of what went wrong" }
```

| Status | Meaning |
|--------|---------|
| `200` | Success (including ignored / invalid-reply cases on the webhook) |
| `400` | Bad request — missing or malformed fields |
| `401` | Invalid API key or invalid webhook signature |
| `404` | Participant not found |
| `429` | Telnyx rate limit exceeded |
| `500` | Unhandled server error |
| `503` | Network error connecting to Telnyx |
