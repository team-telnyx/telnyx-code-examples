---
name: chargeback-adjudication
title: "Chargeback Adjudication with Telnyx Decision Models"
description: "A durable actor that adjudicates payment chargebacks using Telnyx Decision Models, manages regulatory deadlines, and maintains an append-only audit ledger."
language: typescript
framework: edge
telnyx_products: [AI Communications Infrastructure, Decision Models, Messaging, Agent SDK, Edge Compute]
---

# chargeback-adjudication

A durable Telnyx Edge actor that adjudicates payment chargebacks using Telnyx Decision Models, manages regulatory deadlines, and maintains an append-only audit ledger.

## The Story

A regional medical clinic processes hundreds of patient payments each month through its payment processor. When a patient disputes a charge — whether due to a billing error, a forgotten copay, or a genuine fraud attempt — the clinic has a narrow window to respond with evidence or risk an automatic loss of the funds. If the dispute is mishandled, the clinic loses revenue, faces compliance scrutiny, and erodes patient trust. The clinic's billing team needs a system that never forgets a deadline, never loses evidence, and can re-evaluate a case when new information arrives days later.

The actor IS the dispute case. Born the moment a chargeback webhook fires, it assembles the evidence file — the original order, the delivery confirmation, the prior contact history — and calls the Telnyx Decision Models API to rule live: approve a rebate, request more evidence, or deny the claim. It arms a deadline timer that will auto-lose the case if no response arrives in time, and it keeps an append-only audit ledger that an examiner can replay months later. When the patient replies with a photo of their delivered medication, the actor re-wakes with the full prior transcript, re-runs the Decision Model with the new fact, and updates the verdict. If the platform reboots mid-decision, the actor survives — its state, its deadline, and its ledger all durable across restarts. The rest of this README is the API surface of that story.

## Why Telnyx

Telnyx provides **AI Communications Infrastructure** — the durable, programmable foundation that lets applications reason about real-world events and act on them reliably. The Agent SDK gives you stateful actors that survive restarts and span days, Decision Models gives you a live judge that scores and rules on evidence, and Messaging gives you the customer channel to request and receive that evidence. Together, they turn a chargeback from a race against a clock into a managed, auditable case.

## Telnyx API Endpoints Used

