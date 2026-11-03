---
name: crew-cast
title: "Crew Cast — Group MMS Delivery Scoreboard on a Durable Edge Actor"
description: "One durable Edge actor owns a group MMS thread: per-recipient delivery state joined by group_message_id, inbound replies folded via the cc roster, and a dispatch scoreboard that survives worker restarts."
language: typescript
framework: edge
telnyx_products: [messaging, group-mms, edge-runtime]
---

# Crew Cast — THE CREW BOARD

A durable Telnyx Edge actor that owns one group MMS thread — roster, per-recipient delivery state, and reply log — and answers dispatch's question all afternoon: *who has acknowledged, who is silent, who is off-network?*

## The Story

A roofing contractor's dispatch desk in Phoenix runs eight field crews and one group thread per job. At 7:30 a.m. the dispatcher sends a single group MMS — a photo of the roof, the gate code, the ladder instruction — to six technicians at once, and then spends the rest of the morning answering one question: *who actually got it?* If she can't answer it, crews show up at the wrong address, a homeowner waits on an empty driveway, and a five-figure job slips a day; if she guesses wrong and re-sends, six phones buzz twice and the crew stops trusting the thread.

The actor IS the crew conversation. It is born the moment dispatch casts the job — before the send, it writes the roster down, so a crash between "we sent it" and "we recorded it" cannot orphan six recipients. It evolves as six separate `message.finalized` events land on it one at a time, each carrying the same `group_message_id` and a different phone number, folding into one board instead of six half-written rows. It survives the mid-morning deploy that kills the webhook worker — the next finalized event re-activates the *same* actor by name, board intact, no duplicate rows, because the roster cursor makes replay a no-op. It keeps the question alive by scheduling itself to re-check the one recipient whose status is still `unknown` in thirty minutes. And it completes when the last device reports in and it texts dispatch: *all six accounted for.*

The rest of this README is the API surface of that story.

## Why Telnyx

Group MMS is the primitive this whole sample exists for, and Telnyx is the only place it comes as one call plus a correlated webhook stream. `POST /v2/messages/group_mms` takes a `from`, up to eight `to[]` numbers, text and `media_urls[]`, and returns a `data.id` that *is* the `group_message_id` — the join key that every subsequent per-recipient `message.finalized` event carries. That single correlation id is what turns six independent carrier reports into one trustworthy board; without it you are matching phone numbers against a spreadsheet.

Inbound replies come back with a `cc` array listing every other participant, so the actor never needs an external roster registry — the thread carries its own membership. And the honest edge case is documented rather than hidden: recipients on non-Telnyx carriers report `unknown`, because handset confirmation isn't available, and the board renders that distinctly from `delivery_failed`.

This is **AI Communications Infrastructure** in the literal sense: the messaging fabric emits the events, and the durable actor is the memory that makes them mean something to a human under deadline.

## Telnyx API Endpoints Used

| Method | Endpoint / Event | Purpose in this sample |
|--------|------------------|-----------------------|
| `POST` | `/v2/messages/group_mms` | Send one text + photo to up to 8 US/CA recipients. Response `data.id` is the `group_message_id`; `data.to[]` seeds the board with per-recipient `status`, `carrier`, `line_type`. Called through the `TELNYX` binding as `this.env.TELNYX.messages.send({ from, to, text, media_urls })`. |
| `POST` | `/v2/messages` | 1:1 SMS to `DISPATCH_PHONE` once every recipient reaches a terminal state ("Job 1187: all 6 accounted for — 5 delivered, 0 failed, 1 unknown"). Same binding, single-element `to`. |
| webhook | `message.finalized` | One event per recipient. Carries `group_message_id`, `to[0].phone_number`, `status`. Folded into the board idempotently by `(group_message_id, recipient)`. |
| webhook | `message.received` | Inbound crew reply. Carries `from.phone_number`, `text`, and `cc[]` — the full roster of *other* participants. Folded into `replies[]`, marks the sender `acked_at`, and backfills any roster entry missed at cast time. |

**Documented constraints (first-class rules, not footnotes):**

- Maximum **8 recipients** per group MMS. The router rejects a 9th with `400`.
- **US + Canada destinations only**, E.164 (`+1[2-9]\d{9}`). Anything else is `400`.
- **MMS protocol only** — the messaging profile must be MMS-capable and on **v2 webhooks**, or the send returns `403`.
- `unknown` means *non-Telnyx recipient, handset confirmation unavailable*. It is **provisional** — a later `message.finalized` may upgrade it to `delivered` / `sending_failed` / `delivery_failed`.

