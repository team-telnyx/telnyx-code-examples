# Guide — Order Status Self-Service (Durable Actor)

A step-by-step walkthrough of DEV-1189: a durable `OrderAgent` per customer E.164 that answers "where's my order?" from its own SQL state, remembers the thread, and texts delays **before** the customer asks.

## Prerequisites

- Node.js 18+, npm
- Telnyx Edge CLI ([releases](https://github.com/team-telnyx/edge-compute/releases))
- A Telnyx account with an SMS-capable number (10DLC campaign required for US A2P traffic)

## 1. Local verification

```bash
cd order-status-self-service
npm install
npm run typecheck
npm test
```

Expected: `✅ smoke_test.ts: All checks passed`.

## 2. Provision and deploy

```bash
export TELNYX_API_KEY=your_telnyx_api_key_here

# Register the actor function (prints a func_id)
telnyx-edge new-func --actor -l ts -n order-status-self-service
# → copy the printed func_id into telnyx.toml [edge_compute]

# Ship (~5-10 min: upload, build, deploy)
telnyx-edge ship
# → note the deployed URL: https://<your-function>.telnyxcompute.com

# Point the messaging profile's inbound webhook at the deployed function:
#   inbound-message callback → https://<your-function>.telnyxcompute.com/webhook/inbound
```

Demo mode (`DEMO_MODE=true`, the default) logs every SMS to the actor console instead of sending — no charges.

## 3. The demo flow

All commands assume `BASE=https://<your-function>.telnyxcompute.com` and customer `+15551234567`.

### Step 1 — Storefront links an order (the actor is born)

```bash
curl -X POST "$BASE/rpc/linkOrder?customer=%2B15551234567" \
  -H "Content-Type: application/json" \
  -d '{"orderId": "ORD-1001", "carrier": "medship"}'
# → {"ok":true,"orderId":"ORD-1001","customer":"+15551234567"}
```

One durable actor per customer: `env.CUSTOMERS.idFromName("15551234567")` self-provisions the entity, its `orders` SQL table, and its thread.

### Step 2 — Carrier ships the order (proactive text, the customer never asked)

```bash
curl -X POST "$BASE/webhook/carrier?customer=%2B15551234567" \
  -H "Content-Type: application/json" \
  -d '{"kind": "shipped", "orderId": "ORD-1001", "eta": "Tue", "ts": 1767225600000}'
# → {"ok":true,"duplicate":false}
# [demo] SMS to +15551234567: Your order ORD-1001 is on the way — out for delivery Tue.
```

`onCarrier` upserts the durable `orders` row and texts immediately for `shipped`/`delivered`.

### Step 3 — Customer asks "where's my order?" (inbound self-service)

```bash
curl -X POST "$BASE/webhook/inbound" \
  -H "Content-Type: application/json" \
  -d '{"data": {"event_type": "message.received", "payload": {"from": {"phone_number": "+15551234567"}, "text": "where'"'"'s my order?"}}}'
# → {"ok":true,"answer":"On the way — out for delivery, ETA Tue. (Order ORD-1001)"}
# [demo] SMS to +15551234567: On the way — out for delivery, ETA Tue. (Order ORD-1001)
```

The actor reads its own durable SQL (`SELECT * FROM orders WHERE customer = ? ORDER BY ts DESC`) — no app, no portal.

### Step 4 — Follow-up in-thread (no re-identification)

```bash
curl -X POST "$BASE/webhook/inbound" \
  -H "Content-Type: application/json" \
  -d '{"data": {"event_type": "message.received", "payload": {"from": {"phone_number": "+15551234567"}, "text": "will it make it by Friday?"}}}'
# → {"ok":true,"answer":"Order ORD-1001 should arrive by Tue."}
```

The answer comes from the actor's durable state + the persisted MessageLog thread — the same actor instance, same conversation memory.

### Step 5 — Carrier reports a delay (proactive notice BEFORE the customer asks)

```bash
curl -X POST "$BASE/webhook/carrier?customer=%2B15551234567" \
  -H "Content-Type: application/json" \
  -d '{"kind": "delayed", "orderId": "ORD-1001", "eta": "Fri", "ts": 1767484800000, "reason": "weather hold"}'
# → {"ok":true,"duplicate":false}
# [demo] SMS to +15551234567: Heads up — your order ORD-1001 is delayed to Fri: weather hold. We're on it.
```

The `delayed` event wakes the actor via `this.schedule(0, "notifyDelay", ...)`; the `lastNotified` guard makes the notice exactly-once.

### Step 6 — Redelivery is safe (idempotency)

```bash
curl -X POST "$BASE/webhook/carrier?customer=%2B15551234567" \
  -H "Content-Type: application/json" \
  -d '{"kind": "delayed", "orderId": "ORD-1001", "eta": "Fri", "ts": 1767484800000, "reason": "weather hold"}'
# → {"ok":true,"duplicate":true}   ← dropped, NO second SMS
```

A redelivered carrier webhook (same `status` + `ts`) is detected and dropped before any SMS is sent. Even if a *different* delay event for the same order arrives, `notifyDelay`'s `lastNotified` guard suppresses the duplicate.

## 4. Restart-proof demo

To demonstrate the durability contract:

1. Complete Steps 1–2 (order linked + shipped) — the `orders` row and thread are now durable.
2. Kill the Edge function (e.g. `telnyx-edge reset-func order-status-self-service --yes`, or stop `telnyx-edge dev`) **between** a delayed carrier webhook and the proactive text.
3. Send the delayed webhook (Step 5) — the scheduled task is persisted; when the function comes back, `notifyDelay` fires and the notice is sent.
4. Redeliver the same webhook (Step 6) — dropped, no double text. A fresh inbound text re-wakes the actor with its full SQL state and thread.

## 5. Going live

1. Register the live secrets:
   ```bash
   telnyx-edge secrets add DEMO_MODE false
   telnyx-edge secrets add TELNYX_SMS_FROM_NUMBER "+1555XXXXXXXX"
   telnyx-edge secrets add AI_MODEL zai-org/GLM-5.3-Flash
   ```
   (The `.env` file is for local tooling only — the Edge runtime does not inject `[env_vars]` for actor projects.)
2. Re-ship: `telnyx-edge ship`.
3. Live mode sends real SMS via `this.env.TELNYX.messages.send()` and answers via Telnyx-hosted inference (`zai-org/GLM-5.3-Flash` by default — no BYOK key needed).

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| 400 on `/webhook/inbound` | Body isn't the Telnyx `message.received` shape | Send `data.event_type` + `data.payload.from.phone_number` + `data.payload.text` |
| No SMS in the console | Wrong customer E.164 in `?customer=` | The actor is keyed by the customer's E.164; use the same value everywhere |
| 500 on actor calls | `TELNYX_SMS_FROM_NUMBER` missing in live mode | `telnyx-edge secrets add TELNYX_SMS_FROM_NUMBER "+1555XXXXXXXX"`, then re-ship |
| Typecheck failures after editing | Invented SDK APIs | Only `this.ctx.storage.sql`, `this.messages`, `this.getState()/setState()`, and `this.schedule()` exist — see `node_modules/@telnyx/edge-runtime/dist/agent/agent.d.ts` |
