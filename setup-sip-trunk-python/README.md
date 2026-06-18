---
name: setup-sip-trunk
title: "Setup SIP Trunk"
description: "Provision and configure a SIP trunk connection on Telnyx with codec preferences, authentication, and failover."
language: python
framework: flask
telnyx_products: [SIP Trunking]
---

# Setup SIP Trunk

Provision and configure a SIP trunk connection on Telnyx with codec preferences, authentication, and failover.

## Telnyx API Endpoints Used

- **Create SIP Connection**: `POST /v2/sip_connections` -- [API reference](https://developers.telnyx.com/api/sip/create-sip-connection)
- **List SIP Connections**: `GET /v2/sip_connections` -- [API reference](https://developers.telnyx.com/api/sip/list-sip-connections)

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
     JSON API response
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
cd telnyx-code-examples/setup-sip-trunk-python
cp .env.example .env    # ← fill in your credentials
pip install -r requirements.txt
python app.py           # starts on http://localhost:5000
```

### Docker

```bash
docker build -t setup-sip-trunk-python .
docker run --env-file .env -p 5000:5000 setup-sip-trunk-python
```

## API Reference

### `POST /sip/setup`

HTTP endpoint to set up SIP trunking.

```bash
curl -X POST http://localhost:5000/sip/setup \
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

## Resources

- [Telnyx Developer Docs](https://developers.telnyx.com)
- [Telnyx Portal](https://portal.telnyx.com)