## Architecture

```
Dispatch (curl / dispatch app)
        │
        │  POST /cast  { job_id, recipients[6], text, media_url }
        ▼
┌──────────────────────────────────────────────────────────────────┐
│ src/index.ts — plain fetch router (no framework)                 │
│                                                                  │
│   POST /cast                → actor /cast                        │
│   POST /webhooks/messaging  → Ed25519 verify → route by index    │
│   GET  /board/:cast_id      → actor /board                       │
│   GET  /board?cast_id=      → actor /board                       │
└───────────────┬──────────────────────────────────────────────────┘
                │  env.CREW_CAST.idFromName(job_id)
                ▼
   ┌───────────────────────────────────────────────────────────┐
   │  CrewCast extends Agent<Env, CrewState>   (durable)       │
   │                                                           │
   │  state: group_message_id · recipients[{number, carrier,   │
   │         line_type, status, acked_at, finalized_at}]       │
   │         replies[{id, from, text, at, cc[]}]               │
   │         roster_cursor · repolls · notified_signature      │
   │                                                           │
   │  cast()          persist roster → TELNYX.messages.send    │
   │                  → record group_message_id                │
   │  onFinalized()   one recipient, idempotent, replay-safe   │
   │  onReply()       fold reply + cc roster, dedupe by id     │
   │  deliveryReport()  totals + SQL acknowledgement summary   │
   │  repollUnknown()   this.schedule(1800, "repollUnknown")   │
   └──────┬──────────────────────────────┬─────────────────────┘
          │                              │
   CREW_INDEX (KV)                 CREW_DB (SqlDatabase)
   group:<gm_id>  → cast_id        crew_delivery
   thread:<from>  → cast_id        (cast_id, phone_number) PK
   ← webhook routing               ← GROUP BY status ack report
```

**Why the actor is load-bearing.** Six `message.finalized` events arrive separately, minutes apart, and must land on one board. The router resolves `group_message_id → cast_id` through the KV index and hands the event to `idFromName(cast_id)` — the same actor instance every time, whether or not the worker that handled the previous event is still alive. `onFinalized` is a no-op when the incoming status equals the stored status (`duplicate`) or when the recipient is already in a hard-terminal state (`already_terminal`), so a replayed webhook updates nothing but still returns `200` to stop Telnyx retries.

**Why the reply path needs no registry.** Inbound replies carry no `group_message_id`. The router looks up `thread:<to[0].phone_number>` (the crew number) in KV, or accepts `?cast_id=` as an override. The `cc` array on the first reply backfills any participant the cast-time roster missed.

**Why SQL.** `CREW_DB` holds a `crew_delivery` row per `(cast_id, phone_number)`, upserted on every state change. `deliveryReport()` runs a parameterized `GROUP BY status` query over it so the board's `sql_summary` is a real database answer, not an in-memory recount.

## Environment Variables

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|-----------------|
| `TELNYX_API_KEY` | `string` | `your_telnyx_api_key_here` | **yes** | TELNYX_API_KEY | — |
| `TELNYX_PUBLIC_KEY` | `string` | `your_telnyx_public_key_here` | **yes** | TELNYX_PUBLIC_KEY | — |
| `CREW_FROM` | `string` | `+12025550100` | **yes** | The Telnyx number that sends the group MMS and receives crew replies. Must be MMS-capable and on a v2-webhook messaging profile. | Telnyx Portal → Numbers |
| `CREW_PROFILE_ID` | `string` | `your_messaging_profile_id_here` | **yes** (live mode) | Messaging profile with MMS enabled and webhook API version `2`. Required when `DEMO_MODE=false`. | Telnyx Portal → Messaging → Profiles |
| `DISPATCH_PHONE` | `string` | `+12025550199` | **yes** | E.164 number that receives the "all six accounted for" summary SMS. Invalid values are skipped with a warning, not a crash. | Your dispatch desk's phone |
| `PUBLIC_BASE_URL` | `string` | `https://crew-cast.example.workers.dev` | **yes** | Public origin used to build the `webhook_url` returned by `POST /cast` and to register the messaging profile webhook. | Your `telnyx-edge ship` output |
| `DEMO_MODE` | `string` | `true` | no (default `true`) | `true` simulates the group send locally and accepts unsigned webhooks. `false` calls the real Telnyx API and requires a valid Ed25519 signature. | — |
| `CREW_TO_1` … `CREW_TO_6` | `string` | `+12025550101` … `+12025550106` | no | Demo roster used when `POST /cast` omits `recipients`. Must be US/CA E.164. | — |

