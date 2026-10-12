# API

## `POST /demo`

Enqueues a synthetic clinic day on the durable `ReminderQueue` actor.

```bash
curl -X POST http://localhost:8787/demo \
  -H "Content-Type: application/json" \
  -d '{"clinicId":"clinic-42"}'
```

The response includes:

- `actorName`: the actor name derived from `clinicId`.
- `dictionaryPayload`: the `POST /v2/pronunciation_dicts` shape.
- `assistantPayload`: the `POST /v2/ai/assistants` shape.
- `next`: the first outbound `texml/ai_calls` payload and two SSML emotion variants.

## Actor RPC

- `enqueue(clinicId, appointments[])`
- `recordOutcome(patientId, outcome, detail?)`
- `repeatAddress(patientId)`
- `retryNoAnswer({ generation })`
- `snapshot()`

## Telnyx APIs Shown

- `POST /v2/pronunciation_dicts`
- `POST /v2/ai/assistants`
- `POST /v2/texml/ai_calls/{texml_app_id}`
- `POST /v2/calls/{call_control_id}/actions/speak`
