---
name: verify-multi-channel-auth
title: "Verify Multi-Channel Auth"
description: "Verify Multi-Channel Auth — multi-channel verification: SMS first, fallback to voice call, then WhatsApp. Cascading 2FA."
language: python
framework: flask
telnyx_products: [Migration, Number Porting, Verify, WhatsApp]
---

# Verify Multi-Channel Auth

Verify Multi-Channel Auth — multi-channel verification: SMS first, fallback to voice call, then WhatsApp. Cascading 2FA.

## Telnyx API Endpoints Used

- **Create Verification**: `POST /v2/verifications` — [API reference](https://developers.telnyx.com/api/verify/create-verification)
- **Submit Verification Code**: `POST /v2/verifications/{id}/actions/verify` — [API reference](https://developers.telnyx.com/api/verify/verify-code)

## Architecture

```
  API Request
        │
        ▼
  ┌──────────────────┐
  │  Your App         │
  └────────┬─────────┘
           │
           ├──► Telnyx Verify API
           ├──► Telnyx Number Porting
           ├──► Telnyx WhatsApp
           │
           ▼
     JSON API response
```

## Environment Variables

Copy `.env.example` to `.env` and fill in:

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|-----------------|
| `TELNYX_API_KEY` | `string` | `KEY0123456789ABCDEF` | **yes** | Telnyx API v2 key | [Portal](https://portal.telnyx.com/api-keys) |
| `PORT` | `integer` | `5000` | no | HTTP server port | — |

## Setup

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/verify-multi-channel-auth-python
cp .env.example .env    # ← fill in your credentials
pip install -r requirements.txt
python app.py           # starts on http://localhost:5000
```

### Docker

```bash
docker build -t verify-multi-channel-auth-python .
docker run --env-file .env -p 5000:5000 verify-multi-channel-auth-python
```

## API Reference

### `POST /verify/start`

Triggers start

```bash
curl -X POST http://localhost:5000/verify/start \
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

### `POST /verify/check`

Triggers check

```bash
curl -X POST http://localhost:5000/verify/check \
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

### `POST /verify/escalate/<vid>`

Triggers vid

```bash
curl -X POST http://localhost:5000/verify/escalate/example-id \
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

### `POST /verify/cascade`

Triggers cascade

```bash
curl -X POST http://localhost:5000/verify/cascade \
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

### `GET /verifications`

Returns verifications

```bash
curl http://localhost:5000/verifications
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
