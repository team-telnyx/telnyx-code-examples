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

- **Verify**: `POST /v2/verifications` -- [API reference](https://developers.telnyx.com/api/verify/create-verification)


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
cd telnyx-code-examples/verify-multi-channel-auth-python
cp .env.example .env    # ← fill in your credentials
pip install -r requirements.txt
python app.py           # starts on http://localhost:5000
```

### Docker

```bash
docker build -t verify-multi-channel-auth .
docker run --env-file .env -p 5000:5000 verify-multi-channel-auth
```

## API Reference

### `POST /verify/start`

Handles `POST /verify/start`.

**Request:**

```bash
curl -X POST http://localhost:5000/verify/start \
  -H "Content-Type: application/json" \
  -d '{
  "channel": "sms",
  "timeout": 300
}'
```

**Response:**

```json
{
  "verification_id": "...",
  "channel": "...",
  "result": "..."
}
```

### `POST /verify/check`

Handles `POST /verify/check`.

**Request:**

```bash
curl -X POST http://localhost:5000/verify/check \
  -H "Content-Type: application/json" \
  -d '{
  "verification_id": "abc-123",
  "code": "example_value"
}'
```

**Response:**

```json
{
  "verified": "...",
  "channel": "...",
  "message": "..."
}
```

### `POST /verify/escalate/<vid>`

Handles `POST /verify/escalate/<vid>`.

**Request:**

```bash
curl -X POST http://localhost:5000/verify/escalate/example-id
```

**Response:**

```json
{
  "verification_id": "...",
  "channel": "...",
  "attempt": "..."
}
```

### `POST /verify/cascade`

Handles `POST /verify/cascade`.

**Request:**

```bash
curl -X POST http://localhost:5000/verify/cascade
```

**Response:**

```json
{
  "phone": "...",
  "flow": "...",
  "start_url": "...",
  "check_url": "...",
  "escalate_url": "..."
}
```

### `GET /verifications`

Returns all verifications.

**Request:**

```bash
curl http://localhost:5000/verifications
```

**Response:**

```json
{
  "verifications": "..."
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
