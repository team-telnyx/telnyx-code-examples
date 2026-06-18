---
name: migrate-from-vapi
title: "Migrate from Vapi"
description: "Migrate from Vapi — import Vapi voice agents to Telnyx AI Assistants with voice, prompt, and tool configuration mapping."
language: python
framework: flask
telnyx_products: [Migration, Number Porting]
channel: [voice]
---

# Migrate from Vapi

Migrate from Vapi — import Vapi voice agents to Telnyx AI Assistants with voice, prompt, and tool configuration mapping.


## Telnyx API Endpoints Used

- **Call Control**: `POST /v2/calls` -- [API reference](https://developers.telnyx.com/api/call-control/dial)


## Architecture

```text
┌─────────────┐     ┌────────────┐     ┌──────────────────────┐
│  Phone Call  │────►│   Telnyx   │────►│  POST /webhooks/voice│
└─────────────┘     │   Cloud    │     └──────────┬───────────┘
                    └────────────┘                │
                                                   │
                                                   ▼
                                          ┌─────────────────┐
                                          │ Response (SMS/  │
                                          │ Voice/Webhook)  │
                                          └─────────────────┘
```

## Environment Variables

Copy `.env.example` to `.env` and fill in:

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|-----------------|
| `TELNYX_API_KEY` | `string` | `KEY...` | **yes** | Telnyx API v2 key | [→ link](https://portal.telnyx.com/api-keys) |
| `VAPI_API_KEY` | `string` | `...` | **yes** | vapi api key | — |

## Setup

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/migrate-from-vapi-python
cp .env.example .env    # ← fill in your credentials
pip install -r requirements.txt
python app.py           # starts on http://localhost:5000
```

### Webhook Configuration

1. Expose your local server:

   ```bash
   ngrok http 5000
   ```

2. Copy the HTTPS URL and configure in [Telnyx Portal](https://portal.telnyx.com):

   - **Call Control Application** → Webhook URL → `https://<id>.ngrok.io/webhooks/voice`

### Docker

```bash
docker build -t migrate-from-vapi .
docker run --env-file .env -p 5000:5000 migrate-from-vapi
```

## API Reference

### `GET /audit/vapi`

Handles `GET /audit/vapi`.

**Request:**

```bash
curl http://localhost:5000/audit/vapi
```

**Response:**

```json
{
  "vapi_agents": "...",
  "total": 3
}
```

### `POST /migrate/agent`

Handles `POST /migrate/agent`.

**Request:**

```bash
curl -X POST http://localhost:5000/migrate/agent \
  -H "Content-Type: application/json" \
  -d '{
  "vapi_agent": "Sarah Chen"
}'
```

**Response:**

```json
{
  "status": "ok"
}
```

### `GET /mapping/voices`

Handles `GET /mapping/voices`.

**Request:**

```bash
curl http://localhost:5000/mapping/voices
```

**Response:**

```json
{
  "vapi_to_telnyx": "...",
  "note": "..."
}
```

### `GET /mapping/models`

Handles `GET /mapping/models`.

**Request:**

```bash
curl http://localhost:5000/mapping/models
```

**Response:**

```json
{
  "status": "ok"
}
```

### `GET /migration-log`

Returns log details.

**Request:**

```bash
curl http://localhost:5000/migration-log
```

**Response:**

```json
{
  "log": "..."
}
```

### `GET /health`

Returns service health and operational metrics.

**Request:**

```bash
curl http://localhost:5000/health
```

**Response:**

```json
{
  "status": "ok"
}
```

## Resources

- [Telnyx Developer Documentation](https://developers.telnyx.com)
- [Telnyx Portal (dashboard)](https://portal.telnyx.com)
