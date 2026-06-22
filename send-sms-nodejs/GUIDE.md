# Send Your First SMS with Telnyx and Node.js

Build a small Express endpoint that sends an SMS message using the Telnyx Messaging API and the Telnyx Node.js SDK.

## How It Works

```
  POST /sms/send
        │
        ▼
  ┌──────────────────┐
  │ Express handler   │
  │ (validate input)  │
  └────────┬─────────┘
           │ client.messages.send()
           ▼
  ┌──────────────────┐
  │ Telnyx Messaging  │
  └────────┬─────────┘
           │
           └──► SMS delivered
```

## Telnyx Products Used

- **Messaging** — send messages with delivery status

## API Endpoints

- **Send Message**: `POST /v2/messages` -- [API reference](https://developers.telnyx.com/api/messaging/send-message)

## Prerequisites

- Node.js 14+ and npm
- [Telnyx account](https://portal.telnyx.com/sign-up) with a funded balance
- [API key](https://portal.telnyx.com/api-keys)
- [Phone number](https://portal.telnyx.com/numbers/my-numbers) with messaging enabled and a [Messaging Profile](https://portal.telnyx.com/messaging/profiles) assigned

## Step 1: Set Up the Project

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/send-sms-nodejs
cp .env.example .env
npm install
```

Edit `.env` and fill in your `TELNYX_API_KEY` and `TELNYX_PHONE_NUMBER` (E.164, e.g. `+15551234567`). Each value comes from the [Telnyx Portal](https://portal.telnyx.com).

## Step 2: Understand the Code

Everything lives in `server.js`. Here is what each piece does.

### Initialize the client

The SDK client is created once from the API key:

```javascript
const Telnyx = require("telnyx");
require("dotenv").config();

const client = new Telnyx({ apiKey: process.env.TELNYX_API_KEY });
```

### The `sendSms` helper

`sendSms(toNumber, message)` validates input, calls the Telnyx Messaging API, and returns a plain JSON-serializable object:

```javascript
async function sendSms(toNumber, message) {
  const fromNumber = process.env.TELNYX_PHONE_NUMBER;
  if (!fromNumber) {
    throw new Error("TELNYX_PHONE_NUMBER environment variable not set");
  }

  // Validate E.164 format to prevent API errors
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

### The endpoint

`POST /sms/send` reads `to` and `message` from the JSON body, rejects missing fields with a 400, and maps Telnyx SDK errors (`AuthenticationError`, `RateLimitError`, `APIError`, `APIConnectionError`) to the right HTTP status codes.

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/sms/send` | Send a single SMS |

## Step 3: Run It

```bash
node server.js
```

The server starts on `http://localhost:5000` (or the `PORT` from `.env`).

## Step 4: Test It

Send a message:

```bash
curl -X POST http://localhost:5000/sms/send \
  -H "Content-Type: application/json" \
  -d '{
    "to": "+12125559999",
    "message": "Hello from Telnyx!"
  }'
```

A successful call returns:

```json
{
  "message_id": "msg-f5d7a7e0-1234-5678",
  "status": "queued",
  "from": "+15551234567",
  "to": "+12125559999"
}
```

## Going to Production

- **Authentication** — add API key validation on your endpoint
- **Input validation** — validate and normalize destination numbers beyond the `+` check
- **Retries** — handle `429` and `503` with backoff
- **Monitoring** — add structured logging and health checks
- **Delivery receipts** — configure a webhook to track final delivery status (see [receive-sms-webhook-nodejs](../receive-sms-webhook-nodejs/))

## Run

```bash
npm install
node server.js
```

## Resources

- [Source code and reference](./README.md)
- [Typed endpoint reference](./API.md)
- [Messaging quickstart](https://developers.telnyx.com/docs/messaging)
- [Node.js SDK](https://developers.telnyx.com/development/sdk/node)
- [Telnyx Portal](https://portal.telnyx.com)
