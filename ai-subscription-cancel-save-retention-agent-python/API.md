# AI Subscription Cancel-Save Retention Agent - API Reference

Endpoint shapes match the actual `app.py` implementation.

## `GET /workflow`

Returns the assistant greeting, instructions, offer policy, and voice id used by
the sample.

```bash
curl http://localhost:5000/workflow
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
