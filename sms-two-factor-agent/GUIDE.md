# Guide: SMS Two-Factor Agent

This guide walks through the `sms-two-factor-agent` example, a TypeScript Telnyx Edge Compute application (StatefulActors) that implements a complete two-factor authentication (2FA) flow via SMS.

The agent manages the entire lifecycle of a 2FA code: generating the code, storing it with a strict time-to-live, sending it via Telnyx SMS, verifying the user's reply, and cleaning up expired or rate-limited attempts.

## Prerequisites

- Node.js (v18 or newer) and npm
- A Telnyx account with an SMS-capable number (for US A2P traffic, a registered 10DLC campaign — e.g. Low Volume Mixed)
- Telnyx API key ([Telnyx Portal → API Keys](https://portal.telnyx.com))
- Telnyx Edge CLI — install from [github.com/team-telnyx/edge-compute/releases](https://github.com/team-telnyx/edge-compute/releases)

## Environment Setup

1. Authenticate the Edge CLI (it reads `TELNYX_API_KEY` from your environment or its own config):

   ```bash
   export TELNYX_API_KEY=your_telnyx_api_key_here
   ```

2. Install dependencies:

   ```bash
   npm install
   ```

3. There is no `.env` to maintain at runtime — this project is a Telnyx Edge `telnyx.toml` (umbrella) project. Configuration lives in `telnyx.toml`:

   ```toml
   [edge_compute]
   func_id = "..."                  # from telnyx-edge new-func
   func_name = "sms-two-factor-agent"

   [[actors]]
   binding = "AGENT"
   type = "TwoFactorAgent"

   [telnyx]
   binding = "TELNYX"               # injects TELNYX_API_KEY automatically

   [storage.kv.KV]
   id = "..."                       # from telnyx-edge storage kv create

   [env_vars]
   DEMO_MODE = "true"               # "false" sends real SMS
   TELNYX_FROM_NUMBER = "+16282564655"
   ```

## Running the Sample

### 1. Smoke test locally (no Edge runtime needed)

```bash
npm run typecheck   # TypeScript contract check
npm test            # loads the module, verifies the Agent class surface
```

### 2. Provision and deploy

```bash
# Register the function with the platform (prints func_id)
telnyx-edge new-func --actor -l ts -n sms-two-factor-agent

# Provision the KV namespace (prints the KV ID)
telnyx-edge storage kv create --name sms-two-factor-agent-2fa

# Put both ids into telnyx.toml, then ship (~5-10 min)
telnyx-edge ship

# Watch for deploy_ok
telnyx-edge list
```

The function URL looks like `https://sms-two-factor-agent-<id>.telnyxcompute.com`.

### 3. Demo mode (default)

With `DEMO_MODE = "true"`, no real SMS is sent. The generated code is logged to the actor's console — use this during development and demos where you don't want live text messages.

### 4. Switching to live mode

Set `DEMO_MODE = "false"` in `telnyx.toml` `[env_vars]` (and set `TELNYX_FROM_NUMBER` to your SMS-capable number), then `telnyx-edge ship` again. Real SMS will now be sent from your number through your 10DLC campaign.

> **Important — env vars and actors:** `[env_vars]` are injected into the **function runtime's** `process.env` only. The actor runtime (where `TwoFactorAgent` runs) has its own empty `process.env`. The fetch handler therefore passes `DEMO_MODE` and `TELNYX_FROM_NUMBER` into `sendCode()` as arguments. Reading these env vars directly inside the agent class silently reverts it to demo mode — the API will still return `ok: true` while no SMS is sent. This exact pitfall was hit while building this sample.

## How It Works: Step-by-Step

The application uses the Telnyx Edge Agent SDK (`@telnyx/edge-runtime`) to orchestrate the 2FA flow. The `TwoFactorAgent` extends the base `Agent` class, giving it durable state, scheduled tasks, and access to bindings.

### 0. One durable actor per phone number

The fetch front door sanitizes the E.164 number (strips the leading `+`) and resolves one actor instance per phone via `idFromName("17177247292")`. The platform guarantees one live instance per name with serialized calls — so per-phone rate limiting is race-free and counters survive evictions.

### 1. Rate limiting via durable agent state

When a code is requested, the agent reads its durable state (`this.getState()`), checks the send-attempt window (5 attempts per 5-minute window, anchored on `last_send_at`), and increments the counter (`this.setState()`). Exceeding the limit returns a 429 without generating a code.

### 2. Code generation and KV storage

The agent generates a 6-digit numeric code and stores it in the bound KV namespace with a 300-second expiry:

```typescript
await this.env.KV.put(kvKey(phone), code, { expirationTtl: 300 });
```

KV keys allow only `a-z A-Z 0-9 - _ / = .`, so `kvKey()` strips the E.164 `+`: the key for `+17177247292` is `2fa/17177247292`.

If the KV write path is unavailable (e.g. a KV service outage), the agent falls back to its own durable storage (`this.ctx.storage`) with an `expires_at` timestamp — verification reads KV first, then storage, so the flow keeps working either way.

### 3. Sending the SMS via Telnyx binding

In live mode, the agent sends through the `[telnyx]` binding — pre-authenticated, zero-credential:

```typescript
const res = await this.env.TELNYX.messages.send({
  from: fromNumber,
  to: phone,
  text: `Your verification code is ${code}. It expires in 5 minutes.`,
});
```

The response's message id is surfaced in the `POST /verify` response as `message_id` — you can poll `GET /v2/messages/{id}` for delivery status.

### 4. Code verification

When the user submits their code (`POST /check { phone, code }`), the agent retrieves the stored code:

```typescript
const storedCode = await this.getCode(phone);
```

A match clears the code from KV/storage and resets both attempt counters. A mismatch increments the fail counter in the agent's durable state and returns `fails_remaining`.

### 5. Expiry and cleanup via `this.schedule()`

KV's `expirationTtl` is the primary expiry. As a safety net, the agent also schedules a durable task after each send:

```typescript
await this.schedule(300, "expireCode", { phone });
```

`this.schedule(delaySeconds, methodName, payload)` claims the actor's alarm slot and survives evictions. When it fires, the `expireCode` task handler deletes the code (from KV and storage) and resets the rate-limit window — so a stale code never outlives its TTL even if KV expiry is missed.

## Test Script

```bash
BASE=https://sms-two-factor-agent-<id>.telnyxcompute.com
PHONE=+17177247292

# 1. Send a code (real SMS in live mode)
curl -s -X POST $BASE/verify -H "Content-Type: application/json" -d "{\"phone\": \"$PHONE\"}"

# 2. Wrong code → 401 with fails_remaining
curl -s -X POST $BASE/check -H "Content-Type: application/json" \
  -d "{\"phone\": \"$PHONE\", \"code\": \"000000\"}"

# 3. Right code → verified
curl -s -X POST $BASE/check -H "Content-Type: application/json" \
  -d "{\"phone\": \"$PHONE\", \"code\": \"<code-from-sms>\"}"

# 4. Rate limit — 6 sends inside the window → 429 on the sixth
```

## Next Steps

- [Stateful Actors Quick Start](https://developers.telnyx.com/docs/edge-compute/stateful-actors/quick-start)
- [Send SMS Guide](https://developers.telnyx.com/docs/messaging/send-sms)
- [Telnyx Messaging API Reference](https://developers.telnyx.com/api-reference/sms)
- [Edge Compute CLI](https://github.com/team-telnyx/edge-compute/releases)
