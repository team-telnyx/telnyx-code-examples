---
name: inbound-sip-routing
title: "Flask application for managing inbound SIP routing with Telnyx."
description: "Application. Built with Telnyx Migration, Number Porting."
language: python
framework: flask
telnyx_products: [Migration, Number Porting]
---

# Flask application for managing inbound SIP routing with Telnyx.

Flask application for managing inbound SIP routing with Telnyx.


## Telnyx API Endpoints Used

- **SIP Connections**: `GET /v2/sip_connections` — [API reference](https://developers.telnyx.com/api/sip-trunking/list-sip-connections)


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
| `FLASK_DEBUG` | `string` | `false` | no | flask debug | — |

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
docker build -t inbound-sip-routing .
docker run --env-file .env -p 5000:5000 inbound-sip-routing
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
  "connections": "...",
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
  "sip_uri": "example_value",
  "username": "Jane Doe",
  "password": "example_value"
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
