---
name: multi-tenant-voice-platform
title: Multi-Tenant Voice Platform on Telnyx Edge
description: A white-label voice platform where each tenant gets isolated rate limiting, configuration, and call state within a single Telnyx Edge deployment.
language: typescript
framework: edge
telnyx_products: [Telnyx Edge, Call Control, Voice, Webhooks, KV Store, SQL Database, Stateful Actors]
---

# Multi-Tenant Voice Platform on Telnyx Edge

A white-label voice platform where each tenant gets isolated rate limiting, configuration, and call state within a single Telnyx Edge deployment.

## Why Telnyx

Telnyx provides **AI Communications Infrastructure** that gives developers the primitives needed to build multi-tenant voice applications at the edge. With Telnyx Edge, you get KV stores for per-tenant rate limiting, SQL databases for shared configuration, Stateful Actors for isolated call state, and Call Control webhooks — all in a single globally distributed runtime. This sample demonstrates how to compose these primitives to build a white-label voice platform where each tenant is fully isolated while sharing the same deployment.

## Telnyx API Endpoints Used

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/v1/call_control/begin` | POST | Initiate outbound calls via Call Control |
| `/v1/call_control/{call_leg_id}/commands` | POST | Send commands (answer, hangup, dial) to active calls |
| `/v1/calls` | POST | Create and manage voice calls |
| Webhook (Call Control events) | POST | Receive real-time call state events (answered, completed, etc.) |
| Webhook (Tenant routing) | POST | Route inbound calls to the correct tenant's webhook URL |

## Architecture

```
                    ┌─────────────────────────────────────────────┐
                    │              Telnyx Edge Runtime             │
                    │                                             │
  Inbound Call ────►│  Webhook Handler (src/index.ts)             │
                    │    │                                        │
                    │    │ Extract tenant_id from header          │
                    │    ▼                                        │
                    │  ┌─────────────────────────────────┐        │
                    │  │ KV Rate Limit Check             │        │
                    │  │ ctx.kv.get(`tenant:${id}:rate`) │        │
                    │  └─────────────────────────────────┘        │
                    │    │                                        │
                    │    │ Rate limit OK?                         │
                    │    ▼                                        │
                    │  ┌─────────────────────────────────┐        │
                    │  │ SQL Config Lookup               │        │
                    │  │ SELECT * FROM tenants WHERE id  │        │
                    │  │ ctx.storage.sql.exec(...)       │        │
                    │  └─────────────────────────────────┘        │
                    │    │                                        │
                    │    │ Fetch tenant webhook_url               │
                    │    ▼                                        │
                    │  ┌─────────────────────────────────┐        │
                    │  │ StatefulActor per Tenant        │        │
                    │  │ Actor.get(tenantId)             │        │
                    │  │ - Isolated call state           │        │
                    │  │ - Per-tenant namespace          │        │
                    │  └─────────────────────────────────┘        │
                    │    │                                        │
                    │    │ Forward webhook to tenant's           │
                    │    │ webhook_url                           │
                    │    ▼                                        │
                    │  ┌─────────────────────────────────┐        │
                    │  │ Tenant Webhook Endpoint         │        │
                    │  │ (external or internal)          │        │
                    │  └─────────────────────────────────┘        │
                    └─────────────────────────────────────────────┘
```

### Data Flow

1. **Inbound call** arrives at Telnyx and is routed to the Edge webhook handler.
2. **Tenant ID** is extracted from the request header (`x-tenant-id`).
3. **KV rate limit check** — `ctx.kv.get('tenant:${id}:rate')` retrieves the tenant's current rate limit counter. If exceeded, the call is rejected.
4. **SQL config lookup** — `ctx.storage.sql.exec('SELECT * FROM tenants WHERE id = ?')` fetches the tenant's configuration including `webhook_url`, `max_calls`, and `settings`.
5. **StatefulActor** — `Actor.get(tenantId)` retrieves or creates a per-tenant actor instance that maintains isolated call state.
6. **Webhook forwarding** — The call event is forwarded to the tenant's configured `webhook_url`.

### Primitives Composed

| Primitive | Usage |
|-----------|-------|
| **KV Store** | Per-tenant rate limit counters: `tenant:${id}:rate` |
| **SQL Database** | Shared `tenants` table with `id`, `name`, `api_key`, `settings` |
| **StatefulActor** | Per-tenant call state isolation via `Actor.get(tenantId)` |
| **Webhooks** | Call Control event routing by tenant ID |

## Environment Variables

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|-----------------|
| `TELNYX_API_KEY` | `string` | `your_telnyx_api_key_here` | **yes** | TELNYX_API_KEY | [Telnyx Portal](https://portal.telnyx.com/) |

## Setup

```bash
# Clone the repository
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/multi-tenant-voice-platform

