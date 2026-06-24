# MMS Receive with Node.js and Express

## What Does This Example Do?

Build a production-ready Express webhook endpoint that receives inbound MMS messages using the Telnyx Node.js SDK. This tutorial demonstrates webhook configuration, message parsing, media handling, and proper error handling for production resilience. You'll learn how to accept MMS payloads from Telnyx, extract media URLs, and persist message data.

## Who Is This For?

- **Node.js developers** building sms features with Express.
- **Backend engineers** integrating telephony or messaging into existing applications.
- **DevOps teams** looking for containerized, production-ready telecom examples.
- **Startups and enterprises** replacing legacy telecom providers with a modern API-first platform.

## Why Telnyx?

Telnyx is an **AI Communications Infrastructure** platform that gives developers a single API for [voice](https://telnyx.com/products/voice-ai-agents), [messaging](https://telnyx.com/products/sms-api), [SIP](https://telnyx.com/products/sip-trunks), [AI](https://telnyx.com/ai-assistants), and [IoT](https://telnyx.com/products/iot-sim-card) — no Frankenstack required.

- **Integrated platform** — [Voice](https://telnyx.com/products/voice-ai-agents), [SMS](https://telnyx.com/products/sms-api), [SIP trunking](https://telnyx.com/products/sip-trunks), [AI assistants](https://telnyx.com/ai-assistants), and [IoT SIM management](https://telnyx.com/products/iot-sim-card) under one roof. No stitching together multiple vendors.
- **Global private network** — Calls and messages traverse the Telnyx-owned IP network for lower latency and higher reliability than the public internet.
- **Developer-first** — SDKs for Python, Node.js, Go, Ruby, Java, and PHP. Comprehensive webhook event model. Sandbox environment for testing.
- **Competitive pricing** — Pay-as-you-go with no minimums, contracts, or per-seat fees.

## Prerequisites

- Node.js 14 or higher.
- A Telnyx account with an active API key from the [Telnyx Portal](https://portal.telnyx.com).
- A Telnyx phone number enabled for inbound MMS.
- npm (Node package manager).
- A publicly accessible URL (ngrok, Heroku, or similar) to expose your local webhook during development.

## Quick Start

### Option 1: Local (recommended)

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/receive-mms-webhook-nodejs
cp .env.example .env
# Edit .env with your Telnyx API key and phone number
make setup
make run
```

### Option 3: Manual

See the [Implementation Details](#implementation-details) section below for step-by-step instructions.

## Implementation Details

Create `app.js` and initialize the Telnyx client using the new pattern. Define a helper function to handle inbound MMS messages with proper validation and media extraction:

```javascript
const express = require("express");
const bodyParser = require("body-parser");
const Telnyx = require("telnyx");
require("dotenv").config();

const app = express();
app.use(bodyParser.json());

// Initialize client with the new SDK pattern
const client = new Telnyx({ apiKey: process.env.TELNYX_API_KEY });

/**
 * Parse inbound MMS message and extract media URLs.
 * Returns JSON-serializable message data.
 */
function parseInboundMMS(payload) {
  const event = payload.data;
  
  if (!event || !event.payload) {
    throw new Error("Invalid webhook payload structure");
  }

  const message = event.payload;
  
  // Extract media URLs from the message
  const mediaUrls = [];
  if (message.media && Array.isArray(message.media)) {
    message.media.forEach((mediaItem) => {
      if (mediaItem.url) {
        mediaUrls.push({
          url: mediaItem.url,
          type: mediaItem.type || "unknown",
          size: mediaItem.size || null,
        });
      }
    });
  }

  // Return serializable message data
  return {
    messageId: message.id,
    from: message.from?.phone_number || "unknown",
    to: message.to?.[0]?.phone_number || "unknown",
    text: message.text || "",
    mediaCount: mediaUrls.length,
    media: mediaUrls,
    receivedAt: message.received_at || new Date().toISOString(),
    direction: message.direction || "inbound",
  };
}

/**
 * Store message data (in-memory for demo; use database in production).
 */
const messageStore = [];

function storeMessage(messageData) {
  messageStore.push({
    ...messageData,
    storedAt: new Date().toISOString(),
  });
  // Keep only last 100 messages in memory
  if (messageStore.length > 100) {
    messageStore.shift();
  }
}
```

## Complete Code

See [`server.js`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/receive-mms-webhook-nodejs/server.js) for the full implementation.

## Troubleshooting

| Issue | Problem | Solution |
|-------|---------|----------|
| Webhook not receiving messages | The endpoint is running but Telnyx is not sending POST requests to your webhook URL. | Verify that your Messaging Profile in the [Telnyx Portal](https://portal.telnyx.com) has the correct webhook URL configured. Ensure the URL is publicly accessible (test with `curl https://your-url/health`). If using ngrok, confirm the tunnel is active and the URL in your `.env` matches the ngrok HTTPS URL. Restart your Express server after updating the webhook URL. |
| Invalid webhook payload error | The endpoint returns `{"error": "Invalid webhook payload structure"}` when MMS is received. | Confirm that Telnyx is sending the webhook in the expected format with `data.payload` structure. Check your server logs for the actual payload structure. The webhook payload must include `data.payload.id`, `data.payload.from`, `data.payload.to`, and optionally `data.payload.media`. If the structure differs, update the `parseInboundMMS()` function to match Telnyx's actual payload format. |
| Media URLs are empty or null | MMS messages are received but the `media` array is empty or media URLs are not extracted. | Verify that the MMS message actually contains media attachments. Check the raw webhook payload in your server logs to confirm `data.payload.media` is populated. Ensure media items have a `url` property. If media is present but not extracted, update the media extraction logic in `parseInboundMMS()` to match the actual media object structure from Telnyx. |
| Port already in use | Starting the server fails with "EADDRINUSE: address already in use :::3000". | Change the PORT in your `.env` file to an available port (e.g., 3001, 3002). Alternatively, kill the process using port 3000 with `lsof -ti:3000 \| xargs kill -9` (macOS/Linux) or `netstat -ano \| findstr :3000` (Windows). |
| Environment variables not loading | The server starts but `process.env.TELNYX_API_KEY` is undefined. | Ensure your `.env` file exists in the same directory as `app.js` and contains the required variables. Verify the file is named exactly `.env` (not `.env.txt` or `env`). The `require("dotenv").config()` call must execute before any `process.env` access. Restart the server after creating or modifying the `.env` file. |

## FAQ

**Q: Do I need a Telnyx account to run this example?**

Yes. Sign up at [portal.telnyx.com](https://portal.telnyx.com) to get an API key. Telnyx offers free trial credit for testing.

**Q: Can I use this SMS example in production?**

Yes. This example includes error handling and environment-based configuration. Review the security and scaling sections before deploying to production.

**Q: What Node.js version do I need?**

Node.js 18 or higher. Node.js 20 LTS is recommended.

**Q: How is Telnyx different from Twilio?**

Telnyx is an AI Communications Infrastructure platform with a private global network, integrated voice + messaging + AI + SIP + IoT under one API, and significantly lower pricing. No need to stitch together multiple vendors.

**Q: Where do I get a Telnyx phone number?**

Log into the [Telnyx Portal](https://portal.telnyx.com), navigate to Numbers > Search & Buy, and purchase a number with the capabilities you need (SMS, voice, or both).

## Resources

- [Messaging Overview](https://developers.telnyx.com/docs/messaging)
- [Send an SMS — Quickstart](https://developers.telnyx.com/docs/messaging/messages/send-message)
- [Messaging API Reference](https://developers.telnyx.com/api-reference/messages/send-a-message)
- [Node.js SDK](https://developers.telnyx.com/development/sdk/node)
- [Telnyx SMS API](https://telnyx.com/products/sms-api)
- [Messaging Pricing](https://telnyx.com/pricing/messaging)

## Related Examples

- [Receive SMS Webhooks with Node.js](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/sms/nodejs/receive-sms-webhook).
- [Send Bulk SMS Messages with Node.js](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/sms/nodejs/send-bulk-sms).
- [Implement Two-Factor Authentication with SMS](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/sms/nodejs/otp-2fa).
