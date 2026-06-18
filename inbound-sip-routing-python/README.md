---
name: inbound-sip-routing
title: "Flask application for managing inbound SIP routing with Telnyx."
description: "Application. Built with Telnyx Migration, Number Porting."
language: python
framework: flask
telnyx_products: [Migration, Number Porting]
---

# Flask application for managing inbound SIP routing with Telnyx.

Application. Built with Telnyx Migration, Number Porting.

## Telnyx API Endpoints Used

- **Create SIP Connection**: `POST /v2/sip_connections` — [API reference](https://developers.telnyx.com/api/sip-connections/create-sip-connection)
- **List SIP Connections**: `GET /v2/sip_connections` — [API reference](https://developers.telnyx.com/api/sip-connections/list-sip-connections)
- **Retrieve SIP Connection**: `GET /v2/sip_connections/{id}` — [API reference](https://developers.telnyx.com/api/sip-connections/get-sip-connection)

## Architecture

```
  API Request
        │
        ▼
  ┌─────────────┐
  │ Call Control │
  └──────┬──────┘
         │
         ├──► Number Porting
         ├──► DTMF Input
         │
         ▼
    Webhook callback
```

## Environment Variables

Copy `.env.example` to `.env` and fill in:

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|-----------------|
| `TELNYX_API_KEY` | `string` | `KEY0123456789ABCDEF` | **yes** | Telnyx API v2 key | [Portal](https://portal.telnyx.com/api-keys) |
| `FLASK_DEBUG` | `string` | `false` | no | Flask debug | — |

## Setup

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/inbound-sip-routing-python
cp .env.example .env    # ← fill in your credentials
pip install -r requirements.txt
python app.py           # starts on http://localhost:5000
```

### Docker

```bash
docker build -t inbound-sip-routing-python .
docker run --env-file .env -p 5000:5000 inbound-sip-routing-python
```

## API Reference

### `GET /sip/connections`

List all SIP connections configured for inbound routing.

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

Create a new SIP connection for inbound call routing.

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

Get detailed information about a specific SIP connection.

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

## Resources

- [Telnyx Developer Docs](https://developers.telnyx.com)
- [Telnyx Portal](https://portal.telnyx.com)
