# Build an SMS Auto-Reply Bot with Telnyx and Node.js

Receive inbound SMS via signed Telnyx webhooks and send automatic replies using
Node.js and Express.

## How It Works

```
  Inbound SMS
        │
        ▼
  ┌────────────────────┐
  │  Telnyx Messaging   │
  └─────────┬──────────┘
            │  POST message.received (signed)
            ▼
  ┌────────────────────┐
  │  /webhooks/sms      │
  └─────────┬──────────┘
            │  POST /v2/messages
            ▼
  auto-reply delivered to sender
```

## Telnyx Products Used

- **Messaging** — receive inbound SMS via webhooks and send replies with delivery receipts

## API Endpoints

- **Send Message**: `POST /v2/messages` — [API reference](https://developers.telnyx.com/api-reference/messages/send-a-message)
- **Inbound webhook**: `message.received` event delivered to your URL — [reference](https://developers.telnyx.com/api-reference/messaging/webhooks)

## Prerequisites

- Node.js 18+ (20 LTS recommended)
- [Telnyx account](https://portal.telnyx.com/sign-up) with a funded balance
- [API key](https://portal.telnyx.com/api-keys)
- [Phone number](https://portal.telnyx.com/numbers/my-numbers) with messaging enabled
- [Messaging Profile](https://portal.telnyx.com/messaging/profiles) with an inbound webhook URL and the webhook **public key**
- [ngrok](https://ngrok.com) to expose your local server to Telnyx webhooks

## Step 1: Set Up the Project

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/sms-auto-reply-bot-nodejs
cp .env.example .env
npm install
```

Edit `.env` with your Telnyx credentials. `TELNYX_API_KEY` sends replies and
`TELNYX_PUBLIC_KEY` verifies that inbound webhooks really came from Telnyx — both
are required.

## Step 2: Understand the Code

Everything lives in `server.js`. Here is what each piece does.

### Client and raw-body capture

Webhook signature verification hashes the *raw* request bytes, so the JSON parser
stashes the buffer on `req.rawBody` before parsing. The Telnyx client is
initialized once and reused for both sending and verification.

```javascript
const client = Telnyx(process.env.TELNYX_API_KEY);

app.use(express.json({
  verify: (req, _res, buf) => { req.rawBody = buf; },
}));
```

### Verify every inbound webhook

At the top of the webhook route, the raw body and headers are verified against
the public key. Anything that fails is rejected with `401` before any work
happens.

```javascript
try {
  await client.webhooks.unwrap(req.rawBody.toString(), {
    headers: req.headers,
    key: process.env.TELNYX_PUBLIC_KEY,
  });
} catch {
  return res.status(401).json({ error: "invalid signature" });
}
```

### Read fields from the payload

For Telnyx webhooks, `event_type` lives at the `data` level while the message
fields live inside `data.payload`. Reading from the wrong level is a common bug.

```javascript
const data = req.body.data || {};
const eventType = data.event_type;        // "message.received"
const payload = data.payload || {};       // message fields
const fromNumber = payload.from && payload.from.phone_number;
const messageText = payload.text || "";
```

### Choose a reply and send it

```javascript
let autoresponseText = "Thank you for your message. We will respond shortly.";
if (messageText.toLowerCase().includes("help")) {
  autoresponseText = "Help is on the way! Our team will contact you soon.";
} else if (messageText.toLowerCase().includes("hours")) {
  autoresponseText = "We are open Monday-Friday, 9 AM - 5 PM EST.";
}
const result = await sendSMS(fromNumber, autoresponseText);
```

### All endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/webhooks/sms` | Verify + handle inbound SMS, send auto-reply |
| `POST` | `/sms/send` | Manually send an SMS (testing) |
| `GET`  | `/health` | Liveness probe |

## Step 3: Run It

```bash
node server.js
```

The server starts on `http://localhost:3000`.

In a separate terminal, expose it for webhooks:

```bash
ngrok http 3000
```

Copy the HTTPS URL into the [Telnyx Portal](https://portal.telnyx.com):

- **Messaging Profile** → Inbound Webhook → `https://<id>.ngrok.io/webhooks/sms`

Then copy the profile's webhook **public key** into `TELNYX_PUBLIC_KEY` and
restart the server.

## Step 4: Test It

**Health check:**

```bash
curl http://localhost:3000/health
```

**Send a test message manually:**

```bash
curl -X POST http://localhost:3000/sms/send \
  -H "Content-Type: application/json" \
  -d '{ "to": "+12125551234", "message": "Hello from Telnyx!" }'
```

**Trigger the auto-reply:** text your Telnyx number from your phone. Try sending
`help` or `hours` to see the tailored replies. Because signature verification is
enforced, direct `curl` calls to `/webhooks/sms` without a valid Telnyx signature
return `401` — this is expected.

## Going to Production

- **Webhook verification** — already enforced on every inbound webhook via `client.webhooks.unwrap()`. Keep `TELNYX_PUBLIC_KEY` set.
- **Persistence** — record conversations in PostgreSQL or Redis instead of replying statelessly.
- **Idempotency** — dedupe on the inbound message `id` so retried webhooks do not double-reply.
- **Monitoring** — add structured logging and alerts on the `/health` endpoint.
- **Rate limiting** — protect public endpoints from abuse.

## Resources

- [Source code and reference](./README.md)
- [Typed API reference](./API.md)
- [Messaging Guide](https://developers.telnyx.com/docs/messaging)
- [Receive Webhooks](https://developers.telnyx.com/docs/messaging/messages/receive-webhooks)
- [Node.js SDK](https://developers.telnyx.com/development/sdk/node)
- [Telnyx Portal](https://portal.telnyx.com)
