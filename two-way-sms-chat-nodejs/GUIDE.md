# Build Two-Way SMS Chat with Telnyx and Node.js

Send and receive SMS messages with Telnyx using Node.js and Express, with signature-verified inbound webhooks and automatic replies.

## How It Works

```
  POST /sms/send                         Inbound text from a phone
        │                                          │
        ▼                                          ▼
  ┌──────────────┐                        ┌──────────────────┐
  │  Express app  │ ── POST /v2/messages ─▶│ Telnyx Messaging  │
  │  (server.js)  │◀── message.received ───┤    (webhook)      │
  └──────┬───────┘   (signature verified)  └──────────────────┘
         │
         └──► auto-reply via POST /v2/messages
```

## Telnyx Products Used

- **Messaging** — send and receive SMS with delivery receipts and signed inbound webhooks

## API Endpoints

- **Send Message**: `POST /v2/messages` — [API reference](https://developers.telnyx.com/api-reference/messages/send-a-message)
- **Inbound webhook events**: `message.received`, `message.sent`, `message.finalized`

## Prerequisites

- Node.js 18+ and npm
- [Telnyx account](https://portal.telnyx.com/sign-up) with funded balance
- [API key](https://portal.telnyx.com/api-keys) and the matching **public key** (same page) for webhook verification
- [Phone number](https://portal.telnyx.com/numbers/my-numbers) with messaging enabled
- [Messaging Profile](https://portal.telnyx.com/messaging/profiles) assigned to that number, with an inbound webhook URL
- [ngrok](https://ngrok.com) for exposing your local server to Telnyx webhooks

## Step 1: Set Up the Project

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/two-way-sms-chat-nodejs
cp .env.example .env
npm install
```

Edit `.env` with your Telnyx credentials. The `TELNYX_API_KEY` authenticates outbound sends; the `TELNYX_PUBLIC_KEY` verifies inbound webhook signatures. Both come from the [API Keys page](https://portal.telnyx.com/api-keys).

## Step 2: Understand the Code

Everything lives in `server.js`. Here is what each piece does.

### Initialize the client and capture the raw body

The Telnyx client is created from your API key. The JSON body parser also stashes the raw request bytes on `req.rawBody`, because webhook signatures are computed over the exact bytes Telnyx sent — re-serializing the parsed JSON would break verification.

```javascript
const client = Telnyx(config.apiKey);

app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  })
);
```

### Sending an SMS

`sendSms()` validates the destination is E.164 and calls `client.messages.create()`. The SDK response object is not directly JSON-serializable, so it returns a plain object.

```javascript
async function sendSms(toNumber, message) {
  if (!toNumber.startsWith('+')) {
    throw new Error('Phone number must be in E.164 format (e.g., +15551234567)');
  }

  const response = await client.messages.create({
    from_: config.phoneNumber,
    to: toNumber,
    text: message,
  });

  return {
    message_id: response.data.id,
    status: response.data.to?.[0]?.status || 'unknown',
    from: config.phoneNumber,
    to: toNumber,
    direction: 'outbound',
  };
}
```

### Verifying inbound webhooks

Every request to `/webhooks/sms` is verified before any work happens. If the signature does not match, the request is rejected with `401`.

```javascript
app.post('/webhooks/sms', async (req, res) => {
  try {
    await client.webhooks.unwrap(req.rawBody.toString(), {
      headers: req.headers,
      key: config.publicKey,
    });
  } catch (err) {
    return res.status(401).json({ error: 'invalid signature' });
  }

  const event = req.body;
  const eventType = event.data.event_type;
  const payload = event.data.payload;
  // ...handle message.received, message.sent, message.finalized
});
```

Note that `event_type` lives at the `data` level, while the message fields (`id`, `from`, `to`, `text`) are read from `data.payload`.

### Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/sms/send` | Send a single outbound SMS |
| `POST` | `/webhooks/sms` | Receive signed inbound message events |
| `GET`  | `/health` | Liveness probe |

## Step 3: Run It

```bash
node server.js
```

The server starts on `http://localhost:5000` (or your `PORT`).

In a separate terminal, expose it for webhooks:

```bash
ngrok http 5000
```

Copy the HTTPS URL and set it in the [Telnyx Portal](https://portal.telnyx.com):

- **Messaging Profile** → Inbound Settings → Webhook URL → `https://<id>.ngrok.io/webhooks/sms`

## Step 4: Test It

**Health check:**

```bash
curl http://localhost:5000/health
```

**Send a message:**

```bash
curl -X POST http://localhost:5000/sms/send \
  -H "Content-Type: application/json" \
  -d '{"to": "+12125559999", "message": "Hello from Telnyx!"}'
```

**Receive a message:** text your Telnyx number from a phone. Telnyx posts a signed `message.received` event to `/webhooks/sms`, the app logs it, and you receive an automatic reply.

## Going to Production

- **Database** — persist conversations instead of only logging them
- **Idempotency** — de-duplicate webhook events by `data.id` (Telnyx may retry)
- **Authentication** — add API key or auth checks on `/sms/send`
- **Monitoring** — structured logging and alerts on the health check
- **Rate limiting** — protect `/sms/send` and back off on `429` responses

## Resources

- [Source code and API reference](./README.md)
- [Typed endpoint reference](./API.md)
- [Messaging Overview](https://developers.telnyx.com/docs/messaging)
- [Receive inbound message webhooks](https://developers.telnyx.com/docs/messaging/messages/receive-webhooks)
- [Webhook signature verification](https://developers.telnyx.com/docs/messaging/messages/signature-verification)
- [Node.js SDK](https://developers.telnyx.com/development/sdk/node)
- [Telnyx Portal](https://portal.telnyx.com)
