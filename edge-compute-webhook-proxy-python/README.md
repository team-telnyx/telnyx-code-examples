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

**Runs on [Telnyx Edge Compute](https://developers.telnyx.com/docs/edge-compute)** - deploy with `telnyx-edge ship`.

## Telnyx API Endpoints Used

- **Edge Compute**: `telnyx-edge ship` - [Docs](https://developers.telnyx.com/docs/edge-compute)
- **Call Control Webhooks**: Events from Call Control Application - [API reference](https://developers.telnyx.com/api/call-control)
- **Messaging Webhooks**: Events from Messaging Profile - [API reference](https://developers.telnyx.com/api/messaging)

## Architecture

```
  Telnyx Webhook Event
  (voice / SMS / SIM)
        │
        ▼
  ┌──────────────────┐
  │ Telnyx Edge       │ ── serverless, <10ms cold start
  │ (ASGI function)   │
  └────────┬─────────┘
           │
           ├──► Validate signature
           ├──► Enrich with metadata
           ├──► HMAC sign for backend
           │
           ▼
  ┌──────────────────┐
  │ Your Backend      │ ── receives validated, enriched event
  └──────────────────┘
```

## Prerequisites

- [Telnyx Edge Compute CLI](https://github.com/team-telnyx/edge-compute/releases) (`telnyx-edge`)
- A [Telnyx account](https://portal.telnyx.com/sign-up)

## Quick Start

```bash
telnyx-edge auth login
telnyx-edge secrets add FORWARD_SECRET "your-hmac-secret"
# Edit func.toml - set FORWARD_URL
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

## How It Works

1. Receives incoming message via Telnyx Messaging webhook

## Why Telnyx

Telnyx is an **AI Communications Infrastructure** platform - voice, messaging, SIP, AI, and IoT on one private, global network.

- **Single-vendor voice stack** - call control, STT, TTS, and recording from one API. No multi-vendor coordination.
- **Deliverability built in** - number reputation, 10DLC registration, and deliverability monitoring included.

## Environment Variables

| Variable | Type | Required | Description | How to set |
|----------|------|----------|-------------|------------|
| `TELNYX_PUBLIC_KEY` | `string` | **yes** | Verifies the inbound Telnyx Ed25519 webhook signature | Portal > Keys & Credentials > Public Key |
| `FORWARD_URL` | `string` | **yes** | Backend URL (https) to forward events to | `func.toml` `[env_vars]` |
| `FORWARD_SECRET` | `string` | no | HMAC-SHA256 signing secret | `telnyx-edge secrets add` |

## Webhook Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/webhooks/voice` | Call Control events |
| `POST` | `/webhooks/sms` | SMS/MMS events |
| `POST` | `/webhooks/messaging` | Messaging events |
| `GET` | `/health` | Health check with stats |

> **Agent / CLI access** — provision resources programmatically with the [Telnyx CLI](https://developers.telnyx.com/development/cli):
>
> ```bash
> telnyx auth login
> ```
>
> Full API discovery: [llms-full.txt](https://developers.telnyx.com/llms-full.txt) · [CLI docs](https://developers.telnyx.com/development/cli)


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

## Setup

```bash
cd edge-compute-webhook-proxy-python
pip install -r requirements.txt
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


## Troubleshooting

- **Connection refused on port 5000**: App isn't running. Run `python app.py` and check no other process uses port 5000.
- **401 Unauthorized**: Your `TELNYX_API_KEY` is invalid. Generate a new one at [portal.telnyx.com/api-keys](https://portal.telnyx.com/api-keys).
- **Webhooks not arriving**: Ensure ngrok URL is set in your [Call Control Application](https://portal.telnyx.com/call-control/applications) with the correct path.
- **SMS not sending**: Check number has messaging enabled and a [Messaging Profile](https://portal.telnyx.com/messaging/profiles) assigned.

## Related Examples

- [build-voice-ai-agent-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/build-voice-ai-agent-python/README.md) - Full voice AI agent
- [record-phone-calls-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/record-phone-calls-python/README.md) - Call recording
- [send-sms-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/send-sms-python/README.md) - Basic SMS

## Agent Discovery

This example is part of the [Telnyx Code Examples](https://github.com/team-telnyx/telnyx-code-examples) catalog.

- **LLM-optimized docs**: [`llms-full.txt`](https://developers.telnyx.com/llms-full.txt)
- **Example index**: [`llms.txt`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/llms.txt)
- **Telnyx CLI**: [developers.telnyx.com/development/cli](https://developers.telnyx.com/development/cli) — `go install github.com/team-telnyx/telnyx-cli/cmd/telnyx@latest`

## Resources

- [Edge Compute Docs](https://developers.telnyx.com/docs/edge-compute)
- [Edge Compute Quickstart](https://developers.telnyx.com/docs/edge-compute/quickstart)
- [Edge CLI Releases](https://github.com/team-telnyx/edge-compute/releases)
