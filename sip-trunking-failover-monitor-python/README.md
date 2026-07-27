---
name: sip-trunking-failover-monitor
title: "SIP Trunking Failover Monitor"
description: "SIP Trunking Failover Monitor - health-check SIP connections, auto-failover, SMS alerts."
language: python
framework: flask
telnyx_products: [SMS/MMS, AI Inference]
---

# SIP Trunking Failover Monitor

SIP Trunking Failover Monitor - health-check SIP connections, auto-failover, SMS alerts.

## Telnyx API Endpoints Used

- **Credential Connections**: `POST /v2/credential_connections` - [API reference](https://developers.telnyx.com/api/webrtc/create-credential-connection)
- **Send Message**: `POST /v2/messages` - [API reference](https://developers.telnyx.com/api/messaging/send-message)
- **AI Inference**: `POST /v2/ai/chat/completions` - [API reference](https://developers.telnyx.com/api/inference/chat-completions)

## Architecture

```
  API Request
        │
        ▼
  ┌──────────────────┐
  │ Parse message     │
  └────────┬─────────┘
           │
           ▼
  ┌──────────────────┐
  │ AI Inference      │
  │ • Business logic   │
  └────────┬─────────┘
           │ ◄──── conversation loop
           │
           └──► JSON response
```

## Environment Variables

Copy `.env.example` to `.env` and fill in:

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|-----------------|
| `TELNYX_API_KEY` | `string` | `KEY0123456789ABCDEF` | **yes** | Telnyx API v2 key | [Portal](https://portal.telnyx.com/api-keys) |
| `AI_MODEL` | `string` | `moonshotai/Kimi-K2.6` | no | Telnyx AI Inference model name | [Portal](https://developers.telnyx.com/docs/inference/models) |
| `ALERT_NUMBER` | `string` | `your_value` | **yes** | Alert number | - |
| `PRIMARY_SIP_CONNECTION_ID` | `string` | `your_value` | **yes** | Primary sip connection id | - |
| `BACKUP_SIP_CONNECTION_ID` | `string` | `your_value` | **yes** | Backup sip connection id | - |
| `PORT` | `integer` | `5000` | no | HTTP server port | - |

## Setup

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/sip-trunking-failover-monitor-python
cp .env.example .env    # ← fill in your credentials
pip install -r requirements.txt
python app.py           # starts on http://localhost:5000
```

<details>
<summary>Programmatic / CLI setup</summary>

```bash
# Install CLI — https://developers.telnyx.com/development/cli
go install github.com/team-telnyx/telnyx-cli/cmd/telnyx@latest
telnyx auth login

# Provision resources
telnyx available-phone-numbers list --country US --features sms
telnyx number-orders create --phone-number +15551234567
```

For full API discovery, point your agent at [`llms-full.txt`](https://developers.telnyx.com/llms-full.txt).

</details>


## API Reference

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

### `GET /status`

Returns status

```bash
curl http://localhost:5000/status
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

## Troubleshooting

| Issue | Cause | Fix |
|-------|-------|-----|
| `401 Unauthorized` | Invalid or missing API key | Verify `TELNYX_API_KEY` in `.env` matches your key in the [Portal](https://portal.telnyx.com/api-keys) |
| Webhook not received | Local server not publicly reachable | Expose it with a tunnel (e.g. ngrok) and set the webhook URL in the [Telnyx Portal](https://portal.telnyx.com) |
| `422 Unprocessable Entity` | Missing or malformed request fields | Check the request body against the API Reference above |

> **Agent / CLI access** — provision resources programmatically with the [Telnyx CLI](https://developers.telnyx.com/development/cli):
>
> ```bash
> telnyx auth login
> ```
>
> Full API discovery: [llms-full.txt](https://developers.telnyx.com/llms-full.txt) · [CLI docs](https://developers.telnyx.com/development/cli)


## Related Examples

- [Configure SIP Codecs (Python)](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/configure-sip-codecs-python/README.md)
- [Inbound SIP Routing (Python)](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/inbound-sip-routing-python/README.md)
- [Setup SIP Trunk (Python)](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/setup-sip-trunk-python/README.md)
- [SIP Failover Routing (Python)](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/sip-failover-routing-python/README.md)
- [SIP Load Balancer Health Check (Python)](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/sip-load-balancer-health-check-python/README.md)

## Agent Discovery

This example is part of the [Telnyx Code Examples](https://github.com/team-telnyx/telnyx-code-examples) catalog.

- **LLM-optimized docs**: [`llms-full.txt`](https://developers.telnyx.com/llms-full.txt)
- **Example index**: [`llms.txt`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/llms.txt)
- **Telnyx CLI**: [developers.telnyx.com/development/cli](https://developers.telnyx.com/development/cli) — `go install github.com/team-telnyx/telnyx-cli/cmd/telnyx@latest`

## Resources

- [AI Inference Guide](https://developers.telnyx.com/docs/inference)
- [Telnyx Developer Docs](https://developers.telnyx.com)
- [Telnyx Portal](https://portal.telnyx.com)

## Why Telnyx

Telnyx is an **AI Communications Infrastructure** platform - voice, messaging, SIP, AI, and IoT on one private, global network.
