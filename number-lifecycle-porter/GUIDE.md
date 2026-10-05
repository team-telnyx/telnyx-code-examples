# Number Lifecycle Porter — A Developer's Guide

## Overview

The `number-lifecycle-porter` sample demonstrates how to use **Telnyx Edge Stateful Actors** to manage the full lifecycle of a phone number — from search and order, through wiring to a Call Control application, to rollback and retirement. This is the "missing first-mile" demo: every other Telnyx tutorial assumes a number already exists. Here, the phone number itself is the actor.

## Prerequisites

Before you begin, ensure you have:

1. **Telnyx API Key** — [Sign up](https://portal.telnyx.com/sign-up) and create an API key with Numbers and Messaging permissions.
2. **Telnyx CLI** — Install the Telnyx Edge CLI:
   ```bash
   npm install -g @telnyx/edge-cli
   ```
3. **Telnyx Account** — A Telnyx account with at least one Call Control application configured.
4. **Node.js 18+** — Required for the Edge runtime.

## Environment Setup

### 1. Clone and Install

```bash
cd number-lifecycle-porter
npm install
```

### 2. Configure Environment Variables

Copy the example environment file and fill in your values:

```bash
cp .env.example .env
```

Edit `.env` with your Telnyx credentials and configuration:

```env
TELNYX_API_KEY=your_telnyx_api_key_here
CC_APP_CONNECTION_ID=your_call_control_app_connection_id
OPS_SMS_TO=+1555XXXXXXXX
NEW_NUMBER_TAG=clinic-north
POLL_INTERVAL_SECS=30
POLL_MAX_MINUTES=60
AREA_CODE=415
DEMO_MODE=true
```

| Variable | Description | Default |
|---|---|---|
| `TELNYX_API_KEY` | Your Telnyx API key (stored as a secret) | — |
| `CC_APP_CONNECTION_ID` | Call Control application connection ID | — |
| `OPS_SMS_TO` | On-call phone number for cutover/revert SMS | — |
| `NEW_NUMBER_TAG` | Tag applied to the new number | `clinic-north` |
| `POLL_INTERVAL_SECS` | Polling interval for order status | `30` |
| `POLL_MAX_MINUTES` | Maximum time to wait for order success | `60` |
| `AREA_CODE` | Default area code for number search | `415` |
| `DEMO_MODE` | When `true`, simulates API calls without real charges | `true` |

### 3. Set Secrets

The Telnyx API key is stored as a secret, not in plaintext:

```bash
telnyx-edge secrets add TELNYX_API_KEY "your_telnyx_api_key_here"
```

### 4. Configure telnyx.toml

The `telnyx.toml` file declares the actor binding, secrets, and storage:

```toml
name = "number-lifecycle-porter"
main = "src/index.ts"
compatibility_date = "2026-07-28"

[[actors]]
binding = "NUMBERS"
type    = "NumberActor"

[[secrets]]
binding = "TELNYX_API_KEY"
name    = "TELNYX_API_KEY"

[storage.sqldb.ORDERS_DB]
id = "<orders-db-uuid>"

[env_vars]
CC_APP_CONNECTION_ID = "your_call_control_app_connection_id"
OPS_SMS_TO = "+1555XXXXXXXX"
NEW_NUMBER_TAG = "clinic-north"
POLL_INTERVAL_SECS = "30"
POLL_MAX_MINUTES = "60"
AREA_CODE = "415"
DEMO_MODE = "true"
```

## Demo Mode vs Live Mode

### Demo Mode (Default)

When `DEMO_MODE=true`, the actor **simulates** all Telnyx API interactions:

- **Search**: Generates a deterministic E.164 number for the requested area code.
- **Order**: Creates a mock order ID (`order_demo_<digits>`) without calling `POST /v2/number_orders`.
- **Poll**: First poll returns `pending`, second returns `success` — tracked via the SQL `orders` table.
- **Wire-up**: Logs what it *would* PATCH to `/v2/phone_numbers/{id}`.
- **SMS**: Logs the cutover/revert message instead of sending it.

This allows full end-to-end testing without real charges or real phone numbers.

### Live Mode

Set `DEMO_MODE=false` and provide real credentials:

```bash
telnyx-edge secrets add TELNYX_API_KEY "your_real_api_key"
# Update telnyx.toml env_vars: DEMO_MODE = "false"
```

In live mode, the actor makes real API calls to:
- `GET /v2/available_phone_numbers` — search for available numbers
- `POST /v2/number_orders` — create a real number order
- `GET /v2/number_orders/{id}` — poll order status
- `PATCH /v2/phone_numbers/{id}` — wire the number to your Call Control app
- `POST /v2/messages` — send real SMS via the `[telnyx]` binding

## How It Works — Step by Step

### Step 1: Actor Birth via `@rpc provision`

The `NumberActor` is a **durable stateful actor** — one instance per phone number. When you call `provision(areaCode, features)`, the actor is born via:

```typescript
const actor = env.NUMBERS.idFromName(`${areaCode}:${env.NEW_NUMBER_TAG}`);
const stub = env.NUMBERS.get(actor);
const result = await stub.provision(areaCode, features);
```

The `idFromName` call ensures **deterministic actor identity** — the same area code + tag always maps to the same actor. If the actor already exists and has state, the `provision` method returns early (idempotency).

**Code reference**: `provision()` method in the `NumberActor` class — checks `state.orderId` and `state.e164` before proceeding.

### Step 2: Search Available Numbers

The actor calls `GET /v2/available_phone_numbers` with filters for the requested area code and features (voice + SMS by default):

```typescript
const params = new URLSearchParams();
params.set('filter[national_destination_code]', areaCode);
params.append('filter[features][]', 'voice');
params.append('filter[features][]', 'sms');
```

The first candidate from the results is selected and stored in actor state (`state.e164`).

**Code reference**: `searchNumber()` private helper — handles both demo mode (generates a number) and live mode (calls the real API).

### Step 3: Create Number Order

The actor creates a number order via `POST /v2/number_orders`:

```json
{
  "phone_numbers": [{ "phone_number": "+1415XXXXXXX" }]
}
```

The response contains `data.id` (the order ID) and `data.status: "pending"`. The order ID is stored in actor state (`state.orderId`).

**Idempotency**: The actor only calls `POST /v2/number_orders` if `state.orderId` is null. On restart, the actor re-uses the existing order ID — no duplicate orders.

**Code reference**: `createOrder()` private helper — demo mode returns a mock ID; live mode calls the real API.

### Step 4: Poll Order Status with `this.schedule()`

After creating the order, the actor schedules a poll:

```typescript
this.schedule(interval, 'pollOrder');
```

The `pollOrder` method calls `GET /v2/number_orders/{id}` and checks the status:

- **`pending`**: Re-arms the poll timer (with timeout check against `POLL_MAX_MINUTES`).
- **`success`**: Proceeds to wire-up.
- **`failure` / `cancelled`**: Throws an error with a clear message.

**Restart proof**: If the actor is killed between order creation and wire-up, on restart it re-polls the **same order ID** (stored in durable state). No second `POST` is made.

**Code reference**: `pollOrder()` method — handles all three statuses, re-arms via `this.schedule()`.

### Step 5: Wire the Number to Call Control

On order success, the actor wires the number to the Call Control application via `PATCH /v2/phone_numbers/{id}`:

```json
{
  "connection_id": "your_cc_app_connection_id",
  "tags": ["clinic-north", "voice", "sms"]
}
```

The actor first looks up the phone number ID via `GET /v2/phone_numbers?filter[phone_number]=...`, then PATCHes the configuration. A verification `GET` confirms the wire-up.

**Code reference**: `wireNumber()` private helper — demo mode logs the action; live mode performs the real lookup + PATCH + verification.

### Step 6: Announce Cutover via SMS

Once wired, the actor sends a cutover SMS to the on-call list:

```
New line live: +1 415 XXX XXXX — old line forwards until Friday.
```

The SMS is sent via the `[telnyx]` binding:

```typescript
await this.env.TELNYX.messages.send({ to: this.env.OPS_SMS_TO, text: body });
```

**Code reference**: `announceCutover()` and `sendSms()` private helpers.

### Step 7: Rollback Drill via `@rpc rollback`

The `rollback` RPC reverts the number to its old configuration:

1. Re-PATCHes the old number's `connection_id` (set to `null` in demo mode).
2. Sends a revert SMS: `Number +1415XXXXXXX rolled back. Old connection restored.`
3. Updates actor state to `rolled_back`.

**Code reference**: `rollback()` method and `revertNumber()` private helper.

### Step 8: Retire via `@rpc retire`

The `retire` RPC releases the number from the app:

1. PATCHes `connection_id: null` and `tags: ["retired"]`.
2. Updates actor state to `retired`.

**Code reference**: `retire()` method and `releaseNumber()` private helper.

### Step 9: Audit Trail via SQL

Every lifecycle stage is recorded in the `events` table:

| Column | Type | Description |
|---|---|---|
| `number` | TEXT | The E.164 number or area code |
| `stage` | TEXT | `search`, `order`, `wire`, `announce`, `rollback`, `retire` |
| `at` | INTEGER | Unix timestamp |

The `orders` table tracks order state for restart-proof polling:

| Column | Type | Description |
|---|---|---|
| `order_id` | TEXT | The Telnyx order ID (primary key) |
| `status` | TEXT | `pending`, `success`, `failure`, `cancelled` |
| `poll_count` | INTEGER | Number of polls performed |
| `created_at` | INTEGER | Unix timestamp of order creation |

**Code reference**: `logEvent()` private helper and SQL statements in `getOrderStatus()`.

## Running the Sample

### Deploy

```bash
telnyx-edge ship
```

### Provision a Number (Demo Mode)

```bash
curl -X POST "https://<your-subdomain>.telnyx.io/provision?areaCode=415"
```

Response:
```json
{
  "e164": "+14151234567",
  "orderId": "order_demo_14151234567",
  "stage": "ordered"
}
```

### Check Actor Health

```bash
curl "https://<your-subdomain>.telnyx.io/health"
```

### Trigger Rollback

```bash
curl -X POST "https://<your-subdomain>.telnyx.io/rollback?areaCode=415"
```

### Retire the Number

```bash
curl -X POST "https://<your-subdomain>.telnyx.io/retire?areaCode=415"
```

## Smoke Test

Verify the module loads correctly:

```bash
npx tsx smoke_test.ts
```

The smoke test verifies:
- The `NumberActor` class is exported
- The `provision`, `rollback`, and `retire` RPC methods exist
- The default fetch handler is exported
- The module loads without errors

## Telnyx Primitives Used

| Primitive | How It's Used |
|---|---|
| **Agent SDK (`Agent`)** | `NumberActor extends Agent` — provides durable state, RPC methods, and scheduling |
| **`this.schedule()`** | Polls order status every 30 seconds until `success` |
| **`env.NUMBERS.idFromName()`** | Creates a deterministic actor per phone number (area code + tag) |
| **`this.ctx.storage`** | Not directly used — state is managed via `getState()`/`setState()` |
| **SQL Storage (`ORDERS_DB`)** | Audit trail (`events` table) and order tracking (`orders` table) |
| **`[telnyx]` binding** | Sends cutover and revert SMS via `this.env.TELNYX.messages.send()` |
| **Numbers API** | Search (`GET /available_phone_numbers`), order (`POST /number_orders`), poll (`GET /number_orders/{id}`) |
| **Phone Numbers API** | Wire-up (`PATCH /phone_numbers/{id}`), lookup (`GET /phone_numbers?filter[phone_number]=`) |

## Next Steps

- **Production deployment**: Set `DEMO_MODE=false`, add real `TELNYX_API_KEY` secret, and ensure `CC_APP_CONNECTION_ID` points to a real Call Control app.
- **Multi-region**: Deploy actors to different regions for geographic redundancy.
- **Alerting**: Extend the `events` table to trigger alerts on `failure` or `cancelled` order statuses.
- **Batch provisioning**: Add a batch RPC that provisions multiple numbers in parallel.
- **Webhooks**: Add a webhook handler to receive real-time order status updates instead of polling.

### Reference Documentation

- [Telnyx Stateful Actors](https://developers.telnyx.com/docs/edge-compute/stateful-actors)
- [Agent SDK Scheduled Tasks](https://developers.telnyx.com/docs/agent-sdk/scheduled-tasks)
- [Phone Number Search](https://developers.telnyx.com/docs/numbers/phone-numbers/number-search)
- [Number Orders](https://developers.telnyx.com/docs/numbers/phone-numbers/number-orders)
- [Phone Number Configuration](https://developers.telnyx.com/api-reference/phone-number-configurations/update-a-phone-number)
- [Messaging API](https://developers.telnyx.com/docs/messaging/messages/send-message)
- [Telnyx Edge CLI](https://developers.telnyx.com/docs/edge-compute/cli-reference)
