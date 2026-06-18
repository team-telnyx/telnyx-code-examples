---
name: build-conference-calling
title: "Production-ready Flask application for managing conference calls via Telnyx."
description: "Application. Built with Telnyx Migration, Number Porting, Voice."
language: python
framework: flask
telnyx_products: [Migration, Number Porting, Voice]
---

# Production-ready Flask application for managing conference calls via Telnyx.

Production-ready Flask application for managing conference calls via Telnyx.


## Telnyx API Endpoints Used

- **Conference**: `POST /v2/conferences` — [API reference](https://developers.telnyx.com/api/call-control/create-conference)


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
cd telnyx-code-examples/build-conference-calling-python
cp .env.example .env    # ← fill in your credentials
pip install -r requirements.txt
python app.py           # starts on http://localhost:5000
```

### Docker

```bash
docker build -t build-conference-calling .
docker run --env-file .env -p 5000:5000 build-conference-calling
```

## API Reference

### `POST /conference/create`

Creates a new record.

**Request:**

```bash
curl -X POST http://localhost:5000/conference/create \
  -H "Content-Type: application/json" \
  -d '{
  "conference_name": "Jane Doe",
  "participants": "[]"
}'
```

**Response:**

```json
{
  "status_code": "..."
}
```

### `POST /conference/<conference_name>/add-participant`

Adds a new entry.

**Request:**

```bash
curl -X POST http://localhost:5000/conference/example-id/add-participant
```

**Response:**

```json
{
  "status_code": "..."
}
```

### `POST /conference/<conference_name>/end`

Handles `POST /conference/<conference_name>/end`.

**Request:**

```bash
curl -X POST http://localhost:5000/conference/example-id/end
```

**Response:**

```json
{
  "status_code": "..."
}
```

### `GET /conference/<conference_name>/status`

Returns conference status endpoint details.

**Request:**

```bash
curl http://localhost:5000/conference/example-id/status
```

**Response:**

```json
{
  "conference_status_endpoint": [
    "..."
  ]
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

### `POST /webhooks/call-events`

Receives external webhook events.

## Resources

- [Telnyx Developer Documentation](https://developers.telnyx.com)
- [Telnyx Portal (dashboard)](https://portal.telnyx.com)
