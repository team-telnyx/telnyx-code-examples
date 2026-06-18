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

- **Messages**: `POST /v2/messages` — [API reference](https://developers.telnyx.com/api/messaging/send-message)
- **Available Phone Numbers**: `GET /v2/available_phone_numbers` — [API reference](https://developers.telnyx.com/api/numbers/list-available-phone-numbers)
- **AI Inference**: `POST /v2/ai/chat/completions` — [API reference](https://developers.telnyx.com/api/inference/chat-completions)
- **Phone Numbers**: `GET /v2/phone_numbers` — [API reference](https://developers.telnyx.com/api/numbers/list-phone-numbers)

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

## Environment Variables

| Variable | Type | Required | Description | How to set |
|----------|------|----------|-------------|------------|
| `TELNYX_API_KEY` | `string` | **yes** | Telnyx API v2 key | [Portal](https://portal.telnyx.com/api-keys) |

## API Reference

### `GET /mcp/tools/list` — list tools
### `POST /mcp/tools/call` — execute a tool
### `GET /health` — health check

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

## Resources

- [Edge Compute Docs](https://developers.telnyx.com/docs/edge-compute)
- [MCP Specification](https://modelcontextprotocol.io)
- [Telnyx AI Inference](https://developers.telnyx.com/docs/inference)
