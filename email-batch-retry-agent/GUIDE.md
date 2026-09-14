# Telnyx Email Batch Sender with Partial Failure Retry — Developer Guide

This guide walks through the `email-batch-retry-agent` sample — a durable, stateful email campaign agent built on the Telnyx Edge Runtime. Instead of a fire-and-forget script, this sample models an email campaign as a **persistent actor** that owns each message, tracks its state across retries, self-wakes to retry failures with exponential backoff, and notifies an operator when the campaign finishes.

By the end of this guide, you'll understand:

- Why a persistent actor is the right abstraction for batch email delivery with partial failures
- How the agent tracks per-message state (pending → sent → failed → retried → confirmed)
- How the Telnyx Email Batch API's `207 Multi-Status` response drives the retry logic
- How exponential backoff works (60s → 5m, max 3 attempts)
- How to run the sample in mock mode (safe, no real emails) and live mode

---

## Prerequisites

Before running this sample, you'll need:

| Requirement | Details |
|---|---|
| **Telnyx account** | Sign up at [portal.telnyx.com](https://portal.telnyx.com) |
| **API Key** | Create one in the Portal under **API Keys** |
| **Telnyx Edge CLI** | Install via `npm install -g @telnyx/edge-runtime` (includes the `telnyx-edge` CLI) |
| **Node.js** | v18 or later |
| **Operator phone number** | For SMS notifications (E.164 format, e.g. `+15551234567`) |
| **Telnyx sender ID** | A verified sender (alphanumeric sender ID or phone number) |

---

## What This Sample Does

The sample implements a **durable email campaign actor**. Here's the high-level flow:

```
POST /campaigns { campaignId, messages[] }
        │
        ▼
┌─────────────────────────────┐
│  BatchAgent (persistent)    │
│  - owns 100 message states  │
│  - status: CREATED          │
└─────────────────────────────┘
        │ queue("sendBatch")
        ▼
┌─────────────────────────────┐
│  sendBatch()                │
│  - POST /email_messages/batch│
│  - Idempotency-Key header   │
│  - Parse 207 Multi-Status   │
└─────────────────────────────┘
        │ 98 sent / 2 failed
        ▼
┌─────────────────────────────┐
│  schedule(60, "retryFailed")│
│  - Only failed indices      │
│  - New idempotency key      │
└─────────────────────────────┘
        │ retry succeeds
        ▼
┌─────────────────────────────┐
│  COMPLETED                  │
│  - SMS operator summary     │
│  - Persist audit to KV      │
└─────────────────────────────┘
```

---

## Architecture Overview

The sample is built on the **Telnyx Edge Runtime** — a TypeScript runtime for building stateful, durable applications. The core abstraction is the **Agent** (a subclass of `StatefulActor`), which gives you:

- **Durable state** — survives restarts, crashes, and redeploys
- **Self-waking tasks** — `schedule()` and `queue()` for delayed/async work
- **RPC-style method calls** — public methods are callable from stubs
- **HTTP routing** — `fetch()` handler for REST endpoints

### Files in this sample

```
email-batch-retry-agent/
├── src/
│   └── index.ts          # The BatchAgent actor + default fetch handler
├── package.json          # Dependencies and scripts
├── tsconfig.json         # TypeScript config
├── telnyx.toml           # Edge runtime config (bindings, secrets, actors)
├── .env.example          # Placeholder environment variables
├── smoke_test.ts         # Verifies module loads and class/method existence
├── README.md             # Project overview and setup
├── API.md                # Endpoint reference
└── GUIDE.md              # This file
```

---

## Step 1: Understanding the Actor State

The heart of this sample is the **campaign state** — a durable object that lives inside the actor. Every message in the campaign is tracked individually.

```typescript
interface CampaignState {
  campaignId: string;
  total: number;
  sent: number;
  failed: number;
  exhausted: number;
  messages: MessageState[];  // per-index tracking
  status: "CREATED" | "SENDING" | "RETRYING" | "COMPLETED" | "PARTIAL_FAILURE";
  createdAt: string;
  completedAt: string | null;
}
```

Each message in `messages[]` has its own state:

```typescript
interface MessageState {
  index: number;
  to: string;
  from: string;
  subject: string;
  text: string;
  status: "PENDING" | "SENT" | "FAILED" | "RETRYING" | "EXHAUSTED";
  attempts: number;
  lastError: string | null;
  idempotencyKey: string | null;
}
```

This per-message granularity is what makes the retry logic precise — when a batch partially fails, only the failed indices are retried, never the successful ones.

---

## Walkthrough: Code Sections

### 1. Imports and Type Definitions

The sample starts by importing the core Edge Runtime primitives:

```typescript
import {
  Agent,
  type ActorContext,
  type Env,
  type Secrets,
  type ActorNamespace,
  type KvNamespace,
} from "@telnyx/edge-runtime";
```

Then it defines the message/campaign types and the `BatchResponse` interface that mirrors the Telnyx Email Batch API's `207 Multi-Status` response shape.

### 2. Env Bindings

The `Env` interface declares the bindings this actor uses:

```typescript
export interface Env {
  SECRETS: Secrets;          // Secret store (API keys, operator number)
  BATCH_AGENT: ActorNamespace; // Self-reference for routing
  RESULT_KV: KvNamespace;    // KV store for audit records
  MOCK_MODE: string;         // "true" = demo mode (no real emails)
}
```

These bindings are declared in `telnyx.toml` and injected by the runtime.

### 3. Constants

```typescript
const BACKOFF_SECONDS = [60, 300]; // 60s → 5m
const MAX_ATTEMPTS = 3;            // 1 initial + 2 retries
const EMAIL_BATCH_URL = "https://api.telnyx.com/v2/email_messages/batch";
```

**Backoff semantics:** The spec says "60s → 5m → 25m, max 3 attempts." In this implementation, "max 3 attempts" means **1 initial send + 2 retries**. So the backoff schedule is: first retry waits 60s, second retry waits 5m (300s). The 25m tier is documented as the next tier but never fired for a 3-attempt cap.

### 3. The BatchAgent Class

The `BatchAgent` extends `Agent<Env, CampaignState>`. The generic parameters tie the agent to its environment bindings and its durable state type.

#### `initialState()`

Returns the default state when the actor is first created — all zeros, empty messages array, status `"CREATED"`.

#### HTTP Routes (`fetch`)

The actor exposes two REST endpoints:

| Method | Route | Purpose |
|---|---|---|
| `POST` | `/campaigns` | Create a campaign and fire the initial batch |
| `GET` | `/campaigns/:id` | Fetch the full audit trail for a campaign |

**`handleCreateCampaign`** validates the request body:
- `campaignId` must be a non-empty string
- `messages[]` must be a non-empty array
- Each message requires `to`, `from`, `subject`, `text`
- `to` must be a valid E.164 number (regex: `^\+?[1-9]\d{7,14}$`)

It then initializes the durable state — each message gets `status: "PENDING"`, `attempts: 0`, `idempotencyKey: null` — and calls `this.queue("sendBatch")` to fire the initial batch immediately.

**`handleGetCampaign`** returns the full campaign state as JSON — the complete audit trail.

### 4. The Initial Batch Send (`sendBatch`)

This is the core task handler. It's invoked via `queue("sendBatch")` from the create route.

**Step 1 — Guard clause:** If the campaign is already `COMPLETED` or `PARTIAL_FAILURE`, it returns early. This prevents duplicate sends.

**Step 2 — Collect pending messages:** It filters `state.messages` for messages with status `PENDING` or `FAILED`. On the first run, that's all 100 messages.

**Step 3 — Generate idempotency key:** Each batch attempt gets a unique key:

```typescript
const idempotencyKey = this.generateIdempotencyKey(state.campaignId, Date.now());
```

This key is sent in the `Idempotency-Key` header. If the request is retried (e.g., network timeout), the API won't send duplicate emails.

**Step 4 — Send the batch.** The `sendBatchRequest` helper does the actual HTTP call. It supports two modes:

- **Mock mode** (`MOCK_MODE=true`): Simulates the 207 response, forcing indices 97 and 98 to fail on the first attempt. This gives you the 98/2 split without sending real emails.
- **Live mode**: Makes a real `POST` to `https://api.telnyx.com/v2/email_messages/batch` with the `Authorization: Bearer <API_KEY>` and `Idempotency-Key` headers.

**Step 5 — Parse the 207 Multi-Status response.** The Telnyx batch API returns a `207` status with two arrays:

```typescript
interface BatchResponse {
  data: Array<{ index: number; id: string }>;   // successes
  errors: Array<{ index: number; error: string }>; // failures
}
```

The code maps these back to the original message indices and updates each message's state:

- **Success** → `status: "SENT"`, `attempts += 1`, store the idempotency key
- **Failure** → `status: "FAILED"`, `attempts += 1`, store the error and idempotency key

**Step 6 — Decide next action:**
- If **all sent** → `completeCampaign()` (status `COMPLETED`, notify operator)
- If **some failed** → `scheduleRetry()` (status `RETRYING`, schedule self-wake)

### 5. The Retry Task (`retryFailed`)

This is the self-waking retry handler. It's invoked via `schedule(delay, "retryFailed")`.

**Step 1 — Guard clause:** Only runs if status is `RETRYING`.

**Step 2 — Split failures:** It separates messages into:
- `stillRetryable` — those with `attempts < MAX_ATTEMPTS`
- `exhausted` — those that have hit the max attempt cap

Exhausted messages get `status: "EXHAUSTED"` and are counted in `state.exhausted`.

**Step 3 — Send retry batch.** Only the still-retryable messages are included in the payload. A **new idempotency key** is generated for this attempt — this is critical, because the Telnyx API deduplicates on the idempotency key. Using a fresh key per attempt ensures the retry is a genuine new send.

**Step 4 — Parse and update.** Same 207 parsing logic as `sendBatch`. Successful retries flip to `SENT`; failures increment `attempts` again.

**Step 5 — Decide next steps:**
- All sent → `completeCampaign()`
- Still failing → `scheduleRetry()` (which computes the next backoff delay)
- All exhausted → `finishCampaign()` (status `PARTIAL_FAILURE`)

### 6. Exponential Backoff (`scheduleRetry`)

```typescript
private async scheduleRetry(): Promise<void> {
  const state = await this.getState();
  const failed = state.messages.filter((m) => m.status === "FAILED");
  const maxAttempt = Math.max(...failed.map((m) => m.attempts), 1);

  if (maxAttempt >= MAX_ATTEMPTS) {
    await this.finishCampaign();
    return;
  }

  const backoffIdx = Math.min(maxAttempt - 1, BACKOFF_SECONDS.length - 1);
  const delay = BACKOFF_SECONDS[backoffIdx];

  state.status = "RETRYING";
  await this.replaceState(state);
  await this.schedule(delay, "retryFailed");
}
```

The backoff calculation:

| Attempt | `maxAttempt` | `backoffIdx` | Delay |
|---|---|---|---|
| 1st retry | 2 | 1 | 60s |
| 2nd retry | 3 | 2 | 300s (5m) |

If `maxAttempt >= MAX_ATTEMPTS` (3), all messages have exhausted their retries → `finishCampaign()`.

### 7. Completion and Notification

Two completion paths:

- **`completeCampaign()`** — all messages sent → status `COMPLETED`
- **`finishCampaign()`** — some messages exhausted → status `PARTIAL_FAILURE`

Both do the same three things:

1. **Persist audit trail** to KV (`RESULT_KV`), keyed by `campaign:${campaignId}`, with a 30-day TTL. This enables cross-campaign listing.
2. **Notify the operator** via SMS using the `TELNYX` binding:

```typescript
await this.env.TELNYX.messages.send({
  to: operatorNumber,
  from: sender,
  text: summary,
});
```

The summary text is:

```
Campaign {id} complete: {sent}/{total} sent.
Campaign {id} partial failure: {sent}/{total} sent, {exhausted} exhausted.
```

3. **Update status** to `COMPLETED` or `PARTIAL_FAILURE` with a `completedAt` timestamp.

### 8. The Default Fetch Handler

The default export routes all incoming HTTP requests to a singleton actor stub:

```typescript
export default {
  async fetch(req: Request, env: Env, ctx: ActorContext): Promise<Response> {
    const stub = env.BATCH_AGENT.get(env.BATCH_AGENT.idFromName("default"));
    return stub.fetch(req);
  },
};
```

This is the entry point the Edge Runtime calls for every HTTP request. It looks up the actor stub by name (`"default"`) and forwards the request.

---

## Telnyx Primitives Used

| Primitive | How it's used |
|---|---|
| **Agent SDK** | `BatchAgent extends Agent<Env, CampaignState>` — durable, stateful campaign entity |
| **`queue()`** | Fires `sendBatch` immediately after campaign creation |
| **`schedule()`** | Self-waking retry with exponential backoff (60s → 5m) |
| **Telnyx Email API** | `POST /v2/email_messages/batch` with `Idempotency-Key` header |
| **KV Store** | `RESULT_KV` — persists finished audit records for cross-campaign listing |
| **SMS** | `this.env.TELNYX.messages.send()` — operator notification on completion |
| **StateStore** | Durable actor state via `this.ctx.storage` (managed by the Agent base class) |

---

## State Machine

```
CREATED → SENDING → (parse 207)
  → all sent → COMPLETED
  → some failed → RETRYING → (retry batch)
    → all sent → COMPLETED
    → still failed → RETRYING (backoff)
    → max attempts → PARTIAL_FAILURE
```

---

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `TELNYX_API_KEY` | Yes (live mode) | Your Telnyx API key |
| `OPERATOR_NUMBER` | Yes | E.164 phone number to receive SMS notifications |
| `TELNYX_SENDER` | Yes | Telnyx sender number or alphanumeric sender ID |
| `MOCK_MODE` | No | Set to `"true"` for demo mode (default behavior) |

These are stored as **secrets** in the Edge runtime (via `telnyx.toml` `[[secrets]]` sections) and accessed via `this.env.SECRETS.get("...")`.

---

## Setup and Run Instructions

### 1. Install dependencies

```bash
npm install
```

### 2. Authenticate the CLI

```bash
telnyx-edge auth api-key set YOUR_TELNYX_API_KEY
```

### 3. Configure secrets

```bash
telnyx-edge secrets add TELNYX_API_KEY "your_api_key_here"
telnyx-edge secrets add OPERATOR_NUMBER "+15551234567"
telnyx-edge secrets add TELNYX_SENDER "YourBrand"
```

### 4. Deploy

```bash
npm run deploy   # runs telnyx-edge ship
```

### 5. Create a campaign

```bash
curl -X POST https://<your-actor-url>/campaigns \
  -H "Content-Type: application/json" \
  -d '{
    "campaignId": "campaign-2026-03",
    "messages": [
      { "to": "+15551234567", "from": "YourBrand", "subject": "Hello", "text": "Welcome!" },
      // ... up to 100 messages
    ]
  }'
```

### 6. Check the audit trail

```bash
curl https://<your-actor-url>/campaigns/campaign-2026-03
```

---

## Demo Mode vs. Live Mode

### Demo Mode (default, safe)

Set `MOCK_MODE=true` in your environment. In this mode:

- No real emails are sent
- The `sendBatchRequest` helper simulates the 207 Multi-Status response
- Indices 97 and 98 are **forced to fail** on the first attempt (the 98/2 split)
- On the first retry, all messages succeed (the "healing" behavior)
- You can observe the full retry lifecycle without any cost

### Live Mode

Remove `MOCK_MODE` (or set it to `"false"`). The agent will:

- Call `POST https://api.telnyx.com/v2/email_messages/batch` with your real API key
- Send real emails to the `to` addresses in your message payloads
- Parse the real 207 Multi-Status response
- Retry real failures with exponential backoff

> **⚠️ Warning:** Live mode sends real emails and incurs charges. Use test recipient addresses and verify your sender is configured correctly.

---

## Why This Architecture Matters

A stateless script would lose all context if it crashed between the initial send and the retry. The persistent actor pattern gives you:

- **Durable message state** — each of 100 messages tracked individually
- **Self-waking retries** — no external cron needed
- **Crash recovery** — state persists across restarts
- **Complete audit trail** — every attempt, idempotency key, and error logged
- **Multi-campaign support** — one actor per campaign, all living simultaneously with independent state

---

## Next Steps

Now that you understand the email batch retry agent, here's where to go next:

- **Telnyx Email API docs** — [Email Messages Batch](https://developers.telnyx.com/docs/api/v2/email/Email-Messages)
- **Edge Runtime docs** — [Telnyx Edge Runtime](https://developers.telnyx.com/docs/edge)
- **Agent SDK reference** — [Agent and StatefulActor](https://developers.telnyx.com/docs/edge/agent-sdk)
- **SMS API** — [Send a message](https://developers.telnyx.com/docs/api/v2/messaging/Messages)
- **Idempotency keys** — [Idempotent requests](https://developers.telnyx.com/docs/api/v2/overview#idempotent-requests)

### Related examples

- [Call Control with AI Agent](https://github.com/team-telnyx/telnyx-code-examples/tree/main/call-control-ai-agent)
- [SMS Notification Service](https://github.com/team-telnyx/telnyx-code-examples/tree/main/sms-notification-service)
- [Webhook Signature Verification](https://github.com/team-telnyx/telnyx-code-examples/tree/main/webhook-signature-verification)
