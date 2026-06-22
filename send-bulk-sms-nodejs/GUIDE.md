# Send Bulk SMS with Telnyx and Express

Send bulk SMS messages to many recipients with rate limiting and per-message error tracking using the Telnyx Messaging API and Express.

## How It Works

```
  POST /sms/send-bulk
        │
        ▼
  ┌──────────────────┐
  │ Express server    │
  │ sendBulkSMS()     │──► loop over recipients
  └────────┬─────────┘     (delay between each)
           │
           ▼
  ┌──────────────────┐
  │ Telnyx Messaging  │  POST /v2/messages (one per recipient)
  └────────┬─────────┘
           │
           └──► { summary, successful[], failed[] }
```

## Telnyx Products Used

- **Messaging** — send SMS with delivery status

## API Endpoints

- **Send Message**: `POST /v2/messages` -- [API reference](https://developers.telnyx.com/api/messaging/send-message)

## Prerequisites

- Node.js 18+ (Node.js 20 LTS recommended)
- [Telnyx account](https://portal.telnyx.com/sign-up) with funded balance
- [API key](https://portal.telnyx.com/api-keys)
- [Phone number](https://portal.telnyx.com/numbers/my-numbers) with messaging enabled
- [Messaging Profile](https://portal.telnyx.com/messaging/profiles) assigned to that number
- `curl` (or Postman) to test the HTTP endpoints

## Step 1: Set Up the Project

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/send-bulk-sms-nodejs
cp .env.example .env
npm install
```

Edit `.env` with your Telnyx credentials:

| Variable | Description |
|----------|-------------|
| `TELNYX_API_KEY` | Your Telnyx API v2 key |
| `TELNYX_PHONE_NUMBER` | The Telnyx number to send from (E.164) |
| `PORT` | Port to listen on (optional, defaults to `3000`) |
| `RATE_LIMIT_DELAY_MS` | Delay between sends in ms (optional, defaults to `100`) |

## Step 2: Understand the Code

Everything lives in `server.js`. Here is what each piece does.

### Helper Functions

- **`sleep(ms)`** — Promise-based delay used to space out API calls.
- **`sendSingleSMS(toNumber, message)`** — Validates the number is E.164, calls `client.messages.send()` (`POST /v2/messages`), and returns a JSON-serializable result with `message_id`, `status`, `from`, and `to`.
- **`sendBulkSMS(recipients, delayMs)`** — Loops over the recipients, calls `sendSingleSMS` for each, collects results into `successful` and `failed` arrays, and waits `delayMs` between calls. A single bad recipient does not abort the batch.

### All Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/sms/send-bulk` | Send SMS to an array of recipients |
| `POST` | `/sms/send-single` | Send one SMS (handy for testing credentials) |
| `GET` | `/health` | Health check |

The bulk endpoint validates the request, then runs the batch:

```javascript
app.post("/sms/send-bulk", async (req, res) => {
  const { recipients } = req.body;

  if (!recipients || !Array.isArray(recipients)) {
    return res.status(400).json({
      error: "Request body must contain 'recipients' array",
    });
  }
  // ...validate each recipient has 'to' and 'message'...

  const delayMs = parseInt(process.env.RATE_LIMIT_DELAY_MS || "100", 10);
  const results = await sendBulkSMS(recipients, delayMs);

  return res.status(200).json({
    summary: {
      total: results.total,
      successful: results.successful.length,
      failed: results.failed.length,
    },
    successful: results.successful,
    failed: results.failed,
  });
});
```

The core helper that sends one message and shapes the response:

```javascript
async function sendSingleSMS(toNumber, message) {
  const fromNumber = process.env.TELNYX_PHONE_NUMBER;
  if (!fromNumber) {
    throw new Error("TELNYX_PHONE_NUMBER environment variable not set");
  }

  if (!toNumber.startsWith("+")) {
    throw new Error("Phone number must be in E.164 format (e.g., +15551234567)");
  }

  const response = await client.messages.send({
    from: fromNumber,
    to: toNumber,
    text: message,
  });

  return {
    message_id: response.data.id,
    status: response.data.to && response.data.to[0] ? response.data.to[0].status : "unknown",
    from: fromNumber,
    to: toNumber,
  };
}
```

Telnyx SDK exceptions (`AuthenticationError`, `RateLimitError`, `APIError`, `APIConnectionError`) are mapped to `401`, `429`, the upstream status, and `503` respectively in the route handlers.

## Step 3: Run It

```bash
node server.js
```

The server starts on `http://localhost:3000` (or the `PORT` you set).

## Step 4: Test It

**Health check:**

```bash
curl http://localhost:3000/health
```

**Send a single message first:**

```bash
curl -X POST http://localhost:3000/sms/send-single \
  -H "Content-Type: application/json" \
  -d '{"to": "+12125551234", "message": "Hello from Telnyx!"}'
```

**Send a bulk batch:**

```bash
curl -X POST http://localhost:3000/sms/send-bulk \
  -H "Content-Type: application/json" \
  -d '{
    "recipients": [
      { "to": "+12125551234", "message": "Hello from Telnyx!" },
      { "to": "+13105556789", "message": "Second message" }
    ]
  }'
```

The response contains a `summary` plus `successful` and `failed` arrays. Each `failed` entry includes the recipient's `to`, its `index`, and the `error`, so you can re-submit only what failed.

## Going to Production

- **Tune the delay** — set `RATE_LIMIT_DELAY_MS` to stay within your account's messaging throughput; consider concurrency limits for very large batches.
- **Queue large jobs** — for thousands of recipients, push the batch onto a job queue (e.g. Redis/BullMQ) instead of processing inline in the request.
- **Authentication** — add API key or token validation on your endpoints.
- **Retries** — automatically retry entries in the `failed` array with backoff.
- **Monitoring** — add structured logging and alerts on failure rates.

## Run

```bash
npm install
node server.js
```

## Resources

- [Source code and reference](./README.md)
- [Typed endpoint reference](./API.md)
- [Telnyx Developer Docs](https://developers.telnyx.com)
- [Messaging quickstart](https://developers.telnyx.com/docs/messaging)
- [Node.js SDK](https://developers.telnyx.com/development/sdk/node)
- [Telnyx Portal](https://portal.telnyx.com)
