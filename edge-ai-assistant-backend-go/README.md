---
name: edge-ai-assistant-backend-go
title: "Edge Compute Backend for AI Assistant"
description: "Use a Telnyx Edge Compute function as the backend for AI Assistant dynamic variables and webhook tool calls — no separate server required."
language: go
framework: edge-compute
telnyx_products: [Edge Compute, AI Assistants, Voice]
channel: [voice]
---

# Edge Compute Backend for AI Assistant

> Also known as: serverless AI assistant backend, edge webhook handler, dynamic variables resolver, tool call endpoint.

Use a single Telnyx Edge Compute function as the backend for an AI Assistant's dynamic variable resolution and webhook tool calls — no separate server, no Docker, no Kubernetes. The function verifies Telnyx Ed25519 signatures, dispatches on request body shape, and serves both callbacks from one URL.

## Why Telnyx

Telnyx is AI Communications Infrastructure: voice, messaging, and AI inference run on one private global network. Edge Compute extends that platform with serverless functions that sit close to the telephony edge, so webhook callbacks from AI Assistants resolve in milliseconds instead of round-tripping to a distant cloud. One API key covers provisioning phone numbers, building AI Assistants, and deploying edge functions — no stitching together separate vendors for compute, telephony, and AI.

## Telnyx API Endpoints Used

