# Spam / Smishing Filter on 10DLC — Developer Guide

This guide walks you through the `spam-smishing-filter` sample: a durable, per-sender reputation ledger built on the Telnyx Edge Agent SDK that judges every inbound SMS with the **Jev Decision Models API** (`choice`, `noul`, `score`), blocks confirmed smishing/phishing, escalates repeat spammers, and re-evaluates blocked senders over time.

---

## Prerequisites

- A Telnyx account with a 10DLC-registered business number.
- Node.js 18+ and the Telnyx Edge CLI (`telnyx-edge`).
- The `@telnyx/edge-runtime` package (v0.15.1).
- A Telnyx API key with access to **Decision Models (Beta)** and **Messaging**.

---

## Environment Setup

### 1. Authenticate the CLI

```bash
telnyx-edge auth api-key set <your_api_key>
```

### 2. Configure secrets

The sample reads `TELNYX_API_KEY` from the Edge secrets store. Set it:

```bash
telnyx-edge secrets add TELNYX_API_KEY "<your_telnyx_api_key>"
```

### 3. Environment variables

| Variable | Default | Description |
|---|---|---|
| `TELNYX_API_KEY` | *(required)* | Telnyx API key for Decision Models calls. |
| `SPAM_PERMANENT_BLOCK_N` | `5` | Cumulative spam verdicts before a permanent `spam_reputation` block. |
| `SPAM_BLOCK_SCORE` | `4` | Minimum Jev `score` to immediately block a `spam` verdict. |
| `COOLDOWN_MS` | `3600000` | Cooldown (1 hour) before a blocked sender is re-evaluated. |
| `DEMO_MODE` | `true` | When `true`, no real SMS alerts are sent — actions are logged to console. Set to `false` for live mode. |

Create a `.env` file from the template:

```bash
cp .env.example .env
# Edit .env and set your values
```

### 4. telnyx.toml bindings

The `telnyx.toml` declares the actor namespace and SQL storage binding:

```toml
name = "spam-smishing-filter"
main = "src/index.ts"
compatibility_date = "2026-07-28"

[[actors]]
binding = "SPAM_FILTER"
type    = "SpamFilter"

[[secrets]]
binding = "TELNYX_API_KEY"
name    = "TELNYX_API_KEY"

[telnyx]
binding = "TELNYX"

[storage.sqldb.SPAM_DB]
id = "<sqldb-namespace-uuid>"

[env_vars]
DEMO_MODE = "true"
SPAM_PERMANENT_BLOCK_N = "5"
SPAM_BLOCK_SCORE = "4"
COOLDOWN_MS = "3600000"
```

---

## How It Works — Step by Step

### Step 1: Register a watch number

When you want to monitor a 10DLC business number, call the `/watch` RPC endpoint:

```bash
curl -X POST http://<edge-url>/watch \
  -H "Content-Type: application/json" \
  -d '{"number": "+15551234567"}'
```

This triggers `env.SPAM_FILTER.idFromName(number)` — which creates **one durable `SpamFilter` actor per monitored number**. The actor's `watch()` method stores the number in its state and initializes the SQL tables (`senderMsgs`, `blocklist`, `audit`).

### Step 2: Inbound SMS arrives

Telnyx delivers inbound messages to your Edge function's `/inbound-message` webhook. The handler extracts `from`, `to`, `text`, and `id` from `data.payload`, then routes the message to the correct actor via `stub.onMessage({ id, from, text })`.

### Step 3: Idempotent per-message task

Inside `onMessage`, the actor calls `this.schedule(0, "act", msg, { act: "act:<messageId>" })`. This creates a **stable, idempotent task** keyed by the message ID. If the message is redelivered (e.g., due to a crash), the `acted:<messageId>` guard in `ctx.storage` ensures the message is judged and acted on **exactly once**.

### Step 4: Check the blocklist

Before judging, the actor checks if the sender is already in the `blocklist` table. If blocked:

- **Cooldown elapsed?** → Re-evaluate the sender (see Step 7).
- **Still in cooldown?** → Discard silently + audit row (no user alert).

### Step 5: Judge with Jev Decision Models

If the sender is not blocked, the actor fetches the sender's prior message history from `senderMsgs` and calls the **Jev Decision Models API**:

```
POST https://api.telnyx.com/v2/ai/typesafe/v1/systemone
```

The request body includes:
- `model`: `"telnyx/decision-flash"`
- `state`: `{ text, history }` — the current message text plus the sender's prior verdicts
- `questions`: `choice` (ok/spam/phishing), `noul` (hard stop 0–1), `score` (0–5)

The API key is read from `env.SECRETS.get("TELNYX_API_KEY")` — never hardcoded.

**Retry logic**: The `fetchWithRetry` helper handles 429/502 responses with exponential backoff + jitter, honoring `Retry-After` headers.

### Step 6: Apply the decision policy

The Jev verdict drives the policy:

