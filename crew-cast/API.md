# API Reference — crew-cast

Typed contract for the `crew-cast` Edge worker (`src/index.ts`). All routes return `application/json`. All phone numbers are US/CA E.164 (`+1[2-9]\d{9}`).

Base URL: `PUBLIC_BASE_URL` (live) or `http://localhost:8787` (local shim).

---

## Route index

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/cast` | Create the crew thread and send the group MMS |
| `POST` | `/webhooks/messaging` | Telnyx messaging webhook receiver (`message.finalized`, `message.received`) |
| `GET` | `/board/:cast_id` | Delivery scoreboard for one crew thread |
| `GET` | `/board?cast_id=<id>` | Same as above, query-string form |

Actor-internal routes (`CrewCast.fetch`, reachable only through the `CREW_CAST` binding) are documented in [Actor-internal surface](#actor-internal-surface).

---

## POST /cast

Creates the durable `CrewCast` actor for `job_id` (via `idFromName(job_id)`), persists the roster **before** the send, then issues the group MMS and records `group_message_id` from the response. Idempotent: a second call for an already-cast job returns the existing board without re-sending.

### Request body

| Field | Type | Required | Description |
|---|---|---|---|
| `job_id` | `string` | Yes | Thread identifier. 1–64 chars of `[A-Za-z0-9_-]`. Also the actor name and `cast_id`. |
| `recipients` | `string[]` | No | 1–8 unique US/CA E.164 numbers. Omit to use the demo roster from `CREW_TO_1`…`CREW_TO_6`. |
| `text` | `string` | Yes | Message body. Trimmed; must be non-empty. |
| `media_url` | `string \| null` | No | Single public image URL. Must start with `https://`. Sent as `media_urls: [media_url]`. |

### Example request

```bash
curl -s -X POST "$PUBLIC_BASE_URL/cast" \
  -H 'content-type: application/json' \
  -d '{
    "job_id": "job-1187",
    "recipients": [
      "+15550000001", "+15550000002", "+15550000003",
      "+15550000004", "+15550000005", "+15550000006"
    ],
    "text": "Job 1187 — roof tear-off starts 07:30. Photo attached. Reply ON SITE when you roll in.",
    "media_url": "https://example.com/roof-1187.jpg"
  }'
```

### Response — `200 OK`

Returns the full board plus the webhook URL to register on the messaging profile.

```json
{
  "cast_id": "job-1187",
  "job_id": "job-1187",
  "group_message_id": "demo-gm-3f1c9a2e-...",
  "from": "+15550000000",
  "text": "Job 1187 — roof tear-off starts 07:30. ...",
  "media_url": "https://example.com/roof-1187.jpg",
  "recipients": [
    {
      "number": "+15550000001",
      "carrier": "demo",
      "line_type": "mobile",
      "status": "queued",
      "acked_at": null,
      "finalized_at": null
    }
  ],
  "replies": [],
  "totals": {
    "recipients": 6,
    "queued": 6,
    "delivered": 0,
    "sending_failed": 0,
    "delivery_failed": 0,
    "unknown": 0,
    "acked": 0,
    "silent": 6
  },
  "repolls": 0,
  "dispatch_notified": false,
  "sql_summary": [{ "status": "queued", "total": 6, "acked": 0 }],
  "updated_at": "2026-07-28T07:12:04.881Z",
  "webhook_url": "https://your-host.example.com/webhooks/messaging"
}
```

### Status codes

| Code | Condition | Body |
|---|---|---|
| `200` | Cast accepted (or already cast — idempotent replay) | `BoardReport` + `webhook_url` |
| `400` | Invalid JSON; bad `job_id`; empty/oversized/duplicate/non-E.164 `recipients`; missing `text`; non-`https` `media_url` | `{"error": "<message>"}` |
| `500` | `CREW_FROM` not E.164; `CREW_PROFILE_ID` missing in live mode; group send failed | `{"error": "<message>"}` or `{"error":"internal_error"}` |

---

## POST /webhooks/messaging

Telnyx messaging webhook receiver. Verifies the Ed25519 signature over `${telnyx-timestamp}|${rawBody}` using `TELNYX_PUBLIC_KEY` from `SECRETS`, rejects timestamps skewed more than 300 seconds, then routes the event to the owning actor.

### Headers

| Header | Required | Description |
|---|---|---|
| `telnyx-signature-ed25519` | Yes (live) | Base64 Ed25519 signature. |
| `telnyx-timestamp` | Yes (live) | Unix seconds. Must be within ±300s of server time. |
| `content-type` | Yes | `application/json`. |

