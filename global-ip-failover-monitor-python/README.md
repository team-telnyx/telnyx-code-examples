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

- **Call Control: Whisper**: `POST /v2/calls/{id}/actions/bridge` — [API reference](https://developers.telnyx.com/api/call-control/bridge-call)


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
cd telnyx-code-examples/global-ip-failover-monitor-python
cp .env.example .env    # ← fill in your credentials
pip install -r requirements.txt
python app.py           # starts on http://localhost:5000
```

### Docker

```bash
docker build -t global-ip-failover-monitor .
docker run --env-file .env -p 5000:5000 global-ip-failover-monitor
```

## API Reference

### `GET /endpoints`

Returns all endpoints.

**Request:**

```bash
curl http://localhost:5000/endpoints
```

**Response:**

```json
{
  "endpoints": "..."
}
```

### `POST /endpoints`

Adds a new entry.

**Request:**

```bash
curl -X POST http://localhost:5000/endpoints \
  -H "Content-Type: application/json" \
  -d '{
  "id": "f\"ep-{int(time.time(",
  "ip_address": "123 Main St, Apt 4",
  "region": "example_value"
}'
```

**Response:**

```json
{
  "status": "ok",
  "endpoint": "..."
}
```

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

### `GET /failover-log`

Returns failover log details.

**Request:**

```bash
curl http://localhost:5000/failover-log
```

**Response:**

```json
{
  "log": "..."
}
```

### `GET /regions`

Handles `GET /regions`.

**Request:**

```bash
curl http://localhost:5000/regions
```

**Response:**

```json
{
  "status": "ok"
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
