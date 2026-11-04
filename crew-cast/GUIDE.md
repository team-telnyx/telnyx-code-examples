# Crew Cast — The Crew Board

A walkthrough of `crew-cast`, a Telnyx Edge sample that turns a single group MMS into a durable, self-updating delivery scoreboard. One dispatcher casts a photo-and-instructions message to six field technicians; the actor becomes the thread's memory — tracking every recipient's delivery state, folding inbound replies into one board, and answering "who has acknowledged?" all afternoon.

This guide explains how the code works, how to run it in safe demo mode, and how to flip it to the live Telnyx path.

---

## What you'll build

A single Edge actor, `CrewCast`, that owns **one** group MMS thread:

- Sends a group MMS to up to 8 US/CA recipients (`POST /v2/messages/group_mms` via the `TELNYX` binding).
- Persists the roster **before** the send, then records the `group_message_id` from the response.
- Folds six separate `message.finalized` webhooks back onto one board, idempotently, keyed by `(group_message_id, recipient)`.
- Folds `message.received` replies — including the `cc` roster — into a reply log and marks the sender acknowledged.
- Answers dispatch's poll from state: delivered / failed / unknown / acknowledged / silent.
- Schedules a 30-minute re-poll for recipients still `unknown`.
- Notifies dispatch by 1:1 SMS once every recipient reaches a terminal state.
- Survives a worker restart mid-flow — the board is intact, no duplicate rows.

The actor is the load-bearing piece. Without it you get six half-written rows and an unknown-count nobody trusts.

---

## Prerequisites

