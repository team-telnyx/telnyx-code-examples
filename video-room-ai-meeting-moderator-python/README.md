---
name: video-room-ai-meeting-moderator
title: "Video Room AI Meeting Moderator"
description: "Video Room AI Meeting Moderator - create video rooms with AI-powered agenda tracking and time management."
language: python
framework: flask
telnyx_products: [AI Inference, Call Recording]
---

# Video Room AI Meeting Moderator

Video Room AI Meeting Moderator - create video rooms with AI-powered agenda tracking and time management.

## Telnyx API Endpoints Used

- **Video Rooms**: `POST /v2/rooms` - [API reference](https://developers.telnyx.com/api/video/create-room)
- **AI Inference**: `POST /v2/ai/chat/completions` - [API reference](https://developers.telnyx.com/api/inference/chat-completions)

## Architecture

```
  Participants join
        │
        ▼
  ┌──────────────────┐
  │ Telnyx Video Room │
  └────────┬─────────┘
           │
           ▼
  ┌──────────────────┐
  │ AI Processing     │
  │ • Business logic   │
  └────────┬─────────┘
           │
           ├──► JSON response
```

## Environment Variables

Copy `.env.example` to `.env` and fill in:

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|-----------------|
| `TELNYX_API_KEY` | `string` | `KEY0123456789ABCDEF` | **yes** | Telnyx API v2 key | [Portal](https://portal.telnyx.com/api-keys) · [CLI: `telnyx auth`](https://developers.telnyx.com/development/cli) |
| `AI_MODEL` | `string` | `moonshotai/Kimi-K2.6` | no | Telnyx AI Inference model name | [Portal](https://developers.telnyx.com/docs/inference/models) |
| `PORT` | `integer` | `5000` | no | HTTP server port | - |

## Setup

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/video-room-ai-meeting-moderator-python
cp .env.example .env    # ← fill in your credentials
pip install -r requirements.txt
python app.py           # starts on http://localhost:5000
```

<details>
<summary>Programmatic / CLI setup</summary>

```bash
# Install CLI — https://developers.telnyx.com/development/cli
go install github.com/team-telnyx/telnyx-cli/cmd/telnyx@latest
telnyx auth login

# Provision resources
telnyx available-phone-numbers list --country US --features sms
telnyx number-orders create --phone-number +15551234567
```

For full API discovery, point your agent at [`llms-full.txt`](https://developers.telnyx.com/llms-full.txt).

</details>


## API Reference

### `POST /rooms`

Triggers rooms

```bash
curl -X POST http://localhost:5000/rooms \
  -H "Content-Type: application/json" \
  -d '{}'
```

**Response:**

```json
{
  "id": "item-1750280400",
  "status": "created",
  "created_at": "2026-07-15T14:30:00Z"
}
```

### `POST /rooms/<room_id>/start`

Triggers start

```bash
curl -X POST http://localhost:5000/rooms/example-id/start \
  -H "Content-Type: application/json" \
  -d '{}'
```

**Response:**

```json
{
  "meeting_id": "mtg-1750280400",
  "status": "created",
  "participants": 3
}
```

### `GET /rooms/<room_id>/status`

Returns status

```bash
curl http://localhost:5000/rooms/example-id/status
```

**Response:**

```json
{
  "meetings": [
    {
      "id": "mtg-1750280400",
      "title": "Q3 Planning",
      "status": "active",
      "participants": 4,
      "action_items": 3
    }
  ]
}
```

### `POST /rooms/<room_id>/next`

Triggers next

```bash
curl -X POST http://localhost:5000/rooms/example-id/next \
  -H "Content-Type: application/json" \
  -d '{}'
```

**Response:**

```json
{
  "id": "item-1750280400",
  "status": "created",
  "created_at": "2026-07-15T14:30:00Z"
}
```

### `GET /health`

Returns health

```bash
curl http://localhost:5000/health
```

**Response:**

```json
{
  "status": "ok",
  "uptime_seconds": 3842,
  "active_sessions": 2,
  "version": "1.0.0"
}
```

## Troubleshooting

| Issue | Cause | Fix |
|-------|-------|-----|
| `401 Unauthorized` | Invalid or missing API key | Verify `TELNYX_API_KEY` in `.env` matches your key in the [Portal](https://portal.telnyx.com/api-keys) |
| Webhook not received | Local server not publicly reachable | Expose it with a tunnel (e.g. ngrok) and set the webhook URL in the [Telnyx Portal](https://portal.telnyx.com) |
| `422 Unprocessable Entity` | Missing or malformed request fields | Check the request body against the API Reference above |

> **Agent / CLI access** — provision resources programmatically with the [Telnyx CLI](https://developers.telnyx.com/development/cli):
>
> ```bash
> telnyx auth login
> ```
>
> Full API discovery: [llms-full.txt](https://developers.telnyx.com/llms-full.txt) · [CLI docs](https://developers.telnyx.com/development/cli)


## Related Examples

- [AI After Hours Emergency Triage (Python)](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/ai-after-hours-emergency-triage-python/README.md)
- [AI Assistant Knowledge Base (Python)](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/ai-assistant-knowledge-base-python/README.md)
- [AI Assistant Multi Tool (Python)](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/ai-assistant-multi-tool-python/README.md)
- [AI Assistant Phone Setup (Python)](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/ai-assistant-phone-setup-python/README.md)
- [AI Audiobook Narrator (Python)](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/ai-audiobook-narrator-python/README.md)

## Agent Discovery

This example is part of the [Telnyx Code Examples](https://github.com/team-telnyx/telnyx-code-examples) catalog.

- **Agent signup**: [telnyx.com/agent-signup](https://telnyx.com/agent-signup) — get a freemium account for programmatic access
- **LLM-optimized docs**: [`llms-full.txt`](https://developers.telnyx.com/llms-full.txt)
- **Example index**: [`llms.txt`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/llms.txt)
- **Telnyx CLI**: [developers.telnyx.com/development/cli](https://developers.telnyx.com/development/cli) — `go install github.com/team-telnyx/telnyx-cli/cmd/telnyx@latest`

## Resources

- [AI Inference Guide](https://developers.telnyx.com/docs/inference)
- [Telnyx Developer Docs](https://developers.telnyx.com)
- [Telnyx Portal](https://portal.telnyx.com)

## Why Telnyx

Telnyx is an **AI Communications Infrastructure** platform - voice, messaging, SIP, AI, and IoT on one private, global network.
