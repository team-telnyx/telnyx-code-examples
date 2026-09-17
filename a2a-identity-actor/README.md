---
name: a2a-identity-actor
title: "A2A Identity Actor — Persistent Agent Identity & OAuth Token Lifecycle"
description: "A stateful Telnyx Edge actor that owns its OAuth identity, auto-refreshes tokens, authorizes peers, and persists multi-turn A2A conversations."
language: typescript
framework: edge
telnyx_products: [Agent SDK, A2A Messaging, SMS, OAuth]
---

# A2A Identity Actor — Persistent Agent Identity & OAuth Token Lifecycle

A stateful Telnyx Edge agent that acts as a durable identity boundary: it registers with AMP via OAuth client credentials, self-refreshes tokens before expiry, authorizes peers, and persists multi-turn A2A conversations.

## The Story

The actor IS the agent's identity. It comes into being when a new agent is first created, carrying its own credentials and a promise of continuity from the very first moment. Through its life, it grows from a tentative, initializing presence into a trusted, active participant in conversations, periodically renewing its own access to the world before that access can lapse. It survives restarts that would reset a stateless process, idle stretches where it waits patiently for the next word, and partial failures where it must hold messages in a fragile queue until it can re-assert itself. Even when trust is revoked, it does not vanish—it records its own end, preserving the memory of every exchange it ever held, so that its story remains complete. The rest of this README is the API surface of that story.

## Why Telnyx

Telnyx provides the **AI Communications Infrastructure** needed to build agents that are not just stateless inference endpoints, but durable, authenticated participants in a multi-agent ecosystem. With the Telnyx Edge Agent SDK, you get a stateful actor runtime with built-in scheduling, durable storage, and zero-credential access to Telnyx APIs — so your agent can own its OAuth lifecycle, persist conversation state across hours or days, and alert operators via SMS when its identity degrades. No cron jobs, no external state servers, no glue code.

## Telnyx API Endpoints Used

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `POST /oauth/token` (AMP) | `POST` | OAuth client credentials flow — obtain `access_token`, `refresh_token`, `expires_at` |
| `POST /oauth/introspect` (AMP) | `POST` | Validate peer tokens and run health checks on the actor's own token |
| `POST /a2a/message` (AMP) | `POST` | Receive A2A JSON-RPC messages from peers |
| `POST /v2/messages` (Telnyx) | `POST` | Send operator SMS alerts when the actor enters `DEGRADED` state |

## Architecture

The `IdentityAgent` is a stateful actor (`Agent<Env, IdentityState>`) that owns its identity. It registers with AMP on initialization, stores OAuth tokens in durable actor state, and schedules two recurring tasks: a token refresh 60 seconds before expiry, and a health check every 5 minutes. Peers present their own AMP-issued bearer tokens; the actor introspects them and checks the durable peer registry before processing messages. Multi-turn conversations are persisted per-peer in KV, and a degraded actor queues incoming messages and replays them after a successful token refresh.

