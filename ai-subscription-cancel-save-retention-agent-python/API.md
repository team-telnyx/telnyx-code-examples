# AI Subscription Cancel-Save Retention Agent - API Reference

Endpoint shapes match the actual `app.py` implementation.

## `GET /workflow`

Returns a demo-safe overview of the assistant flow without exposing the full
assistant prompt.

```bash
curl http://localhost:5000/workflow
```

## `GET /demo/call-script`

Returns the caller lines to use when recording the demo.

```bash
curl http://localhost:5000/demo/call-script
```

```json
{
  "number_to_call": "+12068646530",
  "caller_lines": [
    "i have an account attached to this phone number.",
    "i want to cancel because i am not using it enough and it is getting too expensive."
  ],
  "alternate_endings": {
    "accept_offer": "yeah, the discount would help. i will keep it if you can apply that.",
    "decline_offer": "no thanks, please cancel it.",
    "escalate": "i would rather talk to a person about this."
  }
}
```

## `GET /demo/call-summary`

Returns a polished after-call JSON summary for screen recording. This endpoint
is intentionally deterministic so the demo has a clean ending screen.

```bash
curl http://localhost:5000/demo/call-summary
```

```json
{
  "call_type": "subscription_cancel_save",
  "caller_intent": "cancel_subscription",
  "caller_utterances": [
    "i have an account attached to this phone number.",
    "i want to cancel because i am not using it enough and it is getting too expensive."
  ],
  "detected_reasons": ["too_expensive", "not_using"],
  "outcome": "saved",
  "next_step": "apply_retention_offer"
}
```

## `POST /assistant/provision`

Creates or updates the subscription cancel-save AI Assistant. If a phone number
or phone number id is provided, the endpoint also assigns that number to the
assistant's default telephony application.

### Body

```json
{
  "name": "subscription cancel save retention assistant",
  "model": "openai/gpt-4o",
  "assistant_id": "assistant-optional-existing-id",
  "phone_number": "+15551234567",
  "phone_number_id": "3000000000000000000"
}
```

All fields are optional. Defaults come from `.env` or the constants in
`app.py`.

### Example

```bash
curl -X POST http://localhost:5000/assistant/provision \
  -H "Content-Type: application/json" \
  -d '{"phone_number":"+15551234567"}'
```

### Response

```json
{
  "assistant": {
    "id": "assistant-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
    "name": "subscription cancel save retention assistant",
    "model": "openai/gpt-4o",
    "greeting": "hi, thanks for calling. do you already have an account with us, or would you like to create one?",
    "enabled_features": ["telephony"],
    "telephony_settings": {
      "default_texml_app_id": "3000000000000000000"
    }
  },
  "assigned_number": {
    "phone_number": "+15551234567",
    "connection_id": "3000000000000000000"
  }
}
```

## `GET /assistant/<assistant_id>`

Fetches one Telnyx AI Assistant.

```bash
curl http://localhost:5000/assistant/assistant-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
```

## `GET /phone-numbers`

Lists Telnyx phone numbers visible to the API key. Use this to find a
`phone_number_id` before assigning a number.

```bash
curl http://localhost:5000/phone-numbers
```

## `GET /health`

Returns local app health and the last assistant id provisioned by this process.

```bash
curl http://localhost:5000/health
```

```json
{
  "status": "ok",
  "assistant_name": "subscription cancel save retention assistant",
  "last_assistant_id": "assistant-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
}
```

## Error Format

Errors return JSON:

```json
{
  "error": "telnyx request failed",
  "detail": "..."
}
```

Common statuses:

| HTTP status | Meaning |
|-------------|---------|
| `200` | Success |
| `400` | Bad request |
| `401` | Invalid or missing Telnyx API key |
| `404` | Resource not found |
| `422` | Invalid Telnyx API payload |
| `500` | Local setup error |
