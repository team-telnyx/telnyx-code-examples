---
name: sms-two-factor-agent
title: "SMS Two-Factor Authentication Agent"
description: "Agent-managed SMS two-factor authentication with code generation, KV storage, and scheduled expiry."
language: typescript
framework: edge
telnyx_products: [SMS, Verify, Agent SDK]
---

# SMS Two-Factor Authentication Agent

An Edge-based agent that manages the full lifecycle of SMS two-factor authentication codes — generation, delivery via Telnyx SMS, verification, and automatic expiry using scheduled tasks.

## Why Telnyx

Telnyx provides the AI Communications Infrastructure that powers programmable SMS, voice, and verification workflows with low-latency global delivery. By combining the Telnyx Edge Agent SDK with the native `[telnyx]` binding, this sample demonstrates zero-credential API access to Telnyx messaging services directly from the edge runtime, enabling secure, scalable authentication flows without managing API keys in application code.

## Telnyx API Endpoints Used

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/v2/messages` | POST | Send SMS verification codes via `this.env.TELNYX.messages.send()` |
| Telnyx Edge `[telnyx]` binding | — | Zero-credential access to Telnyx messaging from Edge runtime |
| Telnyx KV (`[storage.kv.KV]`) | — | Code store with `expirationTtl` — keys auto-expire |

## Architecture

```
┌──────────────┐     POST /verify      ┌──────────────────────────┐
│   Client     │ ────────────────────► │   TwoFactorAgent         │
│  (Web/App)   │                       │   (extends Agent)        │
└──────────────┘                       │   one actor per phone    │
                                       └────────────┬─────────────┘
                                                    │
                                     ┌──────────────┼──────────────┐
                                     ▼              ▼              ▼
                               ┌─────────┐  ┌─────────────┐  ┌─────────────┐
                               │   KV    │  │ Agent state │  │ Telnyx SMS  │
                               │ (TTL    │  │ (attempts + │  │ (via the    │
                               │  300s)  │  │  rate limit)│  │  [telnyx]   │
                               └────┬────┘  └─────────────┘  │  binding)   │
                                    │                        └──────┬──────┘
                                    │                               │
                                    │        ┌──────────────────────┘
                                    │        │
                                    ▼        ▼
                               ┌─────────────────────┐
                               │     User Phone      │
                               │    receives code    │
                               └──────────┬──────────┘
                                          │
                                          ▼
                                    POST /check
                                          │
                                          ▼
                               ┌─────────────────────────┐
                               │     TwoFactorAgent      │
                               │  verify against KV →    │
                               │  cleanup on success →   │
                               │  schedule() expiry net  │
                               └─────────────────────────┘
```

**Flow:**
1. Client requests verification for a phone number (`POST /verify`)
2. The fetch handler routes to the phone's durable actor (`idFromName`)
3. Agent rate-limits via durable per-phone state (5 attempts per 5-minute window), generates a 6-digit code, and stores it in KV with `expirationTtl: 300`
4. Agent sends the SMS via the zero-credential `[telnyx]` binding (`this.env.TELNYX.messages.send()`)
5. Agent schedules `expireCode` cleanup via `this.schedule(300, "expireCode", { phone })` as a safety net
6. User receives the SMS and submits the code (`POST /check`)
7. Agent verifies against KV; success clears the code and resets counters; failure increments the fail counter

Note: KV keys allow only `a-z A-Z 0-9 - _ / = .`, so the E.164 `+` is stripped — the key for `+17177247292` is `2fa/17177247292`.

## Environment Variables

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|-----------------|
| `TELNYX_API_KEY` | `string` | `your_telnyx_api_key_here` | **yes** | Telnyx API key — injected automatically by the `[telnyx]` binding; also used by the `telnyx-edge` CLI | [Telnyx Portal → API Keys](https://portal.telnyx.com) |
| `DEMO_MODE` | `string` | `true` / `false` | no | `true` (default) logs codes to the actor console instead of sending SMS; `false` sends real SMS | set in `telnyx.toml` `[env_vars]` |
| `TELNYX_FROM_NUMBER` | `string` | `+16282564655` | no (live mode) | SMS-capable sender number in E.164 | buy a number at [telnyx.com](https://telnyx.com/products/number-api) |

> **Agent / CLI access** — all of the above can be provisioned from the CLI/agent without the portal:
>
> ```bash
> telnyx auth set-key KEY…               # human CLI auth (or TELNYX_API_KEY env var for agents)
> telnyx number-orders create --profile international --quantity 1   # buy an SMS-capable number
> telnyx-edge storage kv create --name sms-two-factor-agent-2fa      # provision the KV namespace
> ```

## Setup

### Prerequisites

- Node.js 18+ and npm
- Docker (compose plugin) — for `telnyx-edge dev`
- A Telnyx account with an SMS-capable number (10DLC campaign required for US A2P traffic)
- Telnyx Edge CLI: install from [github.com/team-telnyx/edge-compute/releases](https://github.com/team-telnyx/edge-compute/releases)

### Local Development

```bash
# Clone the repository
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/sms-two-factor-agent