```
┌─────────────────────────────────────────────────────────────────────┐
│                        IdentityAgent (actor)                        │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │  IdentityState (durable actor state)                         │  │
│  │  ┌─────────────┐  ┌─────────────┐  ┌──────────────────────┐  │  │
│  │  │ OAuth       │  │ Peer        │  │ Status               │  │  │
│  │  │ accessToken │  │ Registry    │  │ INITIALIZING         │  │  │
│  │  │ refreshToken│  │ authorized  │  │ ACTIVE               │  │  │
│  │  │ expiresAt   │  │ firstContact│  │ TOKEN_REFRESHING     │  │  │
│  │  │ tokenType   │  │ lastContact │  │ DEGRADED             │  │  │
│  │  └─────────────┘  │ messageCount│  │ REVOKED              │  │  │
│  │                   └─────────────┘  └──────────────────────┘  │  │
│  └───────────────────────────────────────────────────────────────┘  │
│                                                                     │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │  Schedules                                                    │  │
│  │  ┌──────────────────────┐  ┌──────────────────────────────┐  │  │
│  │  │ schedule(exp-60,     │  │ every(300, "healthCheck")    │  │  │
│  │  │   "refreshToken")    │  │  → POST /oauth/introspect    │  │  │
│  │  │  → POST /oauth/token │  │  → ACTIVE or DEGRADED        │  │  │
│  │  └──────────────────────┘  └──────────────────────────────┘  │  │
│  └───────────────────────────────────────────────────────────────┘  │
│                                                                     │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │  HTTP Routes                                                  │  │
│  │  GET  /api/identity/:agentId        → redacted identity state │  │
│  │  POST /api/identity/:agentId/retry  → DEGRADED → refresh      │  │
│  │  POST /api/identity/:agentId/revoke → any → REVOKED           │  │
│  │  POST /api/identity/:agentId/authorize → grant peer access    │  │
│  │  POST /a2a/message                  → JSON-RPC message/send   │  │
│  └───────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
        │                        │                        │
        │ introspect             │ introspect             │ A2A messages
        ▼                        ▼                        ▼
┌───────────────┐      ┌──────────────────┐      ┌──────────────────┐
│  AMP OAuth    │      │  Peer Agent      │      │  Conversation    │
│  /oauth/token │      │  (shipping-svc)  │      │  Store (KV)      │
│  /oauth/      │      │  Bearer token    │      │  conv:<peerId>   │
│  introspect   │      └──────────────────┘      └──────────────────┘
└───────────────┘
```

