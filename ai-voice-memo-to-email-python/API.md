## `POST /webhooks/voice`

Receives Telnyx Call Control webhook events. Called automatically by Telnyx during calls — do not call directly.

---

**Try it:**

```bash
curl -X POST http://localhost:5000/webhooks/voice
```

## `GET /`

Live dashboard showing the call timeline and memo inbox. Updates in real time via Server-Sent Events from `/stream`.

---

**Try it:**

Open `http://localhost:5000` in your browser.

## `GET /stream`

Server-Sent Events stream. Pushes call lifecycle events and saved memos to connected dashboards. Replays the last 20 memos on connect.

---

## `GET /memos`

List all memos.

### Response `200`

```json
{
  "memos": [
    {
      "subject": "API Migration Update",
      "body": "Hey team...",
      "action_items": ["Review the PR by Friday"],
      "caller": "+12125551234",
      "raw": "hey team quick update...",
      "timestamp": "2026-08-05T14:30:00Z"
    }
  ]
}
```

**Try it:**

```bash
curl http://localhost:5000/memos
```

---

## `GET /health`

Health check and service status.

### Response `200`

```json
{
  "status": "ok",
  "memos": "<string>"
}
```

**Try it:**

```bash
curl http://localhost:5000/health
```

---

## Status Values

Records use these status values: `answering`, `ended`, `greeting`, `ok`, `processed`, `recording`

## Error Handling

All endpoints return JSON. On error:

```json
{
  "error": "invalid request body"
}
```

| Status | Meaning |
|--------|---------|
| `200` | Success |
| `400` | Bad request — missing or invalid fields |
| `500` | Server error |
