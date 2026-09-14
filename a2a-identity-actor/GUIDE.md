# Guide: Building a Persistent Identity Actor with Telnyx Edge

This guide walks through the `a2a-identity-actor` sample — a TypeScript Telnyx Edge project that demonstrates how to build a **persistent, stateful agent identity** using the Telnyx Agent SDK. The actor IS the agent's identity: it owns OAuth credentials, tracks authorized peers, persists multi-turn conversation state, and self-heals by refreshing tokens before they expire.

By the end of this guide, you'll understand:

- Why a persistent actor is the right abstraction for A2A auth + multi-turn conversations
- How the Telnyx Agent SDK primitives (`schedule`, `every`, `StateStore`, `KV`) compose into a self-managing identity boundary
- How to run the sample in demo mode and switch to live mode

---

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [The Concept: Actor as Identity](#the-concept-actor-as-identity)
3. [Project Structure](#project-structure)
4. [Environment Setup](#environment-setup)
5. [Walking Through the Code](#walking-through-the-code)
   - [Actor State Shape](#actor-state-shape)
   - [Lifecycle: Registration with AMP](#lifecycle-registration-with-amp)
   - [Self-Waking Token Refresh](#self-waking-token-refresh)
   - [Recurring Health Checks](#recurring-health-checks)
   - [Peer Authorization](#peer-authorization)
   - [A2A Message Handling](#a2a-message-handling)
   - [DEGRADED State & Message Queueing](#degraded-state--message-queueing)
   - [Operator Alerts via SMS](#operator-alerts-via-sms)
   - [HTTP API Routes](#http-api-routes)
6. [State Machine](#state-machine)
7. [Demo Mode vs Live Mode](#demo-mode-vs-live-mode)
8. [Running the Sample](#running-the-sample)
9. [Next Steps](#next-steps)

---

## What We're Building

The sample implements `IdentityAgent`, a durable actor that:

- Registers with an **Access Management Platform (AMP)** via OAuth client credentials flow
- Persists OAuth tokens (`access_token`, `refresh_token`, `expires_at`) in durable actor state
- Self-wakes **60 seconds before token expiry** to refresh — no cron job needed
- Runs a **health check every 5 minutes** against AMP to verify identity validity
- Maintains a **peer registry** (who is authorized to talk to it)
- Persists **multi-turn conversation state** per peer across A2A exchanges
- Enters a **DEGRADED state** if token refresh fails, queues messages, and alerts an operator via SMS
- Exposes HTTP routes for identity inspection, peer authorization, retry, and revoke

---

## Prerequisites

- **Node.js** 18+ (for `npx tsx` and the Telnyx Edge CLI)
- A **Telnyx account** with an API key (for live mode; demo mode needs no credentials)
- An **AMP instance** (or mock) exposing:
  - `POST /oauth/token` (client credentials + refresh token grant)
  - `POST /oauth/introspect` (token validation)
  - `POST /a2a/message` (A2A messaging endpoint)
- The **Telnyx Edge CLI** (`telnyx-edge`) for deployment

---

## The Concept: Actor as Identity

In traditional architectures, an agent's identity is a static config file or a database row. The problem: OAuth tokens expire, conversations span hours or days, and authorization decisions need to be durable and immediately revocable.

The **persistent actor** model solves this:

- **Token lifecycle**: The actor owns the refresh cycle. It self-wakes before expiry, refreshes, and persists the new tokens. No external cron job.
- **Conversation continuity**: Multi-turn A2A conversations span hours/days. The actor persists full message history in durable state.
- **Peer registry**: Authorization decisions are durable. Revoking a peer takes effect immediately — the actor checks the registry on every message.
- **Self-healing**: If refresh fails, the actor enters `DEGRADED`, queues messages, and retries autonomously. It doesn't crash.
- **Audit trail**: Every A2A exchange is logged with peer identity, timestamp, and token used.

---

## Project Structure

```
a2a-identity-actor/
├── src/
│   └── index.ts          # Main entry — IdentityAgent class + HTTP handler
├── package.json          # Dependencies + deploy scripts
├── tsconfig.json         # TypeScript config
├── telnyx.toml           # Edge runtime bindings (actors, secrets, KV)
├── .env.example          # Placeholder env vars
├── .gitignore
├── README.md             # Overview + setup
├── API.md                # Endpoint reference
└── GUIDE.md              # This file
```

---

## Environment Setup

Copy `.env.example` to `.env` and fill in placeholders:

```bash
# .env.example
TELNYX_API_KEY=your_telnyx_api_key_here
AMP_CLIENT_ID=your_amp_client_id_here
AMP_CLIENT_SECRET=your_amp_client_secret_here
AMP_TOKEN_URL=https://access-management-platform.ingress.prod.telnyx.io/oauth/token
AMP_A2A_URL=https://access-management-platform.ingress.prod.telnyx.io/a2a/message
AMP_INTROSPECT_URL=https://access-management-platform.ingress.prod.telnyx.io/oauth/introspect
OPERATOR_NUMBER=+1555XXXXXXXX
TELNYX_SENDER=+1555XXXXXXXX
```

**Secrets** (stored in Telnyx Edge secrets, not `.env`):

| Secret | Description |
|---|---|
| `AMP_CLIENT_ID` | AMP OAuth client ID |
| `AMP_CLIENT_SECRET` | AMP OAuth client secret |
| `TELNYX_API_KEY` | Telnyx API key (for live SMS) |

**Env vars** (set in `telnyx.toml` or your runtime):

| Var | Description |
|---|---|
| `AMP_TOKEN_URL` | AMP OAuth token endpoint |
| `AMP_A2A_URL` | AMP A2A message endpoint |
| `AMP_INTROSPECT_URL` | AMP token introspection endpoint |
| `OPERATOR_NUMBER` | Phone number for operator alerts |
| `TELNYX_SENDER` | Telnyx SMS sender number |

---

## Walking Through the Code

All code lives in `src/index.ts`. Let's walk through it feature by feature.

### Actor State Shape

The actor's durable state is defined by the `IdentityState` interface:

```typescript
interface IdentityState {
  agentId: string;
  identityProvider: "AMP" | "KEYCLOAK";
  oauth: {
    accessToken: string;
    refreshToken: string;
    expiresAt: number;
    tokenType: string;
  };
  peers: PeerState[];
  status: "INITIALIZING" | "ACTIVE" | "TOKEN_REFRESHING" | "DEGRADED" | "REVOKED";
  lastHealthCheck: string | null;
  createdAt: string;
}
```

This is the **entire identity entity**. It's persisted in the actor's durable storage (`this.ctx.storage`), so it survives restarts.

The `initialState()` method (in the `Agent` base class) provides the default state:

```typescript
protected initialState(): IdentityState {
  return {
    agentId: "agent-billing-svc",
    identityProvider: "AMP",
    oauth: { accessToken: "", refreshToken: "", expiresAt: 0, tokenType: "Bearer" },
    peers: [],
    status: "INITIALIZING",
    lastHealthCheck: null,
    createdAt: new Date().toISOString(),
  };
}
```

### Lifecycle: Registration with AMP

When the actor first starts, it's in `INITIALIZING` state. The `initialize()` method (called automatically by the Agent SDK) registers with AMP:

```typescript
async initialize(): Promise<void> {
  const state = await this.getState();
  if (state.status !== "INITIALIZING") return;

  try {
    const tokens = await this.registerWithAmp();
    await this.setState({
      oauth: tokens,
      status: "ACTIVE",
      identityProvider: "AMP",
    });
    // Self-wake 60s before expiry to refresh
    await this.schedule(Math.max(1, tokens.expiresAt - Date.now() / 1000 - 60), "refreshToken");
    // Recurring health check every 5 minutes
    await this.every(300, "healthCheck");
  } catch (err) {
    console.error("AMP registration failed", err);
    await this.setState({ status: "DEGRADED" });
    await this.alertOperator("AMP registration failed; actor entering DEGRADED state.");
  }
}
```

**Key Telnyx primitives used:**

- **`this.schedule(delaySeconds, method)`** — schedules a one-time task. Here, it wakes the actor 60 seconds before token expiry to refresh.
- **`this.every(intervalSeconds, method)`** — schedules a recurring task. Here, it runs a health check every 300 seconds (5 minutes).

The `registerWithAmp()` method performs the OAuth client credentials flow:

```typescript
private async registerWithAmp(): Promise<IdentityState["oauth"]> {
  const clientId = await this.env.SECRETS.get("AMP_CLIENT_ID");
  const clientSecret = await this.env.SECRETS.get("AMP_CLIENT_SECRET");
  if (!clientId || !clientSecret) throw new Error("Missing AMP credentials");

  const form = new URLSearchParams();
  form.set("grant_type", "client_credentials");
  form.set("client_id", clientId);
  form.set("client_secret", clientSecret);

  const resp = await fetch(this.env.AMP_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form,
  });
  if (!resp.ok) throw new Error(`AMP token endpoint returned ${resp.status}`);

  const data = (await resp.json()) as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
    token_type: string;
  };
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() / 1000 + data.expires_in,
    tokenType: data.token_type,
  };
}
```

**Secrets** are read via `this.env.SECRETS.get("AMP_CLIENT_ID")` — never hardcoded.

### Self-Waking Token Refresh

The `refreshToken()` method is the scheduled task that fires 60 seconds before expiry:

```typescript
async refreshToken(): Promise<void> {
  const state = await this.getState();
  if (state.status === "REVOKED") return;

  await this.setState({ status: "TOKEN_REFRESHING" });
  try {
    // ... perform refresh_token grant ...
    await this.setState({
      oauth: {
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        expiresAt: Date.now() / 1000 + data.expires_in,
        tokenType: data.token_type,
      },
      status: "ACTIVE",
    });
    // Re-arm the pre-expiry refresh
    await this.schedule(Math.max(1, data.expires_in - 60), "refreshToken");
    // Replay any queued messages
    await this.replayQueuedMessages();
  } catch (err) {
    console.error("Token refresh failed", err);
    await this.setState({ status: "DEGRADED" });
    await this.alertOperator("Token refresh failed. Actor is DEGRADED.");
  }
}
```

**Key points:**

- The actor transitions to `TOKEN_REFRESHING` before attempting refresh.
- On success, it transitions back to `ACTIVE` and **re-arms the schedule** for the next expiry.
- On failure, it transitions to `DEGRADED` and alerts the operator via SMS.
- After a successful refresh, it **replays any queued messages** (more on this later).

### Recurring Health Checks

The `healthCheck()` method runs every 5 minutes:

```typescript
async healthCheck(): Promise<void> {
  const state = await this.getState();
  if (state.status === "REVOKED" || state.status === "INITIALIZING") return;

  try {
    const resp = await fetch(this.env.AMP_INTROSPECT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: state.oauth.accessToken }),
    });
    const data = (await resp.json()) as { active?: boolean };
    if (!resp.ok || !data.active) throw new Error("Token inactive");

    await this.setState({ lastHealthCheck: new Date().toISOString() });
  } catch (err) {
    console.error("Health check failed", err);
    await this.setState({ status: "DEGRADED" });
    await this.alertOperator("Health check failed. Actor is DEGRADED.");
  }
}
```

It introspects the current access token via AMP's `/oauth/introspect` endpoint. If the token is inactive or the endpoint fails, the actor transitions to `DEGRADED`.

### Peer Authorization

Peers are other agents (e.g., `agent-shipping-svc`) that want to communicate with this actor. Authorization is **manual** — the actor grants specific peers the ability to communicate.

```typescript
async authorizePeer(peerId: string): Promise<void> {
  const state = await this.getState();
  const existing = state.peers.find((p) => p.agentId === peerId);
  if (existing) {
    await this.setState({
      peers: state.peers.map((p) =>
        p.agentId === peerId ? { ...p, authorized: true } : p
      ),
    });
  } else {
    await this.setState({
      peers: [
        ...state.peers,
        {
          agentId: peerId,
          authorized: true,
          firstContact: null,
          lastContact: null,
          messageCount: 0,
        },
      ],
    });
  }
  // Persist to KV registry
  await this.env.PEER_REGISTRY.put(
    `peer:${peerId}`,
    JSON.stringify({ authorized: true, firstContact: null, lastContact: null, messageCount: 0 })
  );
}
```

**Key Telnyx primitives:**

- **`this.setState()`** — merge-patch semantics; updates only the `peers` array.
- **`this.env.PEER_REGISTRY`** — a **KV namespace** binding. The peer registry is also persisted to KV for durability and cross-actor visibility.

The `revokePeer()` method flips `authorized` to `false` and updates KV.

### A2A Message Handling

When a peer sends an A2A message via `POST /a2a/message`, the actor:

1. **Validates the peer's token** via AMP introspection
2. **Checks authorization** — is this peer in the authorized registry?
3. **If DEGRADED**, queues the message
4. **Otherwise**, processes it

```typescript
async handleA2AMessage(
  peerToken: string,
  body: { jsonrpc: string; id: string; method: string; params?: { intent?: string; content?: string } }
): Promise<unknown> {
  const state = await this.getState();
  if (state.status === "REVOKED") {
    return { jsonrpc: "2.0", id: body.id, error: { code: -32601, message: "actor revoked" } };
  }

  // Validate peer token via AMP introspect
  const peerId = await this.introspectPeerToken(peerToken);
  if (!peerId) {
    return { jsonrpc: "2.0", id: body.id, error: { code: -32001, message: "invalid peer token" } };
  }

  // Check authorization
  const peer = state.peers.find((p) => p.agentId === peerId);
  if (!peer?.authorized) {
    return { jsonrpc: "2.0", id: body.id, error: { code: -32002, message: "peer not authorized" } };
  }

  // If DEGRADED, queue the message
  if (state.status === "DEGRADED") {
    const conv = await this.getConversation(peerId);
    conv.pendingQueue.push({ id: body.id, method: body.method, params: body.params ?? {} });
    await this.saveConversation(peerId, conv);
    return { jsonrpc: "2.0", id: body.id, result: { queued: true, status: "DEGRADED" } };
  }

  // Process the message
  return this.processMessage(peerId, body);
}
```

**Peer validation** uses AMP's `/oauth/introspect`:

```typescript
private async introspectPeerToken(token: string): Promise<string | null> {
  try {
    const resp = await fetch(this.env.AMP_INTROSPECT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    });
    if (!resp.ok) return null;
    const data = (await resp.json()) as { active?: boolean; sub?: string };
    if (!data.active || !data.sub) return null;
    return data.sub;
  } catch {
    return null;
  }
}
```

**Error semantics:**

- **401** — missing/invalid peer token
- **403** — valid token but peer not authorized

### Multi-Turn Conversation State

The `processMessage()` method handles the actual A2A message and persists conversation state:

```typescript
private async processMessage(
  peerId: string,
  body: { jsonrpc: string; id: string; method: string; params?: { intent?: string; content?: string } }
): Promise<unknown> {
  if (body.method !== "message/send") {
    return { jsonrpc: "2.0", id: body.id, error: { code: -32601, message: "method not found" } };
  }

  const conv = await this.getConversation(peerId);
  const intent = body.params?.intent ?? "default";
  const reply = CANNED_RESPONSES[intent] ?? CANNED_RESPONSES.default;

  conv.messages.push({
    role: "user",
    content: body.params?.content ?? "",
    timestamp: new Date().toISOString(),
  });
  conv.messages.push({
    role: "assistant",
    content: reply,
    timestamp: new Date().toISOString(),
  });
  conv.turnCount += 1;
  conv.lastActiveAt = new Date().toISOString();
  await this.saveConversation(peerId, conv);

  // Update peer registry
  const state = await this.getState();
  await this.setState({
    peers: state.peers.map((p) =>
      p.agentId === peerId
        ? {
            ...p,
            lastContact: new Date().toISOString(),
            firstContact: p.firstContact ?? new Date().toISOString(),
            messageCount: p.messageCount + 1,
          }
        : p
    ),
  });
  await this.env.PEER_REGISTRY.put(
    `peer:${peerId}`,
    JSON.stringify({
      authorized: true,
      firstContact: conv.messages[0]?.timestamp ?? null,
      lastContact: conv.lastActiveAt,
      messageCount: conv.turnCount,
    })
  );

  return {
    jsonrpc: "2.0",
    id: body.id,
    result: {
      agentId: "agent-billing-svc",
      turn: conv.turnCount,
      reply,
    },
  };
}
```

**Key Telnyx primitives:**

- **`CONVERSATION_STORE`** — a KV namespace used as a durable `StateStore`. Each peer gets a `conv:<peerId>` key holding the full `ConversationState` (messages, turn count, last active timestamp, pending queue).

The reply is a **canned billing-service response** keyed by intent (e.g., `"invoice_status"` → `"Invoice INV-1042 is paid."`), NOT LLM-generated. This keeps the sample focused on identity, not inference.

### DEGRADED State & Message Queueing

When the actor is in `DEGRADED` state (token refresh failed, health check failed), incoming A2A messages are **queued** in durable state:

```typescript
if (state.status === "DEGRADED") {
  const conv = await this.getConversation(peerId);
  conv.pendingQueue.push({ id: body.id, method: body.method, params: body.params ?? {} });
  await this.saveConversation(peerId, conv);
  return { jsonrpc: "2.0", id: body.id, result: { queued: true, status: "DEGRADED" } };
}
```

After a successful token refresh, `replayQueuedMessages()` replays them in order:

```typescript
private async replayQueuedMessages(): Promise<void> {
  const state = await this.getState();
  for (const peer of state.peers) {
    const conv = await this.getConversation(peer.agentId);
    if (conv.pendingQueue.length === 0) continue;
    const queued = [...conv.pendingQueue];
    conv.pendingQueue = [];
    await this.saveConversation(peer.agentId, conv);
    for (const msg of queued) {
      await this.processMessage(peer.agentId, {
        jsonrpc: "2.0",
        id: msg.id,
        method: msg.method,
        params: msg.params,
      });
    }
  }
}
```

**Key design decision:** The queue survives restarts because it lives in durable actor state (`CONVERSATION_STORE` KV), not in memory.

### Operator Alerts via SMS

When the actor enters `DEGRADED` state, it alerts an operator via SMS:

```typescript
private async alertOperator(message: string): Promise<void> {
  const demoMode = this.env.DEMO_MODE !== "false";
  if (demoMode) {
    console.log(`[DEMO] SMS to ${this.env.OPERATOR_NUMBER}: ${message}`);
    return;
  }
  try {
    await this.env.TELNYX.messages.send({
      to: this.env.OPERATOR_NUMBER,
      from: this.env.TELNYX_SENDER,
      text: message,
    });
  } catch (err) {
    console.error("Failed to send operator SMS", err);
  }
}
```

**Key Telnyx primitives:**

- **`this.env.TELNYX.messages.send()`** — the zero-credential Telnyx API binding. No API key needed; the platform injects auth.

**Demo mode** is the default (`DEMO_MODE=true`). It logs the SMS to the console instead of sending a real message.

### HTTP API Routes

The actor exposes several HTTP routes via its `fetch()` handler:

| Route | Method | Purpose |
|---|---|---|
| `/api/identity/:agentId` | GET | Returns full identity state (tokens redacted) |
| `/api/identity/:agentId/retry` | POST | Manually trigger token refresh (DEGRADED → TOKEN_REFRESHING) |
| `/api/identity/:agentId/revoke` | POST | Revoke the actor (any → REVOKED) |
| `/api/identity/:agentId/authorize` | POST | Authorize a peer (body: `{ "peerId": "..." }`) |
| `/a2a/message` | POST | A2A message endpoint (requires `Authorization: Bearer <peer-token>`) |

**Token redaction** in `getIdentityState()`:

```typescript
async getIdentityState(): Promise<unknown> {
  const state = await this.getState();
  const expiresIn = Math.max(0, Math.floor(state.oauth.expiresAt - Date.now() / 1000));
  return {
    agentId: state.agentId,
    identityProvider: state.identityProvider,
    oauth: {
      accessToken: "••••",
      expiresIn,
      tokenType: state.oauth.tokenType,
    },
    peers: state.peers,
    status: state.status,
    lastHealthCheck: state.lastHealthCheck,
    createdAt: state.createdAt,
  };
}
```

Raw tokens never leave the actor.

---

## State Machine

```
INITIALIZING → (AMP register) → ACTIVE
ACTIVE → (token near expiry) → TOKEN_REFRESHING
TOKEN_REFRESHING → (success) → ACTIVE
TOKEN_REFRESHING → (failure) → DEGRADED
DEGRADED → (manual retry) → TOKEN_REFRESHING
DEGRADED → (revoke) → REVOKED
ACTIVE → (every 5m) → healthCheck → ACTIVE (or DEGRADED if unhealthy)
```

---

## Demo Mode vs Live Mode

### Demo Mode (default)

- **`DEMO_MODE=true`** (or unset — demo is the default)
- SMS alerts are **logged to console** instead of sent
- No real API calls to Telnyx SMS
- AMP endpoints can be mocked (e.g., a local server or a mock service)

### Live Mode

Set `DEMO_MODE=false` in your environment:

```bash
DEMO_MODE=false
```

In live mode:

- SMS alerts are sent via `this.env.TELNYX.messages.send()` using the `TELNYX` binding
- Requires a valid `TELNYX_API_KEY` secret and configured `OPERATOR_NUMBER` / `TELNYX_SENDER`
- AMP endpoints must be real (or reachable)

---

## Running the Sample

### Prerequisites

1. **Install the Telnyx Edge CLI**:

```bash
npm install -g @telnyx/edge-runtime
```

2. **Authenticate**:

```bash
telnyx-edge auth api-key set <YOUR_TELNYX_API_KEY>
```

3. **Install dependencies**:

```bash
npm install
```

4. **Set secrets**:

```bash
telnyx-edge secrets add AMP_CLIENT_ID "your_client_id"
telnyx-edge secrets add AMP_CLIENT_SECRET "your_client_secret"
telnyx-edge secrets add TELNYX_API_KEY "your_telnyx_api_key"
```

5. **Set env vars** (in `telnyx.toml` or your deployment):

```toml
[env_vars]
AMP_TOKEN_URL = "https://access-management-platform.ingress.prod.telnyx.io/oauth/token"
AMP_A2A_URL = "https://access-management-platform.ingress.prod.telnyx.io/a2a/message"
AMP_INTROSPECT_URL = "https://access-management-platform.ingress.prod.telnyx.io/oauth/introspect"
OPERATOR_NUMBER = "+1555XXXXXXXX"
TELNYX_SENDER = "+1555XXXXXXXX"
DEMO_MODE = "true"
```

### Deploy

```bash
npm run deploy
```

This runs `telnyx-edge ship`.

### Smoke Test

```bash
npx tsx smoke_test.ts
```

This verifies the module loads and the `IdentityAgent` class exists.

### Testing the Flow

1. **Check identity state**:

```bash
curl http://localhost:8787/api/identity/agent-billing-svc
```

2. **Authorize a peer**:

```bash
curl -X POST http://localhost:8787/api/identity/agent-billing-svc/authorize \
  -H "Content-Type: application/json" \
  -d '{"peerId": "agent-shipping-svc"}'
```

3. **Send an A2A message** (as the peer):

```bash
curl -X POST http://localhost:8787/a2a/message \
  -H "Authorization: Bearer <peer-token>" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":"1","method":"message/send","params":{"intent":"invoice_status","content":"What is the status of INV-1042?"}}'
```

4. **Check conversation state**:

```bash
curl http://localhost:8787/api/identity/agent-billing-svc
```

5. **Force a retry** (if DEGRADED):

```bash
curl -X POST http://localhost:8787/api/identity/agent-billing-svc/retry
```

6. **Revoke the actor**:

```bash
curl -X POST http://localhost:8787/api/identity/agent-billing-svc/revoke
```

---

## Next Steps

Now that you understand the persistent identity actor pattern, here's where to go next:

- **Explore the Telnyx Agent SDK**: Read the [Edge Runtime docs](https://developers.telnyx.com/docs/edge) for `Agent`, `StatefulActor`, `schedule()`, `every()`, and `queue()`.
- **Dive into KV storage**: See how `PEER_REGISTRY` and `CONVERSATION_STORE` work in the [KV docs](https://developers.telnyx.com/docs/edge/storage/kv).
- **Learn about the Telnyx API binding**: The `TELNYX` binding gives you zero-credential access to SMS, AI, and more — see the [API binding docs](https://developers.telnyx.com/docs/edge/api-binding).
- **Build on this pattern**: Add LLM-powered replies by swapping the canned responses for `this.env.TELNYX.ai.openai.chat.createCompletion()`.
- **Explore related examples**: Check out other samples in the `telnyx-code-examples` repo for more A2A, Call Control, and SMS patterns.

---

## Resources

- [Telnyx Edge Runtime Docs](https://developers.telnyx.com/docs/edge)
- [Telnyx Agent SDK Reference](https://developers.telnyx.com/docs/edge/agent-sdk)
- [Telnyx SMS API](https://developers.telnyx.com/docs/api/v2/messages)
- [Telnyx Developer Portal](https://developers.telnyx.com)