`TELNYX_API_KEY` and `TELNYX_PUBLIC_KEY` are declared as `[[secrets]]` in `telnyx.toml` and read via `env.SECRETS.get(...)`. The Telnyx API itself is reached through the zero-credential `[telnyx] binding = "TELNYX"` — the platform injects auth, so no key ever appears in a request body or a log line.

## Setup

```bash
# 1. Clone and enter the sample
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/crew-cast

# 2. Configure environment
cp .env.example .env
#    edit .env — set CREW_FROM, CREW_PROFILE_ID, DISPATCH_PHONE, PUBLIC_BASE_URL

# 3. Install
npm install

# 4. Generate binding types from telnyx.toml
npx telnyx-edge types

# 5. Authenticate the CLI and push secrets
telnyx-edge auth api-key set "$TELNYX_API_KEY"
telnyx-edge secrets add TELNYX_PUBLIC_KEY "your_telnyx_public_key_here"

# 6. Sanity check (no network, no credentials needed)
npx tsx smoke_test.ts

# 7. Deploy
npm run deploy          # → telnyx-edge ship
```

`telnyx.toml` declares the actor binding (`CREW_CAST`), the KV namespace (`CREW_INDEX`), the SQL database (`CREW_DB`), the `TELNYX` API binding, and the two secrets. Replace the placeholder namespace UUIDs with your own before shipping.

### The demo flow, end to end

```bash
# 1. Dispatch casts the job — roster persisted BEFORE the send
curl -s -X POST "$PUBLIC_BASE_URL/cast" \
  -H 'content-type: application/json' \
  -d '{
    "job_id": "job-1187",
    "recipients": [
      "+12025550101","+12025550102","+12025550103",
      "+12025550104","+12025550105","+12025550106"
    ],
    "text": "Job 1187 — roof photo attached. Reply ON SITE when you are on the ladder.",
    "media_url": "https://example.com/roof-1187.jpg"
  }'
# → { cast_id, group_message_id, recipients[6] all "queued", totals, ... }

# 2. Poll the board
curl -s "$PUBLIC_BASE_URL/board/job-1187" | jq '.totals'

# 3. Replay the six finalized events (demo/finalized-events.json)
for ev in $(jq -c '.[]' demo/finalized-events.json); do
  curl -s -X POST "$PUBLIC_BASE_URL/webhooks/messaging" \
    -H 'content-type: application/json' -d "$ev" | jq -c
done
# → 5 delivered, 1 unknown (non-Telnyx recipient)

# 4. A crew member replies — cc carries the other five numbers
curl -s -X POST "$PUBLIC_BASE_URL/webhooks/messaging" \
  -H 'content-type: application/json' \
  -d '{"data":{"event_type":"message.received","payload":{
        "id":"msg-0001",
        "from":{"phone_number":"+12025550103"},
        "to":[{"phone_number":"+12025550100"}],
        "cc":[{"phone_number":"+12025550101"},{"phone_number":"+12025550102"},
              {"phone_number":"+12025550104"},{"phone_number":"+12025550105"},
              {"phone_number":"+12025550106"}],
        "text":"on site, east ladder broken",
        "received_at":"2026-07-28T07:42:00Z"}}}'

# 5. Dispatch asks "who hasn't acknowledged?"
curl -s "$PUBLIC_BASE_URL/board/job-1187" | jq '{totals, replies}'

# 6. Crash-resume proof — kill the worker mid-flow, then replay any event.
#    The next webhook re-activates the SAME actor (idFromName("job-1187")).
#    Board intact, no duplicate rows, duplicate events return {"applied":false}.

# 7. The unknown recipient's device finally reports
curl -s -X POST "$PUBLIC_BASE_URL/webhooks/messaging" \
  -H 'content-type: application/json' \
  -d '{"data":{"event_type":"message.finalized","payload":{
        "group_message_id":"<group_message_id from step 1>",
        "to":[{"phone_number":"+12025550106"}],
        "status":"delivered",
        "occurred_at":"2026-07-28T08:15:00Z"}}}'
# → dispatch receives: "Job job-1187: all 6 accounted for — 6 delivered, 0 failed, 0 unknown"
```

In `DEMO_MODE=true` the group send is simulated (`demo-gm-<uuid>`) and unsigned webhooks are accepted with a console warning. Set `DEMO_MODE=false` with real credentials and a registered `PUBLIC_BASE_URL/webhooks/messaging` endpoint to run the live path.

