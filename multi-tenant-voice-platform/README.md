---
name: multi-tenant-voice-platform
title: "Multi-Tenant Voice Platform"
description: "A Flask-based multi-tenant voice platform with per-tenant rate limiting, configuration, and call state management using Telnyx."
language: python
framework: flask
telnyx_products: [Voice API, Webhooks]
---

# Multi-Tenant Voice Platform

A production-ready Flask application demonstrating how to build a multi-tenant voice platform with per-tenant rate limiting, isolated configuration, and call state management using Telnyx's Voice API.

## Why Telnyx

Telnyx provides the **AI Communications Infrastructure** needed to build scalable, multi-tenant voice applications. With Telnyx's Voice API, you get global connectivity, programmable call control, and reliable webhooks — all backed by a private IP network that ensures low-latency, high-quality voice calls. This sample demonstrates how to leverage Telnyx to build a multi-tenant platform where each tenant gets isolated configuration, rate limiting, and call state management.

## Telnyx API Endpoints Used

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/v2/calls` | POST | Initiate an outbound voice call |
| `/v2/calls/{call_control_id}/actions/hangup` | POST | Hang up an active call |
| Webhook | POST | Receive call events (answered, ringing, completed, etc.) |

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Flask Application                           │
│                                                                     │
│  ┌─────────────┐  ┌──────────────┐  ┌───────────────────────────┐  │
│  │  Tenant A   │  │  Tenant B    │  │      Tenant Config        │  │
│  │  (Config)   │  │  (Config)    │  │  (SQL DB simulation)      │  │
│  └─────────────┘  └──────────────┘  └───────────────────────────┘  │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │              Rate Limit Store (KV simulation)               │   │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐          │   │
│  │  │ Tenant A    │  │ Tenant B    │  │ ...         │          │   │
│  │  │ 10 req/min  │  │ 5 req/min   │  │             │          │   │
│  │  └─────────────┘  └─────────────┘  └─────────────┘          │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │              Call State Store (StatefulActor)               │   │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐          │   │
│  │  │ Tenant A    │  │ Tenant B    │  │ ...         │          │   │
│  │  │ Call States │  │ Call States │  │             │          │   │
│  │  └─────────────┘  └─────────────┘  └─────────────┘          │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │                    Telnyx SDK Integration                    │   │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐          │   │
│  │  │ Call.Create │  │ Call.Hangup │  │ Webhooks    │          │   │
│  │  └─────────────┘  └─────────────┘  └─────────────┘          │   │
│  └─────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
                    ┌─────────────────┐
                    │   Telnyx API    │
                    └─────────────────┘
```

## Environment Variables

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|-----------------|
| `TELNYX_API_KEY` | `string` | `your_telnyx_api_key_here` | **yes** | TELNYX_API_KEY | — |
| `TENANT_A_VOICE_PROFILE_ID` | `string` | `your_tenant_a_voice_profile_id_here` | **yes** | TENANT_A_VOICE_PROFILE_ID | — |
| `TENANT_A_WEBHOOK_URL` | `string` | `your_tenant_a_webhook_url_here` | **yes** | TENANT_A_WEBHOOK_URL | — |
| `TENANT_B_VOICE_PROFILE_ID` | `string` | `your_tenant_b_voice_profile_id_here` | **yes** | TENANT_B_VOICE_PROFILE_ID | — |
| `TENANT_B_WEBHOOK_URL` | `string` | `your_tenant_b_webhook_url_here` | **yes** | TENANT_B_WEBHOOK_URL | — |

## Setup

1. **Clone the repository**

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/multi-tenant-voice-platform
```

2. **Create your `.env` file**

```bash
cp .env.example .env
```

3. **Edit `.env` and add your credentials**

```bash
# Open .env in your editor and fill in:
TELNYX_API_KEY=your_telnyx_api_key_here
TENANT_A_VOICE_PROFILE_ID=your_tenant_a_voice_profile_id_here
TENANT_A_WEBHOOK_URL=https://your-domain.com/webhooks/inbound
TENANT_B_VOICE_PROFILE_ID=your_tenant_b_voice_profile_id_here
TENANT_B_WEBHOOK_URL=https://your-domain.com/webhooks/inbound
```

4. **Install dependencies**

```bash
pip install -r requirements.txt
```

5. **Run the application**

```bash
python app.py
```

The server will start on `http://0.0.0.0:5000`.

## API Reference

### Health Check

**GET** `/health`

Returns the service status and current timestamp.

**Response:**
```json
{
  "status": "ok",
  "timestamp": "2024-01-15T12:00:00Z"
}
```