# Authenticate the Edge CLI (or export TELNYX_API_KEY)
export TELNYX_API_KEY=your_telnyx_api_key_here

# Install dependencies
npm install

# Typecheck + smoke test (loads the module, verifies the Agent contract)
npm run typecheck
npm test
```

<details>
<summary>Programmatic / CLI setup</summary>

```bash
# Create the StatefulActor function (registers func_id with the platform)
telnyx-edge new-func --actor -l ts -n sms-two-factor-agent
# → copy the printed func_id into telnyx.toml [edge_compute]

# Provision the KV namespace for the codes
telnyx-edge storage kv create --name sms-two-factor-agent-2fa
# → copy the KV ID into telnyx.toml [storage.kv.KV] id

# Ship to Telnyx Edge (~5-10 min: upload, build, deploy)
telnyx-edge ship

# Deployed URL is printed at the end; also visible via:
telnyx-edge list
```
</details>

### Deploy and Run

```bash
# Ship to Telnyx Edge Compute
telnyx-edge ship

# Health check
curl https://<your-function>.telnyxcompute.com/health

# Demo mode (default): codes are logged to the actor console — no SMS sent
# Live mode: set DEMO_MODE = "false" in telnyx.toml [env_vars], then re-ship

# Send a real verification SMS
curl -X POST https://<your-function>.telnyxcompute.com/verify \
  -H "Content-Type: application/json" \
  -d '{"phone": "+17177247292"}'

# Verify the code the user received
curl -X POST https://<your-function>.telnyxcompute.com/check \
  -H "Content-Type: application/json" \
  -d '{"phone": "+17177247292", "code": "928723"}'