| Endpoint | Product | Purpose |
|---|---|---|
| `POST https://api.telnyx.com/v2/ai/typesafe/v1/systemone` | Decision Models (Beta) | Live adjudication: `choice` (approve_rebate / request_evidence / deny), `score` (lose-probability 0–100), `noul` (fraud flag) |
| `this.env.TELNYX.messages.send({ to, text })` | Messaging | Customer decision notification + evidence request SMS |
| `this.env.DISPUTE_DB.prepare(...)` | Agent SDK SQL | Append-only audit ledger, review queue, seeded evidence rows |
| `this.schedule(delay, method, payload, { id })` | Agent SDK Scheduled Tasks | `decide:<disputeId>` exactly-once task + `respond:<disputeId>` deadline timer |
| `this.env.DISPUTES.idFromName(disputeId)` | Agent SDK Actors | One durable actor per dispute, self-provisioned on webhook |

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Telnyx Edge Runtime                          │
│                                                                     │
│  ┌──────────────┐     ┌──────────────────────────────────────┐    │
│  │  Edge Fetch  │     │         DisputeCase Actor            │    │
│  │   Handler    │     │  (one per disputeId, durable)        │    │
│  │              │     │                                      │    │
│  │ /webhook/    │     │  ┌────────────────────────────────┐  │    │
│  │ chargeback   │────▶│  │  onChargeback(payload)         │  │    │
│  │              │     │  │  1. setState(disputeId, ...)    │  │    │
│  │ /webhook/    │     │  │  2. seedEvidence() → SQL        │  │    │
│  │ inbound-     │────▶│  │  3. schedule(0, "decide",       │  │    │
│  │ message      │     │  │     { id: "decide:<id>" })      │  │    │
│  │              │     │  └────────────────────────────────┘  │    │
│  └──────────────┘     │                                      │    │
│                       │  ┌────────────────────────────────┐  │    │
│                       │  │  decide() task handler          │  │    │
│                       │  │  1. assembleEvidence() → SQL    │  │    │
│                       │  │  2. Decision Model call                 │
│                       │  │     → POST /systemone           │  │    │
│                       │  │     → choice + score + noul     │  │    │
│                       │  │  3. applyPolicy(verdict)        │  │    │
│                       │  │     → SMS customer              │  │    │
│                       │  │     → schedule deadline timer   │  │    │
│                       │  │     → appendAudit() → SQL       │  │    │
│                       │  └────────────────────────────────┘  │    │
│                       │                                      │    │
│                       │  ┌────────────────────────────────┐  │    │
│                       │  │  deadline() task handler        │  │    │
│                       │  │  → if !decided: auto_lost      │  │    │
│                       │  │  → appendAudit("auto_lost")    │  │    │
│                       │  └────────────────────────────────┘  │    │
│                       │                                      │    │
│                       │  ┌────────────────────────────────┐  │    │
│                       │  │  onNewEvidence(text, mediaUrl)  │  │    │
│                       │  │  1. assembleEvidence(mediaUrl)  │  │    │
│                       │  │  2. Decision Model call                 │
│                       │  │  3. appendAudit("re-evaluated") │  │    │
│                       │  │  4. applyPolicy(verdict)        │  │    │
│                       │  └────────────────────────────────┘  │    │
│                       │                                      │    │
│                       │  SQL Tables:                        │    │
│                       │   orders, deliveries, contactLog    │    │
│                       │   audit (append-only ledger)        │    │
│                       │   reviewQueue (fraud holds)         │    │
│                       └──────────────────────────────────────┘    │
│                                                                     │
│  ┌────────────────────────────────────────────────────────────────┐ │
│  │  Telnyx Decision Models API                                    │ │
│  │  POST /v2/ai/typesafe/v1/systemone                             │ │
│  │  { model, state, questions: [choice, score, noul] }            │ │
│  └────────────────────────────────────────────────────────────────┘ │
│                                                                     │
│  ┌────────────────────────────────────────────────────────────────┐ │
│  │  Telnyx Messaging API                                          │ │
│  │  messages.send({ to, text })                                   │ │
│  └────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────┘
```

## Environment Variables

Runtime config is delivered to the actor via `[[secrets]]` bindings (registered with `telnyx-edge secrets add`) — the Edge runtime does not inject `[env_vars]` for actor projects. The code reads each value from `SECRETS.get()` with a plain env-var fallback.

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|-----------------|
| `TELNYX_API_KEY` | `string` | `your_telnyx_api_key_here` | **yes** | TELNYX_API_KEY | — |
| `RESPONSE_DEADLINE_DAYS` | `string` | `7` | no | Fallback chargeback response deadline in days (used when webhook payload lacks `respondBy`) | — |
| `REVIEWER_ONCALL_E164` | `string` | `+1555XXXXXXXX` | no | Phone number to page when a fraud hold is triggered (`noul > 0.8`) | — |
| `TELNYX_SMS_FROM_NUMBER` | `string` | `+1555XXXXXXXX` | no (required for live SMS) | SMS `from` number; must be a messaging-profile/10DLC-attached number on your account | — |
| `DEMO_MODE` | `string` | `true` | no | When `true` (default), SMS is logged to the audit ledger (`sms_demo`) instead of sent via the Telnyx API | — |

> **Agent / CLI access**
>
> ```bash
> # Register phone-number-related config
> telnyx number-orders create              # provision a number for live SMS
> # Register runtime config as secrets (read via SECRETS.get in the actor)
> telnyx-edge secrets add TELNYX_API_KEY "<your_key>"
> telnyx-edge secrets add DEMO_MODE false
> telnyx-edge secrets add RESPONSE_DEADLINE_DAYS 7
> telnyx-edge secrets add REVIEWER_ONCALL_E164 "+1555XXXXXXXX"
> telnyx-edge secrets add TELNYX_SMS_FROM_NUMBER "+1555XXXXXXXX"
> ```
>
> Every SMS attempt is audited (`sms_sent` / `sms_demo` / `sms_error`) in the actor's SQL ledger.

## Setup

```bash
# 1. Clone the repository
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/chargeback-adjudication