- **AI Assistants: Create/Update Assistant** — `POST /v2/ai/assistants` / `PATCH /v2/ai/assistants/{id}` — [API reference](https://developers.telnyx.com/api/ai-assistants/create-assistant)
- **AI Assistants: Start Call** — `POST /v2/texml/ai_calls/{texml_app_id}` — [API reference](https://developers.telnyx.com/api/telemetry)
- **Public Key** — `GET /v2/public_key` — fetches the org's Ed25519 public key for webhook signature verification
- **Edge Compute CLI** — `telnyx-edge new-func`, `telnyx-edge ship`, `telnyx-edge secrets add` — [Edge Compute docs](https://developers.telnyx.com/docs/edge-compute/quickstart)

## Architecture

```
Caller dials in
      │
      ▼
Telnyx AI Assistant (Jordan)
      │
      ├─ Call start → POST dynamic-variables webhook ──┐
      │                                                ▼
      │                              ┌─────────────────────────┐
      │                              │  Edge Compute Function   │
      │                              │  (single Go handler)     │
      │                              │                         │
      │                              │  1. Verify Ed25519 sig   │
      │                              │  2. Dispatch on body     │
      │                              │     - DV: resolve vars  │
      │                              │     - Tool: lookup data  │
      │                              └─────────────────────────┘
      │                                                ▲
      └─ Mid-call → POST webhook tool call ───────────┘
      │
      ▼
Assistant speaks response to caller
```

A single Edge Compute function handles both:
- **Dynamic variables webhook** — resolves `{{company_name}}`, `{{timeframe}}`, etc. from the caller's phone number at call start
- **Webhook tool call** — handles `schedule_estimate` tool calls mid-conversation, returns confirmation data

The handler dispatches on body shape: `data.event_type` present → dynamic variables; flat args object → tool call.

## Environment Variables

Copy `.env.example` to `.env` and fill in:

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|-----------------|
| `TELNYX_API_KEY` | `string` | `KEY0123456789` | **yes** | Telnyx API v2 key | [Portal](https://portal.telnyx.com/api-keys) |
| `TELNYX_PUBLIC_KEY` | `string` | `base64-ed25519-key` | **yes** | Org public key for signature verification | `GET /v2/public_key` |

> `TELNYX_PUBLIC_KEY` is stored as an Edge Compute secret, not in `.env`. See Setup.

## Setup

### Prerequisites

- [Go 1.24+](https://go.dev/dl/)
- [Telnyx Edge Compute CLI](https://developers.telnyx.com/docs/edge-compute/quickstart) installed and authenticated
- A Telnyx account with Edge Compute enabled
- A Telnyx AI Assistant (create one via API or Portal)

### 1. Scaffold the function

```bash
telnyx-edge new-func -l go -n edge-ai-assistant-backend
cd edge-ai-assistant-backend
```

### 2. Copy the handler

Replace the generated `handler.go` with the one from this example:

```bash
cp handler.go edge-ai-assistant-backend/handler.go
```

### 3. Store the public key as a secret

Fetch your org's Ed25519 public key and store it as an encrypted Edge secret:

```bash
PUBLIC_KEY=$(curl -s -H "Authorization: Bearer $TELNYX_API_KEY" \
  https://api.telnyx.com/v2/public_key | jq -r '.data.public')

telnyx-edge secrets add TELNYX_PUBLIC_KEY "$PUBLIC_KEY"
```

### 4. Deploy

```bash
telnyx-edge ship
telnyx-edge list  # wait for status: deploy_ok
```

Save the invoke URL from the output, e.g. `https://edge-ai-assistant-backend-<org>.telnyxcompute.com`.

### 5. Configure the AI Assistant

Point both the dynamic variables webhook and the webhook tool to the Edge function URL:

```bash
curl -X PATCH "https://api.telnyx.com/v2/ai/assistants/$ASSISTANT_ID" \
  -H "Authorization: Bearer $TELNYX_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "dynamic_variables_webhook_url": "https://edge-ai-assistant-backend-<org>.telnyxcompute.com/",
    "dynamic_variables_webhook_timeout_ms": 8000,
    "tools": [
      {
        "type": "webhook",
        "webhook": {
          "name": "schedule_estimate",
          "url": "https://edge-ai-assistant-backend-<org>.telnyxcompute.com/",
          "method": "POST",
          "description": "Schedule a free on-site estimate for the customer.",
          "body_parameters": {
            "type": "object",
            "properties": {
              "customer_name": {"type": "string", "description": "Full name of the customer"},
              "phone_number": {"type": "string", "description": "Customer phone number in E.164 format"},
              "service_type": {"type": "string", "description": "What kind of service the customer needs"},
              "service_address": {"type": "string", "description": "Address where the work will happen"},
              "preferred_date": {"type": "string", "description": "Customer preferred date (optional)"},
              "preferred_time": {"type": "string", "description": "Customer preferred time (optional)"}
            },
            "required": ["customer_name", "phone_number", "service_type", "service_address"]
          }
        }
      }
    ]
  }'
```

### 6. Test

```bash
# Smoke test — expect 403 (signature verification working)
curl -X POST https://edge-ai-assistant-backend-<org>.telnyxcompute.com/ \
  -H "Content-Type: application/json" \
  -d '{"customer_name":"Test","phone_number":"+15551234567","service_type":"roof repair","service_address":"123 Main St","preferred_date":"2025-04-10","preferred_time":"10:00"}'
# → 403 invalid signature

# Make a real call to the assistant's phone number and verify the greeting + tool call work
```

## API Reference

### `POST /` — Dynamic Variables Webhook

Called by Telnyx at call start to resolve `{{variable}}` placeholders in the assistant's instructions and greeting.

**Request (from Telnyx):**
```json
{
  "data": {
    "event_type": "dynamic_variables",
    "payload": {
      "telnyx_conversation_channel": "voice",
      "telnyx_agent_target": "+16282564269",
      "telnyx_end_user_target": "+17177247292",
      "call_control_id": "v3:abc123",
      "assistant_id": "assistant-..."
    }
  }
}
```

**Response:**
```json
{
  "dynamic_variables": {
    "company_name": "Pinecrest Home Services",
    "timeframe": "two business days",
    "placeholder_transfer_destination": "+15551234567"
  }
}
```

### `POST /` — Webhook Tool Call (`schedule_estimate`)

Called by the assistant mid-conversation when the LLM decides to call the `schedule_estimate` tool.

**Request (from Telnyx):**
```json
{
  "customer_name": "John Doe",
  "phone_number": "+17177247292",
  "service_type": "roof repair",
  "service_address": "123 Main St, San Francisco, CA",
  "preferred_date": "2025-04-10",
  "preferred_time": "10:00"
}
```

**Response:**
```json
{
  "scheduled_date": "2025-04-10",
  "scheduled_time": "10:00",
  "confirmation_number": "CONF-1715234567",
  "estimate_id": "EST-1715234567"
}
```

## Troubleshooting

| Issue | Likely cause | Fix |
|-------|--------------|-----|
| `403 invalid signature` on all requests | `TELNYX_PUBLIC_KEY` secret not set or invalid | Re-fetch via `GET /v2/public_key` and re-add: `telnyx-edge secrets add TELNYX_PUBLIC_KEY "<key>"`, then `telnyx-edge ship` |
| Dynamic variables not resolving (greeting shows `{{company_name}}`) | `dynamic_variables_webhook_url` not set on assistant, or function cold-starting past timeout | Set webhook URL on assistant via API; bump `dynamic_variables_webhook_timeout_ms` to 8000 |
| Tool call returns empty or fails | Assistant's webhook tool URL points to wrong endpoint | Verify tool `url` matches the Edge function invoke URL |
| `deploy_ok` but function returns 502 | Build succeeded but runtime panic in handler | Check `handler.go` compiles: `go build ./...`; ensure Go module is named `function` |
| `telnyx-edge ship` times out | Normal — build continues server-side | Run `telnyx-edge list` and wait for `deploy_ok` |

## Related Examples

- [edge-ivr-ab-tester-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/edge-ivr-ab-tester-python/README.md) — A/B test IVR flows at the edge
- [edge-geo-smart-router-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/edge-geo-smart-router-python/README.md) — Route calls by geography at the edge
- [ai-voice-agent-with-function-calling-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/ai-voice-agent-with-function-calling-python/README.md) — Voice agent with function calling (no edge)
- [ai-receptionist-with-booking-tools-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/ai-receptionist-with-booking-tools-python/README.md) — AI receptionist with booking tools

## Resources

- [Edge Compute quickstart](https://developers.telnyx.com/docs/edge-compute/quickstart)
- [Power AI Assistants with Edge Compute (guide)](https://developers.telnyx.com/docs/edge-compute/guides/ai-assistant-backend)
- [AI Assistants — Dynamic Variables](https://developers.telnyx.com/docs/inference/ai-assistants/dynamic-variables)
- [Webhook signing](https://developers.telnyx.com/development/api-fundamentals/webhooks/receiving-webhooks#webhook-signing)
- [Edge Compute secrets](https://developers.telnyx.com/docs/edge-compute/configuration/secrets)
- [Go SDK](https://developers.telnyx.com/development/sdk/go)
- [Telnyx Voice AI](https://telnyx.com/products/voice-ai-agents)
- [Telnyx Pricing](https://telnyx.com/pricing)