## Environment Variables

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|-----------------|
| `AMP_CLIENT_ID` | `string` | `your_amp_client_id_here` | **yes** | AMP_CLIENT_ID | AMP access management platform |
| `AMP_CLIENT_SECRET` | `string` | `your_amp_client_secret_here` | **yes** | AMP_CLIENT_SECRET | AMP access management platform |
| `TELNYX_API_KEY` | `string` | `your_telnyx_api_key_here` | **yes** | TELNYX_API_KEY | [Telnyx Portal](https://portal.telnyx.com) |

## Setup

1. **Clone the repository**

   ```bash
   git clone https://github.com/team-telnyx/telnyx-code-examples.git
   cd telnyx-code-examples/a2a-identity-actor
   ```

2. **Install dependencies**

   ```bash
   npm install
   ```

3. **Configure environment variables**

   Copy `.env.example` to `.env` and fill in your credentials:

   ```bash
   cp .env.example .env
   ```

   Edit `.env` with your actual values:

   ```
   AMP_CLIENT_ID=your_amp_client_id_here
   AMP_CLIENT_SECRET=your_amp_client_secret_here
   TELNYX_API_KEY=your_telnyx_api_key_here
   ```

4. **Set secrets in the Telnyx Edge runtime**

   ```bash
   telnyx-edge auth api-key set "$TELNYX_API_KEY"
   telnyx-edge secrets add AMP_CLIENT_ID "your_amp_client_id_here"
   telnyx-edge secrets add AMP_CLIENT_SECRET "your_amp_client_secret_here"
   ```

5. **Generate types and run the smoke test**

   ```bash
   npm run types
   npx tsx smoke_test.ts
   ```

6. **Deploy**

   ```bash
   npm run deploy
   ```

## API Reference

### `GET /api/identity/:agentId`

Returns the actor's full identity state with tokens redacted.

**Response 200:**

```json
{
  "agentId": "agent-billing-svc",
  "identityProvider": "AMP",
  "oauth": {
    "accessToken": "••••",
    "expiresIn": 3599,
    "tokenType": "Bearer"
  },
  "peers": [
    {
      "agentId": "agent-shipping-svc",
      "authorized": true,
      "firstContact": "2026-07-28T12:00:00Z",
      "lastContact": "2026-07-28T12:05:00Z",
      "messageCount": 3
    }
  ],
  "status": "ACTIVE",
  "lastHealthCheck": "2026-07-28T12:05:00Z",
  "createdAt": "2026-07-28T11:00:00Z"
}
```

### `POST /api/identity/:agentId/authorize`

Authorizes a peer to send A2A messages.

**Request body:**

```json
{
  "peerId": "agent-shipping-svc"
}
```

**Response 200:**

```json
{
  "ok": true
}
```

### `POST /api/identity/:agentId/retry`

Manually triggers a token refresh when the actor is in `DEGRADED` state.

**Response 200:**

```json
{
  "ok": true
}
```

### `POST /api/identity/:agentId/revoke`

Revokes the actor's identity, rejecting all future messages.

**Response 200:**

```json
{
  "ok": true
}
```

### `POST /a2a/message`

Receives A2A messages from peers. Requires `Authorization: Bearer <peer-token>` header.

**Request body:**

```json
{
  "jsonrpc": "2.0",
  "id": "req-123",
  "method": "message/send",
  "params": {
    "intent": "invoice_status",
    "content": "What is the status of invoice INV-1042?"
  }
}
```

**Response 200 (authorized peer):**

```json
{
  "jsonrpc": "2.0",
  "id": "req-123",
  "result": {
    "agentId": "agent-billing-svc",
    "turn": 4,
    "reply": "Invoice INV-1042 is paid."
  }
}
```

**Response 401 (missing/invalid token):**

```json
{
  "jsonrpc": "2.0",
  "id": "req-123",
  "error": {
    "code": -32001,
    "message": "invalid peer token"
  }
}
```

**Response 403 (valid token, unauthorized peer):**

```json
{
  "jsonrpc": "2.0",
  "id": "req-123",
  "error": {
    "code": -32002,
    "message": "peer not authorized"
  }
}
```

**Response 200 (degraded mode — message queued):**

```json
{
  "jsonrpc": "2.0",
  "id": "req-123",
  "result": {
    "queued": true,
    "status": "DEGRADED"
  }
}
```

## Troubleshooting

| Issue | Likely Cause | Solution |
|-------|-------------|----------|
| `AMP registration failed` | Invalid `AMP_CLIENT_ID` or `AMP_CLIENT_SECRET` | Verify credentials in the AMP portal; check secrets are set via `telnyx-edge secrets list` |
| `Token refresh failed` | Refresh token expired or revoked | Check AMP token endpoint logs; re-register the actor by deleting and recreating it |
| `peer not authorized` (403) | Peer token is valid but peer not in authorized registry | Call `POST /api/identity/agent-billing-svc/authorize` with the peer's `agentId` |
| `invalid peer token` (401) | Peer's AMP token is missing, expired, or invalid | Verify the peer's token with `POST /oauth/introspect` |
| `Health check failed` | Access token revoked or AMP endpoint unreachable | Check AMP service status; verify the token is still active |
| Actor stuck in `DEGRADED` | Repeated token refresh failures | Call `POST /api/identity/agent-billing-svc/retry` to manually trigger a refresh |
| SMS not sent | `DEMO_MODE` is `true` (default) | Set `DEMO_MODE=false` in the environment to send real SMS alerts |

## Agent Discovery

- [Agent Signup](https://telnyx.com/agent-signup.md)
- [Telnyx AI GitHub](https://github.com/team-telnyx/ai)
- [Telnyx LLMs.txt](https://telnyx.com/llms.txt)

## Related Examples

- **`a2a-messaging-basic`** — Simple A2A messaging without persistent identity
- **`agent-scheduler`** — Using `schedule()` and `every()` for recurring agent tasks
- **`sms-operator-alerts`** — Sending SMS notifications from agents
- **`kv-peer-registry`** — Using KV for durable peer authorization

## Resources

- [Telnyx Developer Docs](https://developers.telnyx.com)
- [Telnyx API Reference](https://developers.telnyx.com/api)
- [Telnyx Edge SDK](https://github.com/team-telnyx/edge-runtime)
- [Telnyx Product Page](https://telnyx.com)
- [Telnyx Pricing](https://telnyx.com/pricing)