# 2. Install dependencies
npm install

# 3. Configure environment
cp .env.example .env
# Edit .env and set your TELNYX_API_KEY

# 4. Authenticate with Telnyx Edge
telnyx-edge auth api-key set <your_telnyx_api_key>

# 5. Create the edge function (registers func_id) and wire it into telnyx.toml
telnyx-edge new-func -l ts -n chargeback-adjudication --from-dir .
# then replace <func-uuid> in telnyx.toml's [edge_compute] block

# 6. Register the config secrets (see "Agent / CLI access" above)
telnyx-edge secrets add TELNYX_API_KEY "<your_key>"
telnyx-edge secrets add DEMO_MODE true
telnyx-edge secrets add RESPONSE_DEADLINE_DAYS 7
telnyx-edge secrets add REVIEWER_ONCALL_E164 "+1555XXXXXXXX"
telnyx-edge secrets add TELNYX_SMS_FROM_NUMBER "+1555XXXXXXXX"

# 7. Generate type bindings
telnyx-edge types

# 8. Run the smoke test
npx tsx smoke_test.ts

# 9. Deploy
telnyx-edge ship
```

## API Reference

### Webhook Endpoints

#### `POST /webhook/chargeback`

Triggers the birth of a new `DisputeCase` actor.

**Request Body:**

```json
{
  "disputeId": "chgbk_abc123",
  "customer": "+15551234567",
  "amount": 99.99,
  "orderId": "order_xyz789",
  "respondBy": "2026-10-15T12:00:00Z"
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `disputeId` | `string` | yes | Unique identifier for the chargeback |
| `customer` | `string` | yes | Customer phone number (E.164) |
| `amount` | `number` | yes | Disputed amount |
| `orderId` | `string` | yes | Order identifier |
| `respondBy` | `string` | no | ISO deadline; falls back to `RESPONSE_DEADLINE_DAYS` env var |

**Response:**

```json
{
  "ok": true,
  "message": "DisputeCase chgbk_abc123 born and decide task armed"
}
```

#### `POST /webhook/inbound-message`

Re-wakes an existing `DisputeCase` actor with new customer evidence.

**Request Body:**

```json
{
  "disputeId": "chgbk_abc123",
  "text": "I received the package on Oct 1st",
  "mediaUrl": "https://example.com/photo.jpg"
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `disputeId` | `string` | yes | The dispute to re-evaluate |
| `text` | `string` | yes | Customer's text evidence |
| `mediaUrl` | `string` | no | URL to customer-submitted media (e.g., delivery photo) |

**Response:**

```json
{
  "ok": true
}
```

### Actor Methods

| Method | Trigger | Description |
|---|---|---|
| `onChargeback(payload)` | Webhook | Birth path: seeds evidence, computes deadline, arms `decide` task |
| `decide()` | Scheduled task (`decide:<id>`) | Assembles evidence, calls the Decision Model, applies policy |
| `deadline()` | Scheduled task (`respond:<id>`) | Auto-loses the case if no decision was made in time |
| `onNewEvidence(text, mediaUrl)` | Webhook | Re-evaluates with new evidence, re-runs the Decision Model, updates verdict |
| `applyPolicy(verdict)` | Internal | Routes based on the Decision Model's `choice` + `noul` score |
| `judgeWithDecisionModel(state)` | Internal | Calls Telnyx Decision Models API with retry/backoff |
| `assembleEvidence(mediaUrl?)` | Internal | Pulls order, delivery, contact log from SQL |
| `appendAudit(event, payload)` | Internal | Appends to the durable audit ledger |

### Telnyx Decision Models Response

The `judgeWithDecisionModel` method calls `POST /v2/ai/typesafe/v1/systemone` with `{ state, questions }` (state is a JSON string; `choice` uses a criteria map, `score` a criteria rubric) and reads per-question results from `answers`:

| Field | Type | Description |
|---|---|---|
| `answers.decision.choice` | `string` | One of: `approve_rebate`, `request_evidence`, `deny` |
| `answers.loseProb.score` | `number` | Probability of losing the dispute (0–1) |
| `answers.fraud.noul` | `number` | Fraud likelihood (0–1) |

### Decision Policy

| Decision Model Output | Action |
|---|---|
| `noul > 0.8` | Route to human reviewer: insert into `reviewQueue`, SMS reviewer on-call, SMS customer "under manual review" — **never auto-rebate** |
| `choice = approve_rebate` | SMS customer "refund issued", set status `approved`, mark `decided = true` |
| `choice = request_evidence` | SMS customer evidence request, set status `awaiting_evidence`, arm `respond:<id>` deadline timer |
| `choice = deny` | SMS customer "could not be approved", set status `denied`, mark `decided = true` |
| Deadline fires, `!decided` | Set status `auto_lost`, append audit row, SMS customer |

## Troubleshooting

| Issue | Cause | Solution |
|---|---|---|
| Actor not found on webhook | `DISPUTES` binding not configured in `telnyx.toml` | Ensure `[[actors]]` section maps `binding = "DISPUTES"` to `type = "DisputeCase"` |
| Decision Model API returns 429 | Rate limited | The built-in retry/backoff handles this; check `Retry-After` header is honored |
| Decision Model API returns 4xx | Malformed request or auth failure | Non-retryable; the actor throws immediately with the response body |
| Decision Model API returns 502 | Transient gateway error | Retry with jittered backoff (up to 5 attempts) |
| Deadline timer doesn't fire | Actor was killed before `schedule()` completed | The `decide:<id>` task id is stable; retries converge to the same task |
| SMS not sent | `DEMO_MODE` is `true` | `telnyx-edge secrets add DEMO_MODE false` to send real SMS |
| No SMS and no `sms_*` audit row | SMS `from` not configured | `telnyx-edge secrets add TELNYX_SMS_FROM_NUMBER "+1555XXXXXXXX"` |
| `TELNYX_API_KEY` not found | Secret not set | Run `telnyx-edge secrets add TELNYX_API_KEY "<your_key>"` |
| SQL table not found | Tables not seeded | `seedEvidence()` creates tables on first call; ensure `DISPUTE_DB` binding is configured |

## Agent Discovery

- [Telnyx Agent Signup](https://telnyx.com/agent-signup.md)
- [Team Telnyx AI GitHub](https://github.com/team-telnyx/ai)
- [llms.txt](https://telnyx.com/llms.txt)

## Related Examples

- [`refund-adjudicator`](../refund-adjudicator/) — The v4 predecessor that this sample refines into the chargeback/evidence framing
- [`agent-sql-ledger`](../agent-sql-ledger/) — Append-only audit ledger patterns with Agent SDK SQL
- [`decision-models-demo`](../decision-models-demo/) — Basic Decision Models usage without durable actors
- [`messaging-webhook-handler`](../messaging-webhook-handler/) — Inbound SMS/MMS webhook handling

## Resources

- [Decision Models Documentation](https://developers.telnyx.com/docs/inference/decision-models)
- [Decision Models API Reference](https://developers.telnyx.com/api-reference/decision-models/evaluate-decision-models-typesafe-compatible)
- [Agent SDK Documentation](https://developers.telnyx.com/docs/agent-sdk)
- [Agent SDK SQL Documentation](https://developers.telnyx.com/docs/agent-sdk/sql)
- [Agent SDK Scheduled Tasks Documentation](https://developers.telnyx.com/docs/agent-sdk/scheduled-tasks)
- [Messaging: Send Message Documentation](https://developers.telnyx.com/docs/messaging/messages/send-message)
- [Stateful Actors Documentation](https://developers.telnyx.com/docs/edge-compute/stateful-actors)
- [Telnyx Pricing](https://telnyx.com/pricing)