In `DEMO_MODE=true` with no `TELNYX_PUBLIC_KEY` configured, signature verification is skipped with a warning so fixtures can be replayed locally. With `DEMO_MODE=false`, a missing key or bad signature returns `401`.

### Query parameters

| Param | Type | Required | Description |
|---|---|---|---|
| `cast_id` | `string` | No | Forces routing for `message.received` events. Overrides the KV `thread:<crew number>` lookup. |

### Event envelope (`message.finalized`)

| Field | Type | Required | Description |
|---|---|---|---|
| `data.event_type` | `string` | Yes | `"message.finalized"` |
| `data.payload.group_message_id` | `string` | Yes | Join key back to the cast. Resolved via KV `group:<id>`. |
| `data.payload.to[0].phone_number` | `string` | Yes | The recipient this finalization belongs to. |
| `data.payload.status` | `string` | Yes | `delivered` \| `sending_failed` \| `delivery_failed` \| `unknown` \| `queued`. Anything unrecognized normalizes to `unknown`. |
| `data.payload.occurred_at` | `string` | No | ISO-8601. Defaults to server time. |

### Event envelope (`message.received`)

| Field | Type | Required | Description |
|---|---|---|---|
| `data.event_type` | `string` | Yes | `"message.received"` |
| `data.payload.from.phone_number` | `string` | Yes | The crew member replying. Marked `acked_at`. |
| `data.payload.to[0].phone_number` | `string` | No | The crew number; used for the KV `thread:` lookup when `?cast_id=` is absent. |
| `data.payload.cc` | `array` | No | All other participants. Entries may be `{phone_number}` objects or bare strings; non-E.164 values are dropped. Used to backfill the roster on the **first** reply only. |
| `data.payload.text` | `string` | No | Reply body. |
| `data.payload.id` | `string` | No | Webhook id — the reply dedup key. Falls back to `from:received_at:text`. |
| `data.payload.received_at` | `string` | No | ISO-8601. Defaults to server time. |

### Example request — finalization

```bash
curl -s -X POST "$PUBLIC_BASE_URL/webhooks/messaging" \
  -H 'content-type: application/json' \
  -H "telnyx-timestamp: $(date +%s)" \
  -H 'telnyx-signature-ed25519: <base64-signature>' \
  -d '{
    "data": {
      "event_type": "message.finalized",
      "payload": {
        "group_message_id": "demo-gm-3f1c9a2e-...",
        "to": [{ "phone_number": "+15550000004", "status": "unknown" }],
        "status": "unknown",
        "occurred_at": "2026-07-28T07:14:11.000Z"
      }
    }
  }'
```

### Example request — inbound reply

```bash
curl -s -X POST "$PUBLIC_BASE_URL/webhooks/messaging?cast_id=job-1187" \
  -H 'content-type: application/json' \
  -H "telnyx-timestamp: $(date +%s)" \
  -H 'telnyx-signature-ed25519: <base64-signature>' \
  -d '{
    "data": {
      "event_type": "message.received",
      "payload": {
        "id": "evt_01J8Z9K2",
        "from": { "phone_number": "+15550000002" },
        "to": [{ "phone_number": "+15550000000" }],
        "cc": [
          { "phone_number": "+15550000001" }, { "phone_number": "+15550000003" },
          { "phone_number": "+15550000004" }, { "phone_number": "+15550000005" },
          { "phone_number": "+15550000006" }
        ],
        "text": "on site, east ladder broken",
        "received_at": "2026-07-28T07:42:00.000Z"
      }
    }
  }'
```

### Response — `200 OK`

| Shape | When |
|---|---|
| `{"applied": true}` | Finalization or reply folded into the board. |
| `{"applied": false, "reason": "duplicate"}` | Same `(group_message_id, recipient)` with an identical status, or a replayed reply `id`. Acked `200` to stop Telnyx retries. |
| `{"applied": false, "reason": "already_terminal"}` | Recipient already in `delivered` / `sending_failed` / `delivery_failed`. |
| `{"applied": false, "reason": "unknown_group_message_id"}` | `group_message_id` does not match the actor's recorded id. |
| `{"applied": false, "reason": "recipient_not_on_roster"}` | Number is not on the persisted roster. |
| `{"received": true, "routed": false}` | No KV index entry for the group id or crew number — event accepted but not folded. |
| `{"received": true, "ignored": "<event_type>"}` | Event type not handled by this sample. |

### Status codes

