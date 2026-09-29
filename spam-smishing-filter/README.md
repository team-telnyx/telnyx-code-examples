---
name: spam-smishing-filter
title: "Spam & Smishing Filter on 10DLC"
description: "Durable per-sender reputation ledger that judges every inbound SMS via Jev Decision Models, auto-blocks confirmed spammers, and re-evaluates senders over time."
language: typescript
framework: edge
telnyx_products: [Messaging, Decision Models, Agent SDK]
---

# spam-smishing-filter

Durable per-sender reputation ledger that judges every inbound SMS via Jev Decision Models, auto-blocks confirmed spammers, and re-evaluates senders over time.

## The Story

A regional urgent-care clinic relies on its 10DLC-registered business number to receive patient appointment confirmations, insurance uploads, and lab-result requests by SMS. Every day hundreds of inbound texts arrive — but so do smishing attempts: fake pharmacy links, credential-harvesting messages that look like they came from the clinic's own domain, and phishing payloads that could trick a front-desk staffer into clicking. If the filter fails, a single malicious link could compromise patient PHI, trigger a HIPAA breach, or trick staff into handing over credentials — the stakes are patient safety, regulatory compliance, and the clinic's hard-won trust.

The actor IS the inbound sender number's reputation. Born the moment the clinic registers its watch number, it listens to every inbound SMS, sends each one to the Jev Decision Models API for a verdict (ok / spam / phishing), and records the result in a durable per-sender ledger. One odd text from a sender is logged but not blocked; five cumulative spam verdicts from the same number trigger a permanent block. If a blocked sender tries again after the cooldown window, the actor re-runs Jev with the full history and either upholds the block or lifts it on a clean verdict. If the Edge function is killed mid-judgment — between the Jev call and the block — the stable `act:<messageId>` task and `acted` guard ensure the sender is blocked exactly once, the ledger stays intact, and the audit trail is never lost. Durability is the point: the reputation survives reboots, evictions, and weeks of traffic.

The rest of this README is the API surface of that story.

## Why Telnyx

Telnyx provides **AI Communications Infrastructure** — the programmable layer that connects real-time communication channels (SMS, voice, chat) with AI inference, durable state, and zero-trust security. Unlike generic cloud functions, Telnyx Edge Actors give you durable, per-entity state that survives eviction and scales automatically. The Decision Models API delivers specialized telecom-grade AI judgments (smishing, spam, phishing) in a single typesafe call. And the Telnyx Messaging platform delivers the inbound webhook, outbound alert, and 10DLC-registered sender numbers — all with platform-injected authentication, no credential management in your code.

## Telnyx API Endpoints Used

