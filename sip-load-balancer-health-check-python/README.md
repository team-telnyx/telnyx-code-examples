---
name: sip-load-balancer-health-check
title: "SIP Load Balancer Health Check"
description: "SIP Load Balancer Health Check - monitor SIP trunk health across multiple endpoints, auto-failover to healthy trunks, track uptime metrics."
language: python
framework: flask
telnyx_products: []
---

# SIP Load Balancer Health Check

SIP Load Balancer Health Check - monitor SIP trunk health across multiple endpoints, auto-failover to healthy trunks, track uptime metrics.

## Telnyx API Endpoints Used

- **List SIP Connections**: `GET /v2/sip_connections` - [API reference](https://developers.telnyx.com/api/sip-connections/list-sip-connections)
- **Send Alert SMS**: `POST /v2/messages` - [API reference](https://developers.telnyx.com/api/messaging/send-message)

## Architecture

```
  SIP Endpoints (3+)
    │   │   │
    ▼   ▼   ▼
  ┌──────────────────────────┐
  │ Health Check Loop         │
  │ • TCP probe per endpoint  │
  │ • Uptime tracking         │
  │ • Weighted routing table  │
  └────────────┬──────────────┘
               │
      ┌────────┼────────┐
      ▼        ▼        ▼
  Primary  Secondary  Tertiary
  (70%)    (20%)      (10%)
               │
               ▼
  Auto-failover on health failure
  SMS alert to admin
```

## Environment Variables

Copy `.env.example` to `.env` and fill in:

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|-----------------|
| `TELNYX_API_KEY` | `string` | `KEY0123456789ABCDEF` | **yes** | Telnyx API v2 key | [Portal](https://portal.telnyx.com/api-keys) · [CLI: `telnyx auth`](https://developers.telnyx.com/development/cli) |
| `PORT` | `integer` | `5000` | no | HTTP server port | - |

## Setup

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/sip-load-balancer-health-check-python
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

### `GET /route`

Returns route

```bash
curl http://localhost:5000/route
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

### `GET /log`

Returns log

```bash
curl http://localhost:5000/log
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
- [SIP Trunking Failover Monitor (Python)](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/sip-trunking-failover-monitor-python/README.md)

## Agent Discovery

This example is part of the [Telnyx Code Examples](https://github.com/team-telnyx/telnyx-code-examples) catalog.

- **Agent signup**: [telnyx.com/agent-signup.md](https://telnyx.com/agent-signup.md) — automated account provisioning via agent mail; get an API key with no human intervention
- **Agent CLI**: [github.com/team-telnyx/ai/tree/main/cli](https://github.com/team-telnyx/ai/tree/main/cli) — composite commands for agents ([commands reference](https://github.com/team-telnyx/ai/tree/main/cli/src/commands))
- **Agent skills**: [github.com/team-telnyx/ai/tree/main/skills](https://github.com/team-telnyx/ai/tree/main/skills)
- **Telnyx AI repo**: [github.com/team-telnyx/ai](https://github.com/team-telnyx/ai)
- **LLM-optimized docs**: [`llms-full.txt`](https://developers.telnyx.com/llms-full.txt)
- **Example index**: [`llms.txt`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/llms.txt)
- **Telnyx CLI (human)**: [developers.telnyx.com/development/cli](https://developers.telnyx.com/development/cli) — `go install github.com/team-telnyx/telnyx-cli/cmd/telnyx@latest`

## Resources

- [Telnyx Developer Docs](https://developers.telnyx.com)
- [Telnyx Portal](https://portal.telnyx.com)

## Why Telnyx

Telnyx is an **AI Communications Infrastructure** platform - voice, messaging, SIP, AI, and IoT on one private, global network.
