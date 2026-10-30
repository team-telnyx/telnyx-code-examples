## `POST /webhooks/sms`

Receive an inbound SMS event from Telnyx. The raw body is verified against the `telnyx-signature-ed25519` and `telnyx-timestamp` headers using `TELNYX_PUBLIC_KEY`. A valid request is acknowledged with `200` before any work happens, so Telnyx does not retry while the bot is being created.

### Request (sent by Telnyx)

```json
{
  "data": {
    "event_type": "message.received",
    "payload": {
      "id": "40385f64-5717-4562-b3fc-2c963f66afa6",
      "from": { "phone_number": "+15555550123" },
      "to": [{ "phone_number": "+15555550100" }],
      "text": "I can't join this meeting: https://meet.google.com/abc-defg-hij"
    }
  }
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `data.event_type` | `string` | **yes** | Only `message.received` is handled; other events are acknowledged and ignored |
| `data.payload.id` | `string` | **yes** | Message ID. Used to build the session idempotency key |
| `data.payload.from.phone_number` | `string` | **yes** | Must equal `OWNER_PHONE_NUMBER` or the message is ignored |
| `data.payload.text` | `string` | **yes** | Body. The first Google Meet, Zoom, Teams, or Webex URL is used |

### Response `200`

```json
{ "received": true }
```

### Response `401`

Signature missing, malformed, stale (older than 5 minutes), or does not match.

```json
{ "error": "invalid signature" }
```

## Outbound calls the server makes

### Create the meeting session

`POST https://api.telnyx.com/v2/meeting_sessions` (SDK: `client.meetingSessions.create`)

```json
{
  "meeting_url": "https://meet.google.com/abc-defg-hij",
  "bot_name": "Your Bot",
  "chat_on_enter": "Hi all - I am a bot attending on behalf of a teammate...",
  "summarize_on_end": true,
  "idempotency_key": "join-meeting-by-sms:40385f64-5717-4562-b3fc-2c963f66afa6",
  "assistant": { "id": "assistant-...", "audio_gate": "half_duplex", "leave_on_end": true },
  "camera_image": { "format": "jpeg", "url": "https://example.com/bot-camera.jpg" }
}
```

`assistant` and `camera_image` are sent only when `ASSISTANT_ID` / `CAMERA_IMAGE_URL` are set. `chat_on_enter` is omitted for Webex URLs, because Webex has no meeting chat and the API rejects the field there with `422 unsupported_capability`.

Session `status` moves through `joining` → `waiting_for_admission` → `active` → `ended`, or ends in `failed` / `admission_denied`. A session that times out or is cancelled without being admitted also ends as `ended`, with `joined_at: null`, so the server checks `joined_at` before treating `ended` as attendance.

### Read the TL;DR

`GET /v2/meeting_sessions/{id}/artifacts` (SDK: `client.meetingSessions.artifacts.list`). The server uses the artifact with `type: "summary"` once `status` is `completed`, reading `content.text`.

### Send an SMS

`POST /v2/messages` (SDK: `client.messages.send`) with `from`, `to`, `text`.

## `GET /health`

```json
{ "status": "ok", "watching": 0 }
```

| Field | Type | Description |
|-------|------|-------------|
| `status` | `string` | Always `ok` when the server is up |
| `watching` | `number` | Meeting sessions currently being polled |