### List Tenants

**GET** `/api/tenants`

Returns all configured tenants (admin endpoint).

**Response:**
```json
{
  "tenants": [
    {
      "id": "tenant_a",
      "name": "Tenant A",
      "rate_limit_per_minute": 10
    },
    {
      "id": "tenant_b",
      "name": "Tenant B",
      "rate_limit_per_minute": 5
    }
  ]
}
```

### Get Tenant Configuration

**GET** `/api/tenants/<tenant_id>/config`

Returns configuration for a specific tenant.

**Response:**
```json
{
  "tenant_id": "tenant_a",
  "name": "Tenant A",
  "rate_limit_per_minute": 10,
  "default_voice_number_id": ""
}
```

### Initiate Call

**POST** `/api/tenants/<tenant_id>/calls`

Initiates an outbound call for a tenant. Requires `X-Tenant-ID` header.

**Request Headers:**
- `X-Tenant-ID`: The tenant identifier (e.g., `tenant_a`)

**Request Body:**
```json
{
  "to": "+15551234567",
  "from": "+15559876543"
}
```

**Response (201):**
```json
{
  "call_id": "call_1234567890",
  "status": "initiated",
  "tenant_id": "tenant_a"
}
```

### List Calls for Tenant

**GET** `/api/tenants/<tenant_id>/calls`

Returns all call state for a tenant.

**Response:**
```json
{
  "tenant_id": "tenant_a",
  "calls": [
    {
      "status": "initiated",
      "to": "+15551234567",
      "from": "+15559876543",
      "created_at": "2024-01-15T12:00:00Z"
    }
  ]
}
```

### Get Call State

**GET** `/api/tenants/<tenant_id>/calls/<call_id>`

Returns state for a specific call.

**Response:**
```json
{
  "tenant_id": "tenant_a",
  "call_id": "call_1234567890",
  "state": {
    "status": "in-progress",
    "to": "+15551234567",
    "from": "+15559876543",
    "created_at": "2024-01-15T12:00:00Z",
    "last_event": "call_leg_123",
    "last_event_type": "call.answered",
    "updated_at": "2024-01-15T12:01:00Z"
  }
}
```

### Hang Up Call

**POST** `/api/tenants/<tenant_id>/calls/<call_id>/hangup`

Hangs up an active call. Requires `X-Tenant-ID` header.

**Response (200):**
```json
{
  "status": "hangup_requested",
  "call_id": "call_1234567890"
}
```

### Inbound Webhook

**POST** `/webhooks/inbound`

Receives Telnyx webhook events. Verifies Ed25519 signature and updates call state.

## Troubleshooting

| Issue | Possible Cause | Solution |
|-------|---------------|----------|
| `401 Invalid signature` | Webhook signature verification failed | Ensure the webhook URL is correctly configured and the request includes the `Telnyx-Signature-Ed25519` and `Telnyx-Timestamp` headers |
| `429 Rate limit exceeded` | Tenant exceeded their rate limit | Wait for the `Retry-After` period or increase the tenant's rate limit in `TENANT_CONFIG` |
| `502 Failed to initiate call` | Telnyx API error | Check your `TELNYX_API_KEY` and ensure the voice profile ID is valid |
| `404 Tenant not found` | Invalid tenant ID in request | Verify the tenant ID matches one in `TENANT_CONFIG` |
| Calls not updating state | Webhook not reaching the app | Ensure your webhook URL is publicly accessible and configured correctly in the `.env` file |

## Agent Discovery

- **Agent Signup**: [telnyx.com/agent-signup.md](https://telnyx.com/agent-signup.md)
- **AI Repository**: [github.com/team-telnyx/ai](https://github.com/team-telnyx/ai)
- **LLMs.txt**: [telnyx.com/llms.txt](https://telnyx.com/llms.txt)

## Related Examples

- [Voice AI Assistant](https://github.com/team-telnyx/telnyx-code-examples/tree/main/voice-ai-assistant)
- [Call Forwarding](https://github.com/team-telnyx/telnyx-code-examples/tree/main/call-forwarding)
- [IVR System](https://github.com/team-telnyx/telnyx-code-examples/tree/main/ivr-system)

## Resources

- [Telnyx Developer Documentation](https://developers.telnyx.com)
- [Telnyx API Reference](https://developers.telnyx.com/api)
- [Telnyx Python SDK](https://github.com/team-telnyx/telnyx-python)
- [Telnyx Voice API Product Page](https://telnyx.com/voice-api)
- [Telnyx Pricing](https://telnyx.com/pricing)