```

**Important:** `[env_vars]` in `telnyx.toml` are injected into the **function runtime's** `process.env` only — the actor runtime has its own empty `process.env`. The fetch handler therefore passes `DEMO_MODE` and `TELNYX_FROM_NUMBER` into `sendCode()` explicitly. Do not read those env vars directly inside the agent class.

### Project Structure

```
sms-two-factor-agent/
├── src/
│   └── index.ts          # Main entry — fetch front door + TwoFactorAgent
├── telnyx.toml           # Edge manifest — actors, [telnyx], KV, env vars
├── telnyx-env.d.ts       # Generated binding types (telnyx-edge types)
├── package.json
├── tsconfig.json
├── smoke_test.ts
├── .env.example
├── .gitignore
├── README.md
├── API.md
└── GUIDE.md
```

## API Reference

### POST `/verify`

Initiate SMS two-factor authentication for a phone number.

**Request:**
```json
{
  "phone": "+15551234567"
}
```

**Response (200):**
```json
{
  "ok": true,
  "message": "Verification code sent. Check your phone.",
  "demo_mode": false,
  "message_id": "4031a083-1c0b-4fee-a298-e2249ef1f421"
}
```

**Response (400):**
```json
{ "error": "A valid E.164 phone number is required (e.g. +15551234567)" }
```

**Response (429):**
```json
{ "error": "Too many attempts. Please try again later." }
```

---

### POST `/check` (alias: `POST /verify/code`)

Verify the SMS code submitted by the user.

**Request:**
```json
{
  "phone": "+15551234567",
  "code": "123456"
}
```

**Response (200):**
```json
{
  "verified": true,
  "message": "Phone number verified."
}
```

**Response (401):**
```json
{
  "verified": false,
  "error": "Invalid code",
  "status": "invalid",
  "fails_remaining": 4
}
```

**Response (404):**
```json
{ "error": "No active verification code. Request a new one." }
```

---

### GET `/health`

Health check endpoint.

**Response (200):**
```json
{
  "status": "ok",
  "agent": "TwoFactorAgent"
}
```

## Troubleshooting

| Issue | Cause | Solution |
|-------|-------|----------|
| `ok: true` but no SMS received in live mode | `[env_vars]` are injected into the function runtime only — the actor runtime's `process.env` is empty, so the agent silently took the demo branch | The fetch handler passes `DEMO_MODE`/`TELNYX_FROM_NUMBER` explicitly into `sendCode()`; never read these env vars inside the agent class |
| KV `HTTP 400: Invalid key format` | KV keys allow only `a-z A-Z 0-9 - _ / = .` — the E.164 `+` (and `:`) are rejected | `kvKey()` sanitizes the phone; keep the `2fa/` prefix format |
| `KV put ... failed: HTTP 500` | Telnyx KV write-path outage (reads can stay healthy) | The agent falls back to the actor's durable storage (`ctx.storage`) automatically; retry later |
| Rate limit triggered | 5 send-code attempts in the 5-minute window | The window resets when the code expires (`expireCode` task) or on successful verification — request a new code after 5 minutes |
| `schedule()` not firing | Tasks survive restarts but need a live deployment | Verify `TwoFactorAgent` is registered via `[[actors]]` in `telnyx.toml` and the function is `deploy_ok` |
| `reset-func` stuck in `resetting` | Platform-side operation backlog | Retry `telnyx-edge reset-func <name> --yes` after the current operation clears, or ship directly from `deploy_failed` |
| 409 `Function Busy` on ship | A ship/delete/reset operation is already in progress | Wait for the in-flight operation to finish (`telnyx-edge list`), then re-ship |

## Agent Discovery

This example is part of the [Telnyx Code Examples](https://github.com/team-telnyx/telnyx-code-examples) catalog.

- **Agent signup**: [telnyx.com/agent-signup.md](https://telnyx.com/agent-signup.md) — automated account provisioning via agent mail; get an API key with no human intervention
- **Agent CLI**: [github.com/team-telnyx/ai/tree/main/cli](https://github.com/team-telnyx/ai/tree/main/cli) — composite commands for agents ([commands reference](https://github.com/team-telnyx/ai/tree/main/cli/src/commands))
- **Agent skills**: [github.com/team-telnyx/ai/tree/main/skills](https://github.com/team-telnyx/ai/tree/main/skills)
- **Telnyx AI repo**: [github.com/team-telnyx/ai](https://github.com/team-telnyx/ai)
- **LLM-optimized docs**: [`llms-full.txt`](https://developers.telnyx.com/llms-full.txt)
- **Example index**: [`llms.txt`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/llms.txt)
- **Telnyx CLI (human)**: [developers.telnyx.com/development/cli](https://developers.telnyx.com/development/cli) — `go install github.com/team-telnyx/telnyx-cli/cmd/telnyx@latest`

## Related Examples

- [agent-sms-triage-bot](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/agent-sms-triage-bot/README.md) — Inbound SMS triage with a scheduled agent
- [edge-customer-agent-typescript](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/edge-customer-agent-typescript/README.md) — Durable entity agent per phone number (StatefulActors deep-dive)
- [edge-event-microsite](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/edge-event-microsite/README.md) — KV-backed event site with an SMS/WhatsApp concierge

## Resources

- [Stateful Actors Quick Start](https://developers.telnyx.com/docs/edge-compute/stateful-actors/quick-start)
- [Send SMS Guide](https://developers.telnyx.com/docs/messaging/send-sms)
- [SMS API Reference](https://developers.telnyx.com/api-reference/sms)
- [Telnyx Messaging Product](https://telnyx.com/products/sms-api)
- [Telnyx Verify Product](https://telnyx.com/products/verify)
- [Telnyx Pricing](https://telnyx.com/pricing)
- [Edge Compute CLI](https://github.com/team-telnyx/edge-compute/releases)
- [Telnyx Developer Docs](https://developers.telnyx.com)
