## `POST /webhooks/voice`

Receives Telnyx Call Control webhook events.

Handled voice events:

- `call.initiated` answers the inbound call.
- `call.answered` starts one-turn speech capture with `gather_using_ai`.
- `call.ai_gather.ended` routes the captured `utterance` through the Flask state machine.
- `call.speak.ended` is observed for final speak completion.
- `call.hangup` cleans up call state and can create a partial ticket after classification.

## `POST /webhooks/sms`

Receives Telnyx Messaging webhook events.

## `POST /patients`

Seed a patient. Required: `phone`. Optional: `name`, `dob`, `insurance`, `insurance_id`, `provider`, `patient_id`.

## `GET /patients`

List seeded patients.

## `GET /tickets`

List clearance tickets. Filter by `status` (open/complete) and `urgency` (urgent/routine).

## `GET /tickets/<ticket_id>`

Get one ticket with full transcript.

## `POST /tickets/<ticket_id>/complete`

Mark a ticket complete. Body: `{"outcome": "approved|denied|needs_info", "notes": "..."}`.

## `GET /health`

```json
{"status": "ok", "active_calls": 0, "open_tickets": 1, "patients": 2}
```

## Error Handling

All errors return JSON: `{"error": "message"}`

| Status | Meaning |
|--------|---------|
| `200` | Success |
| `201` | Created |
| `400` | Bad request |
| `401` | Invalid webhook signature |
| `404` | Not found |
| `409` | Patient exists |
