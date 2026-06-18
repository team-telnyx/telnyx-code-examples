---
name: call-forwarding
title: "Production-ready Flask application for call forwarding via Telnyx Voice API."
description: "Voice application. Built with Telnyx Migration, Number Porting, Voice."
language: python
framework: flask
telnyx_products: [Migration, Number Porting, Voice]
---

# Production-ready Flask application for call forwarding via Telnyx Voice API.

Production-ready Flask application for call forwarding via Telnyx Voice API.


## Telnyx API Endpoints Used

- **Call Control: Transfer**: `POST /v2/calls/{id}/actions/transfer` — [API reference](https://developers.telnyx.com/api/call-control/transfer-call)


## Telnyx Webhook Events

This app handles these [Call Control](https://developers.telnyx.com/docs/api/v2/call-control) and [Messaging](https://developers.telnyx.com/docs/api/v2/messaging) webhook events:

- `call.initiated` — incoming call detected, app answers
- `call.answered` — call connected, app speaks greeting
- `call.hangup` — call ended, app cleans up session

## Architecture

```text
┌─────────────┐                        ┌──────────────────────┐
│  API Client │───────────────────────►│     Your App         │
└─────────────┘                        └──────────┬───────────┘
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
| `FORWARD_TO_NUMBER` | `string` | `+18005551234` | **yes** | forward to number | — |
| `FLASK_DEBUG` | `string` | `false` | no | flask debug | — |

## Setup

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/call-forwarding-python
cp .env.example .env    # ← fill in your credentials
pip install -r requirements.txt
python app.py           # starts on http://localhost:5000
```

### Docker

```bash
docker build -t call-forwarding .
docker run --env-file .env -p 5000:5000 call-forwarding
```

## API Reference

### `GET /calls/status/<call_control_id>`

Returns call status details.

**Request:**

```bash
curl http://localhost:5000/calls/status/example-id
```

**Response:**

```json
{
  "call_control_id": "...",
  "is_alive": "...",
  "state": "...",
  "metadata": "...",
  "status_code": "..."
}
```

### `POST /calls/hangup/<call_control_id>`

Handles `POST /calls/hangup/<call_control_id>`.

**Request:**

```bash
curl -X POST http://localhost:5000/calls/hangup/example-id
```

**Response:**

```json
{
  "status_code": "..."
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

## Webhook Endpoints

### `POST /webhooks/call`

Receives external webhook events.

## Resources

- [Telnyx Developer Documentation](https://developers.telnyx.com)
- [Telnyx Portal (dashboard)](https://portal.telnyx.com)
