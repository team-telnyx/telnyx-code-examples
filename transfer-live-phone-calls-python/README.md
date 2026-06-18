---
name: transfer-live-phone-calls
title: "Production-ready Flask application for call transfer via Telnyx Voice API."
description: "Voice application. Built with Telnyx Migration, Number Porting, Voice."
language: python
framework: flask
telnyx_products: [Migration, Number Porting, Voice]
---

# Production-ready Flask application for call transfer via Telnyx Voice API.

Production-ready Flask application for call transfer via Telnyx Voice API.


## Telnyx API Endpoints Used

- **Call Control: Transfer**: `POST /v2/calls/{id}/actions/transfer` -- [API reference](https://developers.telnyx.com/api/call-control/transfer-call)


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
| `TELNYX_PHONE_NUMBER` | `string` | `+18005551234` | **yes** | telnyx phone number | — |
| `TELNYX_CONNECTION_ID` | `string` | `...` | **yes** | telnyx connection id | — |
| `FLASK_DEBUG` | `string` | `false` | no | flask debug | — |

## Setup

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/transfer-live-phone-calls-python
cp .env.example .env    # ← fill in your credentials
pip install -r requirements.txt
python app.py           # starts on http://localhost:5000
```

### Docker

```bash
docker build -t transfer-live-phone-calls .
docker run --env-file .env -p 5000:5000 transfer-live-phone-calls
```

## API Reference

### `POST /calls/initiate`

Handles `POST /calls/initiate`.

**Request:**

```bash
curl -X POST http://localhost:5000/calls/initiate
```

**Response:**

```json
{
  "status_code": "..."
}
```

### `POST /calls/transfer`

Handles `POST /calls/transfer`.

**Request:**

```bash
curl -X POST http://localhost:5000/calls/transfer \
  -H "Content-Type: application/json" \
  -d '{
  "transfer_to": "example_value"
}'
```

**Response:**

```json
{
  "status_code": "..."
}
```

### `POST /calls/hangup`

Handles `POST /calls/hangup`.

**Request:**

```bash
curl -X POST http://localhost:5000/calls/hangup
```

**Response:**

```json
{
  "status_code": "..."
}
```

### `GET /calls/status/<call_control_id>`

Returns call status details.

**Request:**

```bash
curl http://localhost:5000/calls/status/example-id
```

**Response:**

```json
{
  "call_status": [
    "..."
  ]
}
```

## Webhook Endpoints

### `POST /webhooks/call-events`

Receives external webhook events.

## Resources

- [Telnyx Developer Documentation](https://developers.telnyx.com)
- [Telnyx Portal (dashboard)](https://portal.telnyx.com)
