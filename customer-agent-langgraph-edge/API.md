# API Reference

## Endpoints

### `GET /health`

Health check endpoint.

**Response:** `200 OK`

```json
{
  "ok": true,
  "demo": true,
  "smsTransport": "demo",
  "brand": "customer-agent-langgraph-edge v0.1.0"
}
```

### `GET /version`

Version info.

**Response:** `200 OK`

```json
{ "brand": "customer-agent-langgraph-edge v0.1.0" }
```

### `GET /`

Demo HTML UI (when `DEMO_MODE=true`). Shows the customer banner, durable history chat, `CustomerState` panel, turn state machine, latest graph execution, and process log.

**Response:** `200 OK` (HTML) or `404` (demo disabled)

### `HEAD /`

Demo UI availability check (when `DEMO_MODE=true`).

**Response:** `200` (with `x-brand-version` header) or `404`

### `POST /send`

Send a message from the demo UI. Routes the inbound to the per-customer `CustomerAgent` actor for `from`.

**Request:**

```json
{
  "text": "where is order ORD-10042?",
  "from": "+15551234567"
}
```

**Response:** `200 OK`

```json
{ "ok": true }
```

**Errors:**
- `400` — `text` is required or `from` is not E.164

### `GET /events`

Retrieve conversation events for the demo UI. Returns durable history (most recent first), process log, and turn state machine values.

**Query Parameters:**
- `from` — E.164 phone number (defaults to `DEMO_SENDER_NUMBER`)
- `limit` — max events to return (1-100, defaults to 50)

**Response:** `200 OK`

```json
{
  "conversation": [
    { "id": 1, "role": "user", "content": "where is my order?", "at": 1723480000000 },
    { "id": 2, "role": "assistant", "content": "Your order is shipped.", "at": 1723480001000 }
  ],
  "processLog": [
    { "id": 1, "turn": 1, "phase": "receive", "intent": "unknown", "note": "phone=+15550001111; queued; text=\"where is my order?\"", "at": 1723480000000 },
    { "id": 2, "turn": 1, "phase": "process_start", "intent": "unknown", "note": "target=1; lastSent=0", "at": 1723480000100 },
    { "id": 3, "turn": 1, "phase": "graph_done", "intent": "order", "note": "reply=\"Your order is shipped.\"", "at": 1723480000500 },
    { "id": 4, "turn": 1, "phase": "sms_mocked", "intent": "order", "note": "clientRef=turn-1", "at": 1723480000600 },
    { "id": 5, "turn": 1, "phase": "commit", "intent": "order", "note": "lastSentTurn=1", "at": 1723480000700 }
  ],
  "turnState": {
    "turn": 1,
    "queuedTurn": 1,
    "processingTurn": 0,
    "lastSentTurn": 1,
    "pendingOutbound": null
  }
}
```

### `GET /context`

Debug route. Returns the full `CustomerContext` for the per-customer actor — proves state persistence across requests.

**Query Parameters:**
- `phone` — E.164 phone number (defaults to `DEMO_SENDER_NUMBER`)

**Response:** `200 OK`

```json
{
  "phone_e164": "+15551234567",
  "customer": {
    "phone_e164": "+15551234567",
    "name": "Anusha",
    "salesforce_id": "mock-anusha-salesforce-id",
    "preferred_channel": "sms",
    "proactive_consent": true,
    "open_tickets": [],
    "shipments": [],
    "escalation_pending": null,
    "active_schedule_ids": [],
    "turn": 2,
    "queuedTurn": 2,
    "processingTurn": 0,
    "lastSentTurn": 2,
    "lastIntent": "order",
    "at": 1723480000700
  },
  "history": [
    { "role": "user", "content": "where is my order ORD-10042?", "at": 1723480000000 },
    { "role": "assistant", "content": "Your order is shipped.", "at": 1723480000500 }
  ],
  "demo": {
    "default_customer_name": "Anusha",
    "default_salesforce_id": "mock-anusha-salesforce-id"
  }
}
```

### `POST /` or `POST /webhooks/messaging`

Telnyx messaging webhook handler. Receives `message.received` events and routes them to the `CustomerAgent` actor for the inbound phone.

**Signature Verification:**
- When `SMS_TRANSPORT=production`: verifies the `telnyx-signature-ed25519` header using `TELNYX_PUBLIC_KEY` via `telnyx.webhooks.unwrap()`.
- When `SMS_TRANSPORT=demo`: parses the body directly without verification.

**Request Body:** Telnyx `message.received` webhook payload

```json
{
  "data": {
    "id": "evt-12345",
    "event_type": "message.received",
    "payload": {
      "from": { "phone_number": "+15550001111" },
      "to": [{ "phone_number": "+15557654321" }],
      "text": "where is my order ORD-10042?"
    }
  }
}
```

**Response:**
- `200 OK` — `{"ok": true, "actor": "customer-15550001111"}` (event processed)
- `200 OK` — `{"ignored": true, "event_type": "..."}` (non-`message.received` event)
- `401` — signature verification failed
- `400` — invalid payload

## Types

### `CustomerAgent` (Agent)

```typescript
class CustomerAgent extends Agent<Env, CustomerState> {
  receive(input: ReceiveMessageInput): Promise<void>;
  process(): Promise<void>;
  nudge(): Promise<void>;
  getEvents(limit?: number): Promise<EventsResponse>;
  getContext(): Promise<CustomerContext>;
}
```

### `TelnyxBoundChatModel` (LangChain chat model)

```typescript
class TelnyxBoundChatModel extends SimpleChatModel {
  constructor(opts: { env: Env; model: string });
  _call(messages: BaseMessage[]): Promise<string>;
  _llmType(): string;  // "telnyx-bound"
}
```

### `CustomerState` (durable per-customer state)

```typescript
interface CustomerState {
  // Identity (durable, normalized E.164)
  phone_e164: string;            // customer phone
  to: string;                    // agent phone (the customer's To:)
  name: string;                  // e.g. "Anusha"
  salesforce_id: string;         // mock-anusha-salesforce-id in Gate 1
  preferred_channel: "sms" | "voice";
  proactive_consent: boolean;

  // External systems refs (durable; empty until later gates)
  open_tickets: TicketRef[];
  shipments: ShipmentRef[];
  escalation_pending: EscalationRef | null;
  active_schedule_ids: string[];

  // Persistent message log (durable; mirror of this.messages)
  history: Array<{ role: "user" | "assistant"; content: string; at: number }>;

  // Coordination state (durable; turn state machine)
  turn: number;
  queuedTurn: number;
  processingTurn: number;
  lastSentTurn: number;
  pendingOutbound: PendingOutbound | null;
  lastIntent: Intent;            // "order" | "smalltalk" | "unknown"
  at: number;                    // last process timestamp
}
```

### `CustomerContext` (debug route shape)

```typescript
interface CustomerContext {
  customer: {
    phone_e164: string;
    name: string;
    salesforce_id: string;
    preferred_channel: "sms" | "voice";
    proactive_consent: boolean;
    open_tickets: TicketRef[];
    shipments: ShipmentRef[];
    escalation_pending: EscalationRef | null;
    active_schedule_ids: string[];
    turn: number;
    queuedTurn: number;
    processingTurn: number;
    lastSentTurn: number;
    lastIntent: Intent;
    at: number;
  };
  history: Array<{ role: "user" | "assistant"; content: string; at: number }>;
}
```
