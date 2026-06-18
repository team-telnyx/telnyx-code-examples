---
name: sip-failover-routing
title: "Production-ready SIP failover routing system with Flask and Telnyx."
description: "Voice application. Built with Telnyx Migration, Number Porting."
language: python
framework: flask
telnyx_products: [Migration, Number Porting]
---

# Production-ready SIP failover routing system with Flask and Telnyx.

Voice application. Built with Telnyx Migration, Number Porting.

## Telnyx API Endpoints Used

- **List Phone Numbers**: `GET /v2/phone_numbers` — [API reference](https://developers.telnyx.com/api/numbers/list-phone-numbers)

## Architecture

```
  API Request
        │
        ▼
  ┌──────────────────┐
  │  Your App         │
  └────────┬─────────┘
           │
           ├──► Telnyx Number Porting
           │
           ▼
     Webhook callback
```

## Telnyx Webhook Events

This app handles these [Call Control](https://developers.telnyx.com/docs/api/v2/call-control) webhook events:

- `call.initiated` -- New inbound or outbound call detected
- `call.answered` -- Call connected, app begins interaction
- `call.hangup` -- Call ended, app cleans up session

## Environment Variables

Copy `.env.example` to `.env` and fill in:

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|-----------------|
| `TELNYX_API_KEY` | `string` | `KEY0123456789ABCDEF` | **yes** | Telnyx API v2 key | [Portal](https://portal.telnyx.com/api-keys) |
| `PRIMARY_SIP_IP` | `string` | `your_value` | **yes** | Primary sip ip | — |
| `PRIMARY_SIP_PORT` | `string` | `5060` | no | Primary sip port | — |
| `BACKUP_SIP_IP` | `string` | `your_value` | **yes** | Backup sip ip | — |
| `BACKUP_SIP_PORT` | `string` | `5060` | no | Backup sip port | — |
| `FLASK_DEBUG` | `string` | `false` | no | Flask debug | — |

## Setup

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/sip-failover-routing-python
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
docker build -t sip-failover-routing-python .
docker run --env-file .env -p 5000:5000 sip-failover-routing-python
```

## API Reference

### `GET /sip/connections`

List all SIP connections.

```bash
curl http://localhost:5000/sip/connections
```

**Response:**

```json
{
  "connections": [
    {
      "id": "1494404757140276705",
      "name": "Production SIP",
      "status": "active",
      "ip": "192.168.1.100"
    }
  ]
}
```

### `POST /sip/connections`

Create a new SIP connection.

```bash
curl -X POST http://localhost:5000/sip/connections \
  -H "Content-Type: application/json" \
  -d '{}'
```

**Response:**

```json
{
  "connections": [
    {
      "id": "1494404757140276705",
      "name": "Production SIP",
      "status": "active",
      "ip": "192.168.1.100"
    }
  ]
}
```

### `GET /sip/connections/<connection_id>`

Retrieve a specific SIP connection.

```bash
curl http://localhost:5000/sip/connections/example-id
```

**Response:**

```json
{
  "connections": [
    {
      "id": "1494404757140276705",
      "name": "Production SIP",
      "status": "active",
      "ip": "192.168.1.100"
    }
  ]
}
```

### `GET /sip/health`

Check health status of all SIP endpoints.

```bash
curl http://localhost:5000/sip/health
```

**Response:**

```json
{
  "connections": [
    {
      "id": "1494404757140276705",
      "name": "Production SIP",
      "status": "active",
      "ip": "192.168.1.100"
    }
  ]
}
```

### `GET /sip/failover-status`

Get current failover routing status.

```bash
curl http://localhost:5000/sip/failover-status
```

**Response:**

```json
{
  "connections": [
    {
      "id": "1494404757140276705",
      "name": "Production SIP",
      "status": "active",
      "ip": "192.168.1.100"
    }
  ]
}
```

### `POST /sip/assign-number`

Assign a phone number to a SIP connection.

```bash
curl -X POST http://localhost:5000/sip/assign-number \
  -H "Content-Type: application/json" \
  -d '{}'
```

**Response:**

```json
{
  "numbers": [
    {
      "phone_number": "+18005551234",
      "status": "active",
      "type": "local",
      "region": "US-CA"
    }
  ]
}
```

## Webhook Endpoints

### `POST /webhooks/call`

Receives [Telnyx Call Control](https://developers.telnyx.com/docs/voice/call-control) webhook events.

**Example payload:**

```json
{
  "data": {
    "event_type": "call.initiated",
    "id": "0ccc7b54-4df3-4bca-a65a-3da1ecc777f0",
    "occurred_at": "2026-07-15T14:30:00.000Z",
    "payload": {
      "call_control_id": "v3:uMi2qMWHT-mLFGkEm4t9tA",
      "connection_id": "1494404757140276705",
      "call_leg_id": "428c31b6-7af4-4bcb-b7f5-5013ef9657c1",
      "call_session_id": "428c31b6-abcd-1234-5678-5013ef9657c1",
      "client_state": null,
      "from": "+12125551234",
      "to": "+13105559876",
      "direction": "incoming",
      "state": "ringing"
    },
    "record_type": "event"
  },
  "meta": {
    "attempt": 1,
    "delivered_to": "https://your-server.example.com/webhooks/voice"
  }
}
```

## Resources

- [Call Control Guide](https://developers.telnyx.com/docs/voice/call-control)
- [Telnyx Developer Docs](https://developers.telnyx.com)
- [Telnyx Portal](https://portal.telnyx.com)