| Code | Condition | Body |
|---|---|---|
| `200` | Event accepted, applied, deduped, or intentionally ignored | See table above |
| `400` | Invalid JSON; missing `data.payload`; missing `group_message_id`; missing/invalid `to[0].phone_number` or `from.phone_number` | `{"error": "<message>"}` |
| `401` | Signature missing, malformed, stale (>300s), or verification failed | `{"error": "invalid_signature"}` |
| `500` | Unhandled actor or storage error | `{"error": "internal_error"}` |

---

## GET /board/:cast_id

Returns the delivery scoreboard for one crew thread, read straight from actor state. `cast_id` is the `job_id` used at cast time.

### Path parameters

| Param | Type | Required | Description |
|---|---|---|---|
| `cast_id` | `string` | Yes | 1–64 chars of `[A-Za-z0-9_-]`. URL-decoded before validation. |

### Example request

```bash
curl -s "$PUBLIC_BASE_URL/board/job-1187"
```

### Response — `200 OK`

`BoardReport`:

| Field | Type | Description |
|---|---|---|
| `cast_id` | `string` | Thread id. |
| `job_id` | `string` | Job id supplied at cast time. |
| `group_message_id` | `string \| null` | `data.id` from the group MMS response. `null` before the send completes. |
| `from` | `string` | The crew (sending) number. |
| `text` | `string` | Original message body. |
| `media_url` | `string \| null` | Original media URL. |
| `recipients` | `Recipient[]` | One row per recipient, in roster order. |
| `replies` | `Reply[]` | Inbound replies, oldest first. |
| `totals` | `object` | Counts: `recipients`, `queued`, `delivered`, `sending_failed`, `delivery_failed`, `unknown`, `acked`, `silent`. `silent = recipients - acked`. |
| `repolls` | `number` | How many 30-minute re-polls have fired (max 2). |
| `dispatch_notified` | `boolean` | `true` once the "all accounted for" SMS to `DISPATCH_PHONE` has been sent. |
| `sql_summary` | `StatusCount[]` | `GROUP BY status` rollup from the `CREW_DB` `crew_delivery` table: `{status, total, acked}`. |
| `updated_at` | `string` | ISO-8601 of the last state mutation. |

**`Recipient`**