- Node.js 20+
- The `telnyx-edge` CLI (`npm i -g @telnyx/edge-runtime-cli` or your team's install path)
- A Telnyx account with:
  - A messaging-capable number (`CREW_FROM`) whose messaging profile has **v2 webhooks** and **MMS** enabled
  - A dispatch number (`DISPATCH_PHONE`) to receive the completion SMS
  - A public HTTPS base URL for webhooks (`PUBLIC_BASE_URL`) — only needed in live mode
- Familiarity with TypeScript and the Edge runtime's actor model (helpful, not required)

---

## Environment setup

### 1. Install dependencies

```bash
npm install
```

### 2. Configure bindings in `telnyx.toml`

The sample declares four bindings:

| Binding | Kind | Purpose |
| --- | --- | --- |
| `CREW_CAST` | actor | The `CrewCast` durable entity |
| `CREW_INDEX` | KV | Maps `group_message_id` → `cast_id` and crew number → `cast_id` |
| `CREW_DB` | SQL | Backs the acknowledgement report on `/board` |
| `TELNYX` | Telnyx API | Zero-credential messaging binding |

```toml
name = "crew-cast"
main = "src/index.ts"
compatibility_date = "2026-07-28"

[[actors]]
binding = "CREW_CAST"
type    = "CrewCast"

[storage.kv.CREW_INDEX]
id = "<kv-namespace-uuid>"

[storage.sqldb.CREW_DB]
id = "<sqldb-id>"

[telnyx]
binding = "TELNYX"

[[secrets]]
binding = "TELNYX_API_KEY"
name    = "TELNYX_API_KEY"

[[secrets]]
binding = "TELNYX_PUBLIC_KEY"
name    = "TELNYX_PUBLIC_KEY"
```

### 3. Set secrets and env vars

```bash
telnyx-edge auth api-key set <YOUR_API_KEY>
telnyx-edge secrets add TELNYX_API_KEY "<YOUR_API_KEY>"
telnyx-edge secrets add TELNYX_PUBLIC_KEY "<YOUR_WEBHOOK_PUBLIC_KEY>"
```

Then set the plain env vars (see `.env.example` for the full list):

| Variable | Example | Notes |
| --- | --- | --- |
| `CREW_FROM` | `+1555XXXXXXX` | The Telnyx number that sends the group MMS |
| `CREW_PROFILE_ID` | `40017b...` | Messaging profile with v2 webhooks + MMS |
| `DISPATCH_PHONE` | `+1555XXXXXXX` | Receives the "all accounted for" SMS |
| `PUBLIC_BASE_URL` | `https://your-host.example` | Where Telnyx posts webhooks |
| `DEMO_MODE` | `true` | `true` = no API calls; `false` = live |
| `CREW_TO_1` … `CREW_TO_6` | `+1555XXXXXXX` | Demo roster (used when `/cast` omits `recipients`) |

### 4. Regenerate types

```bash
npm run types   # telnyx-edge types
```

---

## Demo mode vs live mode

`DEMO_MODE` defaults to **`true`**. In demo mode:

- `sendGroupMms()` **never calls the Telnyx API** — it returns a synthetic `group_message_id` (`demo-gm-<uuid>`) and marks every recipient `queued` with carrier `demo`.
- `sendSms()` logs the dispatch notification instead of sending it.
- Webhook signature verification is **skipped** if `TELNYX_PUBLIC_KEY` is unset (a warning is logged). This lets you replay fixture events locally.

To go live:

1. Set `DEMO_MODE=false`.
2. Provide real `TELNYX_API_KEY`, `TELNYX_PUBLIC_KEY`, `CREW_FROM`, `CREW_PROFILE_ID`, `DISPATCH_PHONE`, and `PUBLIC_BASE_URL`.
3. Point your messaging profile's webhook URL at `${PUBLIC_BASE_URL}/webhooks/messaging`.
4. Deploy with `telnyx-edge ship`.

In live mode, signature verification is **mandatory** — unsigned or stale (>5 min skew) webhooks are rejected with `401`.

---

## Walkthrough

The whole sample lives in `src/index.ts`. It's organized into four regions: **types**, **constants**, **helpers**, and the **actor + router**. We'll walk each in turn.

### 1. Types and state shape

Near the top of the file, the `CrewState` interface defines the durable board:

```ts
interface CrewState {
  cast_id: string; job_id: string; group_message_id: string | null;
  from: string; text: string; media_url: string | null;
  recipients: Recipient[]; replies: Reply[];
  roster_cursor: number; repolls: number;
  notified_signature: string | null;
  created_at: string; updated_at: string;
}
```

Each `Recipient` carries `number`, `carrier`, `line_type`, `status` (one of `queued | delivered | sending_failed | delivery_failed | unknown`), `acked_at`, and `finalized_at`. Each `Reply` carries the webhook `id` (for dedup), `from`, `text`, `at`, and the `cc` roster.

`BoardStatus` is the closed set of statuses the board renders. `HARD_TERMINAL` marks the three statuses that can't be overwritten by a later event.

### 2. Constants and helpers

The **constants** block encodes the documented Group MMS constraints:

- `MAX_RECIPIENTS = 8` — the Group MMS cap.
- `REPOLL_SECONDS = 1800` — the 30-minute re-poll interval.
- `MAX_REPOLLS = 2` — one follow-up re-poll, then stop.
- `E164_US_CA = /^\+1[2-9]\d{9}$/` — US/CA-only validation.

The **helpers** block has a few worth calling out:

- `maskPhone()` — never logs a full number.
- `isDemoMode()` — reads `DEMO_MODE`, defaulting to `true`.
- `normalizeStatus()` — coerces arbitrary webhook status strings into the closed `BoardStatus` set, defaulting to `unknown`.
- `verifySignature()` — Telnyx Ed25519 verification using WebCrypto. It imports the public key from `SECRETS`, checks the `telnyx-timestamp` skew (≤300s), and verifies the signature over `${timestamp}|${rawBody}`. In demo mode with no key set, it warns and returns `true`.

### 3. The actor: `class CrewCast extends Agent<Env, CrewState>`

This is the heart of the sample. `Agent` gives us `getState()`, `setState()`, and `schedule()` — plus a `fetch()` handler for internal RPC from the router.

#### `fetch()` — internal RPC surface

The actor's `fetch()` routes five internal paths:

| Path | Method | Handler |
| --- | --- | --- |
| `/cast` | POST | `cast()` |
| `/finalized` | POST | `onFinalized()` |
| `/reply` | POST | `onReply()` |
| `/repoll` | POST | `repollUnknown()` |
| `/board` | GET | `deliveryReport()` |

These are **not** public routes — the router in `src/index.ts` translates public HTTP requests into these internal calls via `env.CREW_CAST.idFromName(castId).fetch(...)`.

#### `cast()` — persist the roster, then send

The `cast()` method (roughly the first third of the actor class) does the critical ordering:

1. **Guard against re-cast** — if `state.group_message_id` is already set, return the existing board (idempotent).
2. **Persist the roster first** — build a `Recipient[]` with every number `queued`, then `setState()`.
3. **Send the group MMS** — call `sendGroupMms()` (demo or live).
4. **Seed the board from the response** — merge carrier/line_type/status from `data.to[]`.
5. **Record the `group_message_id`** — this is the join key for every future `message.finalized`.
6. **Write the KV indexes** — `group/<id>` → `cast_id` and `thread/<from>` → `cast_id`.
7. **Sync SQL rows** — `syncDeliveryRows()`.
8. **Return the board.**

Persisting the roster *before* the send is what makes the actor crash-safe: if the worker dies between the send and the response, the roster is already durable.

#### `sendGroupMms()` — demo vs live

In demo mode it returns a synthetic result. In live mode it calls the real binding:

```ts
const response = await this.env.TELNYX.messages.send({
  from: input.from,
  to: input.recipients,
  text: input.text,
  ...(input.media_url ? { media_urls: [input.media_url] } : {}),
});
const data = unwrap(response);
const id = typeof data.id === "string" ? data.id : "";
```

`data.id` **is** the `group_message_id`. `data.to[]` carries per-recipient `{ phone_number, status, carrier, line_type }` — the actor seeds the board from it.

#### `onFinalized()` — fold one recipient's delivery state

Each `message.finalized` webhook carries `to[0].phone_number` and `status` (the live payload carries no `group_message_id`). The method:

1. Rejects events whose `group_message_id` (when present) doesn't match the actor's.
2. Rejects recipients not on the roster.
3. **Idempotency check** — if the incoming status equals the current status, return `{ applied: false, reason: "duplicate" }`.
4. **Terminal check** — if the current status is in `HARD_TERMINAL`, return `{ applied: false, reason: "already_terminal" }`. This lets a provisional `unknown` upgrade to `delivered`, but never lets a `delivered` regress.
5. Updates the recipient, bumps `roster_cursor`, syncs SQL, and calls `maybeNotifyDispatch()`.

The router still returns `200` for duplicates so Telnyx stops retrying.

#### `onReply()` — fold `message.received` with the `cc` roster

Inbound replies carry `from.phone_number`, `text`, and a `cc` array listing every *other* participant. The method:

1. **Dedups by webhook `id`** — a retried reply folds into the same row.
2. **Backfills from `cc`** — on the *first* reply only, any `cc` number not already on the roster is added with status `unknown`. This recovers roster entries missed at cast time.
3. **Marks the replier acknowledged** — sets `acked_at` to the reply timestamp.
4. Appends the reply to `replies[]` and syncs SQL.

#### `deliveryReport()` — answer dispatch's poll

Builds the `BoardReport` returned by `GET /board/:cast_id`:

- Per-recipient rows (status, carrier, `acked_at`).
- `totals` — counts per status plus `acked` and `silent`.
- `repolls`, `dispatch_notified`.
- `sql_summary` — the acknowledgement report from `CREW_DB`.

#### `repollUnknown()` — the 30-minute review

Scheduled via `this.schedule(1800, "repollUnknown")`. It:

1. Counts recipients still `queued` or `unknown`.
2. Increments `repolls`.
3. If pending > 0 **and** `repolls < MAX_REPOLLS`, schedules one more 30-minute check.
4. Syncs SQL and returns `{ pending, repolls, rescheduled }`.

The schedule's job is to **review, report, and keep the question alive** — actual resolution comes from late `message.finalized` events landing on the actor (which reactivates it).

#### `maybeNotifyDispatch()` — the completion SMS

Fires when no recipient is still `queued`. It computes a signature `${delivered}/${failed}/${unknown}` and only sends if the signature changed (so a re-poll that resolves nothing doesn't spam dispatch). The message:

```
Job {job_id}: all {n} accounted for — {delivered} delivered, {failed} failed, {unknown} unknown
```

`sendSms()` validates `DISPATCH_PHONE` is E.164, masks it in logs, and in demo mode just logs.

#### `syncDeliveryRows()` and `acknowledgementReport()` — the SQL layer

`syncDeliveryRows()` lazily creates the `crew_delivery` table and upserts one row per recipient:

```sql
INSERT INTO crew_delivery (cast_id, job_id, phone_number, status, acked_at, updated_at)
VALUES (?, ?, ?, ?, ?, ?)
ON CONFLICT(cast_id, phone_number) DO UPDATE SET ...
```

`acknowledgementReport()` runs a parameterized `GROUP BY status` query to produce the `sql_summary` on the board. This is the "agent SQL" the ticket refers to — the Edge `SqlDatabase` binding, not a separate database.

### 4. The router: `src/index.ts` default export

The router is a plain `fetch` handler with three public routes.

#### `POST /cast` — `handleCast()`

Validates the request body:

- `job_id` — 1–64 chars of `[A-Za-z0-9_-]`.
- `recipients` — 1–8 unique US/CA E.164 numbers (falls back to `CREW_TO_1..6` if omitted).
- `text` — required, non-empty.
- `media_url` — optional, must be `https://`.
- `CREW_FROM` — must be E.164.
- `CREW_PROFILE_ID` — required in live mode.

Then it derives the actor id from `job_id`:

```ts
const stub = env.CREW_CAST.get(env.CREW_CAST.idFromName(jobId));
```

and forwards to the actor's `/cast` RPC. The response includes `webhook_url` so you can see where to point your messaging profile.

#### `POST /webhooks/messaging` — `handleWebhook()`

1. Reads the **raw body** (needed for signature verification).
2. Verifies the Ed25519 signature (or skips in demo mode with no key).
3. Parses the event and branches on `data.event_type`:

**`message.finalized`** — extracts `to[0].phone_number` and `status`, looks up `cast_id` via the `group/<id>` KV index (when the payload carries one) and falls back to the crew-number `thread/<CREW_FROM>` index, then forwards to the actor's `/finalized`. If both lookups miss, returns `{ received: true, routed: false }` with `200` (so Telnyx doesn't retry an event for an unknown thread).

**`message.received`** — extracts `from.phone_number`, resolves `cast_id` from `?cast_id=` or the KV `thread/<crewNumber>` index (segments sanitized — KV keys allow `[a-zA-Z0-9/_=.-]` only), normalizes the `cc` array, and forwards to the actor's `/reply`. Dedup key is `payload.id` (falling back to a composite of from/received_at/text).

Unknown event types return `200` with `{ ignored: type }`.

#### `GET /board/:cast_id` and `GET /board?cast_id=`

Both resolve the actor and return its `deliveryReport()`. The `cast_id` must match `[A-Za-z0-9_-]{1,64}`.

---

## Running the demo

### Start the worker

```bash
npm run deploy   # telnyx-edge ship
```

### 1. Cast the group MMS

```bash
curl -X POST https://your-host.example/cast \
  -H 'content-type: application/json' \
  -d '{
    "job_id": "job-1187",
    "text": "Roof inspection 7:30am — east ladder is broken, use the west access. Photo attached.",
    "media_url": "https://example.com/roof-photo.jpg"
  }'
```

In demo mode this returns a board with six `queued` recipients and a `demo-gm-<uuid>` group message id.

### 2. Poll the board

```bash
curl https://your-host.example/board/job-1187 | jq
```

### 3. Simulate a finalized event

```bash
curl -X POST https://your-host.example/webhooks/messaging \
  -H 'content-type: application/json' \
  -d '{
    "data": {
      "event_type": "message.finalized",
      "payload": {
        "group_message_id": "demo-gm-<uuid>",
        "to": [{ "phone_number": "+1555XXXXXXX" }],
        "status": "delivered",
        "occurred_at": "2026-07-28T07:41:00Z"
      }
    }
  }'
```

Repeat for each recipient. One of them should be a non-Telnyx number — send `"status": "unknown"` for it.

### 4. Simulate a reply

```bash
curl -X POST 'https://your-host.example/webhooks/messaging?cast_id=job-1187' \
  -H 'content-type: application/json' \
  -d '{
    "data": {
      "event_type": "message.received",
      "payload": {
        "id": "msg-abc123",
        "from": { "phone_number": "+1555XXXXXXX" },
        "to": [{ "phone_number": "+1555XXXXXXX" }],
        "text": "on site, east ladder broken",
        "cc": [{ "phone_number": "+1555XXXXXXX" }, { "phone_number": "+1555XXXXXXX" }],
        "received_at": "2026-07-28T07:42:00Z"
      }
    }
  }'
```

The board now shows one `acked_at` set and one reply in `replies[]`.

### 5. Crash-resume proof

Kill the worker mid-flow:

```bash
kill -9 <worker-pid>
```

Replay the next `message.finalized` webhook. The actor is re-activated by the webhook delivery — the board is intact, no duplicate rows, and the `roster_cursor` makes the replay idempotent.

### 6. Watch the re-poll fire

After 30 minutes, `repollUnknown()` runs, reviews any still-`unknown` recipients, and schedules one follow-up. When the unknown recipient's device finally reports, the actor updates the board and `maybeNotifyDispatch()` sends the completion SMS.

---

## Error paths to know

| Condition | Response |
| --- | --- |
| More than 8 recipients | `400` — `recipients must contain 1-8 US/CA E.164 numbers` |
| Non-E.164 or non-US/CA number | `400` — `every recipient must be a US/CA E.164 number` |
| Duplicate recipients | `400` — `recipients must be unique` |
| Missing `text` | `400` — `text is required` |
| Non-https `media_url` | `400` — `media_url must be an https URL` |
| Invalid `job_id` | `400` — `job_id must be 1-64 chars of [A-Za-z0-9_-]` |
| Missing `CREW_PROFILE_ID` in live mode | `500` — `CREW_PROFILE_ID is required in live mode` |
| Invalid webhook signature | `401` — `invalid_signature` |
| Unknown `group_message_id` | `200` — `{ received: true, routed: false }` |
| Duplicate `message.finalized` | `200` — `{ applied: false, reason: "duplicate" }` |
| Duplicate `message.received` | `200` — `{ applied: false, reason: "duplicate" }` |

The `sending_failed` and `delivery_failed` statuses are rendered **distinctly** from `unknown` on the board: `unknown` means a non-Telnyx recipient whose handset confirmation is unavailable; `failed` means a Telnyx recipient that genuinely failed.

---

## Next steps

- **Group messaging docs** — the source of truth for the 8-recipient cap, US/CA-only constraint, MMS-only protocol, and the `unknown` status for non-Telnyx recipients: [developers.telnyx.com/docs/messaging/messages/group-messaging](https://developers.telnyx.com/docs/messaging/messages/group-messaging)
- **Agent SDK / Edge runtime** — `Agent`, `getState`/`setState`, `schedule`, and the actor model: [developers.telnyx.com/docs/agent-sdk/harness-sdk](https://developers.telnyx.com/docs/agent-sdk/harness-sdk)
- **Messaging webhooks** — `message.finalized` and `message.received` payload shapes, plus Ed25519 signature verification: [developers.telnyx.com/docs/messaging/webhooks](https://developers.telnyx.com/docs/messaging/webhooks)
- **Messaging profiles** — enabling v2 webhooks and MMS on the sending number: [developers.telnyx.com/docs/messaging/messaging-profiles](https://developers.telnyx.com/docs/messaging/messaging-profiles)
- **Edge storage** — KV, SQL, and the `TELNYX` zero-credential binding: [developers.telnyx.com/docs/edge/storage](https://developers.telnyx.com/docs/edge/storage)

### Ideas to extend

- Add a `GET /board/:cast_id/export.csv` route that streams the SQL rows for a shift report.
- Swap the 30-minute re-poll for `this.every()` if you want a continuous heartbeat.
- Add a `POST /cast/:cast_id/close` route that cancels the schedule and freezes the board.
- Wire `message.received` replies into a second actor that summarizes the thread with `TELNYX.ai.openai.chat.createCompletion`.