## API Reference

### `POST /cast`

Creates (or re-enters) the actor for a job and sends the group MMS.

**Request body**

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `job_id` | `string` | yes | 1–64 chars of `[A-Za-z0-9_-]`. Becomes the actor name via `idFromName(job_id)`. |
| `recipients` | `string[]` | no | 1–8 unique US/CA E.164 numbers. Falls back to `CREW_TO_1..6` when omitted. |
| `text` | `string` | yes | Message body. |
| `media_url` | `string` | no | Must be `https://`. Sent as `media_urls: [media_url]`. |

**Responses**

| Status | Body | When |
|--------|------|------|
| `200` | `BoardReport` + `webhook_url` | Cast succeeded, or the job was already cast (idempotent — returns the existing board). |
| `400` | `{ "error": "..." }` | Invalid JSON, bad `job_id`, 0 or >8 recipients, non-E.164 number, duplicate recipient, missing `text`, non-https `media_url`. |
| `500` | `{ "error": "..." }` | `CREW_FROM` not E.164, or `CREW_PROFILE_ID` missing in live mode. |

### `POST /webhooks/messaging`

Telnyx webhook receiver. Verifies the Ed25519 signature over `${telnyx-timestamp}|${rawBody}` with a 300-second clock-skew window, then routes by event type.

| Event | Routing key | Actor call |
|-------|-------------|------------|
| `message.finalized` | `CREW_INDEX.get("group:" + group_message_id)` | `onFinalized({ group_message_id, phone_number, status, occurred_at })` |
| `message.received` | `?cast_id=` override, else `CREW_INDEX.get("thread:" + to[0].phone_number)` | `onReply({ id, from, text, cc[], occurred_at })` |

| Status | Body | When |
|--------|------|------|
| `200` | `{ "applied": true }` | Event folded into the board. |
| `200` | `{ "applied": false, "reason": "duplicate" \| "already_terminal" \| "recipient_not_on_roster" \| "unknown_group_message_id" }` | Replay or stale event — acknowledged so Telnyx stops retrying. |
| `200` | `{ "received": true, "routed": false }` | No actor owns this thread yet. |
| `400` | `{ "error": "..." }` | Missing `group_message_id`, non-E.164 `to[0].phone_number`, or malformed payload. |
| `401` | `{ "error": "invalid_signature" }` | Signature missing, stale, or wrong (live mode only). |

### `GET /board/:cast_id` and `GET /board?cast_id=`

Answers dispatch's poll straight from actor state. No Telnyx API call.

```json
{
  "cast_id": "job-1187",
  "job_id": "job-1187",
  "group_message_id": "gm-...",
  "from": "+12025550100",
  "text": "Job 1187 — roof photo attached...",
  "media_url": "https://example.com/roof-1187.jpg",
  "recipients": [
    { "number": "+12025550101", "carrier": "telnyx", "line_type": "mobile",
      "status": "delivered", "acked_at": null, "finalized_at": "2026-07-28T07:31:04Z" },
    { "number": "+12025550103", "carrier": "telnyx", "line_type": "mobile",
      "status": "delivered", "acked_at": "2026-07-28T07:42:00Z", "finalized_at": "2026-07-28T07:31:09Z" },
    { "number": "+12025550106", "carrier": null, "line_type": null,
      "status": "unknown", "acked_at": null, "finalized_at": "2026-07-28T07:31:22Z" }
  ],
  "replies": [
    { "id": "msg-0001", "from": "+12025550103", "text": "on site, east ladder broken",
      "at": "2026-07-28T07:42:00Z", "cc": ["+12025550101", "+12025550102", "..."] }
  ],
  "totals": { "recipients": 6, "queued": 0, "delivered": 5, "sending_failed": 0,
              "delivery_failed": 0, "unknown": 1, "acked": 1, "silent": 5 },
  "repolls": 0,
  "dispatch_notified": false,
  "sql_summary": [ { "status": "delivered", "total": 5, "acked": 1 },
                   { "status": "unknown",   "total": 1, "acked": 0 } ],
  "updated_at": "2026-07-28T07:42:00Z"
}
```

**Board status mapping**

| Status | Meaning | Terminal? |
|--------|---------|-----------|
| `queued` | Accepted by Telnyx, no carrier report yet. | no |
| `delivered` | Handset confirmed. | yes |
| `sending_failed` | Telnyx could not hand the message to the carrier. | yes |
| `delivery_failed` | Carrier reported a genuine delivery failure. | yes |
| `unknown` | **Non-Telnyx recipient** — handset confirmation unavailable. Provisional; a later `message.finalized` may upgrade it. | no |