| Endpoint | Method | Purpose |
|---|---|---|
| `POST https://api.telnyx.com/v2/ai/typesafe/v1/systemone` | POST | Jev Decision Models — classifies each inbound SMS as `ok`, `spam`, or `phishing` with `noul` (hard-stop) and `score` (0–5) |
| `inbound-message` webhook | POST | Receives every inbound SMS on the monitored 10DLC number |
| `send-a-message` | POST | Sends block/phishing alert messages to the monitored number |
| Agent SQL (`this.env.SPAM_DB`) | — | Durable per-sender message history, blocklist, and audit ledger |
| `schedule()` | — | Idempotent per-message task (`act:<messageId>`) ensuring exactly-once judgment |

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        Telnyx Edge Runtime                              │
│                                                                         │
│  ┌──────────────┐     ┌──────────────────────────────┐                 │
│  │  HTTP Entry  │     │   SpamFilter (Agent)         │                 │
│  │  /inbound-   │────▶│  idFromName(number)          │                 │
│  │  message     │     │  ─ one actor per watched     │                 │
│  │  /watch      │     │    10DLC number              │                 │
│  └──────────────┘     │                              │                 │
│                       │  onMessage(msg)              │                 │
│                       │    └─ schedule(0,"act",msg,  │                 │
│                       │       {act:"act:<msgId>"})   │                 │
│                       │                              │                 │
│                       │  act(msg)  ◀── idempotent    │                 │
│                       │    ├─ acted guard            │                 │
│                       │    ├─ isBlocked(sender)?     │                 │
│                       │    │   ├─ cooldownElapsed?   │                 │
│                       │    │   │   └─ reEvaluate()    │                 │
│                       │    │   └─ discardSilent()     │                 │
│                       │    └─ judgeWithJev()         │                 │
│                       │       ├─ choice: ok/spam/    │                 │
│                       │       │         phishing      │                 │
│                       │       ├─ noul: 0–1 (hardstop)│                 │
│                       │       └─ score: 0–5          │                 │
│                       │                              │                 │
│                       │  Policy:                     │                 │
│                       │    phishing OR noul>0.8      │                 │
│                       │      → block + alert         │                 │
│                       │    spam & score>=4           │                 │
│                       │      → block + log           │                 │
│                       │    spam & score<4            │                 │
│                       │      → escalateCount()       │                 │
│                       │    ok                        │                 │
│                       │      → deliver + log         │                 │
│                       │                              │                 │
│                       │  escalateCount():            │                 │
│                       │    N cumulative spam         │                 │
│                       │    → permanent block         │                 │
│                       │      (spam_reputation)       │                 │
│                       └──────────────────────────────┘                 │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  Agent SQL (SPAM_DB)                                            │   │
│  │  ┌─────────────┐  ┌────────────┐  ┌──────────┐                 │   │
│  │  │ senderMsgs  │  │ blocklist  │  │  audit   │                 │   │
│  │  │ sender,text │  │ sender,    │  │ ts,      │                 │   │
│  │  │ verdict,ts  │  │ reason,ts  │  │ sender,  │                 │   │
│  │  └─────────────┘  │ PRIMARY KEY│  │ event,   │                 │   │
│  │                   └────────────┘  │ fromState│                 │   │
│  │                                   │ toState, │                 │   │
│  │                                   │ detail   │                 │   │
│  │                                   └──────────┘                 │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  Jev Decision Models API (typesafe)                             │   │
│  │  POST /v2/ai/typesafe/v1/systemone                              │   │
│  │  {                                                              │   │
│  │    model: "telnyx/decision-flash",                              │   │
│  │    state: { text, history },                                    │   │
│  │    questions: [                                                 │   │
│  │      { type:"choice", options:["ok","spam","phishing"] },       │   │
│  │      { type:"noul", instructions:"1 if hard stop, else 0" },    │   │
│  │      { type:"score", options:5, instructions:"0=legit,5=mal" }  │   │
│  │    ]                                                            │   │
│  │  }                                                              │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  Telnyx Messaging                                               │   │
│  │  inbound-message webhook → /inbound-message                     │   │
│  │  send-a-message → block/phishing alerts to watched number       │   │
│  └─────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────┘
```

## Environment Variables

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|-----------------|
| `TELNYX_API_KEY` | `string` | `your_telnyx_api_key_here` | **yes** | TELNYX_API_KEY | — |
| `SPAM_PERMANENT_BLOCK_N` | `number` | `5` | no | Cumulative spam verdicts before permanent block | — |
| `SPAM_BLOCK_SCORE` | `number` | `4` | no | Minimum spam score for immediate block | — |
| `COOLDOWN_MS` | `number` | `3600000` | no | Cooldown period (ms) before re-evaluation | — |
| `DEMO_MODE` | `boolean` | `true` | no | If `true`, no real SMS sent; logs instead | — |

## Setup

```bash
# 1. Clone the repository
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/spam-smishing-filter

# 2. Install dependencies
npm install

# 3. Create .env from the example
cp .env.example .env
# Edit .env and add your TELNYX_API_KEY

# 4. Authenticate with Telnyx Edge CLI
npx telnyx-edge auth api-key set <your_api_key>

