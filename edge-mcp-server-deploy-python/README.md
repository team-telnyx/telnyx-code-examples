---
name: edge-mcp-server-deploy
title: "MCP Server on Edge Compute"
description: "Deploy an MCP server to Telnyx Edge Compute exposing Telnyx APIs as tools for AI agents. Send SMS, search numbers, run inference."
language: python
framework: telnyx-edge (ASGI)
telnyx_products: [Edge Compute, Messaging, Numbers, AI Inference]
integrations: []
channel: [api]
---

# MCP Server on Telnyx Edge Compute

Deploy a [Model Context Protocol (MCP)](https://modelcontextprotocol.io) server to Telnyx Edge Compute. AI agents connect and use Telnyx APIs as tools.

## Tools Exposed

| Tool | Description |
|------|-------------|
| `send_sms` | Send an SMS message via Telnyx |
| `search_numbers` | Search available phone numbers |
| `run_inference` | Run LLM inference via Telnyx AI |
| `list_phone_numbers` | List account phone numbers |

## Telnyx API Endpoints Used

- **Messages**: `POST /v2/messages` - [API reference](https://developers.telnyx.com/api/messaging/send-message)
- **Available Phone Numbers**: `GET /v2/available_phone_numbers` - [API reference](https://developers.telnyx.com/api/numbers/list-available-phone-numbers)
- **AI Inference**: `POST /v2/ai/chat/completions` - [API reference](https://developers.telnyx.com/api/inference/chat-completions)
- **Phone Numbers**: `GET /v2/phone_numbers` - [API reference](https://developers.telnyx.com/api/numbers/list-phone-numbers)

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
           └──► SMS notification
```

## Quick Start

```bash
telnyx-edge auth login
telnyx-edge secrets add TELNYX_API_KEY <your-api-key>
telnyx-edge ship
# → https://mcp-telnyx-tools-<id>.telnyxcompute.com
```

```bash
# Test
curl https://mcp-telnyx-tools-<id>.telnyxcompute.com/mcp/tools/list
```

## Project Structure

```
edge-mcp-server-deploy-python/
├── func.toml
├── pyproject.toml
├── function/
│   ├── __init__.py
│   └── func.py            # MCP server
└── README.md
```

## How It Works

1. Sends conversation to Telnyx AI Inference for processing

## Why Telnyx

Telnyx is an **AI Communications Infrastructure** platform - voice, messaging, SIP, AI, and IoT on one private, global network.

- **Deliverability built in** - number reputation, 10DLC registration, and deliverability monitoring included.
- **Co-located inference** - LLM runs on the same network as voice traffic. Sub-200ms round trips.

## Environment Variables

| Variable | Type | Required | Description | How to set |
|----------|------|----------|-------------|------------|
| `TELNYX_API_KEY` | `string` | **yes** | Telnyx API v2 key | [Portal](https://portal.telnyx.com/api-keys) |

> **Agent / CLI access** — provision resources programmatically with the [Telnyx CLI](https://developers.telnyx.com/development/cli):
>
> ```bash
> telnyx auth login
> ```
>
> Full API discovery: [llms-full.txt](https://developers.telnyx.com/llms-full.txt) · [CLI docs](https://developers.telnyx.com/development/cli)


## API Reference

### `GET /mcp/tools/list` - list tools
### `POST /mcp/tools/call` - execute a tool
### `GET /health` - health check

## Testing

```bash
curl http://localhost:8080/health
```

```json
{"status": "ok", "tools": ["search_numbers", "send_sms", "create_call"]}
```

## Setup

```bash
cd edge-mcp-server-deploy-python
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
- **SMS not sending**: Check number has messaging enabled and a [Messaging Profile](https://portal.telnyx.com/messaging/profiles) assigned.
- **AI response slow/empty**: Verify model name. See available models at [developers.telnyx.com](https://developers.telnyx.com/docs/inference/list-models).

## Related Examples

- [send-sms-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/send-sms-python/README.md) - Basic SMS
- [sms-chatbot-with-conversation-memory-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/sms-chatbot-with-conversation-memory-python/README.md) - AI SMS chatbot
- [run-llm-inference-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/run-llm-inference-python/README.md) - Standalone inference

## Agent Discovery

This example is part of the [Telnyx Code Examples](https://github.com/team-telnyx/telnyx-code-examples) catalog.

- **LLM-optimized docs**: [`llms-full.txt`](https://developers.telnyx.com/llms-full.txt)
- **Example index**: [`llms.txt`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/llms.txt)
- **Telnyx CLI**: [developers.telnyx.com/development/cli](https://developers.telnyx.com/development/cli) — `go install github.com/team-telnyx/telnyx-cli/cmd/telnyx@latest`

## Resources

- [Edge Compute Docs](https://developers.telnyx.com/docs/edge-compute)
- [MCP Specification](https://modelcontextprotocol.io)
- [Telnyx AI Inference](https://developers.telnyx.com/docs/inference)
