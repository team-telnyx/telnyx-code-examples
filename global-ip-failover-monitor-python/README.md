---
name: global-ip-failover-monitor
title: "Global IP Failover Monitor"
description: "Global IP Failover Monitor — monitor Global IP endpoints across regions, auto-failover between healthy endpoints."
language: python
framework: flask
telnyx_products: [Migration, Networking, Number Porting]
---

# Global IP Failover Monitor

Global IP Failover Monitor — monitor Global IP endpoints across regions, auto-failover between healthy endpoints.

## Telnyx API Endpoints Used

- **List Global IPs**: `GET /v2/global_ips` — [API reference](https://developers.telnyx.com/api/global-ips/list-global-ips)
- **Get IP Health**: `GET /v2/global_ips/{id}` — [API reference](https://developers.telnyx.com/api/global-ips/get-global-ip)
- **Send Alert SMS**: `POST /v2/messages` — [API reference](https://developers.telnyx.com/api/messaging/send-message)

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
           ├──► Telnyx Global IP / WireGuard
           │
           ▼
     JSON API response
```

## Environment Variables

Copy `.env.example` to `.env` and fill in:

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|-----------------|
| `TELNYX_API_KEY` | `string` | `KEY0123456789ABCDEF` | **yes** | Telnyx API v2 key | [Portal](https://portal.telnyx.com/api-keys) |
| `CHECK_INTERVAL` | `string` | `60` | no | Check interval | — |
| `PORT` | `integer` | `5000` | no | HTTP server port | — |

## Setup

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/global-ip-failover-monitor-python
cp .env.example .env    # ← fill in your credentials
pip install -r requirements.txt
python app.py           # starts on http://localhost:5000
```

### Docker

```bash
docker build -t global-ip-failover-monitor-python .
docker run --env-file .env -p 5000:5000 global-ip-failover-monitor-python
```

## API Reference

### `GET /endpoints`

Returns endpoints

```bash
curl http://localhost:5000/endpoints
```

**Response:**

```json
{
  "items": [
    {
      "id": "item-001",
      "status": "active",
      "created_at": "2026-07-15T14:30:00Z"
    }
  ]
}
```

### `POST /endpoints`

Triggers endpoints

```bash
curl -X POST http://localhost:5000/endpoints \
  -H "Content-Type: application/json" \
  -d '{}'
```

**Response:**

```json
{
  "id": "item-1750280400",
  "status": "created",
  "created_at": "2026-07-15T14:30:00Z"
}
```

### `POST /check`

Triggers check

```bash
curl -X POST http://localhost:5000/check \
  -H "Content-Type: application/json" \
  -d '{
    "phone": "+12125551234",
    "channel": "sms"
  }'
```

**Response:**

```json
{
  "verification_id": "ver-abc123",
  "status": "pending",
  "channel": "sms",
  "phone": "+12125551234"
}
```

### `GET /failover-log`

Returns failover-log

```bash
curl http://localhost:5000/failover-log
```

**Response:**

```json
{
  "items": [
    {
      "id": "item-001",
      "status": "active",
      "created_at": "2026-07-15T14:30:00Z"
    }
  ]
}
```

### `GET /regions`

Returns regions

```bash
curl http://localhost:5000/regions
```

**Response:**

```json
{
  "items": [
    {
      "id": "item-001",
      "status": "active",
      "created_at": "2026-07-15T14:30:00Z"
    }
  ]
}
```

### `GET /health`

Returns health

```bash
curl http://localhost:5000/health
```

**Response:**

```json
{
  "status": "ok",
  "uptime_seconds": 3842,
  "active_sessions": 2,
  "version": "1.0.0"
}
```

## Resources

- [Telnyx Developer Docs](https://developers.telnyx.com)
- [Telnyx Portal](https://portal.telnyx.com)
