# Track SMS Delivery Receipts with Telnyx and Node.js

Send SMS through Telnyx, receive signed `message.finalized` webhooks, and look
up the final delivery status of every message you send.

## How It Works

```
  POST /sms/send  ──►  Telnyx Messaging  ──►  carrier
        │                                        │
        │  track message_id                      │ delivery result
        ▼                                        ▼
  in-memory store  ◄──  POST /webhooks/sms  ◄──  message.finalized (signed)
        │
        ▼
  GET /receipts/:id   GET /receipts
```

## Telnyx Products Used

- **Messaging** — send SMS and receive delivery receipts via webhooks.

## API Endpoints

- **Send Message**: `POST /v2/messages` -- [API reference](https://developers.telnyx.com/api-reference/messages/send-a-message)
- **Delivery Receipt**: `message.finalized` webhook event -- [webhook reference](https://developers.telnyx.com/api-reference/webhooks/message-finalized)

## Prerequisites

- Node.js 18+ (Node 20 LTS recommended).
- A [Telnyx account](https://portal.telnyx.com/sign-up) with funded balance.
- A [Telnyx API key](https://portal.telnyx.com/app/api-keys).
- Your [Telnyx public key](https://portal.telnyx.com/app/account/public-key) for webhook verification.
- A [phone number](https://portal.telnyx.com/app/numbers/my-numbers) with messaging enabled.
- A [Messaging Profile](https://portal.telnyx.com/app/messaging) with a webhook URL.
- [ngrok](https://ngrok.com) to expose your local server to Telnyx webhooks.

## Step 1: Set Up the Project

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/sms-delivery-receipts-nodejs
cp .env.example .env
npm install
```

Edit `.env` with your credentials:

```bash
TELNYX_API_KEY=KEY...
TELNYX_PUBLIC_KEY=...        # from Portal → Account → Public Key
TELNYX_PHONE_NUMBER=+15551234567
PORT=3000
```

## Step 2: Understand the Code

Everything lives in `server.js`. Here's what each piece does.

### Initialize the client

The Telnyx client is constructed once and reused both for sending SMS and for
verifying webhook signatures:

```javascript
const client = new Telnyx(process.env.TELNYX_API_KEY);
```

### Send and track a message — `sendSMS()`

`POST /sms/send` validates the body, calls `client.messages.create()`, and
records the returned message ID in an in-memory store so later delivery
receipts can be matched back to the message.

### Verify and process webhooks — `POST /webhooks/sms`

This is the security-critical part. The route uses `express.raw()` so it has
the exact bytes Telnyx signed, then verifies the signature on **every**
request before doing anything else:

```javascript
app.post(
  "/webhooks/sms",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    const rawBody = req.body;
    try {
      await client.webhooks.unwrap(rawBody.toString(), {
        headers: req.headers,
        key: process.env.TELNYX_PUBLIC_KEY,
      });
    } catch (err) {
      console.error("Webhook signature verification failed:", err);
      return res.status(401).json({ error: "invalid signature" });
    }
    // ... parse and process ...
  }
);
```

A valid Telnyx webhook nests its fields under `data`: the kind of event is in
`data.event_type`, and the message fields are in `data.payload`. The handler
reads accordingly:

```javascript
const eventType = event.data.event_type;     // "message.finalized"
const payload = event.data.payload || {};    // { id, to: [...] }
const finalStatus = payload.to?.[0]?.status; // "delivered" | "failed" | ...
```

When a message is delivered the receipt's `deliveredAt` is stamped; when it
fails, the carrier error from `payload.to[0].error.message` is recorded.

### Look up status

`GET /receipts/:messageId` returns a single receipt and `GET /receipts`
returns all of them.

### All endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/sms/send` | Send an SMS and start tracking it |
| `POST` | `/webhooks/sms` | Receive signed delivery receipts from Telnyx |
| `GET`  | `/receipts/:messageId` | Look up one message's status |
| `GET`  | `/receipts` | List all tracked receipts |

## Step 3: Run It

```bash
node server.js
```

The server starts on `http://localhost:3000`.

In a separate terminal, expose it for webhooks:

```bash
ngrok http 3000
```

Copy the HTTPS URL and set it in the [Telnyx Portal](https://portal.telnyx.com):

- **Messaging → Messaging Profiles** → your profile → **Outbound** → Webhook URL → `https://<id>.ngrok.io/webhooks/sms`

## Step 4: Test It

Send a message:

```bash
curl -X POST http://localhost:3000/sms/send \
  -H "Content-Type: application/json" \
  -d '{"to": "+12125551234", "message": "Hello from Telnyx!"}'
```

Note the `message_id` in the response, then poll for its receipt (allow 10–30
seconds for the carrier to report back):

```bash
curl http://localhost:3000/receipts/<message_id>
```

You should see `status` transition from `queued` to `delivered`, with a
`deliveredAt` timestamp.

## Step 5: Verify Signature Enforcement

Posting an unsigned request to the webhook must be rejected:

```bash
curl -i -X POST http://localhost:3000/webhooks/sms \
  -H "Content-Type: application/json" \
  -d '{"data":{"event_type":"message.finalized"}}'
# → HTTP/1.1 401 Unauthorized
# → {"error":"invalid signature"}
```

Only genuine, correctly signed Telnyx webhooks are processed.

## Going to Production

- **Database** — replace the in-memory `deliveryReceipts` object with PostgreSQL, Redis, or similar.
- **Always verify signatures** — this example already enforces `TELNYX_PUBLIC_KEY` verification on every webhook; keep it on.
- **Idempotency** — Telnyx may retry webhooks; de-duplicate by message ID.
- **Monitoring** — add structured logging and alerting on failed deliveries.
- **Rate limiting** — protect `/sms/send` from abuse.

## Resources

- [Source code and reference](./README.md)
- [Endpoint reference](./API.md)
- [Messaging Guide](https://developers.telnyx.com/docs/messaging)
- [Webhook signing & verification](https://developers.telnyx.com/docs/messaging/messages/receive-webhooks)
- [Node.js SDK](https://developers.telnyx.com/development/sdk/node)
- [Telnyx Portal](https://portal.telnyx.com)