| Verdict | Condition | Action |
|---|---|---|
| **Phishing** | `choice === "phishing"` OR `noul > 0.8` | Immediate block + phishing alert SMS |
| **Spam (high score)** | `choice === "spam"` AND `score >= SPAM_BLOCK_SCORE` (4) | Immediate block + log |
| **Spam (low score)** | `choice === "spam"` AND `score < 4` | Log + increment cumulative spam count |
| **OK** | `choice === "ok"` | Deliver untouched + log verdict |

The `block()` method inserts into `blocklist` (using `INSERT OR IGNORE` for idempotency) and sends a block alert via `env.TELNYX.messages.send()`. In demo mode, it logs to console instead.

### Step 7: Per-sender memory & permanent blocks

Every message verdict is recorded in `senderMsgs(sender, text, verdict, ts)`. The `escalateCount()` method counts **cumulative** spam verdicts for a sender. When the count reaches `SPAM_PERMANENT_BLOCK_N` (default 5), the sender is permanently blocked with reason `spam_reputation`. This block is **human-removal only** — it is exempt from cooldown lift.

### Step 8: Re-evaluation

If a blocked sender contacts the number again **after** `COOLDOWN_MS` (default 1 hour):

1. The actor re-runs Jev with the sender's full history.
2. If Jev returns `ok` → the block is lifted (`unblock()`), the message is delivered, and an `unblock` audit row is written.
3. If Jev still flags the sender → the block is upheld, and a `reeval_uphold` audit row is written.

**Phishing/hard-stop blocks and `spam_reputation` permanent blocks are exempt** from lift-on-ok.

### Step 9: Audit trail

Every transition writes an `audit(ts, sender, event, fromState, toState, detail)` row:

- `verdict` — Jev decision recorded
- `block` — sender blocked (phishing or spam)
- `permanent_block` — cumulative spam threshold reached
- `reeval` — re-evaluation verdict
- `unblock` — block lifted on cooldown
- `discard_silent` — message discarded during cooldown
- `deliver` — message passed through

The audit table is **independent of the data tables** — it can be replayed to reconstruct the full state history.

---

## Demo Mode vs. Live Mode

By default, `DEMO_MODE=true`. In demo mode:

- No real SMS alerts are sent. Block alerts and phishing warnings are logged to the console.
- Delivered messages are logged but not actually forwarded.
- All Jev Decision Models calls are real (they hit the Telnyx API), but no Telnyx Messaging charges are incurred.

To switch to **live mode** (sends real SMS alerts):

1. Set `DEMO_MODE=false` in your environment or `telnyx.toml` `[env_vars]`.
2. Ensure your Telnyx account has Messaging enabled and your 10DLC number is registered.
3. Deploy with `telnyx-edge ship`.

---

## Running the Sample

### Deploy

```bash
telnyx-edge ship
```

### Test with synthetic messages

Send a synthetic inbound message to your Edge function:

```bash
curl -X POST http://<edge-url>/inbound-message \
  -H "Content-Type: application/json" \
  -d '{
    "data": {
      "payload": {
        "id": "msg_123",
        "from": "+15559999999",
        "to": "+15551234567",
        "text": "Congratulations! You won a prize. Click http://bit.ly/fake to claim."
      }
    }
  }'
```

### Run the smoke test

```bash
npx tsx smoke_test.ts
```

This verifies that the `SpamFilter` class, its methods, and the RPC surface are correctly defined.

---

## Key Telnyx Primitives Used

| Primitive | Usage |
|---|---|
| **Agent SDK** (`Agent<Env, State>`) | The `SpamFilter` class extends `Agent` — a durable entity per monitored number with persistent state and SQL storage. |
| **Agent SQL** (`env.SPAM_DB`) | Three tables: `senderMsgs` (per-sender verdict history), `blocklist` (active blocks), `audit` (full transition log). Survives eviction and weeks of traffic. |
| **Jev Decision Models** | `POST /v2/ai/typesafe/v1/systemone` — classifies each SMS with `choice`, `noul`, and `score` in a single shared-state call. |
| **Messaging** (`env.TELNYX.messages.send`) | Sends block/phishing alert SMS to the monitored number. |
| **`schedule()`** | Creates an idempotent `act:<messageId>` task per inbound message — ensures exactly-once processing even on re-delivery. |
| **`idFromName()`** | Deterministically maps a phone number to a durable actor ID — one actor per monitored number. |

---

## Next Steps

- [Decision Models (Beta) Documentation](https://developers.telnyx.com/docs/inference/decision-models)
- [Inbound Message Webhook Reference](https://developers.telnyx.com/api-reference/callbacks/inbound-message)
- [Send Message API Reference](https://developers.telnyx.com/docs/messaging/messages/send-message)
- [Agent SDK SQL Documentation](https://developers.telnyx.com/docs/agent-sdk/sql)
- [Telnyx Edge Runtime Docs](https://developers.telnyx.com/docs/edge)
- [10DLC Registration Guide](https://developers.telnyx.com/docs/messaging/10dlc)
