---
name: sip-load-balancer-health-check
title: "SIP Load Balancer Health Check"
description: "SIP Load Balancer Health Check — monitor SIP trunk health across multiple endpoints, auto-failover to healthy trunks, track uptime metrics."
language: python
framework: flask
telnyx_products: [Migration, Number Porting]
---

# SIP Load Balancer Health Check

SIP Load Balancer Health Check — monitor SIP trunk health across multiple endpoints, auto-failover to healthy trunks, track uptime metrics.


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

## Setup

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/sip-load-balancer-health-check-python
cp .env.example .env    # ← fill in your credentials
pip install -r requirements.txt
python app.py           # starts on http://localhost:5000
```

### Docker

```bash
docker build -t sip-load-balancer-health-check .
docker run --env-file .env -p 5000:5000 sip-load-balancer-health-check
```

## API Reference

### `POST /check`

Returns service health and operational metrics.

**Request:**

```bash
curl -X POST http://localhost:5000/check
```

**Response:**

```json
{
  "results": "..."
}
```

### `GET /route`

Returns route details.

**Request:**

```bash
curl http://localhost:5000/route
```

**Response:**

```json
{
  "fallback": "...",
  "endpoint": "...",
  "host": "...",
  "port": "...",
  "healthy_count": 3,
  "total_endpoints": 3
}
```

### `GET /endpoints`

Returns all endpoints.

**Request:**

```bash
curl http://localhost:5000/endpoints
```

**Response:**

```json
{
  "endpoints": [
    "..."
  ]
}
```

### `POST /endpoints`

Adds a new entry.

**Request:**

```bash
curl -X POST http://localhost:5000/endpoints \
  -H "Content-Type: application/json" \
  -d '{
  "name": "Jane Doe",
  "host": "example_value",
  "port": 5060,
  "weight": 10
}'
```

**Response:**

```json
{
  "status": "ok"
}
```

### `GET /log`

Returns log details.

**Request:**

```bash
curl http://localhost:5000/log
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