`acked_at` is orthogonal to delivery status: it is set when that recipient's `message.received` reply lands. `totals.silent = recipients − acked`.

### Scheduled task: `repollUnknown`

`this.schedule(1800, "repollUnknown")` fires 30 minutes after a cast or reply. It counts recipients still `queued`/`unknown`, increments `repolls`, and — if anything is still pending and `repolls < 2` — schedules exactly one follow-up check. The timer's job is to *review, report, and keep the question alive*; actual resolution comes from a late `message.finalized` event re-activating the actor.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| `400 recipients must contain 1-8 US/CA E.164 numbers` | More than 8 numbers, or a non-`+1` destination. | Group MMS caps at 8 and is US/CA only. Split the crew into two casts. |
| `400 every recipient must be a US/CA E.164 number` | Number missing `+1`, or a test string like `+1555XXXXXXX`. | Use real E.164 format: `+1` + 10 digits, area code starting 2–9. |
| `403` from the group send | Messaging profile is not MMS-capable for that destination, or is on v1 webhooks. | Enable MMS on the profile and set webhook API version to `2`. |
| `401 invalid_signature` on every webhook | `TELNYX_PUBLIC_KEY` missing or wrong, or the body was re-serialized before verification. | Set the secret via `telnyx-edge secrets add TELNYX_PUBLIC_KEY "..."`. Verify against the **raw** body, not a parsed object. |
| Webhook returns `{"received":true,"routed":false}` | The KV index has no entry for that `group_message_id` or crew number — usually a webhook arriving before `POST /cast` finished. | Replay the event; the index is written immediately after the send response. |
| Board shows `unknown` forever | Recipient is on a non-Telnyx carrier — handset confirmation is genuinely unavailable. | Expected. The 30-minute re-poll keeps the question alive; a late `message.finalized` will upgrade it. |
| Duplicate finalized events do nothing | Working as designed. | `{"applied":false,"reason":"duplicate"}` is the idempotency guard. `200` is returned so Telnyx stops retrying. |
| Dispatch never gets the summary SMS | `DISPATCH_PHONE` is not valid E.164, or at least one recipient is still `queued`. | The notification fires only when every recipient is terminal. Check the console warning for the skipped number. |
| `CREW_PROFILE_ID is required in live mode` | `DEMO_MODE=false` without a profile id. | Set `CREW_PROFILE_ID`, or leave `DEMO_MODE=true` for the local demo. |
| Actor state looks empty after a deploy | The actor name changed — `idFromName` is keyed on `job_id`. | Reuse the same `job_id` to re-enter the same actor. |

## Agent Discovery

- Agent signup and capability manifest: <https://telnyx.com/agent-signup.md>
- Telnyx AI + agent examples: <https://github.com/team-telnyx/ai>
- Machine-readable docs index: <https://developers.telnyx.com/llms.txt>

## Related Examples

- [`edge-customer-agent-typescript`](../edge-customer-agent-typescript) — the `Agent` + plain-fetch router pattern this sample follows.
- [`edge-cron-scheduler`](../edge-cron-scheduler) — `this.schedule()` / `this.every()` task dispatch on Edge actors.
- [`edge-kv-webhook-router`](../edge-kv-webhook-router) — KV-indexed webhook routing to `idFromName` actors.
- [`sms-send-and-receive`](../sms-send-and-receive) — the one-to-one SMS baseline this sample extends to groups.
- [`messaging-webhook-verification`](../messaging-webhook-verification) — Ed25519 signature verification with WebCrypto.

## Resources

- [Group messaging guide](https://developers.telnyx.com/docs/messaging/messages/group-messaging) — the 8-recipient cap, US/CA constraint, `group_message_id` correlation, and the `unknown` status for non-Telnyx recipients.
- [Messaging API reference](https://developers.telnyx.com/api-reference/messages/send-a-group-mms-message) — `POST /v2/messages/group_mms` request and response shapes.
- [Agent SDK / Edge runtime](https://developers.telnyx.com/docs/agent-sdk/harness-sdk) — `Agent`, `getState`/`setState`, `schedule`, and env bindings.
- [Telnyx Messaging product page](https://telnyx.com/products/messaging)
- [Telnyx pricing](https://telnyx.com/pricing/messaging)