# 5. Set the API key as a secret
npx telnyx-edge secrets add TELNYX_API_KEY "<your_api_key>"

# 6. Run the smoke test
npx tsx smoke_test.ts

# 7. Deploy
npx telnyx-edge ship
```

## API Reference

### `POST /watch`

Registers a 10DLC number to be monitored by the spam filter.

**Request:**
```json
{
  "number": "+15551234567"
}
```

**Response:**
```json
{
  "status": "watching",
  "number": "+15551234567"
}
```

### `POST /inbound-message`

Webhook endpoint that receives inbound SMS messages on the monitored number. The payload is forwarded to the `SpamFilter` actor for judgment.

**Request (Telnyx webhook payload):**
```json
{
  "data": {
    "payload": {
      "id": "msg_123",
      "from": "+15559998888",
      "to": "+15551234567",
      "text": "Click here to claim your prize!"
    }
  }
}
```

**Response:**
```
OK
```

### Actor RPC: `watch(number)`

Creates or retrieves the `SpamFilter` actor for the given number and initializes its database tables.

### Actor RPC: `onMessage(msg)`

Entry point for inbound messages. Schedules an idempotent `act` task under `act:<messageId>`.

### Actor RPC: `act(msg)`

The idempotent judgment task. Checks blocklist, calls Jev Decision Models, applies policy, and records all state transitions in the audit ledger.

## Troubleshooting

| Issue | Cause | Solution |
|-------|-------|----------|
| `TELNYX_API_KEY not configured` | Secret not set | Run `npx telnyx-edge secrets add TELNYX_API_KEY "<key>"` |
| `Invalid phone number format` | Number doesn't match E.164 | Ensure number matches `^\+?[1-9]\d{1,14}$` |
| `Max retries exceeded` | Jev API unavailable or rate-limited | Check [Telnyx status page](https://status.telnyx.com); verify API key has Decision Models access |
| Block alert not received | `DEMO_MODE` is `true` | Set `DEMO_MODE=false` in `.env` and redeploy |
| Duplicate blocks for same sender | `acted` guard not working | Verify `act:<messageId>` scheduling is stable; check actor storage |
| Re-evaluation not lifting blocks | `cooldownElapsed` returns false | Wait for `COOLDOWN_MS` (default 1 hour) to pass |
| `SPAM_DB` binding not found | `telnyx.toml` missing SQL binding | Add `[storage.sqldb.SPAM_DB]` section to `telnyx.toml` |

## Agent Discovery

- [Telnyx Agent Signup](https://telnyx.com/agent-signup.md)
- [Team Telnyx AI GitHub](https://github.com/team-telnyx/ai)
- [llms.txt](https://telnyx.com/llms.txt)

## Related Examples

- [telnyx-code-examples/inbound-sms-forwarder](https://github.com/team-telnyx/telnyx-code-examples/tree/main/inbound-sms-forwarder) — Basic inbound SMS webhook handler
- [telnyx-code-examples/decision-models-demo](https://github.com/team-telnyx/telnyx-code-examples/tree/main/decision-models-demo) — Standalone Jev Decision Models usage
- [telnyx-code-examples/agent-sql-demo](https://github.com/team-telnyx/telnyx-code-examples/tree/main/agent-sql-demo) — Agent SDK with SQL storage patterns

## Resources

- [Telnyx Developers — Decision Models](https://developers.telnyx.com/docs/inference/decision-models)
- [Telnyx API Reference — Inbound Message Webhook](https://developers.telnyx.com/api-reference/callbacks/inbound-message)
- [Telnyx Developers — Send Message](https://developers.telnyx.com/docs/messaging/messages/send-message)
- [Telnyx Developers — Agent SDK SQL](https://developers.telnyx.com/docs/agent-sdk/sql)
- [Telnyx Edge Runtime SDK](https://www.npmjs.com/package/@telnyx/edge-runtime)
- [Telnyx Pricing](https://telnyx.com/pricing)