| Field | Type | Description |
|---|---|---|
| `number` | `string` | E.164 recipient. |
| `carrier` | `string \| null` | From the group-send response `data.to[]`. |
| `line_type` | `string \| null` | From the group-send response `data.to[]`. |
| `status` | `BoardStatus` | See [Board status values](#board-status-values). |
| `acked_at` | `string \| null` | ISO-8601 of the recipient's first inbound reply. |
| `finalized_at` | `string \| null` | ISO-8601 of the applied `message.finalized`. |

**`Reply`**

| Field | Type | Description |
|---|---|---|
| `id` | `string` | Webhook id — the dedup key. |
| `from` | `string` | Replying number. |
| `text` | `string` | Reply body. |
| `at` | `string` | ISO-8601. |
| `cc` | `string[]` | The roster carried on the inbound reply. |

```json
{
  "cast_id": "job-1187",
  "job_id": "job-1187",
  "group_message_id": "demo-gm-3f1c9a2e-...",
  "from": "+15550000000",
  "text": "Job 1187 — roof tear-off starts 07:30. ...",
  "media_url": "https://example.com/roof-1187.jpg",
  "recipients": [
    { "number": "+15550000001", "carrier": "demo", "line_type": "mobile", "status": "delivered", "acked_at": null, "finalized_at": "2026-07-28T07:13:02.000Z" },
    { "number": "+15550000002", "carrier": "demo", "line_type": "mobile", "status": "delivered", "acked_at": "2026-07-28T07:42:00.000Z", "finalized_at": "2026-07-28T07:13:05.000Z" },
    { "number": "+15550000004", "carrier": null, "line_type": null, "status": "unknown", "acked_at": null, "finalized_at": "2026-07-28T07:14:11.000Z" }
  ],
  "replies": [
    { "id": "evt_01J8Z9K2", "from": "+15550000002", "text": "on site, east ladder broken", "at": "2026-07-28T07:42:00.000Z", "cc": ["+15550000001", "+15550000003", "+15550000004", "+15550000005", "+15550000006"] }
  ],
  "totals": { "recipients": 6, "queued": 0, "delivered": 5, "sending_failed": 0, "delivery_failed": 0, "unknown": 1, "acked": 1, "silent": 5 },
  "repolls": 1,
  "dispatch_notified": false,
  "sql_summary": [
    { "status": "delivered", "total": 5, "acked": 1 },
    { "status": "unknown", "total": 1, "acked": 0 }
  ],
  "updated_at": "2026-07-28T07:42:00.412Z"
}
```

### Status codes

| Code | Condition | Body |
|---|---|---|
| `200` | Board returned (an unknown `cast_id` returns an empty board, not `404`) | `BoardReport` |
| `400` | `cast_id` missing or fails `[A-Za-z0-9_-]{1,64}` | `{"error": "cast_id required (1-64 chars of [A-Za-z0-9_-])"}` |
| `500` | Unhandled actor or SQL error | `{"error": "internal_error"}` |

---

## GET /board?cast_id=<id>

Identical contract to `GET /board/:cast_id`; the id is read from the query string instead of the path.

```bash
curl -s "$PUBLIC_BASE_URL/board?cast_id=job-1187"
```

Same `200` / `400` / `500` semantics as above.

---

## Board status values

| Status | Terminal | Meaning |
|---|---|---|
| `queued` | No | Seeded from the group-send response; no finalization yet. |
| `delivered` | Yes | Handset confirmed. |
| `sending_failed` | Yes | Telnyx could not hand the message to the carrier. |
| `delivery_failed` | Yes | Carrier rejected after handoff. |
| `unknown` | No (provisional) | Non-Telnyx recipient — handset confirmation unavailable. A later `message.finalized` may upgrade it to `delivered` / `sending_failed` / `delivery_failed`. |

`unknown` and the two failure statuses are rendered as distinct rows in `recipients[]` and counted separately in `totals`.

---

## Idempotency and replay rules

| Event | Dedup key | Behavior on replay |
|---|---|---|
| `message.finalized` | `(group_message_id, recipient)` | Identical status → `{"applied": false, "reason": "duplicate"}`. Recipient already terminal → `already_terminal`. Both ack `200`. |
| `message.received` | `data.payload.id` (fallback `from:received_at:text`) | `{"applied": false, "reason": "duplicate"}`; ack `200`. |
| `POST /cast` | `job_id` | Existing `group_message_id` short-circuits the send and returns the current board. |

The actor processes events serially per instance, so a `kill -9` mid-flow followed by a replayed webhook re-activates the same actor with the board intact and no duplicate rows.

---

## Actor-internal surface

`CrewCast` (`src/index.ts`) exposes these routes on its own `fetch` handler. They are reachable only through the `CREW_CAST` binding — `env.CREW_CAST.get(env.CREW_CAST.idFromName(castId))` — and are not part of the public HTTP surface.

| Method | Path | Body | Returns |
|---|---|---|---|
| `POST` | `/cast` | `CastInput` | `BoardReport` |
| `POST` | `/finalized` | `FinalizedEvent` | `{applied, reason?}` |
| `POST` | `/reply` | `ReplyEvent` | `{applied, reason?}` |
| `POST` | `/repoll` | — | `{ok: true}` |
| `GET` | `/board` | — | `BoardReport` |

### Scheduled task

`this.schedule(1800, "repollUnknown")` fires 30 minutes after the first unresolved state. `repollUnknown()` counts recipients still `queued`/`unknown`, increments `repolls`, and reschedules once more while `pending > 0 && repolls < 2`. It never sends messages — resolution comes from late `message.finalized` events landing on the actor.

### Dispatch notification

When no recipient is `queued` and the `delivered/failed/unknown` signature differs from `notified_signature`, the actor sends one 1:1 SMS to `DISPATCH_PHONE`:

```
Job {job_id}: all {n} accounted for — {delivered} delivered, {failed} failed, {unknown} unknown
```

Skipped silently if `DISPATCH_PHONE` is not valid E.164. No webhook callback is registered.

---

## Error reference

| Code | Meaning | Typical cause |
|---|---|---|
| `200` | Success | — |
| `400` | Bad request | Malformed JSON, `job_id` charset/length, >8 recipients, duplicate recipients, non-E.164 number, empty `text`, non-`https` `media_url`, missing webhook payload fields |
| `401` | Unauthorized webhook | Missing/stale/invalid `telnyx-signature-ed25519`, or `TELNYX_PUBLIC_KEY` unset with `DEMO_MODE=false` |
| `404` | Not found | Path is not `/cast`, `/webhooks/messaging`, or `/board*` |
| `500` | Server error | `CREW_FROM` not E.164, `CREW_PROFILE_ID` missing in live mode, group send rejected, SQL/storage failure |

Upstream Telnyx error paths surfaced through `POST /cast`:

| Upstream | Cause |
|---|---|
| `400` | Recipient list exceeds 8, or mixes protocols |
| `403` | Messaging profile is not MMS-capable for a destination |

Both are returned to the caller as `500 {"error":"internal_error"}` after being logged; the underlying Telnyx message is never echoed to the client.
