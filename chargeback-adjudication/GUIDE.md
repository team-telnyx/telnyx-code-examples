# Chargeback Adjudication — Developer Guide

A step-by-step walkthrough of the `chargeback-adjudication` sample: a durable Telnyx Edge actor that adjudicates payment chargebacks using the Telnyx Decision Models API, enforces regulatory deadlines, and maintains an append-only audit ledger.

---

## Prerequisites

- A Telnyx account with API access (get your key at [telnyx.com](https://telnyx.com))
- Node.js 18+ (for local TypeScript execution via `tsx`)
- The Telnyx Edge CLI (`npm i -g telnyx-edge`)
- Basic familiarity with the [Telnyx Agent SDK](https://developers.telnyx.com/docs/agent-sdk)

---

## Environment Setup

### 1. Clone and install

```bash
cd chargeback-adjudication
npm install
```

### 2. Configure environment variables

Copy the example and fill in your values:

```bash
cp .env.example .env
```

Edit `.env`:

```env
TELNYX_API_KEY=your_telnyx_api_key_here
RESPONSE_DEADLINE_DAYS=7
REVIEWER_ONCALL_E164=+1555XXXXXXXX
TELNYX_SMS_FROM_NUMBER=+1555XXXXXXXX
DEMO_MODE=true
```

| Variable | Description | Default |
|---|---|---|
| `TELNYX_API_KEY` | Your Telnyx API key (used for Telnyx Decision Models calls) | *(required)* |
| `RESPONSE_DEADLINE_DAYS` | Fallback chargeback response deadline in days | `7` |
| `REVIEWER_ONCALL_E164` | Phone number to page for fraud holds | *(required for live mode)* |
| `TELNYX_SMS_FROM_NUMBER` | SMS `from` number for live mode (must be messaging-profile/10DLC-attached) | *(required for live SMS)* |
| `DEMO_MODE` | When `true`, SMS is logged to the audit ledger instead of sent | `true` |

> **Note:** the Edge runtime does **not** inject `[env_vars]` for actor projects. At runtime, the actor reads every value from `SECRETS.get(<name>)` (declared as `[[secrets]]` in `telnyx.toml`) with a plain env-var fallback. The `.env` file is for local tooling only.

### 3. Register the secrets

```bash
telnyx-edge secrets add TELNYX_API_KEY "your_telnyx_api_key_here"
telnyx-edge secrets add DEMO_MODE true
telnyx-edge secrets add RESPONSE_DEADLINE_DAYS 7
telnyx-edge secrets add REVIEWER_ONCALL_E164 "+1555XXXXXXXX"
telnyx-edge secrets add TELNYX_SMS_FROM_NUMBER "+1555XXXXXXXX"
```

### 4. Generate type bindings

```bash
telnyx-edge types
```

This regenerates `telnyx-env.d.ts` from your `telnyx.toml` bindings.

---

## Project Structure

```
chargeback-adjudication/
├── src/
│   └── index.ts          # Main actor + Edge fetch handler
├── smoke_test.ts         # Verifies classes/methods load
├── telnyx.toml           # Actor + binding declarations
├── package.json
├── tsconfig.json
├── .env.example
└── .gitignore
```

---

## How It Works

### The `DisputeCase` Actor

The core of this sample is the `DisputeCase` class, which extends `Agent<DisputeEnv, DisputeState>`. Each chargeback dispute gets its own durable actor instance, provisioned via `env.DISPUTES.idFromName(disputeId)`.

The actor owns:
- **The evidence file** — order details, delivery confirmation, and prior contact history
- **The deadline engine** — a self-scheduling timer that auto-loses unanswered chargebacks
- **The audit ledger** — an append-only SQL table recording every decision and re-evaluation
- **The decision policy** — rules that translate the Decision Model's verdict into customer-facing actions

### Step 1: Chargeback Webhook → Actor Birth

When a payment processor fires a chargeback webhook, it hits the Edge `fetch` handler at `/webhook/chargeback`:

```typescript
// src/index.ts — fetch handler
if (path === "/webhook/chargeback" && req.method === "POST") {
  const payload = await req.json();
  const stub = e.DISPUTES.idFromName(payload.disputeId);
  const result = await stub.onChargeback(payload);
  return new Response(JSON.stringify(result), { status: 200 });
}
```

The `onChargeback` method (in the `DisputeCase` class) initializes the actor state, seeds mock evidence rows into the agent's SQL database, computes the deadline, and arms a stable `decide:<disputeId>` task:

```typescript
// src/index.ts — onChargeback method
await this.setState({ disputeId, customer, orderId, status: "assembling", ... });
await this.seedEvidence(orderId, customer, amount);
this.schedule(0, "decide", {}, { id: "decide:" + disputeId });
```

**Key design choice:** The decision is not executed inline. Instead, a scheduled task with a stable ID (`decide:<disputeId>`) is armed with delay 0. This guarantees exactly-once execution — if the worker is killed and restarted, the same task ID converges to a single decision.

### Step 2: Evidence Assembly

The `assembleEvidence` method queries the agent's SQL database for three tables:

```typescript
// src/index.ts — assembleEvidence method
const orderRow = await db.prepare("SELECT * FROM orders WHERE orderId = ?").bind(orderId).first();
const deliveryRow = await db.prepare("SELECT * FROM deliveries WHERE orderId = ?").bind(orderId).first();
const contactRows = await db.prepare("SELECT * FROM contactLog WHERE customer = ?").bind(customer).all();
```

These tables are seeded with mock rows during `onChargeback` via the `seedEvidence` method. In production, these would be replaced with calls to the merchant's orders API.

### Step 3: Telnyx Decision Models Call

The `judgeWithDecisionModel` method calls the Telnyx Decision Models API (`POST /v2/ai/typesafe/v1/systemone`) with all three question types in a single shared-state call. `state` is a JSON string; each question declares `type`, `instructions`, and (`choice`/`score`) a `criteria` rubric:

```typescript
// src/index.ts — judgeWithDecisionModel method
const body = {
  state: JSON.stringify(state),
  questions: {
    decision: {
      type: "choice",
      instructions: "Rule on the chargeback.",
      criteria: {
        approve_rebate: "Delivery evidence supports the customer's order.",
        request_evidence: "Evidence is inconclusive; more proof is needed.",
        deny: "Evidence supports the merchant; deny the dispute.",
      },
    },
    loseProb: {
      type: "score",
      instructions: "0=we clearly win, 100=we clearly lose.",
      criteria: ["0-25 clearly win", "25-75 uncertain", "75-100 clearly lose"],
    },
    fraud: {
      type: "noul",
      instructions: "1 if this looks like a fraud attempt, else 0.",
    },
  },
};
```

The response nests per-question results under `answers` — the actor reads `answers.decision.choice`, `answers.loseProb.score` (0–1), and `answers.fraud.noul` (0–1).

The call includes bounded retry with jitter for `429`/`502`-class responses:

```typescript
// src/index.ts — retry loop in judgeWithDecisionModel
for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
  const res = await fetch(url, { method: "POST", headers: { Authorization: `Bearer ${apiKey}` }, ... });
  if (res.ok) return await res.json();
  const waitMs = retryAfter ? parseFloat(retryAfter) * 1000 : jitteredBackoff(attempt);
  await sleep(waitMs);
}
```

### Step 4: Decision Policy

The `applyPolicy` method translates the Decision Model's verdict into actions:

```typescript
// src/index.ts — applyPolicy method
if (noul > FRAUD_THRESHOLD) {
  // Route to human reviewer — never auto-rebate
  await this.env.DISPUTE_DB.prepare("INSERT INTO reviewQueue VALUES (?, ?, ?)").bind(...).all();
  const reviewer = await readConfig(this.env, "REVIEWER_ONCALL_E164");
  if (!reviewer) {
    await this.appendAudit("reviewer_missing", { disputeId, reason: "REVIEWER_ONCALL_E164 not configured" });
  } else {
    await this.sendSms(reviewer, `Fraud hold: dispute ${disputeId}, noul=${noul}. Review required.`);
  }
  return;
}

switch (choice) {
  case "approve_rebate":
    await this.sendSms(customerPhone, `Your chargeback ${disputeId} is approved...`);
    await this.setState({ status: "approved", verdict: v, decided: true });
    break;
  case "request_evidence":
    await this.sendSms(customerPhone, `We need more evidence...`);
    await this.setState({ status: "awaiting_evidence", verdict: v, decided: true });
    this.schedule(this.state.deadlineMs / 1000, "deadline", {}, { id: "respond:" + disputeId });
    break;
  case "deny":
    await this.sendSms(customerPhone, `Your chargeback ${disputeId} could not be approved.`);
    await this.setState({ status: "denied", verdict: v, decided: true });
    break;
}
```

**Policy rules:**
- `noul > 0.8` (likely fraud) → Always routes to a human reviewer. No auto-rebate, ever.
- `approve_rebate` → SMS customer that refund is issued.
- `request_evidence` → SMS customer with evidence request + arms the deadline timer.
- `deny` → SMS customer that chargeback could not be approved.

The `decided` flag is the second guard (belt-and-suspenders): the stable task ID makes retries converge, the flag makes a double-fire a no-op.

### Step 5: Deadline Timer

When the Decision Model returns `request_evidence`, the actor arms a deadline timer:

```typescript
// src/index.ts — request_evidence case in applyPolicy
this.schedule(this.state.deadlineMs / 1000, "deadline", {}, { id: "respond:" + disputeId });
```

The `deadline` task handler auto-loses the case if no evidence arrives in time:

```typescript
// src/index.ts — deadline task handler
async deadline(): Promise<void> {
  if (!this.state.decided) {
    await this.setState({ status: "auto_lost" });
    await this.appendAudit("auto_lost", { reason: "deadline expired" });
    await this.sendSms(this.state.customer, `Chargeback ${this.state.disputeId} was auto-lost...`);
  }
}
```

This timer is durable — it survives pod restarts and persists across days.

### Step 6: Re-evaluation on New Evidence

When the customer replies with a delivery photo, the inbound SMS webhook hits `/webhook/inbound-message`:

```typescript
// src/index.ts — fetch handler for inbound messages
if (path === "/webhook/inbound-message" && req.method === "POST") {
  const payload = await req.json();
  const { disputeId, text, mediaUrl } = payload;
  if (!disputeId) return new Response(JSON.stringify({ error: "disputeId required" }), { status: 400 });
  const stub = e.DISPUTES.idFromName(disputeId);
  await stub.onNewEvidence(text, mediaUrl);
  return new Response(JSON.stringify({ ok: true }), { status: 200 });
}
```

The `onNewEvidence` method re-assembles the evidence (including the new media URL), re-runs the Decision Model with the full prior history, and appends to the audit ledger:

```typescript
// src/index.ts — onNewEvidence method
async onNewEvidence(text: string, mediaUrl?: string): Promise<void> {
  const evidence = await this.assembleEvidence(mediaUrl);
  const v = await this.judgeWithDecisionModel({ ...evidence, newEvidence: text });
  await this.appendAudit("re-evaluated", v);
  await this.applyPolicy(v);
}
```

### Step 7: Append-Only Audit Ledger

Every decision, re-evaluation, and fraud hold is recorded in the `audit` SQL table:

```typescript
// src/index.ts — appendAudit method
private async appendAudit(event: string, payload: Record<string, unknown>): Promise<void> {
  await this.env.DISPUTE_DB
    .prepare("INSERT INTO audit VALUES (?, ?, ?, ?)")
    .bind(this.state.disputeId, new Date().toISOString(), event, JSON.stringify(payload))
    .all();
}
```

This ledger is durable and append-only — an auditor can replay the entire dispute lifecycle.

---

## Demo Mode vs Live Mode

### Demo Mode (default)

When `DEMO_MODE=true` (the default), the sample:
- Seeds mock evidence rows in agent SQL (no external API calls)
- Logs SMS messages to the console instead of sending them
- Uses synthetic, non-PII data throughout

```typescript
// src/index.ts — sendSms method
private async sendSms(to: string, text: string): Promise<void> {
  if ((await readConfig(this.env, "DEMO_MODE")) !== "false") {
    console.log(`[DEMO SMS] to=${to} text=${text}`);
    await this.appendAudit("sms_demo", { to, text });
    return;
  }
  const from = await readConfig(this.env, "TELNYX_SMS_FROM_NUMBER");
  if (!from) {
    await this.appendAudit("sms_error", { to, error: "TELNYX_SMS_FROM_NUMBER is not configured for live SMS" });
    throw new Error("TELNYX_SMS_FROM_NUMBER is not configured for live SMS");
  }
  try {
    const resp = await this.env.TELNYX.messages.send({ from, to, text });
    await this.appendAudit("sms_sent", { to, from, id: resp?.data?.id ?? null, status: resp?.data?.status ?? null });
  } catch (err) {
    await this.appendAudit("sms_error", { to, from, error: String(err).slice(0, 300) });
    throw err;
  }
}
```

### Live Mode

To switch to live mode:
1. `telnyx-edge secrets add DEMO_MODE false`
2. Provide a real `REVIEWER_ONCALL_E164` phone number (`telnyx-edge secrets add REVIEWER_ONCALL_E164 ...`)
3. Set the live SMS `from` number: `telnyx-edge secrets add TELNYX_SMS_FROM_NUMBER "+1555XXXXXXXX"` (must be a messaging-profile/10DLC-attached number on your account)
4. Ensure `TELNYX_API_KEY` is set as a secret

In live mode, SMS messages are sent via the Telnyx Messaging API from the configured `from` number, and the Telnyx Decision Models API is called with real credentials. Every SMS attempt is audited (`sms_sent` / `sms_error`) in the ledger.

---

## Running the Sample

### Local smoke test

```bash
npx tsx smoke_test.ts
```

This verifies that the `DisputeCase` class and its methods load without error.

### Deploy to Telnyx Edge

```bash
telnyx-edge ship
```

This deploys the actor and Edge fetch handler to Telnyx Edge.

---

## Telnyx Primitives Used

| Primitive | Usage |
|---|---|
| **Agent SDK** (`Agent` base class) | The `DisputeCase` actor — durable case file owning evidence, deadline, and audit ledger |
| **Agent SQL** (`SqlDatabase`) | Append-only `audit` ledger, `reviewQueue` table, and seeded mock evidence tables |
| **Scheduled Tasks** (`schedule()`) | `decide:<disputeId>` task (exactly-once decision) and `respond:<disputeId>` deadline timer |
| **Messaging** (`TELNYX.messages.send`) | Customer decision SMS and fraud hold notification to reviewer on-call |
| **Secrets** (`SECRETS.get`) | Bearer token for Telnyx Decision Models API calls, live/demo switch, SMS `from` number, and reviewer paging — all declared as `[[secrets]]` in `telnyx.toml` |
| **Webhook Seam** (Edge `fetch`) | `/webhook/chargeback` (actor birth) and `/webhook/inbound-message` (re-evaluation) |

---

## Next Steps

- [Decision Models Documentation](https://developers.telnyx.com/docs/inference/decision-models) — Learn about `choice`, `score`, and `noul` question types
- [Agent SDK Documentation](https://developers.telnyx.com/docs/agent-sdk) — Durable actors, SQL, scheduled tasks, and queues
- [Agent SDK SQL](https://developers.telnyx.com/docs/agent-sdk/sql) — Using SQL databases inside agents
- [Agent SDK Scheduled Tasks](https://developers.telnyx.com/docs/agent-sdk/scheduled-tasks) — Timers and recurring tasks
- [Messaging: Send Message Documentation](https://developers.telnyx.com/docs/messaging/messages/send-message) — Sending SMS via the Telnyx binding
- [Stateful Actors Documentation](https://developers.telnyx.com/docs/edge-compute/stateful-actors) — Durable entities and actor lifecycle
