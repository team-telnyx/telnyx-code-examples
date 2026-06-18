---
name: configure-sip-codecs
title: "Production-ready Flask application for SIP codec configuration via Telnyx."
description: "Voice application. Built with Telnyx Migration, Number Porting, SIP Trunking."
language: python
framework: flask
telnyx_products: [Migration, Number Porting, SIP Trunking]
---

# Production-ready Flask application for SIP codec configuration via Telnyx.

Production-ready Flask application for SIP codec configuration via Telnyx.


## Telnyx API Endpoints Used

- **SIP Connections**: `GET /v2/sip_connections` — [API reference](https://developers.telnyx.com/api/sip-trunking/list-sip-connections)
- **SIP Connection Codecs**: `PATCH /v2/sip_connections/{id}` — [API reference](https://developers.telnyx.com/api/sip-trunking/update-sip-connection)


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
| `SIP_USERNAME` | `string` | `...` | **yes** | sip username | — |
| `SIP_PASSWORD` | `string` | `...` | **yes** | sip password | — |
| `SIP_ENDPOINT` | `string` | `...` | **yes** | sip endpoint | — |
| `FLASK_DEBUG` | `string` | `false` | no | flask debug | — |

## Setup

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/configure-sip-codecs-python
cp .env.example .env    # ← fill in your credentials
pip install -r requirements.txt
python app.py           # starts on http://localhost:5000
```

### Docker

```bash
docker build -t configure-sip-codecs .
docker run --env-file .env -p 5000:5000 configure-sip-codecs
```

## API Reference

### `GET /sip/connections`

Returns all connections.

**Request:**

```bash
curl http://localhost:5000/sip/connections
```

**Response:**

```json
{
  "status_code": "..."
}
```

### `POST /sip/connections`

Creates a new record.

**Request:**

```bash
curl -X POST http://localhost:5000/sip/connections \
  -H "Content-Type: application/json" \
  -d '{
  "name": "Jane Doe",
  "codecs": "[\"G.711\"]",
  "username": "Jane Doe",
  "password": "example_value",
  "sip_endpoint": "example_value"
}'
```

**Response:**

```json
{
  "status_code": "..."
}
```

### `GET /sip/connections/<connection_id>`

Returns connection details.

**Request:**

```bash
curl http://localhost:5000/sip/connections/example-id
```

**Response:**

```json
{
  "status_code": "..."
}
```

## Resources

- [Telnyx Developer Documentation](https://developers.telnyx.com)
- [Telnyx Portal (dashboard)](https://portal.telnyx.com)
