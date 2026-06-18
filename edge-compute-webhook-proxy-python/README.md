---
name: edge-compute-webhook-proxy
title: "Edge Compute Webhook Proxy"
description: "Receive Telnyx voice and SMS webhooks at the edge with minimal latency. Validates, enriches with timestamps, HMAC-signs, and forwards to your backend."
language: python
framework: telnyx-edge (ASGI)
telnyx_products: [Edge Compute, Voice, Messaging]
integrations: []
channel: [voice, sms]
---

# Edge Compute Webhook Proxy

Receive Telnyx voice and SMS webhooks at the edge with sub-10ms cold starts. Validates payloads, enriches with edge timestamps, HMAC-signs the forwarded request, and sends to your backend.

**Runs on [Telnyx Edge Compute](https://developers.telnyx.com/docs/edge-compute)** — deploy with `telnyx-edge ship`.

## Telnyx API Endpoints Used

- **Edge Compute**: `telnyx-edge ship` — [Docs](https://developers.telnyx.com/docs/edge-compute)
- **Call Control Webhooks**: Events from Call Control Application — [API reference](https://developers.telnyx.com/api/call-control)
- **Messaging Webhooks**: Events from Messaging Profile — [API reference](https://developers.telnyx.com/api/messaging)

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
           │
           ▼
```

## Prerequisites

- [Telnyx Edge Compute CLI](https://github.com/team-telnyx/edge-compute/releases) (`telnyx-edge`)
- A [Telnyx account](https://portal.telnyx.com/sign-up)

## Quick Start

```bash
telnyx-edge auth login
telnyx-edge secrets add FORWARD_SECRET "your-hmac-secret"
# Edit func.toml — set FORWARD_URL
telnyx-edge ship
```

## Project Structure

```
edge-compute-webhook-proxy-python/
├── func.toml              # Edge Compute config
├── pyproject.toml          # Python project metadata
├── function/
│   ├── __init__.py
│   └── func.py            # ASGI handler
└── README.md
```

## Environment Variables

| Variable | Type | Required | Description | How to set |
|----------|------|----------|-------------|------------|
| `FORWARD_URL` | `string` | **yes** | Backend URL to forward events to | `func.toml` `[env_vars]` |
| `FORWARD_SECRET` | `string` | no | HMAC-SHA256 signing secret | `telnyx-edge secrets add` |

## Webhook Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/webhooks/voice` | Call Control events |
| `POST` | `/webhooks/sms` | SMS/MMS events |
| `POST` | `/webhooks/messaging` | Messaging events |
| `GET` | `/health` | Health check with stats |

## Testing

**Test locally before deploying:**

```bash
curl -X POST http://localhost:8080 \
  -H "Content-Type: application/json" \
  -d '{"data": {"event_type": "call.initiated"}}'''''' 
```

```json
{"status": "processed", "event_type": "call.initiated"}
```

## Resources

- [Edge Compute Docs](https://developers.telnyx.com/docs/edge-compute)
- [Edge Compute Quickstart](https://developers.telnyx.com/docs/edge-compute/quickstart)
- [Edge CLI Releases](https://github.com/team-telnyx/edge-compute/releases)
