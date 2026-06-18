---
name: sip-failover-routing
title: "Production-ready SIP failover routing system with Flask and Telnyx."
description: "Voice application. Built with Telnyx Migration, Number Porting."
language: python
framework: flask
telnyx_products: [Migration, Number Porting]
---

# Production-ready SIP failover routing system with Flask and Telnyx.

Production-ready SIP failover routing system with Flask and Telnyx.


## Telnyx API Endpoints Used

- **Phone Numbers**: `GET /v2/phone_numbers` — [API reference](https://developers.telnyx.com/api/numbers/list-phone-numbers)
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
| `PRIMARY_SIP_IP` | `string` | `...` | **yes** | primary sip ip | — |
| `PRIMARY_SIP_PORT` | `string` | `5060` | no | primary sip port | — |
| `BACKUP_SIP_IP` | `string` | `...` | **yes** | backup sip ip | — |
| `BACKUP_SIP_PORT` | `string` | `5060` | no | backup sip port | — |
| `FLASK_DEBUG` | `string` | `false` | no | flask debug | — |

## Setup

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/sip-failover-routing-python
cp .env.example .env    # ← fill in your credentials
pip install -r requirements.txt
python app.py           # starts on http://localhost:5000
```

### Docker

```bash
docker build -t sip-failover-routing .
docker run --env-file .env -p 5000:5000 sip-failover-routing
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
  "name": "Jane Doe"
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

### `GET /sip/health`

Returns service health and operational metrics.

**Request:**

```bash
curl http://localhost:5000/sip/health
```

**Response:**

```json
{
  "status": "ok"
}
```

### `GET /sip/failover-status`

Handles `GET /sip/failover-status`.

**Request:**

```bash
curl http://localhost:5000/sip/failover-status
```

**Response:**

```json
{
  "status": "ok"
}
```

### `POST /sip/assign-number`

Assigns to a team member. Notifies both assignee and customer.

**Request:**

```bash
curl -X POST http://localhost:5000/sip/assign-number \
  -H "Content-Type: application/json" \
  -d '{
  "connection_id": "abc-123"
}'
```

**Response:**

```json
{
  "status_code": "..."
}
```

## Webhook Endpoints

### `POST /webhooks/call`

Receives external webhook events.

## Resources

- [Telnyx Developer Documentation](https://developers.telnyx.com)
- [Telnyx Portal (dashboard)](https://portal.telnyx.com)
