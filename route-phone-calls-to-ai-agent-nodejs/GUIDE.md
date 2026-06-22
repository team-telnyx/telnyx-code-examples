# Route Inbound Calls with Telnyx Voice and Express

Receive inbound call webhooks from the Telnyx Voice API and answer calls
programmatically with an Express server using Call Control.

## How It Works

```
  Inbound PSTN call
        │
        ▼
  ┌──────────────────────┐
  │  Telnyx Voice API     │
  │  (Call Control App)   │
  └──────────┬───────────┘
             │  call.initiated webhook
             ▼
  ┌──────────────────────┐
  │  Express server       │
  │  POST /webhooks/      │
  │       inbound-call    │
  └──────────┬───────────┘
             │  answer(call_control_id)
             ▼
  ┌──────────────────────┐
  │  Telnyx Voice API     │  ──► call answered
  └──────────────────────┘
```

## Telnyx Products Used

- **Voice** — Call Control for receiving inbound call webhooks and answering calls programmatically

## API Endpoints

- **Answer Call**: `POST /v2/calls/{call_control_id}/actions/answer` -- [API reference](https://developers.telnyx.com/api-reference/call-commands/answer-call)

## Prerequisites

- Node.js 14+
- [Telnyx account](https://portal.telnyx.com/sign-up) with funded balance
- [API key](https://portal.telnyx.com/api-keys)
- A [Telnyx phone number](https://portal.telnyx.com/numbers/my-numbers) with voice enabled
- A [Call Control Application](https://portal.telnyx.com/call-control/applications) with its webhook URL pointed at this server, and your number assigned to it
- [ngrok](https://ngrok.com) (or similar) to expose your local server to Telnyx webhooks

## Step 1: Set Up the Project

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/route-phone-calls-to-ai-agent-nodejs
cp .env.example .env
npm install
```

Edit `.env` and set `TELNYX_API_KEY` to the key from your
[Telnyx Portal](https://portal.telnyx.com/api-keys). `PORT` is optional — the
server listens on `PORT` if set (the bundled `.env.example` uses `5000`) and
falls back to `3000` otherwise.

## Step 2: Understand the Code

Everything lives in `server.js`. Here is what each piece does.

### Client Initialization

The Telnyx client is created once from the API key in the environment:

```javascript
const client = new Telnyx({ apiKey: process.env.TELNYX_API_KEY });
```

### Helper Function

- **`handleInboundCall(event)`** — Inspects the webhook payload. It pulls
  `call_control_id`, `from`, `to`, and `event_type` from `event.data`. If there
  is no `call_control_id` it throws. When `event_type` is `call.initiated` it
  calls `client.calls.actions.answer(callControlId)` and returns
  `{ call_control_id, status: "answered", from, to }`. For any other event type
  it returns `{ call_control_id, status: "acknowledged", event_type }`.

```javascript
async function handleInboundCall(event) {
  const callControlId = event.data.call_control_id;
  const from = event.data.from;
  const to = event.data.to;
  const eventType = event.data.event_type;

  if (!callControlId) {
    throw new Error("Missing call_control_id in webhook event");
  }

  if (eventType === "call.initiated") {
    const response = await client.calls.actions.answer(callControlId);
    return {
      call_control_id: response.data.call_control_id,
      status: "answered",
      from: from,
      to: to,
    };
  }

  return {
    call_control_id: callControlId,
    status: "acknowledged",
    event_type: eventType,
  };
}
```

### Routes

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/webhooks/inbound-call` | Validate the payload and answer or acknowledge the call |
| `GET`  | `/health` | Return `{ "status": "ok" }` for monitoring |

The webhook route rejects any request without a `data` object (`400`), then
delegates to `handleInboundCall`. Telnyx SDK errors are mapped to HTTP status
codes: `AuthenticationError` → `401`, `RateLimitError` → `429`,
`APIError` → its own `status`, `APIConnectionError` → `503`, missing
fields → `400`, and anything else → `500`.

## Step 3: Run It

```bash
node server.js
```

The server starts on `http://localhost:5000` (or whatever `PORT` you set; `3000`
if unset). In a separate terminal, expose it for webhooks:

```bash
ngrok http 5000
```

Copy the HTTPS URL and set it in the [Telnyx Portal](https://portal.telnyx.com):

- **Call Control Application** → Webhook URL → `https://<id>.ngrok.io/webhooks/inbound-call`
- Assign your Telnyx phone number to that Call Control Application.

## Step 4: Test It

**Health check:**

```bash
curl http://localhost:5000/health
```

**Simulate an inbound call webhook:**

```bash
curl -X POST http://localhost:5000/webhooks/inbound-call \
  -H "Content-Type: application/json" \
  -d '{
    "data": {
      "event_type": "call.initiated",
      "call_control_id": "v3:abc123",
      "from": "+12125551234",
      "to": "+13105557890"
    }
  }'
```

You should receive an `answered` response. Then place a real call to your Telnyx
number — Telnyx will POST a live `call.initiated` event and the server will
answer the call.

## Going to Production

- **Webhook verification** — validate Telnyx webhook signatures ([docs](https://developers.telnyx.com/docs/api/v2/overview#webhook-signing))
- **Authentication** — restrict the webhook route to Telnyx source IPs / signatures
- **Monitoring** — add structured logging and alert on the `/health` endpoint
- **Idempotency** — de-duplicate retried webhook deliveries before answering
- **Extend the call** — after answering, hand the call to a Telnyx AI voice agent or IVR flow

## Run

```bash
npm install
node server.js
```

## Resources

- [Source code and reference](./README.md)
- [Typed endpoint reference](./API.md)
- [Telnyx Voice / Call Control Guide](https://developers.telnyx.com/docs/voice/programmable-voice)
- [Node.js SDK](https://developers.telnyx.com/development/sdk/node)
- [Telnyx Portal](https://portal.telnyx.com)
