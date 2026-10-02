# API Reference — Order Status Self-Service

This document describes the HTTP endpoints exposed by the `order-status-self-service` Edge function. All routes are handled by the default `fetch` export in `src/index.ts`, which routes incoming requests to the appropriate `OrderAgent` method via the `CUSTOMERS` actor namespace (`env.CUSTOMERS.idFromName(customerE164)` — one durable actor per customer E.164).

## Routes

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/rpc/linkOrder` | Storefront RPC — links a customer's order to their durable actor |
| `POST` | `/webhook/carrier` | Carrier status webhook (`shipped` / `delayed` / `delivered`) |
| `POST` | `/webhook/inbound` | Telnyx `message.received` (inbound-message) callback |
| `GET` | `/health` | Health check |

---

## POST /rpc/linkOrder

Links a customer's order to their durable `OrderAgent`. This is where the actor is born: the fetch handler resolves `env.CUSTOMERS.idFromName(customerE164)` and invokes `linkOrder` on the stub, so the durable entity self-provisions on demand.

**Query:** `?customer=%2B15551234567` (URL-encoded E.164)

**Request:**
```json
{
  "orderId": "ORD-1001",
  "carrier": "medship"
}
```

**Response (200):**
```json
{
  "ok": true,
  "orderId": "ORD-1001",
  "customer": "+15551234567"
}
```

**Response (400):**
```json
{ "error": "customer (E.164 in ?customer= or body) and orderId are required" }
```

**Side effects:** the actor's per-actor SQL table is created (`orders(order_id, customer, status, eta, ts)`) and the order is inserted with status `pending`; a `system` note is appended to the MessageLog.

---

## POST /webhook/carrier

Carrier status webhook. Updates the durable `orders` SQL, then either sends a proactive status SMS immediately (`shipped` / `delivered`) or wakes the actor with a scheduled task (`delayed` → `notifyDelay`).

**Query:** `?customer=%2B15551234567` (URL-encoded E.164; may also be in the body)

**Request:**
```json
{
  "kind": "delayed",
  "orderId": "ORD-1001",
  "customer": "+15551234567",
  "eta": "Fri",
  "ts": 1767484800000,
  "reason": "weather hold"
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `kind` | `string` | yes | `shipped`, `delayed`, or `delivered` |
| `orderId` | `string` | yes | Order identifier |
| `customer` | `string` | yes | Customer E.164 (actor key) |
| `eta` | `string` | no | Delivery estimate, e.g. `"Tue"` |
| `ts` | `number` | yes | Event timestamp (ms) — redelivered webhooks carry the same `ts` |
| `reason` | `string` | no | Delay reason |

**Response (200):**
```json
{ "ok": true, "duplicate": false }
```

`duplicate: true` means the event was already recorded (same `status` + `ts`) and no SMS was sent — the redelivery idempotency guard.

**Behavior:**
- `shipped` → immediate SMS: `Your order ORD-1001 is on the way — out for delivery Tue.`
- `delivered` → immediate SMS: `Your order ORD-1001 was delivered. Thanks for shopping with us!`
- `delayed` → `this.schedule(0, "notifyDelay", { event, opts }, { id: "delay:<orderId>" })` — the actor wakes itself and texts `Heads up — your order ORD-1001 is delayed to Fri: weather hold. We're on it.`

---

## POST /webhook/inbound

Telnyx `message.received` (inbound-message) callback. Parses the real Telnyx payload shape and routes the customer's text to their actor.

**Request (Telnyx webhook body):**
```json
{
  "data": {
    "event_type": "message.received",
    "payload": {
      "from": { "phone_number": "+15551234567" },
      "to": [{ "phone_number": "+16282564655" }],
      "text": "where's my order?"
    }
  }
}
```

**Response (200):**
```json
{
  "ok": true,
  "answer": "On the way — out for delivery, ETA Tue. (Order ORD-1001)"
}
```

**Response (400):**
```json
{ "error": "unexpected event_type" }
```

**Behavior:** `onInboundMessage` appends the inbound text to the actor's MessageLog, loads the customer's order rows from per-actor SQL (newest first), builds a one-line plain-language answer, appends the reply to the MessageLog, and sends it via `this.env.TELNYX.messages.send()`.

The follow-up question ("will it make it by Friday?") is answered from the durable order state **plus the persisted thread** — the actor already knows the customer and their order, so there is no re-identification.

---

## GET /health

**Response (200):**
```json
{ "status": "ok", "agent": "OrderAgent" }
```

---

## Actor state & storage

| Store | Schema | Purpose |
|---|---|---|
| Per-actor SQL (`this.ctx.storage.sql`) | `orders(order_id TEXT PRIMARY KEY, customer TEXT NOT NULL, status TEXT NOT NULL, eta TEXT NOT NULL DEFAULT '', ts INTEGER NOT NULL)` | Durable order state — survives eviction, reboot, and webhook redelivery |
| Agent state (`CustomerState`) | `{ customer, linked: string[], lastNotified: string \| null }` | Actor identity + linked orders + exactly-once delay guard |
| MessageLog (`this.messages`) | Append-only thread of `system` / `user` / `assistant` messages | The durable SMS thread — follow-ups resolve without re-identification |

## Actor methods

| Method | Invocation | Description |
|---|---|---|
| `linkOrder(customerE164, orderId, carrier)` | `stub.linkOrder(...)` from `/rpc/linkOrder` | Born actor: sets identity, links the order, initializes SQL |
| `onCarrier(event, opts)` | `stub.onCarrier(...)` from `/webhook/carrier` | SQL upsert + proactive text or scheduled delay wake; idempotent on redelivery |
| `onInboundMessage(msg, opts)` | `stub.onInboundMessage(...)` from `/webhook/inbound` | Q&A from durable state + MessageLog thread |
| `notifyDelay(payload)` | `this.schedule(0, "notifyDelay", ...)` dispatch | Proactive delay SMS; exactly-once via `lastNotified` + stable schedule id |

## Security notes

- The `[telnyx]` binding is zero-credential: API auth is injected at the platform level; no keys live in the sample.
- `DEMO_MODE`/`TELNYX_SMS_FROM_NUMBER`/`AI_MODEL` ship as `[[secrets]]` bindings in `telnyx.toml` and are read by the agent via `readConfig()` (`SECRETS.get()` with a plain env-var fallback) — the Edge runtime does not inject `[env_vars]` for actor projects.
- Carrier webhooks are not authenticated in this sample — validate the sender (allowlist / shared secret) before production use. Telnyx webhooks are Ed25519-signed; server-side examples in this repo verify them with `client.webhooks.unwrap`.
