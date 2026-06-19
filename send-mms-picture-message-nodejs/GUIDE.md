# Send an MMS Picture Message with Telnyx and Node.js

Build a small Express endpoint that sends an MMS picture message — text plus one or more media attachments — using the Telnyx Messaging API and the Telnyx Node.js SDK.

## How It Works

```
  POST /mms/send
        │
        ▼
  ┌──────────────────┐
  │ Express handler   │
  │ (validate input)  │
  └────────┬─────────┘
           │ client.messages.create({ media_urls })
           ▼
  ┌──────────────────┐
  │ Telnyx Messaging  │
  └────────┬─────────┘
           │
           └──► MMS (text + media) delivered
```

## Telnyx Products Used

- **Messaging** — send MMS messages with media attachments and delivery status

## API Endpoints

- **Send Message**: `POST /v2/messages` -- [API reference](https://developers.telnyx.com/api/messaging/send-message)

The only difference between sending SMS and MMS is the `media_urls` array: include it and the message is delivered as MMS.

## Prerequisites

- Node.js 14+ and npm
- [Telnyx account](https://portal.telnyx.com/sign-up) with a funded balance
- [API key](https://portal.telnyx.com/api-keys)
- [Phone number](https://portal.telnyx.com/numbers/my-numbers) that is **MMS-enabled** with a [Messaging Profile](https://portal.telnyx.com/messaging/profiles) assigned
- One or more publicly accessible media URLs (image, video, or document)

## Step 1: Set Up the Project

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/send-mms-picture-message-nodejs
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

### The `sendMMS` helper

`sendMMS(toNumber, message, mediaUrls)` validates input, calls the Telnyx Messaging API with `media_urls`, and returns a plain JSON-serializable object:

```javascript
async function sendMMS(toNumber, message, mediaUrls) {
  const fromNumber = process.env.TELNYX_PHONE_NUMBER;
  if (!fromNumber) {
    throw new Error("TELNYX_PHONE_NUMBER environment variable not set");
  }

  // Validate E.164 format to prevent API errors
  if (!toNumber.startsWith("+")) {
    throw new Error("Phone number must be in E.164 format (e.g., +15551234567)");
  }

  // MMS requires at least one media attachment
  if (!mediaUrls || mediaUrls.length === 0) {
    throw new Error("At least one media URL is required for MMS");
  }

  const response = await client.messages.create({
    from_: fromNumber,
    to: toNumber,
    text: message,
    media_urls: mediaUrls,
  });

  return {
    message_id: response.data.id,
    status: response.data.to && response.data.to[0] ? response.data.to[0].status : "unknown",
    from: fromNumber,
    to: toNumber,
    media_count: mediaUrls.length,
  };
}
```

### The endpoint

`POST /mms/send` reads `to`, `message`, and `media_urls` from the JSON body, rejects missing fields and non-array `media_urls` with a 400, and maps Telnyx SDK errors (`AuthenticationError`, `RateLimitError`, `APIStatusError`, `APIConnectionError`) to the right HTTP status codes. Unexpected errors are logged server-side and returned as a generic `500`.

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/mms/send` | Send a single MMS with media |
| `GET` | `/health` | Liveness probe |

## Step 3: Run It

```bash
node server.js
```

The server starts on `http://localhost:5000` (or the `PORT` from `.env`).

## Step 4: Test It

Send a picture message:

```bash
curl -X POST http://localhost:5000/mms/send \
  -H "Content-Type: application/json" \
  -d '{
    "to": "+12125559999",
    "message": "Check this out!",
    "media_urls": ["https://example.com/image.jpg"]
  }'
```

A successful call returns:

```json
{
  "message_id": "msg-f5d7a7e0-1234-5678",
  "status": "queued",
  "from": "+15551234567",
  "to": "+12125559999",
  "media_count": 1
}
```

## Going to Production

- **Authentication** — add API key validation on your endpoint
- **Input validation** — validate and normalize destination numbers beyond the `+` check, and verify media URLs are reachable before sending
- **Media hosting** — serve attachments from durable, publicly reachable storage (e.g. object storage with signed-but-public URLs)
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