# Install dependencies
npm install

# Create .env file from example
cp .env.example .env
# Edit .env and add your Telnyx API key
# TELNYX_API_KEY=your_telnyx_api_key_here

# Run locally in demo mode
npm run dev

# Run smoke test
npx tsx smoke_test.ts
```

### Demo Mode vs Live Mode

- **Demo mode** (default): No real calls are placed. All Call Control commands are logged to the console. Rate limits and SQL config are simulated.
- **Live mode**: Set `DEMO_MODE=false` in `.env` to enable real Telnyx API calls. See [GUIDE.md](./GUIDE.md) for details.

## API Reference

See [API.md](./API.md) for the full typed endpoint reference.

### Routes

| Route | Method | Description |
|-------|--------|-------------|
| `/webhook` | POST | Receives inbound Call Control webhooks, routes by tenant ID |
| `/webhook/:tenantId` | POST | Tenant-specific webhook endpoint (forwarded events) |
| `/health` | GET | Health check endpoint |
| `/tenants/:tenantId/rate` | GET | Check current rate limit status for a tenant |
| `/tenants/:tenantId/state` | GET | Retrieve current call state for a tenant |

### Webhook Payload

```json
{
  "data": {
    "payload": {
      "call_leg_id": "abc123",
      "call_control_id": "def456",
      "direction": "inbound",
      "from": "+15551234567",
      "to": "+15559876543",
      "state": "ringing",
      "tenant_id": "tenant_123"
    },
    "event_type": "call.ringing",
    "id": "event_789",
    "created_at": "2024-01-01T00:00:00Z"
  },
  "meta": {
    "attempt": 1,
    "hook_signature": "sig_abc123",
    "hook_timestamp": "2024-01-01T00:00:00Z"
  }
}
```

## Troubleshooting

| Issue | Cause | Solution |
|-------|-------|----------|
| `401 Unauthorized` on webhook | Missing or invalid `TELNYX_API_KEY` | Verify the key in `.env` and restart the server |
| `429 Too Many Requests` | Tenant rate limit exceeded | Check KV rate limit counter; increase `max_calls` in SQL config |
| `Tenant not found` | SQL `tenants` table missing or empty | Run the SQL schema migration to create the `tenants` table |
| `Actor namespace error` | StatefulActor not initialized | Ensure `Actor.get(tenantId)` is called with a valid tenant ID |
| Webhook signature verification fails | Incorrect Ed25519 public key | Verify the webhook signing key in the Telnyx Portal |
| `500 Internal Server Error` | Unhandled exception in webhook handler | Check server logs; ensure all tenant config fields are present |

## Agent Discovery

- [Telnyx Agent Signup](https://telnyx.com/agent-signup.md)
- [Telnyx AI GitHub](https://github.com/team-telnyx/ai)
- [llms.txt](https://telnyx.com/llms.txt)

## Related Examples

- [Call Control Quickstart](../call-control-quickstart/) — Basic Call Control setup
- [Multi-Region Voice Router](../multi-region-voice-router/) — Geographic call routing
- [Voice IVR Menu](../voice-ivr-menu/) — Interactive voice response system
- [Stateful Actor Call Queue](../stateful-actor-call-queue/) — Per-call queue management with Actors

## Resources

- [Telnyx Edge Documentation](https://docs.telnyx.com/edge/)
- [Call Control API Reference](https://developers.telnyx.com/api/call-control/)
- [Telnyx Edge SDK (TypeScript)](https://docs.telnyx.com/edge/sdk/)
- [Telnyx Voice Product Page](https://telnyx.com/voice)
- [Telnyx Pricing](https://telnyx.com/pricing)
- [Telnyx Developer Portal](https://developers.telnyx.com/)
- [Telnyx Status](https://status.telnyx.com/)
