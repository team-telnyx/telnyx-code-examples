# Multi-Tenant Voice Platform — Developer Guide

This guide walks you through the `multi-tenant-voice-platform` sample, a white-label voice platform built on Telnyx Edge. Each tenant gets isolated rate limiting, configuration, and call state — all within a single deployment.

## Prerequisites

- Node.js 18+
- Telnyx account with an API key ([sign up](https://portal.telnyx.com/sign-up))
- A Telnyx phone number with Call Control enabled
- Basic familiarity with TypeScript and Telnyx Call Control

## Environment Setup

1. Clone the repo and navigate to the sample:

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/multi-tenant-voice-platform
```

2. Install dependencies:

```bash
npm install
```

3. Create a `.env` file from the example:

```bash
cp .env.example .env
```

4. Edit `.env` and add your Telnyx API key:

```env
TELNYX_API_KEY=your_telnyx_api_key_here
```

> **Demo mode (default):** No real calls are placed. The app logs what would happen.
> **Live mode:** Set `DEMO_MODE=false` in `.env` to use real Telnyx API parameters.

## Running the Sample

Start the Edge server:

```bash
npm run dev
```

The server listens on `http://localhost:8787`.

## How It Works

The platform routes inbound calls through a multi-tenant pipeline. Each step isolates tenant data using different Telnyx Edge primitives.

### 1. Inbound Call Webhook

When a call arrives, Telnyx sends a webhook to your endpoint. The handler extracts the tenant ID from the `X-Tenant-ID` header:

```typescript
// src/index.ts — Inbound Call Control webhook handler
const tenantId = request.headers.get('x-tenant-id') || 'default';
```

The webhook signature is verified using `telnyx.webhooks.unwrap` to ensure it came from Telnyx.

### 2. Per-Tenant Rate Limit (KV Store)

Before processing the call, the platform checks the tenant's rate limit using the KV store:

```typescript
// src/index.ts — KV rate limit check
const rateKey = `tenant:${tenantId}:rate`;
const rateData = await ctx.kv.get(rateKey);
```

If the tenant has exceeded their call limit, the call is rejected. Otherwise, the counter is incremented and stored back in KV.

### 3. Per-Tenant Configuration (SQL Database)

The tenant's configuration — including their webhook URL and max call settings — is fetched from the shared SQL database:

```typescript
// src/index.ts — SQL config lookup
const result = await ctx.storage.sql.exec(
  'SELECT * FROM tenants WHERE id = ?',
  tenantId
);
```

This uses the Edge SQL primitive to query a shared `tenants` table.

### 4. Per-Tenant Call State (StatefulActor)

Each tenant gets its own `StatefulActor` instance for isolated call state management:

```typescript
// src/index.ts — StatefulActor per tenant
const actor = Actor.get(tenantId);
await actor.setState({ currentCallId: callId, status: 'ringing' });
```

The `StatefulActor` provides durable, isolated state per tenant namespace.

### 5. Webhook Forwarding

After processing, the call event is forwarded to the tenant's configured webhook URL:

```typescript
// src/index.ts — Forward to tenant webhook
await fetch(tenantConfig.webhook_url, {
  method: 'POST',
  body: JSON.stringify(callEvent),
});
```

## Telnyx Primitives Used

| Primitive | Purpose |
|---|---|
| **KV Store** | Per-tenant rate limit counters and config cache |
| **SQL Database** | Shared `tenants` table with api_key, settings, webhook_url |
| **StatefulActor** | Isolated call state per tenant (ringing, in-progress, ended) |
| **Call Control** | Webhook routing and call lifecycle management |
| **Webhooks** | Inbound call events with tenant ID header routing |

## Demo Mode vs Live Mode

- **Demo mode (default):** Set `DEMO_MODE=true` (or leave unset). The app logs all actions — rate limit checks, SQL queries, actor state changes, and webhook forwards — without placing real calls or charging your account.
- **Live mode:** Set `DEMO_MODE=false`. The app uses real Telnyx Call Control API parameters and forwards webhooks to real tenant endpoints.

Switch modes by editing the `DEMO_MODE` variable in your `.env` file.

## Testing the Sample

Run the smoke test to verify the module loads correctly:

```bash
npm run test
```

This imports the main handler and verifies it responds to a simulated inbound webhook without errors.

## Next Steps

- [Telnyx Edge SDK Reference](https://developers.telnyx.com/docs/edge-sdk)
- [Call Control API Docs](https://developers.telnyx.com/docs/call-control)
- [KV Store Guide](https://developers.telnyx.com/docs/kv-store)
- [SQL Database Guide](https://developers.telnyx.com/docs/sql-database)
- [StatefulActor Guide](https://developers.telnyx.com/docs/stateful-actor)
- [Webhooks Verification Guide](https://developers.telnyx.com/docs/webhooks)
